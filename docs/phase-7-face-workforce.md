# FASTDO ATTEND — Phase 7 Face AI và quản trị nhân sự

## Phạm vi phát hành

Phase 7 thay màn hình camera mô phỏng bằng luồng Face AI có trạng thái phía server, đồng thời bổ sung nghiệp vụ quản trị nhân viên và phân ca trong PWA. Bản phát hành thêm 8 callable API mới:

- `startFaceSession`
- `completeFaceSession`
- `getAdminWorkforce`
- `createEmployee`
- `changeTemporaryPassword`
- `updateEmployee`
- `assignEmployeeShift`
- `resetEmployeeFace`

Hai API hiện hữu `getPrecheck` và `checkIn` được nâng cấp để áp dụng Face proof. Sau khi triển khai đủ Phase 7, backend có 19 callable Functions.

Tài liệu này là hợp đồng phát hành và tiêu chí nghiệm thu. Các mục chưa đánh dấu trong checklist production là **release gate**, không được hiểu là đã hoàn thành chỉ vì callable API đã được deploy.

## Ranh giới dữ liệu sinh trắc

- Camera chỉ được đọc trong trình duyệt sau khi người dùng cấp quyền.
- Model face-api chạy trên thiết bị và tạo embedding từ frame camera. Ảnh, video và frame camera không được upload lên Cloud Functions, Firestore hoặc Cloud Storage.
- Client chỉ gửi embedding dạng số cùng kết quả đo của active challenge. Embedding vẫn là dữ liệu sinh trắc nhạy cảm, không được coi là dữ liệu vô danh.
- Template được mã hóa AES-256-GCM phía Function trước khi ghi Firestore; khóa `FACE_DATA_KEY` lấy từ Secret Manager và không được đưa ra frontend. Production vẫn cần quy trình version/rotation/recovery cho khóa.
- Frame và canvas tạm phải được giải phóng khi hoàn tất, hủy, hết hạn hoặc rời màn hình Face.
- Firestore Rules phải từ chối client đọc/ghi trực tiếp template, session và proof; mọi truy cập đi qua callable API đã xác thực, App Check và kiểm tra tenant.
- Không ghi embedding, mật khẩu tạm, token camera hoặc proof đầy đủ vào Cloud Logging, analytics hay audit metadata.

## Luồng enrollment

```text
Nhân viên đăng nhập
  → đọc và chấp thuận biểu mẫu sinh trắc có version
  → startFaceSession
  → server phát session ngắn hạn và thử thách quay đầu ngẫu nhiên
  → face-api tạo embedding ngay trên thiết bị
  → completeFaceSession gửi embedding + kết quả thử thách, không gửi ảnh
  → server lưu template và cập nhật trạng thái enrollment
  → session bị đóng, không thể dùng lại
```

Consent phải ghi nhận tối thiểu `consentVersion`, thời điểm chấp thuận, mục đích xử lý và người dùng đã chấp thuận. Không được suy ra consent chỉ từ việc người dùng đã cấp quyền camera. Nếu nhân viên không đồng ý hoặc thiết bị không tương thích, doanh nghiệp cần có quy trình chấm công thay thế được phê duyệt, không tự động ghi nhận Face là đạt.

## Luồng xác minh khi check-in

```text
getPrecheck
  → startFaceSession
  → server chọn ngẫu nhiên quay trái hoặc quay phải
  → client đo chuyển động và tạo embedding cục bộ
  → completeFaceSession so khớp template phía server
  → server phát Face proof ngắn hạn, gắn user + device + company
  → nhân viên xác minh Presence QR để nhận Presence proof
  → checkIn đọc cả hai proof trong Firestore transaction
  → kiểm tra chủ thể, thiết bị, tenant, chi nhánh, hạn dùng và usedAt
  → tạo attendance event và đánh dấu cả hai proof đã dùng trong cùng transaction
```

Client không thể tự khai `faceVerified=true` hoặc chỉ gửi một ID tùy ý. Face proof do server phát, chỉ dùng một lần và phải được tiêu thụ nguyên tử cùng Presence proof. Hai request đồng thời dùng chung proof chỉ được phép tạo tối đa một attendance event; request idempotent cũ có thể nhận lại kết quả đã tạo.

## Giới hạn của liveness MVP

Thử thách quay đầu ngẫu nhiên là **active challenge MVP**, giúp loại một số trường hợp dùng ảnh tĩnh đơn giản. Nó chưa phải Presentation Attack Detection được chứng nhận và chưa đủ để tuyên bố chống được video phát lại, virtual camera, camera injection, mặt nạ hoặc deepfake thời gian thực.

Đặc biệt, vì embedding và kết quả chuyển động được tính ở client, một client đã bị can thiệp có thể tạo payload giả mà không dùng camera thật. Trước khi dùng cho tình huống rủi ro cao hoặc giải quyết tranh chấp lương, cần một trong các hướng sau:

- dịch vụ liveness/PAD có đánh giá độc lập phù hợp ISO/IEC 30107-3;
- native wrapper có device attestation và pipeline camera được bảo vệ;
- xác minh server-side/vendor-side với challenge có chữ ký và bằng chứng chống injection.

Cho tới khi hoàn thành hardening, Face chỉ là một lớp trong quyết định đa tín hiệu gồm tài khoản, thiết bị tin cậy, GPS, Presence QR và Face; không được dùng Face MVP làm bằng chứng duy nhất.

## Hợp đồng callable API

| Callable | Quyền | Hợp đồng chính |
| --- | --- | --- |
| `startFaceSession` | Nhân viên đã xác thực | Client đề nghị enrollment/verification, server kiểm tra trạng thái hồ sơ và thiết bị rồi phát challenge ngẫu nhiên có hạn dùng, gắn session với user/device/company. Enrollment không được ghi đè profile hiện hữu nếu admin chưa reset. |
| `completeFaceSession` | Chủ session | Nhận embedding và số đo challenge, kiểm tra schema/kích thước/hạn dùng, đóng session một lần; enrollment lưu template, verification phát Face proof ngắn hạn. Không nhận raw image. |
| `getAdminWorkforce` | Vai trò quản lý được phép | Trả hồ sơ, trạng thái Face và phân ca trong đúng company scope; không trả embedding, proof hoặc mật khẩu. |
| `createEmployee` | Quản trị nhân sự được phép | Tạo Firebase Auth user và hồ sơ tenant, chuẩn hóa email/mã nhân viên, gán role theo allowlist, tạo mật khẩu tạm an toàn và đặt `mustChangePassword=true`. Mật khẩu chỉ trả một lần, không lưu Firestore hoặc log. |
| `changeTemporaryPassword` | Chính nhân viên đang đăng nhập | Chỉ xử lý tài khoản có `mustChangePassword=true`; kiểm tra độ mạnh, đổi mật khẩu Firebase Auth rồi gỡ cờ sau khi đổi thành công. Không trả, lưu hoặc ghi log mật khẩu mới. |
| `updateEmployee` | Quản trị nhân sự được phép | Chỉ cập nhật field cho phép; kiểm tra role, branch và tenant; mọi thay đổi trạng thái/quyền đều có audit log. |
| `assignEmployeeShift` | Quản trị nhân sự được phép | Kiểm tra employee, shift và branch cùng tenant, ngày bắt đầu/kết thúc hợp lệ; từ chối khoảng phân ca chồng lấn rồi tạo phân ca và audit trong transaction. |
| `resetEmployeeFace` | Quản trị nhân sự được phép | Xóa template, thu hồi session/proof còn hiệu lực và đưa enrollment về `NOT_STARTED`; lưu audit không chứa dữ liệu sinh trắc. |
| `getPrecheck` | Nhân viên | Trả requirement Face thực tế và trạng thái enrollment; camera preview không bao giờ tự được coi là đã xác minh. |
| `checkIn` | Nhân viên | Bắt buộc Face proof và Presence proof hợp lệ khi policy bật; tiêu thụ cả hai proof nguyên tử với attendance event. |

Các thao tác quản trị phải kiểm tra `companyId` từ hồ sơ server, không nhận tenant do client tự khai. Người quản trị công ty không được tự cấp `SUPER_ADMIN`, sửa tenant ngoài phạm vi hoặc đọc template Face. Nếu tạo Firebase Auth thành công nhưng ghi hồ sơ thất bại, backend phải thực hiện rollback/compensating cleanup để không để lại tài khoản mồ côi.

## Mật khẩu tạm và vòng đời nhân viên

- Mật khẩu tạm phải được sinh bằng nguồn ngẫu nhiên mật mã, đủ dài, không dựa trên mã nhân viên hoặc ngày sinh.
- Chỉ hiển thị một lần cho admin và chuyển cho nhân viên qua kênh riêng; không đưa vào URL, email log, analytics, Firestore hoặc audit log.
- `createEmployee` đặt `mustChangePassword=true`; `getMyProfile` trả cờ này để frontend chặn Home, chấm công và màn hình quản trị cho tới khi đổi mật khẩu thành công.
- Backend cũng chặn mọi callable nghiệp vụ qua employee context khi cờ còn bật; chỉ `getMyProfile` và `changeTemporaryPassword` được phép đi qua. Vì vậy client tùy biến không thể bỏ qua màn hình đổi mật khẩu.
- `changeTemporaryPassword` chỉ gỡ cờ sau khi Firebase Auth đã chấp nhận mật khẩu mới. Request phải có Auth, App Check, rate limit và không được đưa mật khẩu vào error/audit metadata.
- Nhân viên phải đổi mật khẩu ở lần đăng nhập đầu. Sau khi đổi thành công, frontend tải lại hồ sơ trước khi mở luồng nghiệp vụ. Ưu tiên password-reset link thay vì chia sẻ mật khẩu tạm khi quy trình email đã sẵn sàng.
- Vô hiệu hóa nhân viên phải đồng bộ trạng thái Auth/hồ sơ, chặn tạo session mới và thu hồi proof còn hiệu lực.
- Đổi role, branch, ca hoặc reset Face phải ghi actor, target, thời gian và lý do; audit không chứa embedding.

## Consent, reset và quyền của nhân viên

- Biểu mẫu consent nêu rõ mục đích chấm công, dữ liệu được tạo, nơi xử lý, thời hạn lưu, bên có quyền truy cập, cách rút consent và kênh khiếu nại.
- Version biểu mẫu phải tăng khi mục đích hoặc cách xử lý thay đổi; consent cũ không tự áp dụng cho mục đích mới.
- Nhân viên có thể yêu cầu xem trạng thái enrollment, reset template hoặc rút consent. Reset phải vô hiệu hóa template cũ ngay, không chỉ đổi cờ giao diện.
- Sau reset hoặc rút consent, lần xác minh tiếp theo bị chặn cho tới khi enrollment mới có consent hợp lệ hoàn tất.
- Có thể giữ audit tombstone tối thiểu để chứng minh thao tác xóa, nhưng tombstone không chứa embedding, ảnh hoặc vector có thể tái nhận dạng.

## Chính sách riêng tư và retention cho pilot

Đây là baseline vận hành cần được pháp chế/người phụ trách dữ liệu phê duyệt trước pilot; runtime expiry không thay thế TTL/xóa vật lý.

| Dữ liệu | Mặc định đề xuất | Yêu cầu |
| --- | --- | --- |
| Raw frame/video | Không upload; chỉ tồn tại trong bộ nhớ phiên | Giải phóng ngay khi hoàn tất/hủy; không chụp telemetry hoặc screenshot. |
| Face session/challenge | Phút, không phải ngày | Từ chối ngay khi hết hạn và cấu hình Firestore TTL để dọn bản ghi. |
| Face proof chưa dùng | Chỉ đủ cho một lần check-in | Hết hạn ngắn, single-use, TTL; không gia hạn từ client. |
| Face template/embedding | Tối đa 12 tháng cho pilot hoặc sớm hơn khi reset, rút consent hay nghỉ việc | Rà soát định kỳ, tái-enroll khi hết hạn; dữ liệu lưu bằng AES-256-GCM và phải có kế hoạch rotation/recovery cho `FACE_DATA_KEY`. |
| Consent và audit tối thiểu | Theo chính sách lao động/pháp lý đã phê duyệt | Tách khỏi template, giới hạn quyền truy cập và không chứa dữ liệu sinh trắc. |

Không sao lưu template sang môi trường phát triển, không dùng dữ liệu nhân viên để huấn luyện model, không chia sẻ với bên thứ ba nếu chưa có căn cứ xử lý và thông báo phù hợp. Backup chứa template phải có cùng encryption, access control và quy trình xóa theo vòng đời.

## Checklist kiểm thử và rollout production

### Backend và dữ liệu

- [ ] Unit test vector sai kích thước, NaN/Infinity, threshold biên, session hết hạn và challenge sai.
- [ ] Test replay: session/Face proof/Presence proof đã dùng đều bị từ chối ở request mới.
- [ ] Emulator test hai `checkIn` đồng thời chỉ tạo một event và tiêu thụ hai proof nguyên tử.
- [ ] Test cross-tenant/cross-branch/cross-device, role escalation và ID enumeration đều bị từ chối.
- [ ] Test khoảng phân ca giao nhau ở đầu, cuối hoặc bao trùm bị từ chối; hai request đồng thời không tạo phân ca chồng lấn.
- [ ] Test reset Face xóa template, thu hồi session/proof và buộc enrollment lại.
- [ ] Test lỗi giữa Firebase Auth và Firestore không để tài khoản hoặc hồ sơ mồ côi.
- [ ] Test tài khoản `mustChangePassword=true` không thể vào Home/chấm công/admin; mật khẩu yếu bị từ chối và đổi thành công mới gỡ cờ.
- [ ] Firestore Rules chặn client đọc/ghi template, session và proof; indexes và TTL đã ở trạng thái Serving.
- [ ] `FACE_DATA_KEY` được cấp trong Secret Manager, quyền truy cập tối thiểu, có version/rotation và quy trình phục hồi được kiểm thử.

### Face, thiết bị và UX

- [ ] Kiểm thử enrollment/verification trên iOS Safari và Android Chrome bằng thiết bị thật.
- [ ] Kiểm thử thiếu sáng, nhiều khuôn mặt, khuôn mặt ngoài khung, kính/khẩu trang và camera permission bị từ chối.
- [ ] Thử ảnh in, ảnh trên màn hình, video replay, virtual camera và payload embedding bị sửa bằng DevTools.
- [ ] Xác nhận model được cache có version/integrity rõ ràng và không tải model từ nguồn không kiểm soát.
- [ ] Có thông báo dễ hiểu, thao tác thử lại có rate limit và luồng chấm công thay thế cho người không thể dùng Face.

### Quyền riêng tư và vận hành

- [ ] Consent version, nội dung privacy notice, retention và quy trình rút consent đã được phê duyệt.
- [ ] Không có raw image, embedding, mật khẩu tạm hoặc proof token trong log/analytics/error report.
- [ ] Dashboard theo dõi tỷ lệ false reject, lỗi camera và latency nhưng không thu thập dữ liệu sinh trắc thô.
- [ ] Có feature flag theo company/branch, rollout canary và cách tắt Face requirement an toàn khi sự cố.
- [ ] Backup/restore, data deletion request, incident response và khóa quyền nhân viên nghỉ việc đã diễn tập.
- [ ] Threshold matching được hiệu chỉnh trên dữ liệu kiểm thử có sự đồng ý; không sao chép mặc định demo sang production mà không đánh giá.

Chỉ bật `faceVerification=true` cho pilot sau khi checklist P0 đạt, quy trình thay thế đã sẵn sàng và rủi ro liveness phía client được bên chịu trách nhiệm chấp thuận bằng văn bản.
