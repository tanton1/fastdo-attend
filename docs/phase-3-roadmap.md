# FASTDO ATTEND — Kế hoạch giai đoạn tiếp theo

Mục tiêu của giai đoạn 03 là chuyển hệ thống từ MVP có backend thật thành bản pilot có thể dùng tại một doanh nghiệp, với bằng chứng chấm công đủ tin cậy và quy trình quản trị rõ ràng.

## Sprint 1 — Bảo mật và thiết bị (P0 · backend đã triển khai)

- Bật Firebase App Check cho Web và Functions.
- Thêm rate limiting, audit log và cảnh báo thao tác bất thường.
- Xây quy trình đăng ký/duyệt/chặn thiết bị; không hiển thị “tin cậy” trước khi backend xác nhận.
- Tách tài khoản demo khỏi dữ liệu pilot và xoay thông tin đăng nhập.

**Đã đạt:** request không có App Check bị từ chối; API quản trị có thể duyệt/chặn thiết bị; toàn bộ quyết định thiết bị được lưu audit. Giao diện quản trị trực quan được thực hiện trong Sprint 4.

## Sprint 2 — Hiện diện tại cơ sở (ưu tiên P0)

- Xây QR động có chữ ký, nonce và hạn dùng 30–60 giây hoặc Presence Gateway nội bộ.
- Ghép GPS + độ chính xác + thiết bị + bằng chứng hiện diện vào risk score.
- Chống replay, chống gửi lặp và lưu lý do `ALLOW/REVIEW/DENY`.

**Hoàn thành khi:** check-in ngoài geofence hoặc dùng QR cũ bị từ chối; check-in hợp lệ tạo đúng một event và một work session.

## Sprint 3 — Face AI và quyền riêng tư (ưu tiên P0)

- Chọn nhà cung cấp face matching/liveness hoặc dịch vụ tự vận hành.
- Xây enrollment có đồng ý, version biểu mẫu và quy trình thu hồi/xóa dữ liệu.
- Chỉ lưu template/ảnh theo retention policy; mã hóa và giới hạn quyền truy cập.
- Truyền `faceSessionId` đã ký tới `checkIn`; backend xác minh lại trước khi ghi nhận.

**Hoàn thành khi:** camera preview không thể tự được coi là xác minh; replay ảnh/video thất bại; có log và chính sách xóa dữ liệu.

## Sprint 4 — Admin Dashboard và nghiệp vụ (ưu tiên P1)

- Realtime monitor theo chi nhánh, ca làm và trạng thái nhân viên.
- Duyệt cảnh báo, thiết bị, Face enrollment và yêu cầu điều chỉnh công.
- Quản lý nhân viên, ca, phân ca, ngày nghỉ và chính sách chi nhánh.
- Báo cáo công, đi trễ/về sớm, xuất CSV/XLSX cho payroll.

**Hoàn thành khi:** quản trị viên xử lý trọn vòng đời một ca và truy vết được ai thay đổi dữ liệu nào.

## Sprint 5 — PWA pilot và vận hành (ưu tiên P1)

- Service worker, cài đặt PWA, offline shell và hàng đợi retry có idempotency.
- Khôi phục phiên đang làm sau reload; kiểm tra camera/GPS trên iOS Safari và Android Chrome.
- Sentry/Cloud Logging dashboard, budget alert, backup và runbook sự cố.
- Pilot 20–50 nhân viên tại một chi nhánh trong 2–4 tuần.

**Hoàn thành khi:** tỷ lệ check-in thành công trên thiết bị hỗ trợ đạt mục tiêu pilot, không có event trùng và mọi lỗi production có cảnh báo/trace.

## Thứ tự khuyến nghị

Không mở pilot trước khi hoàn tất Sprint 1–3. Admin Dashboard có thể phát triển song song từ cuối Sprint 2, còn PWA offline nên làm sau khi API và mô hình bằng chứng đã ổn định.
