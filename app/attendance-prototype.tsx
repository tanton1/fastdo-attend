"use client";

import { FormEvent, useCallback, useEffect, useRef, useState } from "react";
import Image from "next/image";
import QRCode from "qrcode";
import { firebaseDemoMode } from "./lib/firebase-client";
import { assignEmployeeShift, changeTemporaryPassword, completeFaceSession, createEmployee, createPresenceChallenge, getAdminWorkforce, getPrecheck, listManagedDevices, loginEmployee, logoutEmployee, readCurrentLocation, requestPasswordReset, resetEmployeeFace, restoreAuthenticatedUser, reviewManagedDevice, sendLocationHeartbeat, startFaceSession, submitCheckIn, submitCheckOut, updateEmployee, verifyPresenceChallenge } from "./lib/attendance-api";
import type { AdminDevice, AdminWorkforce, AttendanceUser, CheckInResult, DeviceLocation, DeviceStatus, FaceChallenge, FaceEvidence, FacePurpose, LocationHeartbeatResult, PrecheckData, PresenceChallenge, WorkforceEmployee } from "./lib/attendance-types";

type Screen = "login" | "password" | "home" | "devices" | "precheck" | "face" | "presence" | "success" | "session";
type CheckState = "waiting" | "checking" | "success" | "warning";

interface BarcodeDetectorLike {
  detect(source: HTMLVideoElement): Promise<Array<{ rawValue: string }>>;
}

interface BarcodeDetectorConstructor {
  new(options: { formats: string[] }): BarcodeDetectorLike;
}

const checks = [
  {
    id: "device",
    icon: "▣",
    title: "Thiết bị",
    detail: "Mã thiết bị đã sẵn sàng để đánh giá",
  },
  {
    id: "location",
    icon: "⌖",
    title: "Vị trí",
    detail: "Đã nhận tọa độ GPS chính xác",
  },
  {
    id: "time",
    icon: "◷",
    title: "Thời gian",
    detail: "Ca bắt đầu lúc 08:00",
  },
  {
    id: "network",
    icon: "⌁",
    title: "Kết nối",
    detail: "Kết nối ổn định",
  },
] as const;

function Brand({ compact = false }: { compact?: boolean }) {
  return (
    <div className={`brand ${compact ? "brand--compact" : ""}`} aria-label="FASTDO ATTEND">
      <span className="brand__mark">F</span>
      <span className="brand__copy">
        <strong>FASTDO</strong>
        <small>ATTEND</small>
      </span>
    </div>
  );
}

function StatusDot({ state }: { state: CheckState }) {
  if (state === "checking") {
    return <span className="status-spinner" aria-label="Đang kiểm tra" />;
  }

  return (
    <span className={`status-dot status-dot--${state}`} aria-label={state === "success" ? "Đạt" : state === "warning" ? "Cần xử lý" : "Chờ kiểm tra"}>
      {state === "success" ? "✓" : state === "warning" ? "!" : "•"}
    </span>
  );
}

function LoginScreen({ onLogin }: { onLogin: (employeeId: string, password: string, remember: boolean) => Promise<void> }) {
  const demoMode = firebaseDemoMode();
  const [employeeId, setEmployeeId] = useState(demoMode ? "FD0238" : "");
  const [password, setPassword] = useState(demoMode ? "fastdo2026" : "");
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [remember, setRemember] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [resetting, setResetting] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!employeeId.trim() || !password.trim()) {
      setError("Vui lòng nhập đầy đủ mã nhân viên và mật khẩu.");
      return;
    }
    setError("");
    setSubmitting(true);
    try {
      await onLogin(employeeId, password, remember);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Không thể đăng nhập. Vui lòng thử lại.");
    } finally {
      setSubmitting(false);
    }
  }

  async function resetPassword() {
    setError("");
    setNotice("");
    setResetting(true);
    try {
      setNotice(await requestPasswordReset(employeeId));
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Chưa thể gửi email đặt lại mật khẩu.");
    } finally {
      setResetting(false);
    }
  }

  return (
    <section className="screen login-screen" aria-labelledby="login-title">
      <div className="login-glow" />
      <div className="login-brand"><Brand /></div>

      <div className="login-intro">
        <p className="eyebrow">Chào mừng quay lại <span>✦</span></p>
        <h1 id="login-title">Sẵn sàng cho một ngày hiệu quả.</h1>
        <p>Đăng nhập để tiếp tục chấm công.</p>
      </div>

      <form className="login-form" onSubmit={submit} noValidate>
        <label>
          <span>Mã nhân viên / Email / SĐT</span>
          <input
            value={employeeId}
            onChange={(event) => setEmployeeId(event.target.value)}
            autoComplete="username"
            placeholder="Nhập mã nhân viên hoặc email"
          />
        </label>

        <label>
          <span>Mật khẩu</span>
          <span className="password-field">
            <input
              value={password}
              type={showPassword ? "text" : "password"}
              onChange={(event) => setPassword(event.target.value)}
              autoComplete="current-password"
              placeholder="Nhập mật khẩu"
            />
            <button type="button" onClick={() => setShowPassword((value) => !value)} aria-label={showPassword ? "Ẩn mật khẩu" : "Hiện mật khẩu"}>
              {showPassword ? "Ẩn" : "Hiện"}
            </button>
          </span>
        </label>

        <div className="form-options">
          <label className="remember"><input type="checkbox" checked={remember} onChange={(event) => setRemember(event.target.checked)} /> <span>Ghi nhớ tài khoản</span></label>
          <button type="button" className="text-button" onClick={() => void resetPassword()} disabled={resetting}>{resetting ? "Đang gửi…" : "Quên mật khẩu?"}</button>
        </div>

        {error && <p className="form-error" role="alert">{error}</p>}
        {notice && <p className="form-notice" role="status">{notice}</p>}
        <button className="primary-button" type="submit" disabled={submitting}>{submitting ? "Đang xác thực…" : "Đăng nhập"}</button>
      </form>

      <div className="divider"><span>hoặc đăng nhập bằng</span></div>
      <button className="passkey-button" type="button" onClick={demoMode ? () => onLogin(employeeId, password, remember) : undefined} disabled={!demoMode} title={demoMode ? undefined : "WebAuthn/Passkey sẽ được tích hợp ở giai đoạn tiếp theo"}>
        <span className="scan-icon">⌾</span>
        {demoMode ? "Passkey / Face ID" : "Passkey / Face ID · Sắp có"}
      </button>

      <p className="login-help">Chưa có tài khoản? Liên hệ quản trị viên để được cấp quyền.</p>
    </section>
  );
}

function ChangeTemporaryPasswordScreen({ user, onChanged, onLogout }: { user: AttendanceUser; onChanged: (user: AttendanceUser) => void; onLogout: () => void }) {
  const [password, setPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const rules = {
    length: password.length >= 12,
    upper: /[A-Z]/.test(password),
    lower: /[a-z]/.test(password),
    digit: /\d/.test(password),
    symbol: /[^A-Za-z0-9]/.test(password),
  };
  const valid = Object.values(rules).every(Boolean) && password === confirmation;

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!valid) {
      setError(password !== confirmation ? "Hai mật khẩu chưa trùng khớp." : "Mật khẩu mới chưa đáp ứng đủ yêu cầu bảo mật.");
      return;
    }
    setSubmitting(true);
    setError("");
    try {
      onChanged(await changeTemporaryPassword(password));
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Không thể đổi mật khẩu.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <section className="screen forced-password-screen" aria-labelledby="forced-password-title">
      <div className="forced-password-glow" />
      <header><Brand compact /><button onClick={onLogout}>Đăng xuất</button></header>
      <main>
        <span className="forced-password-icon">⌘</span>
        <p className="eyebrow">BẢO VỆ TÀI KHOẢN</p>
        <h1 id="forced-password-title">Tạo mật khẩu riêng</h1>
        <p>Chào {user.fullName}. Mật khẩu hiện tại chỉ dùng một lần; bạn cần thay đổi trước khi truy cập dữ liệu chấm công.</p>
        <form onSubmit={submit}>
          <label><span>Mật khẩu mới</span><span className="password-field"><input type={showPassword ? "text" : "password"} value={password} onChange={(event) => setPassword(event.target.value)} autoComplete="new-password" /><button type="button" onClick={() => setShowPassword((value) => !value)}>{showPassword ? "Ẩn" : "Hiện"}</button></span></label>
          <label><span>Nhập lại mật khẩu</span><input type={showPassword ? "text" : "password"} value={confirmation} onChange={(event) => setConfirmation(event.target.value)} autoComplete="new-password" /></label>
          <ul className="password-rules" aria-label="Yêu cầu mật khẩu"><li className={rules.length ? "done" : ""}>Ít nhất 12 ký tự</li><li className={rules.upper && rules.lower ? "done" : ""}>Có chữ hoa và chữ thường</li><li className={rules.digit ? "done" : ""}>Có chữ số</li><li className={rules.symbol ? "done" : ""}>Có ký tự đặc biệt</li></ul>
          {confirmation && password !== confirmation && <p className="form-error">Hai mật khẩu chưa trùng khớp.</p>}
          {error && <p className="form-error" role="alert">{error}</p>}
          <button className="primary-button" type="submit" disabled={!valid || submitting}>{submitting ? "Đang bảo vệ tài khoản…" : "Đổi mật khẩu & tiếp tục"}</button>
        </form>
        <small>FASTDO không bao giờ gửi mật khẩu mới của bạn qua email hoặc tin nhắn.</small>
      </main>
    </section>
  );
}

function HomeScreen({ time, date, user, precheck, onCheckIn, onManageDevices, onLogout }: { time: string; date: string; user: AttendanceUser; precheck: PrecheckData | null; onCheckIn: () => void; onManageDevices: () => void; onLogout: () => void }) {
  return (
    <section className="screen home-screen" aria-labelledby="home-title">
      <header className="mobile-header">
        <div>
          <p>Chào buổi sáng,</p>
          <h1 id="home-title">{user.fullName}</h1>
          <span>{date}</span>
        </div>
        <div className="header-actions">
          <button className="icon-button" aria-label="Thông báo"><span className="notification-dot" />♧</button>
          <button className="avatar-button" onClick={onLogout} aria-label="Đăng xuất tài khoản Hải Âu">HÂ</button>
        </div>
      </header>

      <main className="home-content">
        <article className="shift-card">
          <div>
            <span className="card-label">CA HÔM NAY</span>
            <h2>{precheck?.shift.name ?? "Ca hành chính"}</h2>
            <strong>{precheck?.shift.startTime ?? "08:00"} – {precheck?.shift.endTime ?? "17:00"}</strong>
          </div>
          <span className="countdown">Theo lịch ca</span>
          <div className="shift-location">
            <span>⌖</span>
            <p>{precheck?.branch.name ?? "Aura Thanh Khê"}<br /><small>{precheck?.branch.address ?? "276 Thái Thị Bôi, Đà Nẵng"}</small></p>
          </div>
        </article>

        <section className="checkin-hero" aria-label="Trạng thái chấm công">
          <div className="orbit orbit--one"><span /></div>
          <div className="orbit orbit--two"><span /></div>
          <div className="checkin-ring">
            <div>
              <strong>{time}</strong>
              <span>Sẵn sàng</span>
              <small>chấm công</small>
            </div>
          </div>
          <span className="orbit-label orbit-label--face"><b>⌾</b>Khuôn mặt</span>
          <span className="orbit-label orbit-label--location"><b>⌖</b>Vị trí</span>
          <span className="orbit-label orbit-label--device"><b>▣</b>Thiết bị</span>
          <span className="orbit-label orbit-label--presence"><b>⌘</b>Điểm cơ sở</span>
        </section>

        <button className="primary-button checkin-button" onClick={onCheckIn}>CHẤM CÔNG VÀO <span>→</span></button>

        <div className="readiness-card">
          <div><span className="mini-icon">◉</span><p>Camera<strong>Sẽ kiểm tra</strong></p></div>
          <div><span className="mini-icon">⌖</span><p>Vị trí<strong>Sẽ kiểm tra</strong></p></div>
          <div><span className="mini-icon">▣</span><p>Thiết bị<strong>{firebaseDemoMode() ? "Mô phỏng" : precheck?.device.trusted ? "Đã duyệt" : precheck?.device.isBlocked ? "Đã chặn" : precheck ? "Chờ duyệt" : "Sẽ đánh giá"}</strong></p></div>
          <div><span className="mini-icon mini-icon--warn">⌘</span><p>Điểm cơ sở<strong className="warn">Chưa xác minh</strong></p></div>
        </div>
      </main>

      <nav className="bottom-nav" aria-label="Điều hướng chính">
        <button className="active"><span>⌂</span>Trang chủ</button>
        <button><span>□</span>Lịch làm</button>
        <button className="nav-main" onClick={onCheckIn} aria-label="Bắt đầu chấm công"><span>⌘</span></button>
        <button><span>◷</span>Lịch sử</button>
        {user.canManageDevices
          ? <button onClick={onManageDevices}><span>⚙</span>Quản trị</button>
          : <button><span>♙</span>Cá nhân</button>}
      </nav>
    </section>
  );
}

function formatDeviceTime(value: string | null): string {
  if (!value) return "Chưa có dữ liệu";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Chưa có dữ liệu";
  return new Intl.DateTimeFormat("vi-VN", {
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "Asia/Ho_Chi_Minh",
  }).format(date);
}

function PresenceAdminPanel() {
  const [challenge, setChallenge] = useState<PresenceChallenge | null>(null);
  const [qrDataUrl, setQrDataUrl] = useState("");
  const [secondsLeft, setSecondsLeft] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!challenge) return;
    const timer = window.setInterval(() => setSecondsLeft(Math.max(0, Math.ceil((new Date(challenge.expiresAt).getTime() - Date.now()) / 1000))), 1000);
    return () => window.clearInterval(timer);
  }, [challenge]);

  async function generate() {
    setLoading(true);
    setError("");
    try {
      const next = await createPresenceChallenge();
      const image = await QRCode.toDataURL(next.qrToken, {
        width: 240,
        margin: 1,
        errorCorrectionLevel: "M",
        color: { dark: "#080a0a", light: "#ffffff" },
      });
      setChallenge(next);
      setQrDataUrl(image);
      setSecondsLeft(Math.max(0, Math.ceil((new Date(next.expiresAt).getTime() - Date.now()) / 1000)));
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Không thể tạo mã hiện diện.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <section className="presence-admin" aria-label="QR hiện diện tại cơ sở">
      <div className="presence-admin__intro">
        <span>⌘</span>
        <div><strong>QR hiện diện động</strong><p>Mã được ký tại máy chủ, tự hết hạn sau 45 giây và chỉ dùng đúng chi nhánh.</p></div>
      </div>

      {!challenge && <div className="presence-admin__empty"><span>▦</span><strong>Chưa phát mã hiện diện</strong><p>Tạo mã khi nhân viên đã có mặt tại điểm chấm công.</p></div>}

      {challenge && <article className={`presence-qr-card ${secondsLeft === 0 ? "is-expired" : ""}`}>
        <div className="presence-qr-card__head"><div><span>ĐIỂM CHẤM CÔNG</span><strong>{challenge.branch.name}</strong></div><b>{secondsLeft > 0 ? `${secondsLeft}s` : "HẾT HẠN"}</b></div>
        {qrDataUrl && <Image src={qrDataUrl} alt={`QR hiện diện ${challenge.branch.name}`} width={198} height={198} unoptimized />}
        <p>Mã nhập nhanh</p>
        <strong className="presence-code">{challenge.code.slice(0, 3)} {challenge.code.slice(3)}</strong>
        <small>Không chụp hoặc gửi mã ra ngoài cơ sở.</small>
      </article>}

      {error && <p className="admin-message admin-message--error" role="alert">{error}</p>}
      <button className="primary-button presence-generate" onClick={() => void generate()} disabled={loading}>{loading ? "Đang ký mã…" : challenge ? "Tạo mã mới" : "Phát QR hiện diện"}</button>
    </section>
  );
}

function faceStatusLabel(status: WorkforceEmployee["faceEnrollmentStatus"]): string {
  if (status === "APPROVED") return "Đã đăng ký";
  if (status === "PENDING") return "Đang xử lý";
  if (status === "REJECTED") return "Cần đăng ký lại";
  return "Chưa đăng ký";
}

function WorkforceAdminPanel({ mode }: { mode: "EMPLOYEES" | "SHIFTS" }) {
  const [data, setData] = useState<AdminWorkforce | null>(null);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [showCreate, setShowCreate] = useState(false);
  const [temporaryPassword, setTemporaryPassword] = useState<{ employee: string; value: string } | null>(null);
  const [employeeForm, setEmployeeForm] = useState({ fullName: "", employeeCode: "", email: "", role: "EMPLOYEE" as WorkforceEmployee["role"], branchId: "" });
  const today = new Date().toISOString().slice(0, 10);
  const [assignmentForm, setAssignmentForm] = useState({ userId: "", branchId: "", shiftId: "", startDate: today, endDate: today });

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const result = await getAdminWorkforce();
      setData(result);
      setEmployeeForm((current) => ({ ...current, branchId: current.branchId || result.branches[0]?.id || "" }));
      setAssignmentForm((current) => ({
        ...current,
        userId: current.userId || result.employees.find((employee) => employee.status === "ACTIVE")?.id || "",
        branchId: current.branchId || result.branches[0]?.id || "",
        shiftId: current.shiftId || result.shifts[0]?.id || "",
      }));
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Không thể tải dữ liệu nhân sự.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    let active = true;
    void getAdminWorkforce()
      .then((result) => {
        if (!active) return;
        setData(result);
        setEmployeeForm((current) => ({ ...current, branchId: current.branchId || result.branches[0]?.id || "" }));
        setAssignmentForm((current) => ({
          ...current,
          userId: current.userId || result.employees.find((employee) => employee.status === "ACTIVE")?.id || "",
          branchId: current.branchId || result.branches[0]?.id || "",
          shiftId: current.shiftId || result.shifts[0]?.id || "",
        }));
      })
      .catch((reason) => { if (active) setError(reason instanceof Error ? reason.message : "Không thể tải dữ liệu nhân sự."); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, []);

  async function submitEmployee(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!employeeForm.fullName.trim() || !employeeForm.employeeCode.trim() || !employeeForm.email.trim() || !employeeForm.branchId) {
      setError("Vui lòng nhập đầy đủ thông tin nhân viên và chi nhánh.");
      return;
    }
    setBusyId("CREATE");
    setError("");
    setNotice("");
    try {
      const result = await createEmployee({
        fullName: employeeForm.fullName.trim(),
        employeeCode: employeeForm.employeeCode.trim().toUpperCase(),
        email: employeeForm.email.trim().toLowerCase(),
        role: employeeForm.role,
        branchIds: [employeeForm.branchId],
      });
      setData((current) => current ? { ...current, employees: [result.employee, ...current.employees] } : current);
      setTemporaryPassword({ employee: result.employee.fullName, value: result.temporaryPassword });
      setEmployeeForm((current) => ({ ...current, fullName: "", employeeCode: "", email: "", role: "EMPLOYEE" }));
      setShowCreate(false);
      setNotice(`Đã tạo tài khoản cho ${result.employee.fullName}.`);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Không thể tạo nhân viên.");
    } finally {
      setBusyId("");
    }
  }

  async function toggleEmployee(employee: WorkforceEmployee) {
    const nextStatus = employee.status === "ACTIVE" ? "INACTIVE" : "ACTIVE";
    if (nextStatus === "INACTIVE" && !window.confirm(`Tạm ngưng tài khoản ${employee.fullName}?`)) return;
    setBusyId(employee.id);
    setError("");
    try {
      const updated = await updateEmployee(employee.id, { status: nextStatus });
      setData((current) => current ? { ...current, employees: current.employees.map((item) => item.id === employee.id ? updated : item) } : current);
      setNotice(nextStatus === "ACTIVE" ? `Đã kích hoạt ${employee.fullName}.` : `Đã tạm ngưng ${employee.fullName}.`);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Không thể cập nhật nhân viên.");
    } finally {
      setBusyId("");
    }
  }

  async function resetFace(employee: WorkforceEmployee) {
    if (!window.confirm(`Xóa mẫu khuôn mặt hiện tại của ${employee.fullName} và yêu cầu đăng ký lại?`)) return;
    setBusyId(employee.id);
    setError("");
    try {
      await resetEmployeeFace(employee.id);
      setData((current) => current ? { ...current, employees: current.employees.map((item) => item.id === employee.id ? { ...item, faceEnrollmentStatus: "NOT_STARTED" } : item) } : current);
      setNotice(`Đã yêu cầu ${employee.fullName} đăng ký lại khuôn mặt.`);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Không thể đặt lại mẫu khuôn mặt.");
    } finally {
      setBusyId("");
    }
  }

  async function submitAssignment(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!assignmentForm.userId || !assignmentForm.branchId || !assignmentForm.shiftId || !assignmentForm.startDate || !assignmentForm.endDate) {
      setError("Vui lòng chọn đủ nhân viên, chi nhánh, ca và thời hạn áp dụng.");
      return;
    }
    if (assignmentForm.endDate < assignmentForm.startDate) {
      setError("Ngày kết thúc phải bằng hoặc sau ngày bắt đầu.");
      return;
    }
    setBusyId("ASSIGN");
    setError("");
    try {
      const assignment = await assignEmployeeShift(assignmentForm);
      setData((current) => current ? { ...current, assignments: [assignment, ...current.assignments] } : current);
      setNotice("Đã phân ca và đồng bộ lịch chấm công.");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Không thể phân ca.");
    } finally {
      setBusyId("");
    }
  }

  if (loading) return <div className="workforce-loading"><span className="status-spinner" /> Đang đồng bộ dữ liệu…</div>;
  if (!data) return <div className="device-empty"><strong>Chưa tải được dữ liệu</strong><button className="secondary-button" onClick={() => void load()}>Thử lại</button></div>;

  if (mode === "SHIFTS") {
    const availableShifts = data.shifts.filter((shift) => !assignmentForm.branchId || shift.branchId === assignmentForm.branchId);
    return (
      <section className="workforce-panel" aria-label="Quản lý phân ca">
        <div className="workforce-heading"><div><small>LỊCH LÀM VIỆC</small><h2>Phân ca nhân viên</h2></div><span>{data.assignments.length} phân công</span></div>
        <form className="workforce-form assignment-form" onSubmit={submitAssignment}>
          <label><span>Nhân viên</span><select value={assignmentForm.userId} onChange={(event) => setAssignmentForm((current) => ({ ...current, userId: event.target.value }))}>{data.employees.filter((employee) => employee.status === "ACTIVE").map((employee) => <option key={employee.id} value={employee.id}>{employee.employeeCode} · {employee.fullName}</option>)}</select></label>
          <label><span>Chi nhánh</span><select value={assignmentForm.branchId} onChange={(event) => { const branchId = event.target.value; const firstShift = data.shifts.find((shift) => shift.branchId === branchId); setAssignmentForm((current) => ({ ...current, branchId, shiftId: firstShift?.id || "" })); }}>{data.branches.filter((branch) => branch.isActive).map((branch) => <option key={branch.id} value={branch.id}>{branch.name}</option>)}</select></label>
          <label><span>Ca làm</span><select value={assignmentForm.shiftId} onChange={(event) => setAssignmentForm((current) => ({ ...current, shiftId: event.target.value }))}>{availableShifts.map((shift) => <option key={shift.id} value={shift.id}>{shift.name} · {shift.startTime}–{shift.endTime}</option>)}</select></label>
          <div className="workforce-form__dates"><label><span>Từ ngày</span><input type="date" value={assignmentForm.startDate} onChange={(event) => setAssignmentForm((current) => ({ ...current, startDate: event.target.value }))} /></label><label><span>Đến ngày</span><input type="date" value={assignmentForm.endDate} min={assignmentForm.startDate} onChange={(event) => setAssignmentForm((current) => ({ ...current, endDate: event.target.value }))} /></label></div>
          <button className="primary-button" type="submit" disabled={busyId === "ASSIGN" || availableShifts.length === 0}>{busyId === "ASSIGN" ? "Đang phân ca…" : "Xác nhận phân ca"}</button>
        </form>
        {error && <p className="admin-message admin-message--error" role="alert">{error}</p>}
        {notice && <p className="admin-message admin-message--success" role="status">{notice}</p>}
        <div className="assignment-list">
          {data.assignments.length === 0 && <div className="device-empty"><span>◷</span><strong>Chưa có phân ca</strong><p>Tạo lịch đầu tiên bằng biểu mẫu phía trên.</p></div>}
          {data.assignments.map((assignment) => {
            const employee = data.employees.find((item) => item.id === assignment.userId);
            const shift = data.shifts.find((item) => item.id === assignment.shiftId);
            const branch = data.branches.find((item) => item.id === assignment.branchId);
            return <article className="assignment-card" key={assignment.id}><span>◷</span><div><strong>{employee?.fullName ?? "Nhân viên"}</strong><p>{shift?.name ?? "Ca làm"} · {branch?.name ?? "Chi nhánh"}</p><small>{assignment.startDate} → {assignment.endDate}</small></div></article>;
          })}
        </div>
      </section>
    );
  }

  return (
    <section className="workforce-panel" aria-label="Quản lý nhân viên">
      <div className="workforce-heading"><div><small>NHÂN SỰ DOANH NGHIỆP</small><h2>{data.employees.length} nhân viên</h2></div><button onClick={() => setShowCreate((value) => !value)}>{showCreate ? "Đóng" : "+ Thêm mới"}</button></div>
      {showCreate && <form className="workforce-form" onSubmit={submitEmployee}>
        <label><span>Họ và tên</span><input value={employeeForm.fullName} onChange={(event) => setEmployeeForm((current) => ({ ...current, fullName: event.target.value }))} placeholder="Nguyễn Minh Anh" autoComplete="name" /></label>
        <div className="workforce-form__split"><label><span>Mã nhân viên</span><input value={employeeForm.employeeCode} onChange={(event) => setEmployeeForm((current) => ({ ...current, employeeCode: event.target.value }))} placeholder="FD0242" /></label><label><span>Vai trò</span><select value={employeeForm.role} onChange={(event) => setEmployeeForm((current) => ({ ...current, role: event.target.value as WorkforceEmployee["role"] }))}><option value="EMPLOYEE">Nhân viên</option><option value="MANAGER">Quản lý</option><option value="HR">Nhân sự</option></select></label></div>
        <label><span>Email đăng nhập</span><input type="email" value={employeeForm.email} onChange={(event) => setEmployeeForm((current) => ({ ...current, email: event.target.value }))} placeholder="minhanh@congty.vn" autoComplete="email" /></label>
        <label><span>Chi nhánh</span><select value={employeeForm.branchId} onChange={(event) => setEmployeeForm((current) => ({ ...current, branchId: event.target.value }))}>{data.branches.filter((branch) => branch.isActive).map((branch) => <option key={branch.id} value={branch.id}>{branch.name}</option>)}</select></label>
        <button className="primary-button" type="submit" disabled={busyId === "CREATE"}>{busyId === "CREATE" ? "Đang tạo tài khoản…" : "Tạo nhân viên"}</button>
      </form>}
      {temporaryPassword && <div className="temporary-password" role="status"><div><span>MẬT KHẨU TẠM THỜI · CHỈ HIỆN MỘT LẦN</span><strong>{temporaryPassword.value}</strong><p>Gửi riêng cho {temporaryPassword.employee} và yêu cầu đổi ngay sau lần đăng nhập đầu tiên.</p></div><button onClick={() => void navigator.clipboard.writeText(temporaryPassword.value)}>Sao chép</button></div>}
      {error && <p className="admin-message admin-message--error" role="alert">{error}</p>}
      {notice && <p className="admin-message admin-message--success" role="status">{notice}</p>}
      <div className="employee-list">
        {data.employees.map((employee) => <article className={`employee-card ${employee.status === "INACTIVE" ? "is-inactive" : ""}`} key={employee.id}>
          <div className="employee-card__head"><span className="device-owner-avatar">{employee.fullName.trim().split(/\s+/).slice(-2).map((part) => part[0]).join("").toUpperCase()}</span><div><strong>{employee.fullName}</strong><small>{employee.employeeCode} · {employee.role.replaceAll("_", " ")}</small></div><b>{employee.status === "ACTIVE" ? "HOẠT ĐỘNG" : "TẠM NGƯNG"}</b></div>
          <p className="employee-card__email">{employee.email}</p>
          <div className="employee-face"><span className={`face-state face-state--${employee.faceEnrollmentStatus.toLowerCase()}`}>◉ {faceStatusLabel(employee.faceEnrollmentStatus)}</span>{employee.faceEnrollmentStatus !== "NOT_STARTED" && <button onClick={() => void resetFace(employee)} disabled={busyId === employee.id}>Đặt lại Face</button>}</div>
          <button className={`employee-toggle ${employee.status === "ACTIVE" ? "employee-toggle--stop" : ""}`} onClick={() => void toggleEmployee(employee)} disabled={busyId === employee.id}>{busyId === employee.id ? "Đang cập nhật…" : employee.status === "ACTIVE" ? "Tạm ngưng tài khoản" : "Kích hoạt tài khoản"}</button>
        </article>)}
      </div>
    </section>
  );
}

function DeviceAdminScreen({ user, onBack }: { user: AttendanceUser; onBack: () => void }) {
  const [section, setSection] = useState<"DEVICES" | "PRESENCE" | "EMPLOYEES" | "SHIFTS">("DEVICES");
  const [devices, setDevices] = useState<AdminDevice[]>([]);
  const [filter, setFilter] = useState<"ALL" | DeviceStatus>("ALL");
  const [loading, setLoading] = useState(true);
  const [reviewingId, setReviewingId] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const refresh = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      setDevices(await listManagedDevices());
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Không thể tải danh sách thiết bị.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    let active = true;
    void listManagedDevices()
      .then((result) => { if (active) setDevices(result); })
      .catch((reason) => { if (active) setError(reason instanceof Error ? reason.message : "Không thể tải danh sách thiết bị."); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, []);

  async function review(device: AdminDevice, decision: Extract<DeviceStatus, "TRUSTED" | "BLOCKED">) {
    if (decision === "BLOCKED" && !window.confirm(`Khóa thiết bị ${device.label} của ${device.employeeName}?`)) return;
    setReviewingId(device.id);
    setError("");
    setNotice("");
    try {
      const result = await reviewManagedDevice(device.id, decision);
      setDevices((current) => current.map((item) => item.id === device.id ? {
        ...item,
        status: result.status,
        trusted: result.trusted,
        isBlocked: result.status === "BLOCKED",
        reviewedAt: new Date().toISOString(),
      } : item));
      setNotice(result.status === "TRUSTED" ? `Đã duyệt thiết bị của ${device.employeeName}.` : `Đã khóa thiết bị của ${device.employeeName}.`);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Không thể cập nhật thiết bị.");
    } finally {
      setReviewingId("");
    }
  }

  const counts = {
    PENDING: devices.filter((device) => device.status === "PENDING").length,
    TRUSTED: devices.filter((device) => device.status === "TRUSTED").length,
    BLOCKED: devices.filter((device) => device.status === "BLOCKED").length,
  };
  const visibleDevices = filter === "ALL" ? devices : devices.filter((device) => device.status === filter);

  return (
    <section className="screen admin-screen" aria-labelledby="device-admin-title">
      <header className="admin-header">
        <button className="back-button" onClick={onBack} aria-label="Quay lại">←</button>
        <div>
          <span>TRUNG TÂM QUẢN TRỊ</span>
          <h1 id="device-admin-title">{section === "DEVICES" ? "Kiểm soát truy cập" : section === "PRESENCE" ? "Hiện diện tại cơ sở" : section === "EMPLOYEES" ? "Đội ngũ nhân viên" : "Ca làm & phân công"}</h1>
        </div>
        <button className="admin-refresh" onClick={() => section === "DEVICES" && void refresh()} disabled={section !== "DEVICES" || loading} aria-label="Tải lại danh sách">↻</button>
      </header>

      <main className="admin-content">
        <section className="admin-profile" aria-label="Phiên quản trị">
          <span className="admin-profile__avatar">{user.fullName.trim().split(/\s+/).slice(-2).map((part) => part[0]).join("").toUpperCase()}</span>
          <div><strong>{user.fullName}</strong><small>{user.employeeCode} · {user.role.replaceAll("_", " ")}</small></div>
          <span className="admin-profile__secure">● ĐÃ XÁC THỰC</span>
        </section>

        <nav className="admin-tabs" aria-label="Chức năng quản trị">
          <button className={section === "DEVICES" ? "active" : ""} onClick={() => setSection("DEVICES")}>▣ Thiết bị</button>
          <button className={section === "PRESENCE" ? "active" : ""} onClick={() => setSection("PRESENCE")}>▦ Presence QR</button>
          <button className={section === "EMPLOYEES" ? "active" : ""} onClick={() => setSection("EMPLOYEES")}>♙ Nhân viên</button>
          <button className={section === "SHIFTS" ? "active" : ""} onClick={() => setSection("SHIFTS")}>◷ Phân ca</button>
        </nav>

        {section === "PRESENCE" ? <PresenceAdminPanel /> : section === "EMPLOYEES" || section === "SHIFTS" ? <WorkforceAdminPanel mode={section} /> : <><div className="device-stats">
          <button className={filter === "PENDING" ? "active" : ""} onClick={() => setFilter("PENDING")}><strong>{counts.PENDING}</strong><span>Chờ duyệt</span></button>
          <button className={filter === "TRUSTED" ? "active" : ""} onClick={() => setFilter("TRUSTED")}><strong>{counts.TRUSTED}</strong><span>Đã duyệt</span></button>
          <button className={filter === "BLOCKED" ? "active" : ""} onClick={() => setFilter("BLOCKED")}><strong>{counts.BLOCKED}</strong><span>Đã khóa</span></button>
        </div>

        <div className="device-list-head">
          <div><span>THIẾT BỊ TRONG DOANH NGHIỆP</span><strong>{filter === "ALL" ? "Tất cả" : filter === "PENDING" ? "Chờ duyệt" : filter === "TRUSTED" ? "Đã duyệt" : "Đã khóa"}</strong></div>
          {filter !== "ALL" && <button onClick={() => setFilter("ALL")}>Xem tất cả</button>}
        </div>

        {error && <p className="admin-message admin-message--error" role="alert">{error}</p>}
        {notice && <p className="admin-message admin-message--success" role="status">{notice}</p>}

        <div className="device-list" aria-live="polite">
          {loading && [0, 1, 2].map((item) => <div className="device-card device-card--loading" key={item}><span /><span /><span /></div>)}
          {!loading && visibleDevices.length === 0 && <div className="device-empty"><span>▣</span><strong>Không có thiết bị</strong><p>Không tìm thấy thiết bị phù hợp với bộ lọc hiện tại.</p></div>}
          {!loading && visibleDevices.map((device) => (
            <article className={`device-card device-card--${device.status.toLowerCase()}`} key={device.id}>
              <div className="device-card__head">
                <span className="device-owner-avatar">{device.employeeName.trim().split(/\s+/).slice(-2).map((part) => part[0]).join("").toUpperCase()}</span>
                <div><strong>{device.employeeName}</strong><small>{device.employeeCode}</small></div>
                <span className={`device-badge device-badge--${device.status.toLowerCase()}`}>{device.status === "PENDING" ? "CHỜ DUYỆT" : device.status === "TRUSTED" ? "TIN CẬY" : "ĐÃ KHÓA"}</span>
              </div>
              <div className="device-card__body">
                <p><span>▣</span><strong>{device.label}</strong></p>
                <p><span>◎</span>Hoạt động: {formatDeviceTime(device.lastSeenAt)}</p>
                <p><span>＋</span>Đăng ký: {formatDeviceTime(device.createdAt)}</p>
              </div>
              <div className="device-actions">
                {device.status !== "TRUSTED" && <button className="device-action device-action--approve" onClick={() => void review(device, "TRUSTED")} disabled={reviewingId === device.id}>{reviewingId === device.id ? "Đang xử lý…" : "✓ Duyệt thiết bị"}</button>}
                {device.status !== "BLOCKED" && <button className="device-action device-action--block" onClick={() => void review(device, "BLOCKED")} disabled={reviewingId === device.id}>⊘ Khóa</button>}
              </div>
            </article>
          ))}
        </div></>}
      </main>
    </section>
  );
}

function PrecheckScreen({ onBack, onContinue }: { onBack: () => void; onContinue: (precheck: PrecheckData, location: DeviceLocation) => void }) {
  const demoMode = firebaseDemoMode();
  const [states, setStates] = useState<Record<string, CheckState>>({
    device: "checking",
    location: "waiting",
    time: "waiting",
    network: "waiting",
  });
  const [precheck, setPrecheck] = useState<PrecheckData | null>(null);
  const [location, setLocation] = useState<DeviceLocation | null>(null);
  const [error, setError] = useState("");
  const [retryKey, setRetryKey] = useState(0);

  useEffect(() => {
    let active = true;
    async function runPrecheck() {
      setError("");
      setPrecheck(null);
      setLocation(null);
      setStates({ device: "checking", location: "waiting", time: "waiting", network: "checking" });
      let data: PrecheckData;
      try {
        data = await getPrecheck();
        if (!active) return;
        setPrecheck(data);
        if (!data.device.trusted) {
          setStates({ device: "warning", location: "waiting", time: "success", network: "success" });
          setError(data.device.isBlocked ? "Thiết bị này đã bị quản trị viên chặn." : "Thiết bị đã được đăng ký và đang chờ quản trị viên phê duyệt.");
          return;
        }
        setStates({ device: "success", location: "checking", time: "success", network: "checking" });
      } catch (reason) {
        if (!active) return;
        setError(reason instanceof Error ? reason.message : "Không thể tải điều kiện chấm công.");
        setStates({ device: "warning", location: "waiting", time: "waiting", network: "warning" });
        return;
      }

      try {
        const currentLocation = await readCurrentLocation(firebaseDemoMode());
        if (!active) return;
        setLocation(currentLocation);
        setStates({ device: "success", location: "success", time: "success", network: "success" });
      } catch (reason) {
        if (!active) return;
        setError(reason instanceof Error ? reason.message : "Không thể kiểm tra điều kiện chấm công.");
        setStates({ device: "success", location: "warning", time: "success", network: "success" });
      }
    }
    void runPrecheck();
    return () => { active = false; };
  }, [retryKey]);

  const complete = Object.values(states).every((state) => state === "success") && Boolean(precheck && location);

  return (
    <section className="screen precheck-screen" aria-labelledby="precheck-title">
      <header className="flow-header">
        <button className="back-button" onClick={onBack} aria-label="Quay lại">←</button>
        <div><h1 id="precheck-title">Kiểm tra điều kiện</h1><span>Bước 1/3</span></div>
        <span className="header-spacer" />
      </header>

      <div className="stepper" aria-label="Tiến trình chấm công">
        <span className="done" /><span /><span />
      </div>

      <main className="precheck-content">
        <div className="context-card">
          <span className="context-icon">⌁</span>
          <div><small>ĐIỂM CHẤM CÔNG</small><strong>{precheck?.branch.name ?? "Đang tải chi nhánh…"}</strong><span>{precheck ? `${precheck.shift.name} · ${precheck.shift.startTime} – ${precheck.shift.endTime}` : "Đang đồng bộ ca làm"}</span></div>
        </div>

        <div className="check-list">
          {checks.map((check) => {
            const state = states[check.id];
            return (
              <article className={`check-row check-row--${state}`} key={check.id}>
                <span className="check-row__icon">{check.icon}</span>
                <div>
                  <h2>{check.title}</h2>
                  <p>{state === "checking" ? "Đang xác minh…" : state === "waiting" ? "Đang chờ kiểm tra" : check.id === "device" && precheck ? `${precheck.device.label} · ${precheck.device.trusted ? "Đã duyệt" : precheck.device.isBlocked ? "Đã chặn" : "Chờ duyệt"}` : check.id === "location" && location ? `Độ chính xác GPS ±${Math.round(location.accuracy)} m` : check.id === "time" && precheck ? `Ca bắt đầu lúc ${precheck.shift.startTime}` : check.id === "network" && !demoMode ? "Đã kết nối Firebase" : check.detail}</p>
                </div>
                <StatusDot state={state} />
              </article>
            );
          })}
        </div>

        <div className="privacy-note">
          <span>i</span>
          <p><strong>Dữ liệu của bạn được bảo vệ</strong>{demoMode ? "Vị trí chỉ được dùng để mô phỏng bước xác minh và chưa được gửi lên máy chủ." : "Vị trí chỉ được gửi an toàn tới Firebase khi chấm công và trong phiên làm việc."}</p>
        </div>
        {error && <p className="precheck-error" role="alert">{error}</p>}
      </main>

      <footer className="flow-footer">
        <button className="primary-button" disabled={!complete && !error} onClick={() => error ? setRetryKey((value) => value + 1) : precheck && location && onContinue(precheck, location)}>
          {complete ? "Tiếp tục xác thực khuôn mặt" : error ? "Thử lại kiểm tra" : "Đang kiểm tra điều kiện…"}
        </button>
      </footer>
    </section>
  );
}

let faceModelsPromise: Promise<typeof import("@vladmandic/face-api")> | null = null;

function loadFaceModels(): Promise<typeof import("@vladmandic/face-api")> {
  if (!faceModelsPromise) {
    faceModelsPromise = import("@vladmandic/face-api").then(async (faceApi) => {
      await Promise.all([
        faceApi.nets.tinyFaceDetector.loadFromUri("/models/face-api"),
        faceApi.nets.faceLandmark68TinyNet.loadFromUri("/models/face-api"),
        faceApi.nets.faceRecognitionNet.loadFromUri("/models/face-api"),
      ]);
      return faceApi;
    }).catch((reason) => {
      faceModelsPromise = null;
      throw reason;
    });
  }
  return faceModelsPromise;
}

function averageFaceDescriptors(descriptors: Float32Array[]): number[] {
  if (descriptors.length === 0) return [];
  return Array.from({ length: 128 }, (_, index) => descriptors.reduce((sum, descriptor) => sum + descriptor[index], 0) / descriptors.length);
}

function FaceScreen({ precheck, onBack, onComplete }: { precheck: PrecheckData; onBack: () => void; onComplete: (faceProofId: string) => Promise<void> }) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const cancelledRef = useRef(false);
  const [purpose, setPurpose] = useState<FacePurpose>(precheck.employee.faceEnrollmentStatus === "APPROVED" ? "VERIFY" : "ENROLL");
  const [cameraState, setCameraState] = useState<"idle" | "loading" | "ready" | "denied">("idle");
  const [scanState, setScanState] = useState<"idle" | "neutral" | "challenge" | "submitting" | "enrolled" | "captured">("idle");
  const [challenge, setChallenge] = useState<FaceChallenge | null>(null);
  const [consented, setConsented] = useState(false);
  const [progress, setProgress] = useState(0);
  const [matchScore, setMatchScore] = useState<number | null>(null);
  const [faceProofId, setFaceProofId] = useState("");
  const [error, setError] = useState("");
  const demoMode = firebaseDemoMode();

  useEffect(() => () => {
    cancelledRef.current = true;
    streamRef.current?.getTracks().forEach((track) => track.stop());
  }, []);

  function stopCamera() {
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
  }

  async function prepareCamera() {
    if (purpose === "ENROLL" && !consented) {
      setError("Bạn cần xác nhận đồng ý đăng ký dữ liệu khuôn mặt trước khi tiếp tục.");
      return;
    }
    if (!navigator.mediaDevices?.getUserMedia) {
      setCameraState("denied");
      setError("Thiết bị hoặc trình duyệt này không hỗ trợ camera.");
      return;
    }
    setCameraState("loading");
    setError("");
    cancelledRef.current = false;
    try {
      const [, stream] = await Promise.all([
        loadFaceModels(),
        navigator.mediaDevices.getUserMedia({ video: { facingMode: "user", width: { ideal: 640 }, height: { ideal: 640 } }, audio: false }),
      ]);
      if (cancelledRef.current) {
        stream.getTracks().forEach((track) => track.stop());
        return;
      }
      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play();
      }
      const session = await startFaceSession(purpose);
      setChallenge(session.challenge);
      setCameraState("ready");
      setScanState("idle");
      sessionStorage.setItem("fastdo-face-session", JSON.stringify({ id: session.sessionId, expiresAt: session.expiresAt }));
    } catch (reason) {
      stopCamera();
      setCameraState("denied");
      setError(reason instanceof Error && /permission|denied|notallowed/i.test(reason.message)
        ? "Không thể mở camera. Hãy cấp quyền camera cho ứng dụng rồi thử lại."
        : "Không thể khởi tạo Face AI. Hãy kiểm tra kết nối và thử lại.");
    }
  }

  async function runLiveness() {
    if (!videoRef.current || cameraState !== "ready" || !challenge) return;
    const stored = sessionStorage.getItem("fastdo-face-session");
    const faceSession = stored ? JSON.parse(stored) as { id: string; expiresAt: string } : null;
    if (!faceSession || new Date(faceSession.expiresAt).getTime() <= Date.now()) {
      setError("Phiên Face AI đã hết hạn. Vui lòng khởi tạo lại camera.");
      setCameraState("idle");
      stopCamera();
      return;
    }
    setError("");
    setScanState("neutral");
    setProgress(4);
    const faceApi = await loadFaceModels();
    const descriptors: Float32Array[] = [];
    let faceFrames = 0;
    let neutralFrames = 0;
    let challengeFrames = 0;
    let motionScore = 0;
    const startedAt = performance.now();
    const deadline = startedAt + 14_000;

    try {
      while (performance.now() < deadline && !cancelledRef.current) {
        const result = await faceApi
          .detectSingleFace(videoRef.current, new faceApi.TinyFaceDetectorOptions({ inputSize: 224, scoreThreshold: 0.58 }))
          .withFaceLandmarks(true)
          .withFaceDescriptor();
        if (!result) {
          await new Promise((resolve) => window.setTimeout(resolve, 90));
          continue;
        }
        const box = result.detection.box;
        const nose = result.landmarks.getNose();
        const noseTip = nose[Math.min(3, nose.length - 1)];
        const yaw = (noseTip.x - (box.x + box.width / 2)) / Math.max(1, box.width / 2);
        faceFrames += 1;

        if (neutralFrames < 7) {
          if (Math.abs(yaw) <= 0.14) {
            neutralFrames += 1;
            descriptors.push(new Float32Array(result.descriptor));
            setProgress(Math.min(48, 6 + neutralFrames * 6));
          }
        } else {
          setScanState("challenge");
          const directionalMotion = challenge === "TURN_LEFT" ? yaw : -yaw;
          motionScore = Math.min(1, Math.max(motionScore, directionalMotion));
          if (directionalMotion >= 0.18) {
            challengeFrames += 1;
            setProgress(Math.min(96, 52 + challengeFrames * 11));
          }
          if (challengeFrames >= 4) break;
        }
        await new Promise((resolve) => window.setTimeout(resolve, 80));
      }

      const durationMs = Math.round(performance.now() - startedAt);
      if (neutralFrames < 7) throw new Error("Chưa thu đủ khung hình nhìn thẳng. Hãy giữ điện thoại ngang tầm mắt và thử lại.");
      if (challengeFrames < 4 || motionScore < 0.18) throw new Error(`Chưa nhận được động tác ${challenge === "TURN_LEFT" ? "quay trái" : "quay phải"}. Hãy thực hiện chậm và rõ hơn.`);
      const descriptor = averageFaceDescriptors(descriptors);
      if (descriptor.length !== 128) throw new Error("Không tạo được mẫu khuôn mặt hợp lệ. Vui lòng thử lại.");

      setScanState("submitting");
      setProgress(100);
      const evidence: FaceEvidence = { challenge, durationMs, motionScore, faceFrames, neutralFrames };
      const completion = await completeFaceSession({ sessionId: faceSession.id, descriptor, evidence });
      sessionStorage.removeItem("fastdo-face-session");
      setMatchScore(completion.matchScore);
      stopCamera();
      setCameraState("idle");
      if (purpose === "ENROLL") {
        setPurpose("VERIFY");
        setFaceProofId("");
        setProgress(0);
        setScanState("enrolled");
      } else {
        setFaceProofId(completion.faceProofId);
        setScanState("captured");
      }
    } catch (reason) {
      setScanState("idle");
      setProgress(0);
      setError(reason instanceof Error ? reason.message : "Không thể xác minh người thật. Vui lòng quét lại.");
    }
  }

  async function simulateDemo() {
    if (purpose === "ENROLL" && !consented) {
      setError("Hãy xác nhận đồng ý trước khi mô phỏng đăng ký khuôn mặt.");
      return;
    }
    setError("");
    const session = await startFaceSession(purpose);
    const completion = await completeFaceSession({
      sessionId: session.sessionId,
      descriptor: Array.from({ length: 128 }, (_, index) => Math.sin(index + 1) * 0.01),
      evidence: { challenge: session.challenge, durationMs: 2800, motionScore: 0.34, faceFrames: 14, neutralFrames: 8 },
    });
    setChallenge(session.challenge);
    setMatchScore(completion.matchScore);
    if (purpose === "ENROLL") {
      setPurpose("VERIFY");
      setFaceProofId("");
      setProgress(0);
      setScanState("enrolled");
    } else {
      setFaceProofId(completion.faceProofId);
      setProgress(100);
      setScanState("captured");
    }
  }

  const instruction = scanState === "neutral" ? "Nhìn thẳng và giữ yên" : scanState === "challenge" ? (challenge === "TURN_LEFT" ? "Từ từ quay đầu sang trái" : "Từ từ quay đầu sang phải") : "Nhìn thẳng vào camera";

  return (
    <section className="screen face-screen" aria-labelledby="face-title">
      <header className="flow-header face-header">
        <button className="back-button" onClick={onBack} aria-label="Quay lại">×</button>
        <div><h1 id="face-title">{scanState === "enrolled" ? "Đăng ký hoàn tất" : purpose === "ENROLL" ? "Đăng ký khuôn mặt" : "Xác thực khuôn mặt"}</h1><span>Bước 2/3 · Face AI & Liveness</span></div>
        <span className="header-spacer" />
      </header>

      <main className="camera-stage">
        <video ref={videoRef} autoPlay muted playsInline className={cameraState === "ready" ? "visible" : ""} />
        <div className={`face-oval ${scanState === "neutral" || scanState === "challenge" || scanState === "submitting" ? "is-scanning" : ""} ${scanState === "captured" ? "is-captured" : ""}`}>
          <span className="corner corner--tl" /><span className="corner corner--tr" /><span className="corner corner--bl" /><span className="corner corner--br" />
          {(scanState === "neutral" || scanState === "challenge") && <span className="scan-line" />}
          {cameraState !== "ready" && scanState !== "captured" && scanState !== "enrolled" && <div className="face-placeholder"><span>◉</span><p>Đặt khuôn mặt vào khung hình</p></div>}
          {(scanState === "captured" || scanState === "enrolled") && <div className="face-complete-mark">✓</div>}
        </div>

        <div className="camera-copy">
          <h2>{scanState === "enrolled" ? "Mẫu khuôn mặt đã được bảo vệ" : scanState === "captured" ? "Khuôn mặt đã khớp" : scanState === "submitting" ? "Đang bảo vệ bằng chứng…" : instruction}</h2>
          <p>{scanState === "enrolled" ? "Bây giờ hãy xác minh lại một lần để tạo bằng chứng chấm công dùng một lần." : scanState === "captured" ? `Độ tin cậy ${Math.round((matchScore ?? 1) * 100)}%. Bạn có thể tiếp tục xác minh tại cơ sở.` : cameraState === "denied" ? "Kiểm tra quyền camera của trình duyệt rồi thử lại." : scanState === "challenge" ? "Giữ điện thoại cố định, chỉ xoay đầu theo hướng yêu cầu." : "Không đeo khẩu trang, giữ đủ sáng và chỉ có một người trong khung hình."}</p>
        </div>

        {(scanState === "neutral" || scanState === "challenge" || scanState === "submitting") && <div className="face-progress" aria-label={`Tiến độ xác thực ${progress}%`}><span style={{ width: `${progress}%` }} /></div>}
        <div className="liveness-status">
          <span className={cameraState === "ready" || scanState === "captured" || scanState === "enrolled" ? "active" : ""}><b>✓</b>Phát hiện mặt</span>
          <span className={scanState === "challenge" || scanState === "submitting" || scanState === "captured" || scanState === "enrolled" ? "active" : ""}><b>○</b>Thử thách</span>
          <span className={scanState === "captured" || scanState === "enrolled" ? "active" : ""}><b>✓</b>Người thật</span>
        </div>

        {purpose === "ENROLL" && cameraState !== "ready" && scanState !== "captured" && <label className="biometric-consent"><input type="checkbox" checked={consented} onChange={(event) => setConsented(event.target.checked)} /><span><strong>Tôi đồng ý đăng ký dữ liệu khuôn mặt</strong>Chỉ mẫu số 128 chiều được gửi và lưu để đối chiếu; ảnh/video gốc chỉ xử lý trên thiết bị và không được tải lên máy chủ.</span></label>}
        {cameraState !== "ready" && scanState !== "captured" && <button className="primary-button camera-action" onClick={() => void prepareCamera()} disabled={cameraState === "loading" || (purpose === "ENROLL" && !consented)}>{cameraState === "loading" ? "Đang tải Face AI…" : cameraState === "denied" ? "Thử lại camera" : purpose === "ENROLL" ? "Đồng ý & bật camera" : "Bật camera an toàn"}</button>}
        {demoMode && cameraState !== "ready" && scanState !== "captured" && <button className="secondary-button camera-demo-action" onClick={() => void simulateDemo()} disabled={purpose === "ENROLL" && !consented}>Mô phỏng Face AI</button>}
        {cameraState === "ready" && scanState === "idle" && <button className="primary-button camera-action" onClick={() => void runLiveness()}>Bắt đầu kiểm tra người thật</button>}
        {(scanState === "neutral" || scanState === "challenge" || scanState === "submitting") && <button className="primary-button camera-action" disabled>{scanState === "submitting" ? "Đang xác thực trên máy chủ…" : instruction}</button>}
        {error && <p className="camera-error" role="alert">{error}</p>}
        {scanState === "captured" && <button className="primary-button camera-action" onClick={() => void onComplete(faceProofId)}>Tiếp tục xác minh tại cơ sở</button>}
        <p className="face-privacy">● Camera chỉ xử lý trên thiết bị. FASTDO không tải ảnh hoặc video gốc lên máy chủ.</p>
      </main>
    </section>
  );
}

function PresenceScreen({ precheck, onBack, onVerified }: { precheck: PrecheckData; onBack: () => void; onVerified: (proofId: string) => Promise<void> }) {
  const [code, setCode] = useState("");
  const [scanning, setScanning] = useState(false);
  const [verifying, setVerifying] = useState(false);
  const [error, setError] = useState("");
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const frameRef = useRef(0);

  useEffect(() => () => {
    if (frameRef.current) window.cancelAnimationFrame(frameRef.current);
    streamRef.current?.getTracks().forEach((track) => track.stop());
  }, []);

  function stopScanner() {
    if (frameRef.current) window.cancelAnimationFrame(frameRef.current);
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    setScanning(false);
  }

  async function submit(input: { qrToken?: string; code?: string }) {
    setVerifying(true);
    setError("");
    try {
      const proof = await verifyPresenceChallenge(input);
      stopScanner();
      await onVerified(proof.proofId);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Không thể xác minh hiện diện.");
      setVerifying(false);
    }
  }

  async function startScanner() {
    setError("");
    const Detector = (window as unknown as { BarcodeDetector?: BarcodeDetectorConstructor }).BarcodeDetector;
    if (!Detector) {
      setError("Trình duyệt chưa hỗ trợ quét QR trực tiếp. Hãy nhập mã 6 số hiển thị tại cơ sở.");
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: "environment" } }, audio: false });
      streamRef.current = stream;
      if (!videoRef.current) return;
      videoRef.current.srcObject = stream;
      await videoRef.current.play();
      setScanning(true);
      const detector = new Detector({ formats: ["qr_code"] });
      const scan = async () => {
        if (!videoRef.current || verifying) return;
        try {
          const codes = await detector.detect(videoRef.current);
          if (codes[0]?.rawValue) {
            await submit({ qrToken: codes[0].rawValue });
            return;
          }
        } catch {
          // Some browsers throw while the first camera frames are still loading.
        }
        frameRef.current = window.requestAnimationFrame(scan);
      };
      frameRef.current = window.requestAnimationFrame(scan);
    } catch {
      setError("Không thể mở camera sau. Hãy cấp quyền camera hoặc nhập mã 6 số.");
      stopScanner();
    }
  }

  function submitCode(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!/^\d{6}$/.test(code)) {
      setError("Mã hiện diện phải gồm đúng 6 chữ số.");
      return;
    }
    void submit({ code });
  }

  return (
    <section className="screen presence-screen" aria-labelledby="presence-title">
      <header className="flow-header">
        <button className="back-button" onClick={onBack} aria-label="Quay lại">←</button>
        <div><h1 id="presence-title">Xác minh tại cơ sở</h1><span>Bước 3/3 · QR động</span></div>
        <span className="header-spacer" />
      </header>
      <div className="stepper" aria-label="Tiến trình chấm công"><span className="done" /><span className="done" /><span className="done" /></div>

      <main className="presence-content">
        <div className="presence-branch"><span>⌖</span><div><small>ĐIỂM ĐANG XÁC MINH</small><strong>{precheck.branch.name}</strong><p>{precheck.branch.address}</p></div></div>

        <div className={`presence-scanner ${scanning ? "is-scanning" : ""}`}>
          <video ref={videoRef} muted playsInline />
          <div className="presence-scanner__frame"><i /><i /><i /><i />{!scanning && <span>▦</span>}</div>
          {scanning && <b>Đưa mã QR vào giữa khung</b>}
        </div>

        {!scanning && <button className="primary-button presence-scan-button" onClick={() => void startScanner()} disabled={verifying}>▦ Quét QR tại điểm chấm công</button>}
        {scanning && <button className="secondary-button presence-stop-button" onClick={stopScanner}>Dừng camera</button>}

        <div className="presence-divider"><span>hoặc nhập mã 6 số</span></div>
        <form className="presence-code-form" onSubmit={submitCode}>
          <input inputMode="numeric" pattern="[0-9]*" maxLength={6} value={code} onChange={(event) => setCode(event.target.value.replace(/\D/g, "").slice(0, 6))} placeholder="000 000" aria-label="Mã hiện diện 6 số" />
          <button type="submit" disabled={verifying || code.length !== 6}>{verifying ? "Đang xác minh…" : "Xác minh"}</button>
        </form>
        <p className="presence-security">● QR được ký bởi FASTDO, giới hạn theo chi nhánh và chống sử dụng lại.</p>
        {error && <p className="camera-error" role="alert">{error}</p>}
      </main>
    </section>
  );
}

function SuccessScreen({ result, precheck, onStart }: { result: CheckInResult; precheck: PrecheckData; onStart: () => void }) {
  const time = new Intl.DateTimeFormat("vi-VN", { hour: "2-digit", minute: "2-digit", hour12: false, timeZone: "Asia/Ho_Chi_Minh" }).format(new Date(result.serverTimestamp));
  return (
    <section className="screen success-screen" aria-labelledby="success-title">
      <div className="success-orbit"><span>✓</span></div>
      <p className="success-eyebrow">BẰNG CHỨNG ĐÃ ĐƯỢC GHI NHẬN</p>
      <h1 id="success-title">CHECK-IN THÀNH CÔNG</h1>
      <strong className="success-time">{time}</strong>
      <p className="success-date">Thứ Tư, 12/08/2026</p>
      <div className="success-location"><span>⌖</span><p>{precheck.branch.name}<small>{result.distanceMeters} m từ điểm cơ sở</small></p></div>
      <div className="evidence-grid">
        <div><span>RỦI RO</span><strong>{result.risk.score}</strong><small>{result.risk.level}</small></div>
        <div><span>GPS</span><strong>{Math.round(result.locationAccuracy)}m</strong><small>Độ chính xác</small></div>
        <div><span>THIẾT BỊ</span><strong>✓</strong><small>Đã ghi nhận</small></div>
      </div>
      <button className="primary-button success-action" onClick={onStart}>Bắt đầu ca làm <span>→</span></button>
    </section>
  );
}

function SessionScreen({ result, precheck, onCheckOut, onHeartbeat }: { result: CheckInResult; precheck: PrecheckData; onCheckOut: () => Promise<void>; onHeartbeat: () => Promise<LocationHeartbeatResult> }) {
  const [elapsed, setElapsed] = useState("00:00:00");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [heartbeat, setHeartbeat] = useState<LocationHeartbeatResult | null>(null);
  const [heartbeatError, setHeartbeatError] = useState("");

  useEffect(() => {
    const startedAt = new Date(result.serverTimestamp).getTime();
    const update = () => {
      const seconds = Math.max(0, Math.floor((Date.now() - startedAt) / 1000));
      const hours = String(Math.floor(seconds / 3600)).padStart(2, "0");
      const minutes = String(Math.floor((seconds % 3600) / 60)).padStart(2, "0");
      const remaining = String(seconds % 60).padStart(2, "0");
      setElapsed(`${hours}:${minutes}:${remaining}`);
    };
    update();
    const timer = window.setInterval(update, 1000);
    return () => window.clearInterval(timer);
  }, [result.serverTimestamp]);

  useEffect(() => {
    let active = true;
    async function syncLocation() {
      try {
        const next = await onHeartbeat();
        if (!active) return;
        setHeartbeat(next);
        setHeartbeatError("");
      } catch (reason) {
        if (!active) return;
        setHeartbeatError(reason instanceof Error ? reason.message : "Không thể đồng bộ vị trí.");
      }
    }
    void syncLocation();
    const timer = window.setInterval(() => void syncLocation(), 60000);
    return () => {
      active = false;
      window.clearInterval(timer);
    };
  }, [onHeartbeat]);

  async function checkOut() {
    setSubmitting(true);
    setError("");
    try {
      await onCheckOut();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Không thể chấm công ra.");
      setSubmitting(false);
    }
  }

  return (
    <section className="screen session-screen" aria-labelledby="session-title">
      <p className="session-eyebrow">ĐANG TRONG CA</p>
      <h1 id="session-title">{elapsed}</h1>
      <p>Thời gian làm việc</p>
      <div className={`session-status ${heartbeat && !heartbeat.insideGeofence ? "session-status--outside" : ""}`} aria-live="polite"><span>●</span><div><strong>{heartbeatError ? "Chưa thể xác minh vị trí" : heartbeat && !heartbeat.insideGeofence ? "Ngoài khu vực làm việc" : "Trong khu vực làm việc"}</strong><small>{heartbeatError || (heartbeat ? `${precheck.branch.name} · ${heartbeat.distanceMeters} m · ${firebaseDemoMode() ? "Mô phỏng cục bộ" : "Đã đồng bộ Firebase"}` : "Đang đồng bộ vị trí…")}</small></div></div>
      <div className="session-card">
        <p><span>Check-in</span><strong>{new Intl.DateTimeFormat("vi-VN", { hour: "2-digit", minute: "2-digit", hour12: false }).format(new Date(result.serverTimestamp))}</strong></p>
        <p><span>Ca kết thúc</span><strong>{precheck.shift.endTime}</strong></p>
        <p><span>Trạng thái</span><strong className="green">{result.status === "VALID" ? "Hợp lệ" : "Chờ duyệt"}</strong></p>
      </div>
      <div className="session-actions"><button>Nghỉ giữa ca</button><button>Xin ra ngoài</button></div>
      {error && <p className="session-error" role="alert">{error}</p>}
      <button className="primary-button checkout-button" onClick={checkOut} disabled={submitting}>{submitting ? "Đang chấm công ra…" : "Chấm công ra"}</button>
      <p className="monitoring-note">◉ Theo dõi chỉ hoạt động khi PWA đang mở</p>
    </section>
  );
}

export function AttendancePrototype() {
  const demoMode = firebaseDemoMode();
  const [screen, setScreen] = useState<Screen>("login");
  const [time, setTime] = useState("07:52");
  const [date, setDate] = useState("");
  const [toast, setToast] = useState("");
  const [user, setUser] = useState<AttendanceUser | null>(null);
  const [precheck, setPrecheck] = useState<PrecheckData | null>(null);
  const [location, setLocation] = useState<DeviceLocation | null>(null);
  const [faceProofId, setFaceProofId] = useState("");
  const [checkInResult, setCheckInResult] = useState<CheckInResult | null>(null);

  useEffect(() => {
    const update = () => {
      const now = new Date();
      setTime(new Intl.DateTimeFormat("vi-VN", { hour: "2-digit", minute: "2-digit", hour12: false, timeZone: "Asia/Ho_Chi_Minh" }).format(now));
      setDate(new Intl.DateTimeFormat("vi-VN", { weekday: "long", day: "2-digit", month: "2-digit", year: "numeric", timeZone: "Asia/Ho_Chi_Minh" }).format(now));
    };
    update();
    const timer = window.setInterval(update, 30000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    if (demoMode) return;
    let active = true;
    void restoreAuthenticatedUser()
      .then((restoredUser) => {
        if (active && restoredUser) {
          setUser(restoredUser);
          setScreen(restoredUser.mustChangePassword ? "password" : "home");
        }
      })
      .catch(() => {
        if (active) setScreen("login");
      });
    return () => { active = false; };
  }, [demoMode]);

  async function handleLogin(employeeId: string, password: string, remember: boolean) {
    const loggedInUser = await loginEmployee(employeeId, password, remember);
    setUser(loggedInUser);
    setScreen(loggedInUser.mustChangePassword ? "password" : "home");
  }

  async function handleLogout() {
    await logoutEmployee(user);
    setUser(null);
    setPrecheck(null);
    setFaceProofId("");
    setCheckInResult(null);
    setScreen("login");
  }

  async function completeCheckIn(presenceToken: string) {
    if (!faceProofId) throw new Error("Bằng chứng khuôn mặt chưa sẵn sàng. Vui lòng quay lại xác thực.");
    const currentLocation = location ?? await readCurrentLocation(firebaseDemoMode());
    const result = await submitCheckIn(currentLocation, presenceToken, faceProofId);
    setCheckInResult(result);
    setFaceProofId("");
    setScreen("success");
  }

  async function completeCheckOut() {
    if (!checkInResult) return;
    const currentLocation = await readCurrentLocation(firebaseDemoMode());
    await submitCheckOut(checkInResult.sessionId, currentLocation);
    setCheckInResult(null);
    setScreen("home");
    setToast("Chấm công ra thành công. Phiên làm việc đã được đóng.");
    window.setTimeout(() => setToast(""), 4200);
  }

  const syncActiveSession = useCallback(async () => {
    if (!checkInResult) throw new Error("Không tìm thấy phiên làm việc đang hoạt động.");
    const currentLocation = await readCurrentLocation(firebaseDemoMode());
    return sendLocationHeartbeat(checkInResult.sessionId, currentLocation);
  }, [checkInResult]);

  return (
    <main className="prototype-shell">
      <aside className="prototype-context">
        <Brand />
        <p className="phase-tag">PILOT · GIAI ĐOẠN 07</p>
        <h2>Chấm công rõ ràng.<br /><span>Bằng chứng đáng tin.</span></h2>
        <p className="context-lead">Nền móng trải nghiệm nhân viên cho hệ thống chấm công đa lớp Face AI, vị trí và hiện diện tại cơ sở.</p>
        <div className="phase-progress">
          <div className="phase-progress__head"><span>Tiến độ bảo mật đa lớp</span><strong>07 / 08</strong></div>
          <div className="phase-progress__bar"><span /></div>
        </div>
        <ul className="scope-list">
          <li className="done"><span>✓</span><div><strong>Đăng nhập nhân viên</strong><small>Firebase Auth và phiên đăng nhập thật</small></div></li>
          <li className="done"><span>✓</span><div><strong>Home ca làm</strong><small>Trạng thái sẵn sàng theo thời gian thực</small></div></li>
          <li className="done"><span>✓</span><div><strong>Pre-check đa lớp</strong><small>Functions, phân ca và dữ liệu cơ sở thật</small></div></li>
          <li className="done"><span>✓</span><div><strong>Face AI & Presence</strong><small>Embedding 128 chiều · liveness thử thách ngẫu nhiên</small></div></li>
          <li className="active"><span>→</span><div><strong>Workforce Admin</strong><small>Nhân viên, sinh mật khẩu tạm và phân ca</small></div></li>
        </ul>
        <p className="prototype-note"><span>●</span> {demoMode ? "Bản prototype tương tác · Dữ liệu mô phỏng" : "Firebase production · Dữ liệu đồng bộ thật"}</p>
      </aside>

      <section className="device-area" aria-label={demoMode ? "Bản thử nghiệm ứng dụng nhân viên" : "Ứng dụng chấm công nhân viên"}>
        <div className="device-caption"><span>EMPLOYEE PWA</span><span>390 × 844</span></div>
        <div className="device-frame">
          <div className="device-status"><span>{time}</span><span className="device-island" /><span>▮ ◒</span></div>
          {screen === "login" && <LoginScreen onLogin={handleLogin} />}
          {screen === "password" && user && <ChangeTemporaryPasswordScreen user={user} onChanged={(updatedUser) => { setUser(updatedUser); setScreen("home"); }} onLogout={() => void handleLogout()} />}
          {screen === "home" && user && <HomeScreen time={time} date={date} user={user} precheck={precheck} onCheckIn={() => setScreen("precheck")} onManageDevices={() => setScreen("devices")} onLogout={() => void handleLogout()} />}
          {screen === "devices" && user?.canManageDevices && <DeviceAdminScreen user={user} onBack={() => setScreen("home")} />}
          {screen === "precheck" && <PrecheckScreen onBack={() => setScreen("home")} onContinue={(data, currentLocation) => { setPrecheck(data); setLocation(currentLocation); setFaceProofId(""); setScreen("face"); }} />}
          {screen === "face" && precheck && <FaceScreen precheck={precheck} onBack={() => { setFaceProofId(""); setScreen("precheck"); }} onComplete={async (proofId) => { setFaceProofId(proofId); setScreen("presence"); }} />}
          {screen === "presence" && precheck && <PresenceScreen precheck={precheck} onBack={() => setScreen("face")} onVerified={completeCheckIn} />}
          {screen === "success" && checkInResult && precheck && <SuccessScreen result={checkInResult} precheck={precheck} onStart={() => setScreen("session")} />}
          {screen === "session" && checkInResult && precheck && <SessionScreen result={checkInResult} precheck={precheck} onCheckOut={completeCheckOut} onHeartbeat={syncActiveSession} />}
          {toast && <div className="toast" role="status"><span>✓</span>{toast}</div>}
        </div>
        <p className="demo-hint">{demoMode ? "Dùng mã demo có sẵn hoặc Passkey / Face ID để bắt đầu." : "Tài khoản nhân viên được xác thực và đồng bộ qua Firebase."}</p>
      </section>
    </main>
  );
}
