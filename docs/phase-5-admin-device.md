# FASTDO ATTEND — Bảng quản trị thiết bị

## Phạm vi đã triển khai

- Hồ sơ đăng nhập trả về vai trò và quyền quản trị từ backend, không tin dữ liệu role do client tự khai báo.
- Tài khoản `SUPER_ADMIN`, `COMPANY_ADMIN`, `HR`, `MANAGER` có mục **Quản trị** trong thanh điều hướng.
- Bảng điều khiển hiển thị số thiết bị chờ duyệt, đã tin cậy và đã khóa.
- Có thể lọc danh sách, tải lại, duyệt thiết bị, khóa thiết bị và mở lại thiết bị đã khóa.
- Mỗi thiết bị hiển thị nhân viên sở hữu, mã nhân viên, nhãn trình duyệt, ngày đăng ký và lần hoạt động gần nhất.
- Thao tác khóa yêu cầu xác nhận; backend luôn kiểm tra thiết bị thuộc cùng doanh nghiệp.

## Phân quyền

`getMyProfile`, `listDevices` và `reviewDevice` đều yêu cầu Firebase Auth và App Check. Quyền quyết định nằm tại Cloud Functions:

```text
EMPLOYEE                          → chỉ xem thiết bị của mình
MANAGER / HR / COMPANY_ADMIN     → xem và xử lý thiết bị cùng công ty
SUPER_ADMIN                      → quyền quản trị thiết bị theo company hiện tại
```

Quản trị viên không cần được phân ca mới có thể sử dụng bảng duyệt thiết bị. Các API chấm công vẫn yêu cầu phân ca hợp lệ.

Tài khoản pilot `FD0238` đang giữ vai trò `COMPANY_ADMIN` để vận hành bảng quản trị trong giai đoạn MVP. Trước pilot nhiều người dùng nên tạo tài khoản quản trị riêng và đưa tài khoản nhân viên này về `EMPLOYEE` để tách nhiệm vụ.

## Luồng vận hành

```text
Nhân viên đăng nhập
  → thiết bị đăng ký PENDING
  → quản trị viên mở Quản trị
  → kiểm tra nhân viên + thiết bị + thời gian
  → Duyệt thành TRUSTED hoặc Khóa thành BLOCKED
  → audit log được ghi cùng quyết định
```

Thiết bị `TRUSTED` được đi tiếp sang GPS và check-in. Thiết bị `PENDING` hoặc `BLOCKED` bị chặn trước khi ứng dụng yêu cầu vị trí.
