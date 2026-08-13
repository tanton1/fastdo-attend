# Changelog

## Unreleased — Operations workflow

- Thêm yêu cầu điều chỉnh công có trạng thái `PENDING/APPROVED/REJECTED/CANCELLED`, audit và adjustment bất biến cho payroll.
- Thêm yêu cầu nghỉ phép, phân quyền duyệt theo tenant/chi nhánh và giao diện xử lý cho nhân viên/quản trị.
- Thêm callable `getMyAttendanceEvents`, `create/list/reviewAttendanceRequest`, `create/list/reviewLeaveRequest` và `exportPayrollCsv`.
- Thêm payroll CSV theo kỳ/chi nhánh, chống CSV formula injection và chặn kỳ vượt 5.000 sự kiện.
- Thêm service worker offline shell; thao tác chấm công vẫn cần server xác nhận.
- Mở rộng Firestore Rules/indexes và runbook go-live.

## Phase 9 — Report pagination (2026-08-13)

- Attendance report có cursor opaque theo `serverTimestamp` + document ID, giữ nguyên tenant/branch scope và giới hạn tối đa 500 dòng mỗi trang.
- Admin Reports có nút “Tải thêm”, gộp các trang không trùng ID và chỉ mở CSV khi toàn bộ kỳ đã tải xong.
- Bổ sung kiểm thử cursor encode/decode, tie-break thứ tự ổn định và composite indexes cho truy vấn phân trang.

## Phase 8 — Pilot hardening (2026-08-13)

Phase 8 là bản phát hành kỹ thuật cho Pilot Control, báo cáo, realtime monitor và quyền riêng tư Face AI. Việc triển khai mã không đồng nghĩa pilot đã được phê duyệt; các release gate bên dưới vẫn phải hoàn tất trước khi mở cho người lao động.

### Added

- Năm callable API mới: `getPilotPolicy`, `updatePilotPolicy`, `getAttendanceReport`, `getRealtimeMonitor`, `withdrawFaceConsent`; tổng backend là 24 callable Functions.
- Policy Face theo chi nhánh với ba mode `OFF`, `MONITOR`, `REQUIRED`, cửa sổ rollout, cohort ổn định, threshold `0.35..0.65` và retention `1..365` ngày.
- Báo cáo chấm công theo timezone và realtime snapshot có tenant/branch scope, page summary và tín hiệu `truncated/hasMore`.
- Nhân viên có thể rút consent, xóa Face profile và thu hồi session/proof chưa dùng trong transaction.
- `faceTelemetry` chỉ chứa metadata đã làm sạch; TTL cho telemetry và `faceProfiles.retentionExpiresAt`.
- Công cụ one-off `functions/src/tools/backfill-face-retention.ts`, mặc định dry-run và chỉ ghi khi có `--apply`.
- Giao diện quản trị Pilot/Báo cáo và màn Quyền riêng tư Face AI; metadata/social preview Phase 8.

### Changed

- `getPrecheck`, `startFaceSession`, `completeFaceSession` và `checkIn` áp dụng effective policy theo cửa sổ rollout/cohort.
- `completeFaceSession` và `checkIn` đọc policy trong Firestore transaction để cập nhật policy đồng thời gây conflict/retry.
- Report/realtime chỉ mô tả số liệu trong trang bằng `pageSummary`; UI cảnh báo kết quả thiếu và khóa CSV khi `truncated=true`.
- Runtime phát hiện Face profile thiếu/hết hạn sẽ chặn verification và đưa enrollment về `NOT_STARTED` ở lần đối chiếu tiếp theo.

### Security and privacy notes

- Raw image/video không được upload; descriptor vẫn là dữ liệu sinh trắc học nhạy cảm và được mã hóa AES-256-GCM.
- Policy update ghi audit metadata tối thiểu, không phải full diff và hiện không có trường lý do vận hành riêng. Field ngoài contract bị bỏ qua, không được lưu.
- Chuyển policy sang `OFF` chặn phiên mới và completion đang diễn ra, nhưng không bulk-revoke Face proof đã cấp; proof single-use có thể còn được gửi tùy chọn cho tới khi hết hạn tối đa 90 giây.
- Không có lifecycle trigger cho Face TTL. Backfill phải được chạy cho profile Phase 7 hoặc khi cần rút ngắn expiry; trạng thái employee được sửa theo cơ chế runtime reconciliation.

### Known limitations and release gates

- Attendance report tối đa 500 dòng/request và realtime tối đa 100 dòng/request; có `hasMore` nhưng chưa có cursor hoặc trang kế tiếp. `pageSummary` bị truncated không được dùng làm tổng kỳ, bảng lương hay quyết định kỷ luật.
- Firebase Emulator integration chưa chạy trên môi trường hiện tại do thiếu Java; chưa có bằng chứng end-to-end cho Auth/App Check/Rules, tenant isolation và transaction concurrency của 5 API mới.
- Chưa hoàn tất ma trận camera/GPS/PWA trên ít nhất hai iPhone và hai Android thật.
- Head-turn là active liveness phía client mức MVP, chưa phải PAD được kiểm thử độc lập hoặc chứng nhận ISO/IEC 30107-3.
- Trước pilot cần hoàn thành privacy/legal approval, luồng chấm công thay thế, backfill retention, production QA và diễn tập kill switch.

### Validation completed

- `npm run lint`: đạt.
- `npm run build`: đạt production build.
- `npm run test:functions`: 18/18 bài domain đạt.
- `npm test`: Sites build và rendered HTML test đạt.

Các kết quả trên không bao gồm Firebase Emulator, thiết bị thật hoặc PAD; chúng vẫn là release gate như đã liệt kê.

### Release evidence to record

- Commit và version/deployment của Firebase cùng frontend.
- Kết quả `lint`, production build, rendered HTML test và Functions test.
- Kết quả backfill `scanned`, `candidates`, `updated`, `skippedInvalid`; mọi record invalid phải có cách xử lý.
- Policy/branch/cohort được duyệt, người duyệt và trạng thái từng exit criterion trong [tài liệu Phase 8](docs/phase-8-pilot-hardening.md).
