# LIFE OS — Final database audit

Ngày kiểm tra: 27/10/2026. Phạm vi: SQL migrations, grants/RLS, RPC, triggers/constraints, client đồng bộ, API và quy trình triển khai. **Chưa triển khai migration lên Supabase production.**

## 1. Database Audit

Số liệu lấy từ PostgreSQL cục bộ sau ba migration, lưu tại `DATABASE_AUDIT_COUNTS.json`:

| Hạng mục | Số lượng |
| --- | ---: |
| Bảng | 18 |
| Owner policies | 72 |
| RPC nghiệp vụ | 2 |
| Primary keys | 18 |
| Foreign keys | 24 |
| CHECK constraints | 28 |
| Deferred constraint trigger | 1 |
| NOT NULL constraints trong catalog PostgreSQL 18 | 95 |
| Tổng constraints trong catalog PostgreSQL 18 | 166 |
| Indexes, gồm PK indexes | 34 |

Không có UNIQUE độc lập ngoài 18 PK: uniqueness của metadata là `(user_id,event_id)`, của bản ghi là PK theo tenant; exercises dùng `(user_id,plan_id,id)`. UUID không cần unique toàn cục giữa các tài khoản. PostgreSQL 15–17 lưu NOT NULL dưới dạng thuộc tính cột thay vì các hàng `pg_constraint` kiểu `n`, nên tổng catalog sẽ khác; không dùng 166 như một điều kiện bắt buộc trên mọi phiên bản.

### Các vấn đề phát hiện và đã sửa

| Vấn đề | Ảnh hưởng | Sửa và bằng chứng |
| --- | --- | --- |
| HIGH — GRANT CRUD không thu hồi quyền ALL được cấp từ default privileges | Role có thể còn TRUNCATE/REFERENCES/TRIGGER; TRUNCATE không chịu RLS. Đây là rủi ro tùy cấu hình default grants, không phải bằng chứng production đã bị truy cập. | Migration 003 revoke ACL bảng/cột rồi cấp đúng quyền; test dựng default ALL và xác nhận TRUNCATE bị từ chối ở cả 18 bảng. |
| HIGH — Ghi trực tiếp không tăng revision; counter có thể bị xóa/reset | Snapshot cũ có thể ghi đè dữ liệu từ client khác. | Mọi authenticated writer khóa counter trước row locks; statement trigger tăng revision, counter monotonic và không được DELETE qua API. Native test kiểm tra direct DML và hai phiên RPC chồng lấn. |
| HIGH — Load trả data=NULL khi chưa có preferences dù đã có records/profile | App có thể mở workspace trống rồi lưu snapshot mất các bản ghi trực tiếp. | Load STABLE dựng preferences tương thích trong bộ nhớ và trả bản ghi đã có, giữ tên hồ sơ; không ghi dữ liệu khi GET. Regression test round-trip trực tiếp. |
| MEDIUM — Gỡ subjectId bị COALESCE giữ lại liên kết cũ | University metadata không khớp thao tác gỡ liên kết. | Gán FK từ liên kết hiện tại; test link → unlink → đổi category → lưu lặp. |
| MEDIUM — Validation DB chưa kiểm tra đủ required fields; API tin envelope/ack không hợp lệ | Direct RPC có thể lưu workspace mà frontend không mở lại được; phản hồi lỗi hình dạng có thể bị hiểu là workspace trống/synced. | Trigger kiểm tra hợp đồng payload, bounds và checklist; API xác minh envelope/revision và ack tăng hợp lệ. Test malformed preferences/ack, rollback. |
| MEDIUM — Đổi ngày event trực tiếp có thể làm recurrence.until trước ngày bắt đầu | Load sau đó không qua Zod. | Constraint trigger deferred kiểm tra trạng thái cuối transaction; cho phép reschedule event và recurrence nguyên tử, chặn trạng thái cuối không hợp lệ. |
| MEDIUM — Verify chỉ đếm policies, chưa kiểm tra nội dung và quyền đặc biệt | Policy tên đúng nhưng USING/WITH CHECK=true hoặc grant rộng có thể bị bỏ sót. | Verify kiểm tra biểu thức/role/cmd, table/column ACL, quyền đặc biệt và search_path; test drift chủ động. |
| Tooling — npm audit báo các advisory moderate/critical ở bộ test Vitest/tinypool cũ | Ảnh hưởng công cụ dev/test; không phải dependency runtime của ứng dụng. | Nâng Vitest 5.0.5 và Vite 6.4.x, chạy lại test; `npm audit` và `npm audit --omit=dev` đều 0 vulnerabilities tại lúc kiểm tra. Node dev/test yêu cầu 22.12+, đã kiểm tra trên Node 24. |

Đồng thời sửa script staging: dùng cùng UUID ở cột id và payload để test INSERT chéo tài khoản thực sự đi tới RLS thay vì thất bại sớm vì payload mismatch; bỏ giả định revision=N+1.

## 2. Security Audit

- 18 bảng bật RLS; mỗi bảng có SELECT/INSERT/UPDATE/DELETE policy cho đúng `authenticated`. USING và WITH CHECK dựa trên `(select auth.uid())` với owner column. UPDATE không chuyển dữ liệu sang tenant khác.
- `anon` và `PUBLIC` không có quyền dữ liệu/RPC riêng tư; authenticated chỉ có CRUD bảng nghiệp vụ, không TRUNCATE/REFERENCES/TRIGGER/MAINTAIN. `user_sync_state` là metadata nội bộ: có SELECT/INSERT/UPDATE phục vụ RPC/triggers, không DELETE; trigger chặn reset/nhảy counter. Policy DELETE của bảng này vẫn tồn tại nhưng GRANT không cho thực thi.
- PK/FK kết hợp user_id chặn tham chiếu chéo tài khoản. Profile/user preferences tham chiếu Auth UUID. Audit không cấp BYPASSRLS hay quyền quản trị cho app.
- Hai RPC dùng SECURITY INVOKER, search_path rỗng, auth.uid(), không nhận owner_id từ client. Các SQL động chỉ dùng identifier đã kiểm soát và `%I`; JSON của người dùng không được ghép thành câu SQL. Test nội dung giống SQL vẫn được lưu như text.
- Các trigger helper không có EXECUTE cho PUBLIC/anon/authenticated; trigger vẫn được PostgreSQL gọi theo định nghĩa đã cài. Hai scalar validator dùng cho generated columns được giới hạn đúng quyền cần thiết.
- Snapshot locks theo user; các user khác không dùng chung khóa. Revision mới tăng, có thể lớn hơn N+1 do metadata/direct writes, được giới hạn trong số nguyên JS an toàn.
- Retry cùng revision sau lần lưu đã commit trả conflict, không lặp tác dụng ghi. UI giữ bản local, tải lại cloud và yêu cầu recovery khi khác nhau; không tự tăng revision của snapshot cũ.

Admin/SQL Editor và service-role là quyền vận hành có thể bypass RLS theo thiết kế PostgreSQL/Supabase; audit không dùng chúng để kiểm chứng quyền của user, cũng không đưa key này vào ứng dụng. Việc chỉnh trực tiếp bởi admin nằm ngoài giao thức revision của client; cần cửa sổ maintenance khi vận hành dữ liệu thủ công.

## 3. Fixes Applied

- `supabase/migrations/202610270002_final_audit.sql`: toàn bộ sửa DB, preflight trạng thái/policies/FK, quyền tối thiểu, khóa/revision, contract validation, unlink, load fallback và constraint trigger. Transaction không thực thi DML lên hàng nghiệp vụ.
- `supabase/verify_schema.sql`, `supabase/preflight.sql`: verification mạnh hơn và hướng dẫn xác định trạng thái trước deploy, chỉ đọc metadata.
- `src/app/api/data/route.ts`: xác minh phản hồi DB để giữ an toàn cache/local khi hợp đồng không đúng.
- `tests/database-audit.test.ts`, `tests/database-native.test.ts`, `tests/helpers/database-audit.ts`: regression, grants mặc định, drift và test native hai phiên.
- `tests/backend-data.test.ts`: malformed envelopes/ack; `tests/database-schema.test.ts`: giữ bộ kiểm tra migration lịch sử 001/002, chuyển verify hiện hành sang bộ audit 003.
- `supabase/tests/rls.mjs`: sửa kiểm tra staging cho UUID và revision; **không chạy script ghi này lên Supabase trong audit**.
- `scripts/test-native-db.mjs`, `package.json`, `package-lock.json`, `.gitignore`: runner/dependencies dev và cô lập native cluster test.
- `README.md`, `DATABASE_SCHEMA.md`, `SUPABASE_CONNECTION.md`, `BACKEND.md`, `VALIDATION.md`, `DATABASE_DEPLOYMENT.md`: đồng bộ thứ tự ba migration và quy trình kiểm tra.

Hai file migration 001/002 giữ nguyên; không sửa lịch sử đã công bố. Không sửa `.env.local`, dịch enum, đổi timezone hoặc UI. `events` vẫn là nguồn duy nhất cho Calendar/Timeline/Tasks/Nutrition/Workout. Metadata theo event giữ lịch sử khi đổi category và không tạo thêm event. Meal history và exercise logs vẫn được giữ theo cascade rules đã kiểm thử.

## 4. Test Results

| Kiểm tra | Kết quả |
| --- | --- |
| `npm test` | 153 passed; 7 native tests skip có chủ đích ở lệnh mặc định |
| `npm run test:db` | 64 passed, gồm kiểm tra hai migration lịch sử và migration audit |
| `npm run test:db:native` | 7 passed trên PostgreSQL 18.4 riêng, không mock khóa/concurrency |
| TypeScript | Passed |
| Production build | Passed |
| Playwright production regression | 8 passed: Timeline CRUD, timetable, task scheduling, meal/workout history, Auth/API và form 390px/1440px |
| npm audit, gồm dev dependencies | 0 vulnerabilities tại thời điểm kiểm tra |

Tổng các test tự động đã chạy: **160 tests unit/API/database + 8 browser tests = 168 passed, 0 failed**. Không cộng `test:db` lần nữa vì nó là subset của npm test. Bảy native tests được chạy riêng bằng opt-in, không còn hạng mục đó chưa được thực thi.

Native tests tạo database sạch, chạy đủ ba migration và preflight/verify nguyên bản. Hai connection thật kiểm tra chờ khóa, commit/conflict, rollback/release, khác user, race khởi tạo counter lần đầu và FK deferred thất bại ở commit. Cluster loopback, user/password ngẫu nhiên, đã dừng và dọn đúng thư mục test. Bộ PGlite cũng kiểm tra dữ liệu cũ không đổi khi nâng cấp và migration 002 rollback nếu dữ liệu legacy không tương thích.

Đã kiểm tra Supabase thật chỉ đọc: Auth HTTP 200; Data API reachable nhưng events trả PGRST205 (chưa có trong exposed schema cache). Không suy ra RLS production hoặc schema đã triển khai từ phép kiểm tra này.

## 5. Migration Readiness

**READY FOR DEPLOYMENT trong phạm vi code/migration và môi trường PostgreSQL cục bộ đã kiểm thử.** Không đồng nghĩa đã triển khai hoặc đã xác nhận end-to-end trên Supabase thật.

Còn phải xác minh sau khi được bạn cho phép áp dụng: schema thực tế/policy default trên project đích, SQL verification, PostgREST schema reload, JWT A/B và anon, flow email/callback, đồng bộ nhiều thiết bị qua API và hiệu năng snapshot trên dữ liệu staging đại diện. Chưa có staging Supabase riêng/tài khoản thử được cung cấp; không dùng production để thay thế.

## 6. Deployment Instructions

Làm theo [DATABASE_DEPLOYMENT.md](DATABASE_DEPLOYMENT.md): preflight → chỉ chạy migration còn thiếu theo 001 → 002 → 003 → verify → kiểm tra API và hai tài khoản staging → mở lại writer. Mỗi file chạy nguyên transaction một lần. Nếu lỗi: ROLLBACK, giữ các file đã thành công, rà soát nguyên nhân; không DROP/TRUNCATE dữ liệu hay replay baseline.

Tham khảo đối chiếu: [PostgreSQL RLS và các thao tác ngoài phạm vi RLS](https://www.postgresql.org/docs/17/ddl-rowsecurity.html), [Supabase RLS](https://supabase.com/docs/guides/database/postgres/row-level-security), [Vitest migration](https://vitest.dev/guide/migration/).
