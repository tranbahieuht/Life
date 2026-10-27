# Triển khai database LIFE OS sau audit

Các migration chưa được chạy lên Supabase production. Các lệnh ghi và bài test trong audit chỉ dùng database cục bộ riêng. Truy vấn Supabase thật chỉ là GET Auth settings và GET events với `limit=0`; không lấy bản ghi, không tạo tài khoản hay sửa dữ liệu.

## Chuẩn bị

1. Chọn đúng Project trong Supabase Dashboard, kiểm tra tên/ref ở Dashboard. Có backup hoặc snapshot phù hợp nếu project đã có dữ liệu. Không copy key vào SQL Editor, chat hoặc terminal.
2. Thực hiện trước trên project staging riêng. Không chạy script test có ghi dữ liệu bằng tài khoản cá nhân/production.
3. Tạm ngừng các client ghi/đồng bộ trong cửa sổ migration. Không để người dùng ghi giữa các file. Mở **SQL Editor → New query** và chạy toàn bộ `supabase/preflight.sql` (chỉ đọc).

## Chọn đúng thứ tự

| Kết quả preflight | Thao tác |
| --- | --- |
| Có 0/18 bảng LIFE OS; cả hai RPC và marker đều NULL | Chạy 001 → 002 → 003 |
| Có đủ 18 bảng và hai RPC; hardening/final marker NULL | Chạy 002 → 003 |
| Có đủ baseline và hardening; final marker NULL | Chạy 003 |
| Cả hai marker đã có | Không chạy lại; chạy verify và đối chiếu lịch sử SQL/CLI |
| Bảng chỉ có một phần, marker mâu thuẫn hoặc schema ngoài dự kiến | Dừng, rà soát schema/history; không dùng DROP/CASCADE để ép cài |

Tên file chính xác:

1. **001:** `supabase/migrations/202610260001_life_os.sql` — baseline 18 bảng, RLS và RPC.
2. **002:** `supabase/migrations/202610270001_schema_hardening.sql` — constraints, metadata và validation.
3. **003:** `supabase/migrations/202610270002_final_audit.sql` — sửa quyền, revision, unlink, load fallback và kiểm tra hợp đồng dữ liệu.

Với mỗi file còn thiếu: mở **New query**, copy **toàn bộ nội dung**, bao gồm `begin;` và `commit;`, bấm **Run**, đợi thành công rồi mới chuyển sang file kế tiếp. Giữ nguyên thứ tự, không chạy các đoạn riêng lẻ. Mỗi migration chạy một lần. SQL Editor không tự cập nhật lịch sử Supabase CLI; lưu lại tên file đã chạy trong quy trình triển khai của bạn. Nếu sau này dùng CLI, đối chiếu/repair migration history theo đúng các file đã áp dụng trước khi `db push`.

Hai migration đầu được giữ nguyên. File 003 không có DML chạy trực tiếp lên bản ghi nghiệp vụ: nó sửa định nghĩa function/trigger, quyền và thêm constraint kiểm tra. Thân `save_life_os` có DML cho việc đồng bộ bình thường, nhưng không được gọi trong quá trình migration.

## Kiểm tra sau migration

1. New query → copy toàn bộ `supabase/verify_schema.sql` → **Run**. Script chỉ đọc metadata. Mong đợi 18 bảng, RLS bật, 4 owner policies/bảng (72 tổng); không có constraint chưa validate. Script cũng kiểm tra biểu thức USING/WITH CHECK, role, quyền bảng/cột, TRUNCATE, RPC và search_path.
2. Tại `D:\LIFE_OS`, chạy `npm run check:supabase`. Mong đợi Auth HTTP 200, `reachable=true`, `eventsTableAvailable=true`. Đây là kiểm tra Data API, chưa chứng minh RLS của phiên đăng nhập.
3. Kiểm tra Authentication → URL Configuration: Site URL và các callback `/auth/callback` phải đúng origin. Dùng hai tài khoản staging đã xác nhận email, không dùng service-role/secret key.
4. Tài khoản A: tạo/sửa/hoàn thành một hoạt động, task có phiên lịch, bữa ăn và buổi tập; tải lại và đăng nhập lại. Calendar, Timeline, Nutrition, Workout phải đọc cùng một event, không tăng số bản ghi khi lưu lặp. Đổi category/gỡ liên kết phải giữ một event; metadata cũ được giữ làm lịch sử, không dùng làm nguồn lịch thứ hai.
5. Tài khoản B: SELECT bảng/RPC chỉ thấy dữ liệu B; SELECT với `user_id=A` trả `[]`; INSERT giả user A bị từ chối; UPDATE/DELETE hàng A không thay đổi dữ liệu; FK tham chiếu event/plan của A bị từ chối. Thử anon phải bị từ chối. Không đánh giá RLS bằng SELECT dưới role quản trị trong SQL Editor.
6. Hai thiết bị đăng nhập A cùng tải revision N: thiết bị 1 lưu; thiết bị 2 lưu snapshot cũ phải nhận lỗi xung đột 409, giữ bản local và cho người dùng xử lý recovery. Revision mới **lớn hơn N**, không nhất thiết N+1. Không tự retry bằng cách thay revision trong snapshot cũ. Khi mất phản hồi sau lưu, tải lại cloud và dùng recovery thay vì ghi đè.
7. Nếu cần kiểm tra API/RLS tự động trên **staging trống có hai tài khoản thử riêng**, dùng `supabase/tests/rls.mjs`. Cấu hình trong môi trường riêng/staging, không ghi đè `.env.local` production: URL/public key staging, `LIFE_OS_RUN_LIVE_TESTS=1`, `LIFE_OS_TEST_EMAIL_A`, `LIFE_OS_TEST_PASSWORD_A`, `LIFE_OS_TEST_EMAIL_B`, `LIFE_OS_TEST_PASSWORD_B`. Chạy `node --env-file=.env.staging.local supabase/tests/rls.mjs`. Script có ghi/xóa marker, kiểm tra RPC, revision/rollback rồi khôi phục snapshot thử. Có thể còn default preferences/revision mới; chỉ dùng tài khoản dùng một lần, không có chỉnh sửa đồng thời. Không tự chạy bước này trong audit.
8. Kiểm tra đăng ký/xác nhận email, đăng nhập, đăng xuất, khôi phục mật khẩu và callback trên origin triển khai; kiểm tra RLS qua JWT người dùng thực. Đây là phần phải xác minh trên Supabase sau khi bạn cho phép áp dụng migration.

## Khi gặp lỗi

- Chạy `ROLLBACK;` nếu SQL Editor vẫn báo transaction aborted. File lỗi rollback toàn bộ; các file đã thành công trước đó vẫn được giữ.
- `lock_timeout`: dừng các writer, kết thúc transaction đang giữ khóa rồi chạy lại **file chưa thành công**. Không tăng timeout tùy tiện trong khi các client vẫn ghi.
- `relation already exists`, marker đã có hoặc policy ngoài dự kiến: kiểm tra preflight/history. Không chạy lại baseline, không xóa bảng, không đổi thành `CREATE TABLE IF NOT EXISTS` để bỏ qua schema khác.
- Vi phạm FK/CHECK/dữ liệu cũ: migration không tự sửa hay xóa bản ghi. Giữ backup, rà soát lỗi trên staging và chuẩn bị migration sửa dữ liệu được duyệt riêng.
- App lỗi sau deploy: ngừng writer và giữ bản local/backup; không dùng rollback bằng `DROP TABLE`. Khôi phục snapshot theo quy trình backup của project hoặc áp dụng một migration sửa tiếp sau khi được rà soát.
- Quyền/role ngoài dự kiến do cấu hình Supabase: không dùng secret key trong app để vượt lỗi. Verify phải đạt trước khi mở lại đồng bộ.

## Chạy lại kiểm thử cục bộ

```powershell
npm ci
npm run test:db
npm run test:db:native
npm test
npm run typecheck
npm run build
```

Node 22.12+ hoặc Node 24. Native test tự tạo cluster PostgreSQL riêng, chỉ lắng nghe loopback, dùng credentials ngẫu nhiên, dừng và xóa đúng thư mục test của nó. Không đọc biến Supabase hay tạo user hệ điều hành. Nếu môi trường không cho chạy binary PostgreSQL, báo native test chưa chạy; không thay thế bằng ghi thử lên production.
