# FASTDO ATTEND — Giai đoạn 02: Firebase backend và database

## Kết quả đã triển khai

Hạ tầng Firebase thật đã được tạo cho môi trường phát triển:

| Thành phần | Trạng thái |
| --- | --- |
| Firebase project `fastdo-attend-2026` | Đã tạo |
| Web App `FASTDO ATTEND Web` | Đã đăng ký |
| Authentication Email/Password | Đã bật và kiểm tra đăng nhập |
| Firestore `(default)` | Đã tạo tại `asia-southeast1` |
| Security Rules | Đã biên dịch và phát hành |
| Composite indexes | Đã phát hành |
| Dữ liệu nền demo | Đã tạo |
| Cloud Functions | Build/test đạt; chưa phát hành vì project chưa bật Blaze |

Frontend vẫn để `NEXT_PUBLIC_FIREBASE_DEMO_MODE=true`. Chỉ chuyển sang `false` sau khi Cloud Functions được phát hành để tránh một luồng thật bị dừng giữa chừng.

## Luồng dữ liệu

```text
Employee PWA
  ├─ Firebase Authentication
  ├─ getPrecheck()
  ├─ checkIn(location + device + evidence)
  ├─ sendLocationHeartbeat(session + location)
  └─ checkOut(location + device + evidence)
          │
          ▼
Callable Cloud Functions — asia-southeast1
  ├─ xác thực UID
  ├─ tải nhân viên, phân ca, chi nhánh và ca làm
  ├─ tính khoảng cách Haversine ở máy chủ
  ├─ kiểm tra geofence, độ chính xác GPS và thiết bị
  ├─ tính risk score
  └─ ghi transaction + idempotency key
          │
          ▼
Cloud Firestore — asia-southeast1
```

Thời gian chấm công chính luôn là `serverTimestamp`. `clientTimestamp` chỉ được lưu để phát hiện chỉnh đồng hồ thiết bị.

## Collections

| Collection | Mục đích | Client được ghi? |
| --- | --- | --- |
| `companies` | Tenant/doanh nghiệp | Không |
| `branches` | Cơ sở, GPS, bán kính và chính sách hiện diện | Không |
| `employees` | Hồ sơ, vai trò, trạng thái Face enrollment | Không |
| `shifts` | Khung giờ ca làm | Không |
| `shiftAssignments` | Phân ca theo khoảng ngày | Không |
| `devices` | Thiết bị đã duyệt/chặn | Không |
| `attendanceEvents` | Nhật ký check-in/check-out bất biến | Không |
| `workSessions` | Phiên làm việc hiện tại | Không |
| `locationHeartbeats` | Mẫu vị trí trong ca | Không |
| `alerts` | Cảnh báo rủi ro/rời vùng | Không |
| `attendanceRequests` | Yêu cầu điều chỉnh từ nhân viên | Chỉ tạo bản ghi `PENDING` của chính mình |
| `idempotencyKeys` | Chống gửi lặp thao tác | Không |

Mọi collection đều gắn `companyId` khi có dữ liệu nghiệp vụ. Rules chỉ cho người dùng đang hoạt động đọc dữ liệu thuộc cùng tenant; các bản ghi chấm công chỉ do backend ghi.

## Cloud Functions

### `getPrecheck`

Trả nhân viên, chi nhánh, ca làm, giờ máy chủ và chính sách bằng chứng cần có.

### `checkIn`

- Yêu cầu đăng nhập.
- Kiểm tra input, GPS accuracy, thiết bị và ca làm.
- Tính khoảng cách tới chi nhánh ở máy chủ.
- Tính risk score và quyết định `ALLOW`, `FLAG`, `REVIEW` hoặc `DENY`.
- Ghi `attendanceEvents`, `workSessions` và `idempotencyKeys` trong transaction.

### `checkOut`

Xác nhận phiên `ACTIVE`, kiểm tra lại vị trí và kết thúc phiên bằng một attendance event mới.

### `sendLocationHeartbeat`

Chỉ nhận heartbeat cho phiên `ACTIVE` thuộc đúng người dùng, tính lại geofence ở máy chủ và cập nhật trạng thái phiên.

## Dữ liệu nền đã tạo

- Company: `fastdo_demo`
- Branch: `aura_thanh_khe`
- Shift: `shift_office` — 08:00–17:00
- Employee Auth: `fd0238@fastdo.attend`
- Employee code: `FD0238`
- Shift assignment: `assignment_hai_au_2026`

## Wi-Fi trên PWA

`branches/aura_thanh_khe` có cấu hình `allowedWifiSsids: ["Aura Staff"]` và `presenceMode: "GPS_QR_WIFI_GATEWAY"`, nhưng PWA không được tin cậy khi tự khai báo SSID. Bước production phải triển khai một trong hai bằng chứng:

1. Presence Gateway chỉ truy cập được từ LAN công ty, phát token có chữ ký và hạn dùng rất ngắn.
2. QR động tại cơ sở, có chữ ký, nonce và chống replay.

Native wrapper/MDM có thể bổ sung SSID/BSSID như một tín hiệu rủi ro, không nên dùng làm bằng chứng duy nhất.

## Kiểm thử đã thực hiện

- Frontend production build và rendered HTML test.
- ESLint toàn dự án.
- Unit tests cho Haversine và risk scoring.
- Đăng nhập Auth thật thành công.
- Người dùng đã đăng nhập đọc được hồ sơ và chi nhánh qua Firestore Rules.
- Request ẩn danh bị Firestore từ chối `403`.
- Emulator smoke test đã được chuẩn bị tại `functions/scripts/smoke-emulators.cjs`; máy hiện tại cần cài Java và đưa lệnh `java` vào `PATH` trước khi chạy Firestore Emulator.

## Việc cần làm trước production

1. Chủ dự án chủ động nâng Firebase lên Blaze, sau đó chạy `npm run firebase:deploy:functions`.
2. Đổi `NEXT_PUBLIC_FIREBASE_DEMO_MODE=false` trên môi trường thật.
3. Kết nối Face AI/liveness provider; không tự nhận camera preview là đã xác minh.
4. Xây Presence Gateway hoặc QR động có chữ ký.
5. Thêm App Check, rate limiting, retention policy cho ảnh/video và quy trình đồng ý dữ liệu sinh trắc.
6. Xây Admin Dashboard để duyệt thiết bị, Face enrollment và attendance có risk cao.
