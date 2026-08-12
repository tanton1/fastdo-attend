# FASTDO ATTEND — Sprint 1: App Check và thiết bị tin cậy

## Kết quả production

| Thành phần | Trạng thái |
| --- | --- |
| reCAPTCHA Enterprise | Đã tạo key giới hạn cho tên miền production |
| Firebase App Check | Đã đăng ký Web App và bật enforcement cho callable Functions |
| Rate limiting | Đã áp dụng theo người dùng và cửa sổ 60 giây |
| TTL cho rate limit | Đã bật trên `rateLimits.expiresAt` |
| Device enrollment | Thiết bị mới mặc định `PENDING` |
| Device approval | API quản trị hỗ trợ `TRUSTED` và `BLOCKED` |
| Audit log | Ghi đăng ký, duyệt/chặn và quyết định chấm công |

## Callable Functions

Ngoài bốn API chấm công, backend có thêm:

- `registerDevice`: đăng ký hoặc cập nhật lần hoạt động gần nhất của thiết bị.
- `getDeviceStatus`: trả trạng thái thiết bị của chính nhân viên.
- `listDevices`: chỉ dành cho `SUPER_ADMIN`, `COMPANY_ADMIN`, `HR`, `MANAGER` trong cùng doanh nghiệp.
- `reviewDevice`: quản trị viên duyệt hoặc chặn thiết bị và tạo audit log bất biến.
- `getMyProfile`: trả hồ sơ, vai trò và quyền quản trị của người dùng đang đăng nhập.

Tất cả chín callable Functions production đều yêu cầu đồng thời Firebase Auth và App Check hợp lệ. Emulator tự tắt enforcement để phục vụ kiểm thử local.

## Trạng thái thiết bị

```text
Thiết bị mới → PENDING → TRUSTED
                    └→ BLOCKED
TRUSTED ─────────────────→ BLOCKED
```

- `PENDING`: đã đăng ký nhưng chưa được chấm công.
- `TRUSTED`: được phép tiếp tục GPS và check-in.
- `BLOCKED`: bị từ chối ngay ở pre-check.

Backend kiểm tra ownership theo `companyId + userId + deviceId`; client không thể tự khai báo `TRUSTED`. `checkIn` cũng kiểm tra lại trạng thái ở máy chủ để tránh bỏ qua giao diện.

## Hạn mức hiện tại

| Hành động | Hạn mức/người dùng/phút |
| --- | ---: |
| Đăng ký thiết bị | 5 |
| Xem trạng thái thiết bị | 30 |
| Pre-check | 20 |
| Check-in | 5 |
| Check-out | 5 |
| Location heartbeat | 30 |
| Danh sách thiết bị | 30 |
| Duyệt/chặn thiết bị | 20 |

## Kiểm thử production

- App Check token từ `fastdo-attend.vercel.app` được Functions xác nhận `VALID`.
- Request không có App Check bị từ chối HTTP `401`.
- Thiết bị trình duyệt mới được ghi `PENDING` và chưa yêu cầu GPS trước khi duyệt.
- Audit log ghi đúng actor, role, Firebase App ID, thiết bị và thời gian máy chủ.
- Firestore Rules không cho client ghi trực tiếp `devices`, `auditLogs` hoặc `rateLimits`.

## Giới hạn còn lại

Mã thiết bị hiện là UUID cục bộ được quản trị viên duyệt, phù hợp MVP nhưng vẫn có thể bị sao chép trên thiết bị đã xâm nhập. Giai đoạn tăng cường nên gắn enrollment với khóa WebAuthn/passkey phần cứng hoặc native device attestation.
