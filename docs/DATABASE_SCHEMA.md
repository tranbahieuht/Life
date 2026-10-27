# Database LIFE OS và hướng dẫn chạy migration

Đã chuẩn bị schema và kiểm thử cục bộ. **Chưa chạy bất kỳ migration nào lên Supabase thật.** Không thay đổi `.env.local`, không dùng key quản trị, không tạo tài khoản hay chỉnh dữ liệu của bạn.

Sau final audit có **ba migration**. [DATABASE_AUDIT.md](DATABASE_AUDIT.md) ghi kết quả mới nhất; [DATABASE_DEPLOYMENT.md](DATABASE_DEPLOYMENT.md) là hướng dẫn triển khai hiện hành. Migration 003 bổ sung sửa grants, revision, load fallback, unlink và validation; hai file trước giữ nguyên. Các số liệu 111 tests dưới đây là kết quả lịch sử trước audit.

## Kiến trúc

Giữ nguyên hợp đồng `AppData` và hai RPC `load_life_os()` / `save_life_os(p_data,p_expected_revision)` mà API hiện tại sử dụng. JSONB giữ dữ liệu ứng dụng; cột generated phục vụ truy vấn/index và luôn lấy giá trị từ payload, tránh hai bản dữ liệu độc lập. Trigger kiểm tra các trường quan trọng ở PostgreSQL, ngoài Zod tại server.

| Bảng | Khóa và vai trò |
| --- | --- |
| `profiles` | PK `id` → `auth.users.id`; tên hiển thị |
| `user_preferences` | PK `user_id` → Auth; payload cài đặt, generated `language`, `timezone` |
| `events` | PK `(user_id,id)`; nguồn duy nhất cho lịch, giờ, loại, trạng thái; generated `task_id`, title/date/time/category/status |
| `tasks` | PK `(user_id,id)`; công việc, deadline, mức ưu tiên, thời lượng, hoàn thành; một task có nhiều phiên làm việc trong events |
| `subjects` | PK `(user_id,id)`; tên môn học, giảng viên |
| `class_schedules` | PK `(user_id,event_id)`; FK event, subject; metadata phòng học, không lưu lịch riêng |
| `meal_templates` | PK `(user_id,id)`; định nghĩa món/bữa ăn có thể tái sử dụng |
| `meals` | PK `(user_id,event_id)`; FK event, template; một bữa dự kiến tương ứng một event |
| `meal_logs` | PK `(user_id,id)`; FK event tùy chọn, tên món, thời điểm ăn thực tế, số khẩu phần, payload dinh dưỡng |
| `workout_plans` | PK `(user_id,id)`; tên, loại, mô tả kế hoạch |
| `workout_sessions` | PK `(user_id,event_id)`; FK event, plan; thời điểm bắt đầu/kết thúc thực tế |
| `exercises` | PK `(user_id,plan_id,id)`; FK plan; thứ tự, payload tên/số hiệp/số lần/tạ/thời gian nghỉ |
| `exercise_logs` | PK `(user_id,id)`; số đo lịch sử, ngày tập; giữ mã event/exercise dạng tham chiếu lịch sử |
| `ai_plan_proposals` | PK `(user_id,id)`; prompt, summary, base_revision, payload đề xuất, trạng thái proposed/accepted/rejected, accepted_at |
| `event_recurrences` | PK `(user_id,event_id)`; FK event; quy tắc tuần, các thứ, ngày kết thúc |
| `event_exceptions` | PK `(user_id,event_id,occurrence_date)`; FK event; các lần lặp bị loại trừ |
| `user_sync_state` | PK `user_id`; revision cho đồng bộ nguyên tử và phát hiện xung đột |
| `notifications` | PK `(user_id,id)`; FK event tùy chọn; lịch nhắc, trạng thái đã đọc |

Mọi bảng có `created_at` và `updated_at` kiểu `timestamptz`; trigger tự cập nhật `updated_at`. Bảng gốc tham chiếu Auth; bảng con dùng FK kết hợp `user_id` và ID cha. Cùng một UUID ở tài khoản khác không thể được dùng để vượt qua quyền sở hữu. Meal log cũ giữ `consumed_at`/`servings` mới ở NULL khi chưa biết giá trị; default chỉ áp dụng cho bản ghi mới, không giả định thời điểm ăn trong lịch sử.

## Đồng bộ với Timeline

- Calendar và Daily Timeline đọc cùng `events`; không tạo bảng calendar riêng.
- Tasks lưu riêng deadline; phiên làm việc là event với `details.taskId`. FK generated bắt buộc task thuộc cùng người dùng, được kiểm tra tại commit. Khi xóa task, UI hiện có gỡ liên kết và giữ phiên lịch.
- Nutrition dùng event category `nutrition`, `details.templateId` và thông tin dinh dưỡng tại lúc lên lịch. Trigger tạo/upsert `meals` bằng khóa event. Workout dùng tương tự với `details.planId` và `workout_sessions`. Lưu lại nhiều lần không nhân đôi lịch hay metadata.
- Study event tạo/upsert `class_schedules`; `subjects` là danh mục riêng, không tự suy đoán môn từ tiêu đề. `details.subjectId` có thể liên kết môn đã có.
- Giờ/ngày dự kiến giữ nguyên định dạng local clock của app, diễn giải bằng timezone trong preferences. Không chuyển timezone hay đổi giờ hiện có. Audit, intake và thời điểm tập thực tế dùng `timestamptz`.
- Xóa template/plan/subject chỉ gỡ FK của metadata, giữ event. Xóa event giữ meal log và đặt `event_id=null`. Exercise logs không có FK xóa dây chuyền, nên vẫn giữ lịch sử khi xóa plan/event.
- Metadata cũ được giữ khi đổi category để tránh mất thông tin; các màn hình hiện tại vẫn xác định loại hoạt động từ event. Metadata không tự sinh thêm event.
- Hai RPC hiện đồng bộ sáu collection của frontend: events, tasks, preferences, mealTemplates, workoutPlans, exerciseLogs. Subjects, meal_logs và lịch sử AI có schema/RLS sẵn cho API mở rộng; bước này không tự thêm form mới hay tự lưu mọi phản hồi AI. Đề xuất chỉ thay đổi lịch sau hành động chấp nhận hiện có.

Snapshot save khóa revision theo người dùng, kiểm tra phiên bản, rồi ghi trong một transaction. Snapshot thiếu collection/null bị từ chối; ghi lỗi hoặc revision cũ rollback toàn bộ. Các thao tác DELETE trong thân RPC chỉ áp dụng dữ liệu của chủ sở hữu khi người dùng đồng bộ một snapshot đã được duyệt; chúng không được gọi khi chạy migration. Không tự nhập hay ghi đè workspace local.

Sau migration 003, direct writes cũng khóa counter trước row locks và tăng revision. Revision mới lớn hơn N, không nhất thiết N+1. Bảng nội bộ user_sync_state không được xóa/reset qua API. GRANT không cho TRUNCATE/REFERENCES/TRIGGER/MAINTAIN. Load giữ records/profile đã có khi chưa khởi tạo preferences bằng defaults trong bộ nhớ, không ghi khi GET.

## Bảo mật và kiểm thử

- 18 bảng có RLS, mỗi bảng bốn policy SELECT/INSERT/UPDATE/DELETE dành cho `authenticated`. USING giới hạn hàng đang truy cập; WITH CHECK chặn tạo hàng hoặc chuyển quyền sở hữu sang tài khoản khác. `anon` và `PUBLIC` không được cấp quyền bảng/RPC.
- Hai RPC và các trigger dùng `SECURITY INVOKER`, search_path cố định; mọi thao tác chạy dưới quyền/RLS của người gọi. SQL Editor chạy với quyền quản trị nên việc xem được mọi hàng ở đó không kiểm chứng RLS cho người dùng.
- Các index theo người dùng/ngày/trạng thái, deadline/ưu tiên, khóa ngoại, ngày ăn/tập và trạng thái đề xuất. PK đều bắt đầu bằng user_id ở các collection để hỗ trợ truy vấn theo chủ sở hữu.
- `npm run test:db` chạy SQL thật trên PostgreSQL WASM (PGlite) trong bộ nhớ, mô phỏng đúng role `anon`, `authenticated` không BYPASSRLS và hàm `auth.uid()`. Không đọc env, kết nối mạng hoặc dùng Supabase thật.
- Test chạy cả hai migration nguyên bản, kiểm tra dữ liệu cũ ở mọi bảng không đổi khi nâng cấp, CRUD cho chủ sở hữu, chặn CRUD chéo tài khoản và chuyển ownership, chặn anon, tenant FK, validation, timestamps, round-trip frontend, không trùng metadata, xung đột revision và rollback.
- Đây là kiểm thử PostgreSQL cục bộ, chưa thay thế kiểm thử end-to-end qua Supabase Auth/PostgREST thật. Sau khi bạn áp dụng migration trên môi trường staging, có thể dùng hai tài khoản thử riêng theo `docs/BACKEND.md` và `supabase/tests/rls.mjs`. Script live có ghi dữ liệu thử nên không tự chạy trong bước này.

Kết quả kiểm tra ngày 27/10/2026: 32 kiểm thử database/RLS và toàn bộ 111 kiểm thử đạt; TypeScript và production build thành công. Baseline, migration bổ sung và script verify đều được thực thi trong PostgreSQL cục bộ khi kiểm thử.

## SQL Editor deployment after final audit

Follow [DATABASE_DEPLOYMENT.md](DATABASE_DEPLOYMENT.md) for the authoritative Vietnamese instructions. Run `supabase/preflight.sql` first, then only missing migrations in order:

1. `202610260001_life_os.sql`
2. `202610270001_schema_hardening.sql`
3. `202610270002_final_audit.sql`

Run each complete transaction once. Never replay an installed migration or delete tables to force installation. After all three are present, run `supabase/verify_schema.sql` and `npm run check:supabase`, then validate with two disposable staging accounts. No production migration has been run by this audit.
