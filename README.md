# FASTDO ATTEND

PWA chấm công nhân viên theo phong cách **Black Ignite**, kết hợp Firebase Authentication, Firestore, GPS geofence, thiết bị tin cậy và risk scoring. Luồng hiện có:

```text
Đăng nhập → Home → Pre-check → Camera → Check-in → Đang trong ca → Check-out
```

## Trạng thái Firebase

- Project: `fastdo-attend-2026`
- Region dữ liệu và Functions: `asia-southeast1`
- Firebase Authentication: Email/Password đã bật
- Firestore: database `(default)` đã tạo, rules và indexes đã triển khai
- Cloud Functions thế hệ 2: 9 callable API chấm công, hồ sơ và quản lý thiết bị đang chạy Node.js 22
- Firebase App Check: reCAPTCHA Enterprise đã bật enforcement cho toàn bộ callable Functions production
- Thiết bị mới phải được quản trị viên duyệt trước khi GPS/check-in được thực hiện
- Quản trị viên có bảng điều khiển trong PWA để lọc, duyệt, khóa và mở khóa thiết bị
- Vercel production chạy `NEXT_PUBLIC_FIREBASE_DEMO_MODE=false`; local vẫn có thể chọn demo hoặc emulator

## Chạy ứng dụng

Yêu cầu Node.js `>=22.13.0`.

```bash
npm install
npm run dev
```

Tài khoản demo trong giao diện:

```text
Mã nhân viên: FD0238
Mật khẩu: fastdo2026
```

## Cấu hình môi trường

Sao chép `.env.example` thành `.env.local`, điền Firebase Web API key rồi chọn chế độ:

```dotenv
NEXT_PUBLIC_FIREBASE_DEMO_MODE=true
NEXT_PUBLIC_FIREBASE_USE_EMULATORS=false
```

- `DEMO_MODE=true`: chạy toàn bộ UX bằng dữ liệu mô phỏng, không ghi dữ liệu thật.
- `DEMO_MODE=false`: đăng nhập Firebase thật và gọi callable Cloud Functions.
- `USE_EMULATORS=true`: kết nối Auth, Firestore và Functions emulator tại các port trong `firebase.json`.

## Kiểm thử

```bash
npm run lint
npm test
npm run test:functions
```

Kiểm thử tích hợp emulator cần Java được cài và có trong `PATH`:

```bash
firebase emulators:exec --only auth,firestore,functions "npm --prefix functions run test:emulators"
```

## Triển khai Firebase

```bash
npm run firebase:deploy:core
npm run firebase:deploy:functions
```

`firebase:deploy:core` triển khai Firestore rules và indexes. Project production đã ở gói Blaze và Functions thế hệ 2 đã được phát hành.

## Tài liệu

- [Nền móng giao diện](docs/phase-1-foundation.md)
- [Firebase backend và database](docs/phase-2-firebase-backend.md)
- [Kế hoạch giai đoạn tiếp theo](docs/phase-3-roadmap.md)
- [App Check và thiết bị tin cậy](docs/phase-4-security-device.md)
- [Bảng quản trị thiết bị](docs/phase-5-admin-device.md)

## Lưu ý về Face ID và Wi-Fi

- PWA không truy cập dữ liệu sinh trắc Face ID của Apple. Passkey/WebAuthn và Face AI camera là hai lớp riêng.
- Trình duyệt không cho PWA đọc SSID/BSSID Wi-Fi. Dữ liệu `allowedWifiSsids` chỉ là cấu hình quản trị; bằng chứng hiện diện thật phải đến từ Presence Gateway trong mạng nội bộ, QR động có chữ ký, hoặc native wrapper/MDM.
