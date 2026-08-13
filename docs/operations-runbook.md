# FASTDO ATTEND — Runbook vận hành

## Luồng hằng ngày

### Nhân viên

1. Đăng nhập và đổi mật khẩu tạm thời nếu được yêu cầu.
2. Cấp quyền camera và vị trí chính xác; sử dụng thiết bị đã được duyệt.
3. Chọn **Chấm công vào**, hoàn thành Pre-check, Face AI (nếu policy yêu cầu) và quét Presence QR.
4. Chờ phản hồi server trước khi rời màn hình; chỉ trạng thái `VALID` hoặc `PENDING_REVIEW` mới là kết quả đã ghi nhận.
5. Trong ca, giữ PWA ở foreground khi cần heartbeat vị trí; chấm công ra khi kết thúc ca.
6. Mở **Lịch sử** để gửi yêu cầu điều chỉnh công hoặc nghỉ phép. Không sửa trực tiếp bản ghi chấm công.

### HR/Quản trị

- **Thiết bị:** duyệt thiết bị mới, khóa thiết bị thất lạc hoặc có dấu hiệu bất thường.
- **Presence QR:** phát mã theo đúng chi nhánh; mã tự hết hạn và chỉ dùng một lần.
- **Nhân viên/Ca:** tạo nhân viên, cấp mật khẩu tạm, gán chi nhánh và ca.
- **Pilot:** bắt đầu ở `MONITOR`, chỉ chuyển `REQUIRED` sau khi canary đạt exit criteria; dùng `OFF` làm kill switch.
- **Yêu cầu:** duyệt/từ chối điều chỉnh công và nghỉ phép; bắt buộc ghi lý do khi từ chối.
- **Payroll:** chọn kỳ và chi nhánh, xuất CSV sau khi các điều chỉnh cần thiết đã được duyệt.
- **Báo cáo:** không dùng trang báo cáo bị `truncated/hasMore` làm tổng payroll.

## Xử lý sự cố

| Triệu chứng | Xử lý đầu tiên |
| --- | --- |
| Thiết bị chờ duyệt | Quản trị mở **Thiết bị** và duyệt đúng người/thiết bị; không duyệt thiết bị dùng chung không xác định. |
| GPS không đạt | Bật Precise Location, ra nơi thoáng và thử lại; nếu vẫn lỗi dùng quy trình thay thế có người duyệt. |
| QR hết hạn | Tạo QR mới tại đúng chi nhánh; không dùng lại ảnh QR cũ. |
| Face không đạt | Kiểm tra ánh sáng/camera; ở `MONITOR` có thể bỏ qua, ở `REQUIRED` dùng fallback đã được phê duyệt. |
| Mất mạng | Không xác nhận thành công ở client; ghi lại thời gian, chụp mã lỗi không chứa dữ liệu Face và báo HR. |
| Nhiều lỗi đồng thời | Chuyển policy chi nhánh về `OFF`, mở incident, giữ audit và không xóa event gốc. |

## Bảo mật và dữ liệu

- PWA không đọc được SSID/BSSID; `allowedWifiSsids` chỉ là cấu hình. Muốn chứng minh Wi‑Fi phải bổ sung Presence Gateway hoặc native wrapper.
- Face template là dữ liệu sinh trắc học nhạy cảm: không đưa vào log, ticket, analytics hoặc bản sao dev/test.
- Rút consent phải vô hiệu template/session/proof ngay ở runtime; TTL chỉ là dọn vật lý bất đồng bộ.
- Face liveness hiện là active challenge MVP, chưa phải PAD được chứng nhận và không được là bằng chứng duy nhất cho payroll/kỷ luật/tranh chấp.
- Giới hạn truy cập theo `companyId`/chi nhánh luôn được kiểm tra ở server; không tin role/tenant do client gửi.

## Go-live checklist

- [ ] Firebase Rules/indexes và 30 callable Functions đã deploy ở `asia-southeast1`.
- [ ] App Check enforcement, Secret Manager keys, billing alert và quota alert hoạt động.
- [ ] Emulator integration test cho Auth/App Check/Rules/tenant isolation/concurrency đạt.
- [ ] Kiểm thử ít nhất hai iPhone và hai Android với browser thường và PWA standalone.
- [ ] Face retention backfill dry-run/apply đã được phê duyệt; TTL được xác minh.
- [ ] Privacy notice, consent version, fallback manual và retention policy được phê duyệt bằng văn bản.
- [ ] Pilot một chi nhánh chạy `MONITOR` tối thiểu một cửa sổ đánh giá; tỷ lệ check-in, latency, false reject và hỗ trợ được ghi nhận.
- [ ] Payroll CSV đã đối soát với adjustment/leave đã duyệt.
- [ ] Có người trực vận hành, kênh incident và kế hoạch rollback về `OFF`.

## Release/rollback

1. Build/lint/test ở branch release.
2. Deploy Functions trước, sau đó Rules/indexes, rồi Vercel.
3. Smoke test đăng nhập, pre-check, Face/QR, check-in/out, request review và payroll CSV.
4. Theo dõi error rate/latency/chi phí trong 30–60 phút.
5. Khi có lỗi nghiêm trọng, chuyển policy chi nhánh về `OFF`, dừng rollout cohort và mở incident; chỉ rollback code sau khi bảo toàn audit/event.
