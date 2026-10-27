# Supabase: kết nối và đề xuất dữ liệu

## Trạng thái kiểm tra ngày 27/10/2026

- Next.js 16 App Router; đã cài `@supabase/supabase-js` và `@supabase/ssr`.
- Browser client: `src/lib/supabase/client.ts`; server client: `src/lib/supabase/server.ts`.
- Phiên đăng nhập dùng cookie/PKCE, được làm mới qua `src/proxy.ts`. API dữ liệu xác minh người dùng ở server bằng `auth.getUser()`.
- Giao diện hiện có hỗ trợ đăng ký, đăng nhập email/mật khẩu, đăng xuất, quên mật khẩu và đổi mật khẩu. Callback ở `/auth/callback`.
- Ưu tiên `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`, tiếp tục hỗ trợ biến anon cũ.
- Next.js đã nhận đủ URL và publishable key từ `.env.local`. Auth settings trả HTTP 200, đăng nhập email và đăng ký được bật.
- Truy vấn chỉ đọc `/rest/v1/events?select=id&limit=0` nhận HTTP 404, mã `PGRST205`: đã truy cập được PostgREST, nhưng bảng `events` chưa có trong schema cache được công khai. Chưa thể đồng bộ dữ liệu nghiệp vụ trước khi triển khai schema. Không suy ra quyền đọc/ghi hay tính đúng đắn của RLS từ phép kiểm tra này.
- Không tạo tài khoản, gửi email, tạo bảng, chạy migration hoặc thay đổi dữ liệu trên Supabase.
- Kiểm tra hoàn tất với cấu hình thật: `npm run typecheck`, `npm run build` thành công; `npm test` đạt 79/79 (gồm ưu tiên cấu hình, callback PKCE, phân loại kết quả probe và bảo vệ API). Các kiểm thử dùng mock không thay thế kiểm thử đăng nhập/database thật.
- Smoke test production đạt 3/3: API dữ liệu từ chối phiên chưa đăng nhập (401), callback thiếu code chuyển hướng an toàn, form đăng nhập/khôi phục mật khẩu mở được ở 390px và 1440px mà không đổi dữ liệu local. Không gửi form, tạo tài khoản hay gửi email. Chạy lại bằng `LIFE_OS_CHECK_SUPABASE=1` và `PLAYWRIGHT_BASE_URL` trỏ tới server production, rồi `npx playwright test tests/e2e/supabase.spec.ts`.

Khi thay đổi `NEXT_PUBLIC_SUPABASE_URL` hoặc `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` trong `.env.local`, khởi động lại dev server hoặc build lại. Không đưa secret/service-role key vào các biến public.

Chạy `npm run check:supabase` để kiểm tra lại. Lệnh chỉ GET Auth settings và truy vấn bảng `events` với `limit=0`, in trạng thái HTTP và các cờ khả dụng; không in key, URL dự án, dữ liệu người dùng hay nội dung lỗi nhà cung cấp. `reachable=true` với `eventsTableAvailable=false` là trạng thái kết nối được nhưng chưa sẵn sàng lưu dữ liệu. Endpoint OpenAPI gốc có thể yêu cầu key quản trị nên không được dùng làm tiêu chí kết nối bằng public key. Không cần cung cấp thêm key quản trị.

Trong Supabase Dashboard, cấu hình Site URL và redirect URL chính xác: ví dụ `http://127.0.0.1:3000/auth/callback`, địa chỉ localhost nếu dùng, và `/auth/callback` ở tên miền triển khai. Kiểm tra email confirmation/SMTP theo cấu hình dự án. Luồng đăng nhập thật cần một tài khoản hợp lệ và chưa được kiểm thử trong bước này.

## Schema đề xuất — chưa áp dụng

Giữ `events` làm nguồn lịch thống nhất cho Timeline và Calendar, tránh lưu cùng một hoạt động ở hai nơi.

| Phạm vi | Bảng đề xuất | Dữ liệu và quan hệ chính |
| --- | --- | --- |
| Hồ sơ/cài đặt | `profiles`, `user_preferences` | Liên kết `auth.users.id`; tên, ngôn ngữ vi/en, timezone IANA, thói quen và thông báo |
| Timeline + Calendar | `events`, `event_recurrences`, `event_exceptions` | Hoạt động, ngày/giờ, loại, trạng thái, mức bảo vệ, quy tắc lặp và ngoại lệ |
| Tasks | `tasks` | Tiêu đề, hạn hoàn thành, ưu tiên, trạng thái, thời lượng dự kiến; liên kết lịch khi được sắp xếp |
| Nutrition | `meal_templates`, `meals`, `meal_logs` | Mẫu món ăn Việt/Anh, định lượng và dinh dưỡng; bữa dự kiến liên kết event, nhật ký thực tế riêng |
| Workout | `workout_plans`, `exercises`, `workout_sessions`, `exercise_logs` | Kế hoạch, bài tập, buổi tập liên kết event; số hiệp/lần/tạ và kết quả thực tế |
| AI Planner | `ai_plan_proposals` | Yêu cầu, bản đề xuất, phạm vi ngày, thay đổi, cảnh báo, trạng thái chấp nhận/từ chối và phiên bản dữ liệu gốc |
| Đồng bộ/thông báo | `user_sync_state`, `notifications` | Revision chống ghi đè đồng thời; trạng thái thông báo theo người dùng |

Nguyên tắc triển khai:

- UUID cho khóa chính; `user_id` bắt buộc, tham chiếu `auth.users`, bật RLS với `auth.uid() = user_id` trên mọi bảng riêng tư.
- Khóa ngoại giữa các bảng có cả `user_id` để tránh tham chiếu chéo tài khoản. Index theo người dùng/ngày, deadline/trạng thái và các khóa ngoại.
- Không dịch enum trong database. `language` chỉ thay đổi hiển thị/giao tiếp. Giữ nguyên quy ước thời gian hiện tại; lưu timezone riêng, dùng `timestamptz` cho thời điểm audit/thông báo tuyệt đối.
- Chấp nhận đề xuất AI mới ghi lịch, trong transaction; dùng revision để phát hiện xung đột. AI không được ghi database trực tiếp.
- Lưu nhật ký ăn/tập tách khỏi lịch dự kiến, giữ lịch sử khi thay đổi template/kế hoạch.
- Snapshot/RPC hiện tại dùng payload JSONB kết hợp cột phục vụ ràng buộc/index. Khi chuẩn hóa sâu hơn, cần migration tương thích và kiểm thử round-trip, không đổi hợp đồng frontend đột ngột.

Schema hiện đã được hoàn thiện bằng baseline `supabase/migrations/202610260001_life_os.sql` và migration bổ sung `supabase/migrations/202610270001_schema_hardening.sql`, kèm kiểm thử PostgreSQL/RLS cục bộ. **Chưa chạy migration trên Supabase thật.** Xem [DATABASE_SCHEMA.md](DATABASE_SCHEMA.md) để biết thiết kế, giới hạn và chính xác cách chạy SQL Editor sau khi bạn quyết định áp dụng. Auth hoạt động độc lập với các bảng nghiệp vụ; đồng bộ cần `load_life_os` và `save_life_os` sau khi schema được triển khai.

Final audit bổ sung `202610270002_final_audit.sql`; hai migration cũ giữ nguyên và cả ba chưa được triển khai lên Supabase thật. Kiểm tra chỉ đọc vẫn xác nhận Auth HTTP 200 và events PGRST205. Xem [DATABASE_AUDIT.md](DATABASE_AUDIT.md) cho kết quả mới nhất và [DATABASE_DEPLOYMENT.md](DATABASE_DEPLOYMENT.md) cho thứ tự ba migration. Verify hiện hành yêu cầu đủ cả ba file.

Tham khảo: [Supabase SSR clients](https://supabase.com/docs/guides/auth/server-side/creating-a-client).
