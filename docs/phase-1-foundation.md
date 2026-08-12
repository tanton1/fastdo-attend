# FASTDO ATTEND — Giai đoạn 01: Nền móng sản phẩm

## Mục tiêu

Tạo một luồng nhân viên có thể kiểm thử trước khi kết nối backend thật:

1. Đăng nhập.
2. Xem ca làm hôm nay.
3. Bắt đầu chấm công.
4. Pre-check thiết bị, vị trí, thời gian và kết nối.
5. Mở camera và thu mẫu thử nghiệm.

## Quyết định sản phẩm

- “Face ID / Passkey” chỉ là xác thực thiết bị qua WebAuthn.
- “Xác minh khuôn mặt” là quy trình camera và Face AI riêng.
- PWA không đọc SSID/BSSID, do đó hiện diện tại cơ sở sẽ dùng QR động hoặc Presence Gateway.
- Prototype hiện tại không tuyên bố xác minh Face AI thành công; màn hình camera chỉ kiểm thử quyền và trải nghiệm.
- Toàn bộ quyết định chấm công thật phải được backend tính lại theo giờ máy chủ.

## Phạm vi đã triển khai

- Design system Black Ignite responsive.
- Luồng Login → Home → Pre-check → Camera prototype.
- Trạng thái kiểm tra, loading, hoàn tất và lỗi quyền camera.
- Mobile layout 390 × 844 và desktop presentation.
- Web app manifest.
- Dữ liệu demo không được gửi lên máy chủ.

## Hợp đồng dữ liệu cho bước tiếp theo

`GET /api/attendance/precheck`

```json
{
  "serverTime": "2026-08-12T07:52:00+07:00",
  "employee": { "id": "emp_0238", "name": "Hải Âu" },
  "shift": { "id": "shift_office", "start": "08:00", "end": "17:00" },
  "branch": { "id": "aura_thanh_khe", "radiusMeters": 50 },
  "requirements": {
    "trustedDevice": true,
    "location": true,
    "faceVerification": true,
    "liveness": true,
    "presenceProof": true
  }
}
```

## Definition of Done

- Hoạt động ở chiều rộng 390 px và desktop.
- Không tạo nhầm cảm giác Face AI đã được kết nối.
- Nút pre-check chỉ mở khi tất cả điều kiện demo hoàn tất.
- Camera được dừng khi rời màn hình.
- Build production và bài kiểm tra render đều vượt qua.

## Backlog giai đoạn 02

- Backend NestJS và PostgreSQL/PostGIS.
- WebAuthn/Passkey thật.
- Face provider adapter và liveness thật.
- GPS geofence được backend xác minh.
- QR động có chữ ký, hết hạn và chống replay.
- Attendance event bất biến, idempotency key và risk score.
