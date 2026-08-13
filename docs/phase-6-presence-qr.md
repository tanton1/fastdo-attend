# FASTDO ATTEND — Presence QR động

## Mục tiêu

Presence QR bổ sung bằng chứng rằng nhân viên đang nhìn thấy mã được phát trực tiếp tại đúng cơ sở. Lớp này không thay thế GPS hoặc thiết bị tin cậy; check-in cần đồng thời cả ba.

## Luồng production

```text
Quản trị viên phát QR
  → Cloud Function ký payload bằng HMAC-SHA256
  → QR + mã 6 số có hạn 45 giây
  → nhân viên quét QR hoặc nhập mã
  → server kiểm tra chữ ký + công ty + chi nhánh + thời hạn
  → tạo presenceProof gắn user + device, hạn 90 giây
  → checkIn tiêu thụ proof trong cùng Firestore transaction
```

## Chống gian lận

- Khóa ký `PRESENCE_SIGNING_KEY` nằm trong Google Cloud Secret Manager, không xuất hiện trong mã nguồn hoặc biến môi trường frontend.
- Payload QR có `challengeId`, `companyId`, `branchId`, `expiresAtSeconds` và nonce ngẫu nhiên.
- Backend so sánh hash token với challenge đã lưu và không tin dữ liệu do client khai báo.
- Presence proof gắn đúng tài khoản, thiết bị đã duyệt và chi nhánh trong phân ca.
- Proof chỉ được dùng một lần; `usedAt` và `usedEventId` được cập nhật nguyên tử cùng attendance event.
- Request lặp với idempotency key cũ trả lại kết quả cũ; request mới dùng lại proof bị từ chối.

## API

- `createPresenceChallenge`: chỉ dành cho quản trị viên, phát QR và mã 6 số cho chi nhánh trong phạm vi quản lý.
- `verifyPresenceChallenge`: dành cho nhân viên có phân ca và thiết bị `TRUSTED`, đổi QR/mã thành proof ngắn hạn.
- `checkIn`: bắt buộc proof hợp lệ; GPS, thiết bị và proof đều được đánh giá tại backend.

## Khả năng tương thích

Chrome/Edge hỗ trợ `BarcodeDetector` có thể quét trực tiếp bằng camera sau. Trình duyệt chưa hỗ trợ vẫn dùng mã 6 số hiển thị bên dưới QR, với cùng kiểm tra chi nhánh và thời hạn.
