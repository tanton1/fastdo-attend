# FASTDO ATTEND

PWA chấm công nhân viên theo phong cách **Black Ignite**, kết hợp Firebase Authentication, Firestore, GPS geofence, thiết bị tin cậy, Face AI xử lý trên thiết bị, Presence QR ký số và risk scoring. Luồng hiện có:

```text
Đăng nhập → Home → Pre-check → Face AI (theo policy) → Presence QR → Check-in → Đang trong ca → Check-out
```

## Trạng thái Firebase

- Project: `fastdo-attend-2026`
- Region dữ liệu và Functions: `asia-southeast1`
- Firebase Authentication: Email/Password đã bật
- Firestore: database `(default)` đã tạo, rules và indexes đã triển khai
- Cloud Functions thế hệ 2: 32 callable API chấm công, hồ sơ, thiết bị, Face AI, quản trị nhân sự, Presence QR, pilot policy, báo cáo/realtime, yêu cầu điều chỉnh công, nghỉ phép và payroll CSV chạy Node.js 22
- Firebase App Check: reCAPTCHA Enterprise đã bật enforcement cho toàn bộ callable Functions production
- Thiết bị mới phải được quản trị viên duyệt trước khi GPS/check-in được thực hiện
- Quản trị viên có bảng điều khiển trong PWA để lọc, duyệt, khóa và mở khóa thiết bị; xử lý yêu cầu điều chỉnh công/nghỉ phép và xuất payroll CSV
- Quản trị viên có thể tạo/cập nhật nhân viên, cấp mật khẩu tạm một lần, phân ca và reset Face enrollment trong đúng phạm vi công ty; tài khoản mới bị chặn khỏi nghiệp vụ cho tới khi đổi mật khẩu thành công
- Chính sách pilot theo chi nhánh hỗ trợ `OFF`, `MONITOR`, `REQUIRED`, cửa sổ thời gian và cohort ổn định; chỉ `SUPER_ADMIN`/`COMPANY_ADMIN` được sửa policy
- Báo cáo và realtime monitor trả dữ liệu có giới hạn cùng `truncated/hasMore`; attendance report hỗ trợ cursor opaque để tải tiếp các trang và chỉ mở CSV sau khi tải đủ kỳ. Payroll CSV dùng sự kiện và adjustment đã duyệt
- QR hiện diện được ký bằng khóa trong Secret Manager, hết hạn sau 45 giây; proof của nhân viên chỉ dùng một lần
- Face embedding được tạo trong trình duyệt; raw image/video không được upload. Template được mã hóa AES-256-GCM bằng khóa Secret Manager; Face proof và Presence proof đều do server phát, chỉ dùng một lần và được tiêu thụ nguyên tử cùng check-in
- Face profile mới dùng `retentionExpiresAt` với Firestore TTL và kiểm tra hết hạn ở runtime. Profile Phase 7/policy bị rút ngắn cần chạy one-off backfill; dự án không dùng lifecycle trigger riêng nên trạng thái nhân viên có thể được sửa ở lần precheck/Face tiếp theo
- Head-turn ngẫu nhiên hiện là active challenge MVP, chưa phải liveness/PAD được chứng nhận; không dùng Face làm bằng chứng duy nhất cho tình huống rủi ro cao
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

Các lệnh trên kiểm tra lint/build, domain và HTML render. Firebase Emulator integration chưa chạy trên máy phát triển hiện tại vì chưa có Java trong `PATH`; ma trận camera/GPS trên iPhone và Android thật cùng kiểm thử PAD vẫn là release gate trước pilot.

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

Sau khi build Functions, chạy backfill retention ở chế độ dry-run trước; chỉ thêm `--apply` sau khi kiểm tra số liệu và có phê duyệt:

```bash
npm --prefix functions run build
node functions/lib/tools/backfill-face-retention.js --project fastdo-attend-2026 --limit 100000
node functions/lib/tools/backfill-face-retention.js --project fastdo-attend-2026 --limit 100000 --apply
```

Công cụ chỉ đọc metadata cần cho retention, không đọc descriptor; cần Application Default Credentials có quyền tối thiểu phù hợp.

## Tài liệu

- [Nền móng giao diện](docs/phase-1-foundation.md)
- [Firebase backend và database](docs/phase-2-firebase-backend.md)
- [Kế hoạch giai đoạn tiếp theo](docs/phase-3-roadmap.md)
- [App Check và thiết bị tin cậy](docs/phase-4-security-device.md)
- [Bảng quản trị thiết bị](docs/phase-5-admin-device.md)
- [Presence QR động](docs/phase-6-presence-qr.md)
- [Face AI và quản trị nhân sự](docs/phase-7-face-workforce.md)
- [Pilot hardening, báo cáo và realtime monitor](docs/phase-8-pilot-hardening.md)
- [Runbook vận hành và go-live](docs/operations-runbook.md)
- [Production monitoring và cảnh báo](docs/production-monitoring.md)
- [Lịch sử thay đổi](CHANGELOG.md)

## Lưu ý về Face ID và Wi-Fi

- PWA không truy cập dữ liệu sinh trắc Face ID của Apple. Passkey/WebAuthn và Face AI camera là hai lớp riêng.
- PWA có service worker cho offline shell/cache giao diện; thao tác chấm công vẫn cần server xác nhận, không hiển thị thành công giả khi mất mạng.
- Face AI chỉ gửi embedding, nhưng embedding vẫn là dữ liệu sinh trắc nhạy cảm và phải tuân theo consent, quyền rút đồng ý/reset/xóa, giới hạn truy cập và retention policy trong tài liệu Phase 7–8.
- Trình duyệt không cho PWA đọc SSID/BSSID Wi-Fi. Dữ liệu `allowedWifiSsids` chỉ là cấu hình quản trị; bằng chứng hiện diện thật phải đến từ Presence Gateway trong mạng nội bộ, QR động có chữ ký, hoặc native wrapper/MDM.
