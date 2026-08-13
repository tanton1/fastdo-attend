# FASTDO ATTEND — Phase 8 Pilot hardening

## Mục tiêu và phạm vi

Phase 8 đưa bản Face AI của Phase 7 từ mức MVP kỹ thuật sang một pilot có kiểm soát. Trọng tâm của giai đoạn này là:

- quản lý chính sách pilot theo doanh nghiệp/chi nhánh bằng feature flag phía server;
- cho quản trị viên xem báo cáo chấm công có giới hạn thời gian và phạm vi tenant;
- cung cấp realtime monitor vận hành mà không làm lộ dữ liệu sinh trắc học;
- cho nhân viên tự rút đồng ý Face và xóa mẫu nhận diện đang lưu;
- chuẩn hóa ma trận thử nghiệm thiết bị thật, ngưỡng chất lượng và điều kiện dừng pilot.

Phase 8 bổ sung 5 callable API:

- `getPilotPolicy`
- `updatePilotPolicy`
- `getAttendanceReport`
- `getRealtimeMonitor`
- `withdrawFaceConsent`

Backend Phase 8 có tổng cộng 24 callable Functions. Năm API mới vẫn phải qua các release gate về tích hợp, thiết bị thật và quyền riêng tư trước khi mở pilot cho người lao động.

Face profile mới có `retentionExpiresAt` để Firestore TTL dọn vật lý. Song song, `getPrecheck`, `startFaceSession` và `completeFaceSession` đối chiếu hạn dùng phía server, từ chối profile hết hạn và đưa `faceEnrollmentStatus` về `NOT_STARTED` khi phát hiện trạng thái cũ. Dự án không dùng lifecycle trigger riêng; trạng thái nhân viên vì vậy có thể còn hiển thị `APPROVED` cho tới lần đối chiếu runtime tiếp theo.

Profile Phase 7 chưa có `retentionExpiresAt`, hoặc profile cần rút ngắn hạn sau khi policy đổi, phải được xử lý bằng công cụ backfill một lần. Công cụ chỉ đọc metadata `companyId`, `enrolledAt`, expiry và chi nhánh được gán; không đọc hay ghi log descriptor. Chạy dry-run trước, kiểm tra số lượng rồi mới dùng `--apply`:

```bash
npm --prefix functions run build
node functions/lib/tools/backfill-face-retention.js --project fastdo-attend-2026 --limit 100000
node functions/lib/tools/backfill-face-retention.js --project fastdo-attend-2026 --limit 100000 --apply
```

Backfill chọn thời hạn ngắn nhất trong các policy chi nhánh được gán, dùng mặc định 90 ngày khi chưa cấu hình, và chỉ thêm hoặc rút ngắn TTL hiện hữu. Lệnh cần Application Default Credentials có quyền tối thiểu cần thiết; kết quả dry-run/apply phải được lưu trong release note nhưng không được chứa descriptor.

Ngoài phạm vi Phase 8:

- chứng nhận Presentation Attack Detection (PAD) hoặc tuyên bố tuân thủ ISO/IEC 30107-3;
- dùng Face làm bằng chứng duy nhất để tính lương, kỷ luật hoặc giải quyết tranh chấp;
- đọc SSID/BSSID Wi-Fi từ PWA;
- tải ảnh/video khuôn mặt lên backend để giám sát;
- thay thế hoàn toàn quy trình chấm công dự phòng có con người phê duyệt.

## Nguyên tắc phát hành

1. Chính sách do backend quyết định. Giao diện không thể tự bật Face, tăng tỷ lệ rollout hoặc mở rộng phạm vi báo cáo.
2. Trạng thái rollout dùng đúng ba giá trị `OFF`, `MONITOR`, `REQUIRED`. Backend mặc định `REQUIRED` khi chi nhánh chưa có policy để không âm thầm hạ lớp bảo mật Face đã áp dụng từ Phase 7; trước pilot, admin phải chủ động lưu `OFF` hoặc `MONITOR` cho chi nhánh chưa sẵn sàng. Cửa sổ `startsAt`/`endsAt` và cohort ổn định quyết định mode hiệu lực cho từng người dùng.
3. Rollout phải đảo ngược được. Quản trị viên có thể tắt yêu cầu Face mà không vô hiệu hóa các lớp thiết bị tin cậy, GPS và Presence QR.
4. Không thu thập thêm dữ liệu sinh trắc học cho dashboard. Report và realtime monitor chỉ dùng attendance event, trạng thái vận hành và mã lỗi đã khử dữ liệu nhạy cảm.
5. Rút consent có hiệu lực ngay ở runtime. Việc Firestore TTL dọn bản ghi vật lý sau đó không được dùng để trì hoãn quyền rút đồng ý.
6. Mọi truy cập quản trị đều lấy `companyId` và phạm vi chi nhánh từ hồ sơ đã xác thực phía server, không tin tenant/role do client tự khai.

## Hợp đồng callable API Phase 8

Các callable áp dụng Firebase Authentication, App Check production, kiểm tra các trường nghiệp vụ được sử dụng, rate limit và mã lỗi `HttpsError`. Trường bổ sung không nằm trong hợp đồng bị bỏ qua và không được ghi vào policy; client không được dựa vào hành vi này như một cơ chế lưu metadata tùy ý. Thời gian trả về ở dạng ISO 8601 UTC; ngày báo cáo dùng `YYYY-MM-DD` và backend diễn giải theo múi giờ doanh nghiệp/chi nhánh đã cấu hình.

### `getPilotPolicy`

| Thuộc tính | Hợp đồng |
| --- | --- |
| Quyền | `SUPER_ADMIN`, `COMPANY_ADMIN`, `HR` đọc được policy toàn tenant; `MANAGER` chỉ đọc các chi nhánh được gán. |
| Input | `{ branchId? }`; bỏ trống để đọc các policy trong phạm vi chi nhánh người gọi được phép quản lý. |
| Output | `{ policies: PilotPolicy[] }`; mỗi policy gồm `branchId`, `enforcementMode`, `faceMatchThreshold`, `retentionDays`, `rollout`, `version`, `updatedAt`, `updatedBy`. |
| Bảo mật | Không trả secret, template, descriptor, proof token hoặc policy của tenant khác. |
| Trường hợp lỗi | `permission-denied` khi ngoài scope; `invalid-argument` khi branch sai định dạng. Policy chưa có trả mặc định tương thích Phase 7 (`REQUIRED`, version 0) để admin thấy rõ và chủ động đổi trước pilot. |

### `updatePilotPolicy`

| Thuộc tính | Hợp đồng |
| --- | --- |
| Quyền | Chỉ `SUPER_ADMIN` và `COMPANY_ADMIN` được thay đổi chính sách pilot trong tenant; `HR`/`MANAGER` không được sửa. |
| Input | `{ branchId, enforcementMode, faceMatchThreshold, retentionDays, rollout }`; `rollout` gồm `label`, `cohortPercent`, `startsAt`, `endsAt`, `notes`. Backend bỏ qua field không dùng, đồng thời từ chối threshold ngoài `0.35..0.65`, retention ngoài `1..365` ngày, cohort ngoài `1..100` hoặc khoảng rollout mâu thuẫn. `faceMatchThreshold` là khoảng cách tối đa nên giá trị thấp hơn là nghiêm ngặt hơn. |
| Output | `{ policy }` với policy đã chuẩn hóa, version mới, `updatedAt` và actor cập nhật. |
| Bảo mật | Update chạy trong transaction, tăng version và ghi audit gồm actor/thời gian/scope, mode trước và mode mới, threshold/retention mới cùng version; audit không chứa dữ liệu sinh trắc học. Đây không phải bản diff đầy đủ và hiện không lưu lý do vận hành riêng. |
| Trường hợp lỗi | `invalid-argument` khi input ngoài giới hạn; `permission-denied` khi role/scope không hợp lệ. Release gate pilot được kiểm soát bằng quy trình vận hành, không phải một field riêng trong API. |

Policy tối thiểu cần biểu diễn được các trạng thái sau:

- `OFF`: không thu thập hoặc yêu cầu Face; vẫn giữ thiết bị tin cậy, GPS và Presence QR theo policy hiện hữu.
- `MONITOR`: cho phép luồng pilot và telemetry an toàn để đánh giá; Face không được dùng để chặn check-in.
- `REQUIRED`: yêu cầu Face proof cho chi nhánh/cohort đã được duyệt.

Khi cần tạm dừng do sự cố, chuyển policy về `OFF`; rollout metadata và audit giữ đủ ngữ cảnh để điều tra và khôi phục có kiểm soát.

Rollout theo phần trăm chọn cohort ổn định bằng định danh tenant/user, không chọn ngẫu nhiên lại ở mỗi request. Tỷ lệ được chấp nhận là số nguyên trong `1..100`. Trong cửa sổ rollout, người dùng thuộc cohort nhận mode đã cấu hình; ngoài cohort/cửa sổ, `REQUIRED` hạ về `MONITOR` và `MONITOR` hạ về `OFF`. `OFF` luôn giữ nguyên `OFF`.

### `getAttendanceReport`

| Thuộc tính | Hợp đồng |
| --- | --- |
| Quyền | `SUPER_ADMIN`, `COMPANY_ADMIN`, `HR` xem trong tenant; `MANAGER` chỉ xem các chi nhánh được gán. Branch filter luôn phải thuộc scope người gọi. |
| Input | `{ startDate, endDate, branchId?, limit?, cursor? }`; ngày ở dạng `YYYY-MM-DD`, `cursor` là token opaque do response trước trả về. |
| Output | `{ range, pageSummary, rows, truncated, hasMore, pagination }`; `range` nêu timezone hiệu lực. `pageSummary` chỉ tổng hợp các dòng đang trả về, không phải tổng toàn kỳ khi `truncated=true`. Mỗi dòng chỉ chứa dữ liệu nghiệp vụ cần thiết như nhân viên, chi nhánh, loại sự kiện, thời gian, trạng thái, khoảng cách/độ chính xác cần thiết và risk decision đã làm sạch. |
| Giới hạn | Tối đa 31 ngày và tối đa 500 dòng mỗi request. Backend đọc thêm một dòng để xác định `hasMore` và trả `nextCursor` opaque theo timestamp + document ID để lấy trang kế tiếp. Khi còn trang, UI cảnh báo, cho phép tải thêm và khóa CSV thiếu dữ liệu. |
| Bảo mật | Không trả descriptor, face profile, liveness payload, proof token, QR token, secret, vị trí chính xác hơn nhu cầu nghiệp vụ hoặc metadata thiết bị không cần thiết. |
| Tính đúng | Dòng trả về được lọc theo timezone doanh nghiệp/chi nhánh, không đếm trùng request idempotent và nêu rõ attendance `REJECTED`/`PENDING_REVIEW`. Không dùng `pageSummary` làm tổng kỳ hoặc dữ liệu tính lương khi `truncated=true`. |

### `getRealtimeMonitor`

| Thuộc tính | Hợp đồng |
| --- | --- |
| Quyền | `SUPER_ADMIN`, `COMPANY_ADMIN`, `HR` xem trong tenant; `MANAGER` chỉ xem các chi nhánh được gán. |
| Input | `{ branchId?, limit? }`; backend giới hạn limit và không nhận tenant tùy ý. |
| Output | `{ generatedAt, pageSummary, rows, truncated, hasMore, pagination }`; mỗi row là session đang hoạt động đã làm sạch, gồm trạng thái geofence/heartbeat/risk cần cho vận hành. `insideGeofence=null` nghĩa là chưa đủ dữ liệu, không phải đang ở ngoài vùng. |
| Ngữ nghĩa realtime | Đây là snapshot gần thời gian thực, không phải bằng chứng tuyệt đối nhân viên đang ở một vị trí tại đúng thời điểm render. UI phải hiển thị thời gian cập nhật. |
| Bảo mật | Không phát stream camera, ảnh, embedding, proof token hoặc GPS liên tục. Chỉ trả sự kiện đã được phép xem và giới hạn số lượng. |

### `withdrawFaceConsent`

| Thuộc tính | Hợp đồng |
| --- | --- |
| Quyền | Chỉ chính nhân viên đang đăng nhập rút consent của mình; admin dùng quy trình reset riêng và không được giả mạo consent của nhân viên. |
| Input | `{}`; không nhận `employeeId` tùy ý. Giao diện phải có bước xác nhận chủ ý rõ ràng trước khi gọi. |
| Output | `{ withdrawn, faceEnrollmentStatus, revokedSessions, revokedProofs, withdrawnAt }`; trạng thái enrollment sau khi hoàn tất là `NOT_STARTED`. |
| Hiệu lực | Transaction vô hiệu/xóa Face template, thu hồi session/proof chưa dùng và cập nhật employee enrollment/consent state. Request lặp lại phải an toàn, không khôi phục dữ liệu đã xóa. |
| Audit | Chỉ giữ tombstone tối thiểu: actor, thời gian, consent version và loại thao tác. Không giữ descriptor, ảnh, vector có thể tái nhận dạng hoặc reason chứa dữ liệu nhạy cảm không cần thiết. |

Sau khi rút consent, `startFaceSession` cho mục đích xác minh phải bị chặn. Enrollment mới chỉ được phép sau khi nhân viên xem và chấp thuận consent version đang hiệu lực; doanh nghiệp phải cung cấp luồng chấm công thay thế trong thời gian đó.

## Bảo mật và phân tách tenant

- Firebase Auth xác định người gọi; custom payload từ client không được dùng làm nguồn role hoặc tenant.
- App Check production được enforce cho cả 5 API, nhưng không thay thế Auth, authorization hay rate limit.
- `SUPER_ADMIN`, `COMPANY_ADMIN`, `HR` và `MANAGER` phải tuân theo ma trận quyền hiện hữu; quyền đọc report không mặc nhiên đồng nghĩa quyền sửa policy.
- Mọi query report/realtime bắt buộc có `companyId` phía server và giới hạn chi nhánh. ID thuộc tenant khác phải trả lỗi không tiết lộ sự tồn tại của tài nguyên.
- `updatePilotPolicy` và `withdrawFaceConsent` ghi audit server-only, không chứa secret hoặc dữ liệu sinh trắc học; audit policy hiện là metadata vận hành tối thiểu, không phải full diff hay trường lý do riêng.
- Report giới hạn khoảng ngày và kích thước trang để tránh data exfiltration và truy vấn gây chi phí không kiểm soát. Cursor chỉ là token opaque, không chứa dữ liệu Face hay thông tin tenant; mỗi request vẫn kiểm tra lại quyền truy cập.
- Payload lỗi/log không chứa descriptor, tọa độ đầy đủ, QR/presence token, Face proof, password hoặc camera telemetry.
- Chỉ các field policy đã biết được chuẩn hóa và lưu; field bổ sung bị bỏ qua. Giá trị mặc định nằm phía server để client cũ không làm policy suy giảm theo cách âm thầm.
- Firestore Rules tiếp tục chặn client đọc/ghi trực tiếp `faceProfiles`, Face session/proof, pilot policy và dữ liệu audit nhạy cảm.

## Retention và quyền riêng tư

Các mốc dưới đây là baseline kỹ thuật cho pilot, cần pháp chế/người phụ trách dữ liệu phê duyệt theo nơi doanh nghiệp vận hành. Runtime expiry và Firestore TTL là hai lớp khác nhau: backend từ chối dữ liệu hết hạn ngay cả khi bản ghi chưa được TTL xóa vật lý.

| Loại dữ liệu | Baseline pilot | Xử lý khi hết hạn/rút consent |
| --- | --- | --- |
| Raw frame/video | Không upload; chỉ tồn tại trong bộ nhớ phiên camera | Giải phóng khi hoàn tất, hủy, timeout hoặc rời màn hình; không đưa vào analytics/screenshot tự động. |
| Face template đã mã hóa | Theo `retentionDays` của policy, chỉ được chọn trong khoảng 1–365 ngày | Profile mới ghi `retentionExpiresAt`; runtime coi profile hết hạn là `NOT_STARTED`, còn Firestore TTL dọn vật lý bất đồng bộ. Profile cũ hoặc policy bị rút ngắn cần chạy one-off backfill nêu trên. Rút consent/reset xóa ngay trong transaction; backup phải theo cùng lịch xóa và encryption. |
| Face session/proof | Phút; đủ cho một lần xác minh/check-in | Runtime từ chối ngay khi hết hạn; proof single-use; Firestore TTL dọn vật lý. |
| Face telemetry | Metadata vận hành ngắn hạn theo thời hạn pilot đã duyệt | Chỉ lưu event type, mode, outcome và số đo đã làm sạch trong `faceTelemetry`; có `expiresAt` TTL, không chứa ảnh, descriptor, token hoặc định danh thiết bị. |
| Consent record | Theo chính sách lao động/pháp lý đã duyệt | Giữ record/tombstone tối thiểu, tách khỏi template; không dùng consent cũ cho mục đích mới. |
| Attendance event | Theo nghĩa vụ chấm công/kế toán địa phương đã duyệt | Xóa hoặc lưu trữ lạnh theo lịch; report không được kéo dài retention bằng cách sao chép dữ liệu. |
| Realtime response | Snapshot tại thời điểm gọi, không được lưu thêm bởi API monitor | Response không chứa tọa độ GPS tuyệt đối hay dữ liệu Face. Dữ liệu heartbeat nguồn có vòng đời riêng và cần được quản trị theo chính sách vị trí của doanh nghiệp. |
| Audit quản trị | Theo chính sách an ninh và pháp lý đã duyệt | Giới hạn quyền đọc, chống sửa, không chứa descriptor/token/secret. |

Không dùng dữ liệu nhân viên để huấn luyện model, không sao chép template production sang dev/test và không chia sẻ cho nhà cung cấp PAD nếu chưa có căn cứ xử lý, hợp đồng dữ liệu và thông báo phù hợp. Quy trình rotation/recovery `FACE_DATA_KEY` phải bảo đảm có thể giải mã dữ liệu còn hợp lệ trong thời gian chuyển khóa và xóa version cũ khi không còn cần thiết.

TTL không thay thế runtime authorization và không đồng bộ tức thì trường trạng thái trong `employees`. Trước khi mở pilot, phải chạy dry-run/apply backfill, lưu số `scanned/candidates/updated/skippedInvalid`, xử lý bản ghi invalid và kiểm tra TTL production đã bật cho `faceProfiles.retentionExpiresAt` cùng `faceTelemetry.expiresAt`.

## Rollout bằng feature flag

### Trình tự đề xuất

1. **Cấu hình trước pilot:** triển khai code/index; vì policy thiếu sẽ mặc định `REQUIRED` để tương thích Phase 7, admin phải lưu rõ `OFF` hoặc `MONITOR` cho mọi chi nhánh chưa sẵn sàng trước khi đưa người dùng vào pilot. Kiểm thử tài khoản nội bộ, Rules, rate limit và rollback.
2. **MONITOR / một chi nhánh:** bật dashboard/report không nhạy cảm; đo lỗi camera, latency và tỷ lệ hoàn thành nhưng không dùng Face để chặn chấm công.
3. **CANARY / cohort nhỏ:** bật `REQUIRED` cho cohort ổn định đã đồng ý, có hỗ trợ tại chỗ và quy trình thay thế.
4. **Mở rộng có kiểm soát:** chỉ tăng cohort sau mỗi cửa sổ đánh giá; không tăng đồng thời nhiều biến như threshold, model và tỷ lệ rollout.
5. **Pilot đầy đủ:** chỉ áp dụng cho chi nhánh đã đạt exit criteria; tenant/branch còn lại vẫn `OFF` hoặc `MONITOR`.

### Kill switch và rollback

- Có thể chuyển policy sang `OFF` mà không cần redeploy frontend.
- Backend đọc policy và tính mode hiệu lực theo cửa sổ rollout/cohort ở mỗi luồng Face và precheck. `completeFaceSession`/`checkIn` đọc policy document trong chính Firestore transaction để một cập nhật policy đồng thời gây conflict/retry thay vì dùng quyết định cũ.
- Khi tắt Face, không tự động bỏ qua thiết bị tin cậy, GPS hoặc Presence QR.
- Sự kiện thay đổi policy ghi actor, thời gian, scope, mode trước/mới, threshold/retention mới và version. Ghi chú rollout nằm trong policy nhưng audit hiện chưa phải full diff và không có trường lý do vận hành độc lập.
- UI hiển thị policy đang hiệu lực và thời điểm cập nhật; không hiển thị optimistic state như đã lưu nếu callable thất bại.
- `OFF` chặn phiên Face mới và làm phiên đang hoàn tất thất bại khi backend kiểm tra lại policy. Update policy không quét để thu hồi hàng loạt session/proof đã cấp; Face proof đã phát có thể được gửi như bằng chứng tùy chọn cho tới khi hết hạn tối đa 90 giây. Proof vẫn là single-use, và `OFF` không làm Face trở thành điều kiện check-in.

## Giới hạn liveness phía client

Head-turn ngẫu nhiên và descriptor được tính trong trình duyệt vẫn là active challenge MVP. Một client bị can thiệp có thể giả payload, dùng virtual camera, camera injection, replay video hoặc deepfake. Vì vậy:

- không tuyên bố đây là PAD được chứng nhận;
- không suy ra “người thật chắc chắn hiện diện” chỉ từ kết quả client;
- không dùng kết quả Face MVP làm bằng chứng duy nhất cho lương/kỷ luật/tranh chấp;
- luôn giữ các lớp tài khoản, thiết bị tin cậy, GPS, Presence QR, risk scoring và review thủ công;
- đánh dấu rõ các thử nghiệm spoof mà client MVP không chặn được là rủi ro đã biết, không chỉnh test để giả vờ đạt;
- trước production diện rộng, đánh giá nhà cung cấp PAD có kiểm thử độc lập phù hợp ISO/IEC 30107-3 hoặc native wrapper có device attestation và camera pipeline được bảo vệ.

## Ma trận kiểm thử thiết bị thật

Mỗi hàng cần ghi thiết bị/OS/browser chính xác, mạng, trạng thái cài PWA, kết quả, video/log đã khử dữ liệu nhạy cảm và mã issue. Không dùng ảnh mặt nhân viên thật trong ticket.

| Nhóm | Cấu hình tối thiểu | Kịch bản bắt buộc |
| --- | --- | --- |
| iOS Safari | iPhone còn được hỗ trợ, một máy đời trung và một máy cấu hình thấp hơn; iOS bản mới nhất và mới nhất trừ một | Browser thường và PWA standalone; camera lần đầu/đã cấp/từ chối/thu hồi; foreground/background; reload giữa challenge. |
| Android Chrome | Thiết bị Pixel/Samsung hoặc tương đương; một máy tầm trung và một máy RAM thấp; Android/Chrome mới nhất và mới nhất trừ một | Browser thường và PWA standalone; camera permission; battery saver; app switch; WebView không được coi là đạt nếu chưa kiểm riêng. |
| Camera/ánh sáng | Camera trước; sáng tốt, ngược sáng, thiếu sáng vừa phải | Một mặt, nhiều mặt, ngoài khung, quá gần/xa, kính, khẩu trang, quay sai hướng, dừng chuyển động. |
| Tấn công trình diễn | Ảnh in, ảnh trên màn hình, video replay | Ghi nhận khả năng chặn thực tế; kết quả lọt qua là known risk của MVP và phải kích hoạt review/biện pháp bù trừ. |
| Can thiệp client | DevTools/payload sửa, request replay, proof dùng lại, virtual camera nơi hỗ trợ | Backend từ chối schema sai, session/proof hết hạn hoặc dùng lại; không coi kiểm tra client là security boundary. |
| GPS | Trong/ngoài geofence, accuracy tốt/kém, permission approximate/precise, mock location khi có thể | Policy/risk decision đúng; UI nêu lý do và có retry; không treo phiên Face khi GPS thất bại. |
| Presence QR | QR mới/hết hạn/sai chi nhánh, mã số đúng/sai, hai request đồng thời | Proof đúng tenant/user/device/branch, single-use và được tiêu thụ nguyên tử cùng Face proof. |
| Mạng | Wi-Fi cơ sở, 4G/5G, độ trễ cao, mất mạng giữa các bước, đổi mạng | Không tạo event trùng; timeout/retry có idempotency; không tuyên bố đã check-in trước khi server xác nhận. |
| Consent | Đồng ý mới, consent version cũ, rút consent, request rút lặp lại, enrollment lại | Xóa/vô hiệu template và proof ngay; luồng thay thế hoạt động; consent mới không được suy ra từ camera permission cũ. |
| Feature flag | `OFF`, `MONITOR`, cohort `REQUIRED`, nhiều chi nhánh | Backend và UI cùng policy; ngoài cohort không bị enforce; kill switch có hiệu lực không cần deploy. |
| Report | Múi giờ, biên ngày, DST nơi áp dụng, branch filter, `limit+1`, cursor và trạng thái `truncated` | Không đếm trùng, không vượt tenant/branch, khoảng quá lớn bị từ chối, không lộ dữ liệu Face; CSV bị khóa khi còn trang chưa tải. Employee/status filter và XLSX payroll vẫn là backlog. |
| Realtime | Không có sự kiện, lưu lượng đồng thời, sự kiện trễ, refresh nhanh, nhiều branch | `generatedAt` rõ ràng, dữ liệu có giới hạn, trạng thái `unknownGeofence` không bị gắn nhầm là ngoài vùng và response không trả tọa độ GPS tuyệt đối. |

## Trạng thái kiểm thử và khoảng trống đã biết

Các bài kiểm thử tự động hiện kiểm tra domain Face/presence/policy/cohort, timezone report, giới hạn trang và schema telemetry; bài render kiểm tra trang đăng nhập, badge/metadata Phase 8. Chúng không thay thế kiểm thử callable với Firebase thật hoặc thiết bị camera/GPS thật.

Những khoảng trống phải ghi rõ trong release note và chưa được coi là đạt chỉ vì lint/build/unit test xanh:

- Firebase Emulator integration chưa chạy trên máy hiện tại vì chưa có Java trong `PATH`; tenant/branch isolation, Auth, App Check, Rules và transaction concurrency của 5 API mới chưa có bằng chứng emulator end-to-end.
- Chưa hoàn thành ma trận thiết bị thật gồm tối thiểu hai iPhone và hai Android cho camera, GPS, PWA standalone, permission, đổi mạng và app background/foreground.
- Active head-turn vẫn là liveness phía client mức MVP; chưa có PAD được kiểm thử độc lập hoặc chứng nhận ISO/IEC 30107-3.
- Backfill retention cần được chạy dry-run rồi apply có phê duyệt; các profile bị `skippedInvalid` phải được xử lý riêng và không được coi là đã có TTL.
- Realtime hiện vẫn trả một trang cùng `hasMore`; attendance report có cursor để lấy trang tiếp theo. Không dùng `pageSummary` bị truncated làm tổng kỳ, bảng lương hay quyết định kỷ luật.
- QA sau triển khai cần kiểm tra quyền `COMPANY_ADMIN/HR/MANAGER`, kill switch, rút consent, timezone hiển thị và cảnh báo dữ liệu chưa đầy đủ.

## Exit criteria cho pilot

### P0 — bắt buộc trước canary

- [ ] Đủ 24 callable exports; lint, build, unit test và function test đều đạt.
- [ ] Emulator/integration test chứng minh tenant/branch isolation, Auth/App Check, rate limit và Rules cho 5 API mới.
- [ ] `withdrawFaceConsent` xóa/vô hiệu template, thu hồi session/proof và chặn verification mới; request lặp lại an toàn.
- [ ] `updatePilotPolicy` có authorization, validation, audit và rollback/kill switch được diễn tập.
- [ ] Report/realtime không trả descriptor, token, raw image, secret hoặc field ngoài contract; `truncated/hasMore/pageSummary` được hiển thị đúng và CSV thiếu dữ liệu bị khóa.
- [ ] Backfill Face retention đã dry-run, apply có phê duyệt và xử lý xong mọi `skippedInvalid`; TTL production được xác minh.
- [ ] Hai request đồng thời không tái sử dụng proof hay tạo attendance event trùng.
- [ ] Privacy notice, consent version, lịch retention và luồng chấm công thay thế được chủ sở hữu nghiệp vụ/pháp lý phê duyệt bằng văn bản.
- [ ] Test thiết bị thật đạt trên ít nhất hai iPhone và hai Android thuộc cấu hình đã hỗ trợ.
- [ ] Không có lỗi bảo mật mức critical/high chưa xử lý và không có dữ liệu sinh trắc học trong log/analytics/error report.

### Chất lượng canary

- [ ] Hoàn thành tối thiểu một cửa sổ pilot đủ đại diện cho ca/ngày/chi nhánh đã chọn; cỡ mẫu và ngoại lệ được ghi trong báo cáo, không chỉ nêu phần trăm.
- [ ] Không có false accept cross-user trong bộ negative-pair có đồng ý; false reject và retry được đo theo thiết bị/điều kiện thay vì gộp che mất nhóm yếu.
- [ ] Tỷ lệ hoàn thành Face trong điều kiện hỗ trợ đạt mục tiêu do chủ sản phẩm phê duyệt; đề xuất ban đầu là ≥95% sau tối đa một lần retry.
- [ ] P95 thời gian xác minh sau khi model đã cache đạt mục tiêu đã duyệt; đề xuất ban đầu là ≤8 giây, tách riêng thời gian camera/model và backend.
- [ ] 100% trường hợp không thể dùng Face có luồng thay thế, không làm mất attendance event hợp lệ và có audit phù hợp.
- [ ] Kill switch được kiểm thử trên production canary và có hiệu lực trong mục tiêu vận hành đã duyệt.
- [ ] Dashboard nêu rõ thời gian cập nhật, không gây hiểu nhầm snapshot realtime là theo dõi vị trí liên tục.

### Điều kiện dừng hoặc quay lui

Pilot phải chuyển `OFF` khi có một trong các tình huống sau:

- lộ descriptor, secret, proof token, ảnh/video hoặc dữ liệu tenant khác;
- có bằng chứng replay/cross-tenant tạo attendance event trái phép;
- không thể thực hiện yêu cầu rút consent/xóa mẫu trong thời gian xử lý đã cam kết;
- false accept, false reject hoặc lỗi camera vượt ngưỡng đã duyệt mà chưa có biện pháp giảm thiểu;
- kill switch không hoạt động, policy UI/backend không nhất quán hoặc report sai số liệu ảnh hưởng nghiệp vụ;
- hệ thống chặn người lao động nhưng luồng thay thế không khả dụng.

## Checklist bàn giao Phase 8

- [ ] Đối chiếu API contract trong tài liệu với type frontend và export backend sau khi merge.
- [ ] Xác nhận README ghi đúng số callable thực tế, không dùng số “dự kiến” như trạng thái production.
- [ ] Cập nhật Firestore Rules/indexes/TTL nếu collection hoặc query mới yêu cầu.
- [ ] Chạy `npm run lint`, `npm run build`, `npm run test:functions` và `npm test`.
- [ ] Chạy emulator suite khi môi trường có Java; nếu chưa chạy phải ghi rõ trong biên bản phát hành.
- [ ] QA giao diện desktop/mobile cho policy, report, realtime và rút consent.
- [ ] Kiểm tra production bằng dữ liệu test được phê duyệt; không dùng thao tác phá hủy trên hồ sơ nhân viên thật.
- [ ] Cập nhật `CHANGELOG.md` với commit/deployment/version, kết quả backfill, người duyệt policy và trạng thái từng exit criterion.
