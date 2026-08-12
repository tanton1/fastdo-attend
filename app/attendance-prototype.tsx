"use client";

import { FormEvent, useCallback, useEffect, useRef, useState } from "react";
import { firebaseDemoMode } from "./lib/firebase-client";
import { getPrecheck, loginEmployee, logoutEmployee, readCurrentLocation, sendLocationHeartbeat, submitCheckIn, submitCheckOut } from "./lib/attendance-api";
import type { AttendanceUser, CheckInResult, DeviceLocation, LocationHeartbeatResult, PrecheckData } from "./lib/attendance-types";

type Screen = "login" | "home" | "precheck" | "face" | "success" | "session";
type CheckState = "waiting" | "checking" | "success" | "warning";

const checks = [
  {
    id: "device",
    icon: "▣",
    title: "Thiết bị",
    detail: "iPhone 14 Pro · Thiết bị tin cậy",
  },
  {
    id: "location",
    icon: "⌖",
    title: "Vị trí",
    detail: "Cách Aura Thanh Khê 18 m",
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
    <span className={`status-dot status-dot--${state}`} aria-label={state === "success" ? "Đạt" : "Chờ kiểm tra"}>
      {state === "success" ? "✓" : "•"}
    </span>
  );
}

function LoginScreen({ onLogin }: { onLogin: (employeeId: string, password: string) => Promise<void> }) {
  const [employeeId, setEmployeeId] = useState("FD0238");
  const [password, setPassword] = useState("fastdo2026");
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!employeeId.trim() || !password.trim()) {
      setError("Vui lòng nhập đầy đủ mã nhân viên và mật khẩu.");
      return;
    }
    setError("");
    setSubmitting(true);
    try {
      await onLogin(employeeId, password);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Không thể đăng nhập. Vui lòng thử lại.");
    } finally {
      setSubmitting(false);
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
          <label className="remember"><input type="checkbox" defaultChecked /> <span>Ghi nhớ tài khoản</span></label>
          <button type="button" className="text-button">Quên mật khẩu?</button>
        </div>

        {error && <p className="form-error" role="alert">{error}</p>}
        <button className="primary-button" type="submit" disabled={submitting}>{submitting ? "Đang xác thực…" : "Đăng nhập"}</button>
      </form>

      <div className="divider"><span>hoặc đăng nhập bằng</span></div>
      <button className="passkey-button" type="button" onClick={() => onLogin(employeeId, password)}>
        <span className="scan-icon">⌾</span>
        Passkey / Face ID
      </button>

      <p className="login-help">Chưa có tài khoản? <button className="text-button">Liên hệ quản trị</button></p>
    </section>
  );
}

function HomeScreen({ time, user, precheck, onCheckIn, onLogout }: { time: string; user: AttendanceUser; precheck: PrecheckData | null; onCheckIn: () => void; onLogout: () => void }) {
  return (
    <section className="screen home-screen" aria-labelledby="home-title">
      <header className="mobile-header">
        <div>
          <p>Chào buổi sáng,</p>
          <h1 id="home-title">{user.fullName}</h1>
          <span>Thứ Tư, 12/08/2026</span>
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
          <span className="countdown">Còn 8 phút</span>
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
          <div><span className="mini-icon">◉</span><p>Camera<strong>Sẵn sàng</strong></p></div>
          <div><span className="mini-icon">⌖</span><p>Vị trí<strong>Đã bật</strong></p></div>
          <div><span className="mini-icon">▣</span><p>Thiết bị<strong>Tin cậy</strong></p></div>
          <div><span className="mini-icon mini-icon--warn">⌘</span><p>Điểm cơ sở<strong className="warn">Chưa xác minh</strong></p></div>
        </div>
      </main>

      <nav className="bottom-nav" aria-label="Điều hướng chính">
        <button className="active"><span>⌂</span>Trang chủ</button>
        <button><span>□</span>Lịch làm</button>
        <button className="nav-main" onClick={onCheckIn} aria-label="Bắt đầu chấm công"><span>⌘</span></button>
        <button><span>◷</span>Lịch sử</button>
        <button><span>♙</span>Cá nhân</button>
      </nav>
    </section>
  );
}

function PrecheckScreen({ onBack, onContinue }: { onBack: () => void; onContinue: (precheck: PrecheckData, location: DeviceLocation) => void }) {
  const [states, setStates] = useState<Record<string, CheckState>>({
    device: "success",
    location: "checking",
    time: "waiting",
    network: "waiting",
  });
  const [precheck, setPrecheck] = useState<PrecheckData | null>(null);
  const [location, setLocation] = useState<DeviceLocation | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    let active = true;
    async function runPrecheck() {
      try {
        const data = await getPrecheck();
        if (!active) return;
        setPrecheck(data);
        setStates({ device: "success", location: "checking", time: "success", network: "checking" });
        const currentLocation = await readCurrentLocation(firebaseDemoMode());
        if (!active) return;
        setLocation(currentLocation);
        setStates({ device: "success", location: "success", time: "success", network: "success" });
      } catch (reason) {
        if (!active) return;
        setError(reason instanceof Error ? reason.message : "Không thể kiểm tra điều kiện chấm công.");
        setStates((current) => ({ ...current, location: "warning", network: "warning" }));
      }
    }
    void runPrecheck();
    return () => { active = false; };
  }, []);

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
                  <p>{state === "checking" ? "Đang xác minh…" : state === "waiting" ? "Đang chờ kiểm tra" : check.detail}</p>
                </div>
                <StatusDot state={state} />
              </article>
            );
          })}
        </div>

        <div className="privacy-note">
          <span>i</span>
          <p><strong>Dữ liệu của bạn được bảo vệ</strong>Vị trí chỉ được dùng để xác minh lúc chấm công. Bản thử nghiệm chưa gửi dữ liệu lên máy chủ.</p>
        </div>
        {error && <p className="precheck-error" role="alert">{error}</p>}
      </main>

      <footer className="flow-footer">
        <button className="primary-button" disabled={!complete} onClick={() => precheck && location && onContinue(precheck, location)}>
          {complete ? "Tiếp tục xác thực khuôn mặt" : "Đang kiểm tra điều kiện…"}
        </button>
      </footer>
    </section>
  );
}

function FaceScreen({ onBack, onComplete }: { onBack: () => void; onComplete: () => Promise<void> }) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const [cameraState, setCameraState] = useState<"idle" | "loading" | "ready" | "denied">("idle");
  const [scanState, setScanState] = useState<"idle" | "scanning" | "captured">("idle");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [demoBypassed, setDemoBypassed] = useState(false);
  const demoMode = firebaseDemoMode();

  useEffect(() => () => streamRef.current?.getTracks().forEach((track) => track.stop()), []);

  async function startCamera() {
    setCameraState("loading");
    setError("");
    if (!navigator.mediaDevices?.getUserMedia) {
      setCameraState("denied");
      setError("Thiết bị hoặc trình duyệt này không hỗ trợ truy cập camera.");
      return;
    }
    const cameraRequest = navigator.mediaDevices.getUserMedia({ video: { facingMode: "user" }, audio: false });
    let timeoutId = 0;
    try {
      const timeout = new Promise<never>((_, reject) => {
        timeoutId = window.setTimeout(() => reject(new Error("CAMERA_TIMEOUT")), 8000);
      });
      const stream = await Promise.race([cameraRequest, timeout]);
      window.clearTimeout(timeoutId);
      streamRef.current = stream;
      if (videoRef.current) videoRef.current.srcObject = stream;
      setCameraState("ready");
    } catch (reason) {
      window.clearTimeout(timeoutId);
      void cameraRequest.then((lateStream) => lateStream.getTracks().forEach((track) => track.stop())).catch(() => undefined);
      setCameraState("denied");
      setError(reason instanceof Error && reason.message === "CAMERA_TIMEOUT"
        ? "Camera chưa được cấp quyền sau 8 giây. Hãy cấp quyền hoặc tiếp tục bằng bản mô phỏng."
        : "Không thể mở camera. Hãy kiểm tra quyền camera của trình duyệt.");
    }
  }

  function continueDemo() {
    setDemoBypassed(true);
    setError("");
    setScanState("captured");
  }

  function startScan() {
    if (cameraState !== "ready") return;
    setScanState("scanning");
    window.setTimeout(() => setScanState("captured"), 2200);
  }

  async function complete() {
    setSubmitting(true);
    setError("");
    try {
      await onComplete();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Không thể gửi yêu cầu chấm công.");
      setSubmitting(false);
    }
  }

  return (
    <section className="screen face-screen" aria-labelledby="face-title">
      <header className="flow-header face-header">
        <button className="back-button" onClick={onBack} aria-label="Quay lại">×</button>
        <div><h1 id="face-title">Xác thực khuôn mặt</h1><span>Bước 2/3 · Prototype camera</span></div>
        <span className="header-spacer" />
      </header>

      <main className="camera-stage">
        <video ref={videoRef} autoPlay muted playsInline className={cameraState === "ready" ? "visible" : ""} />
        <div className={`face-oval ${scanState === "scanning" ? "is-scanning" : ""} ${scanState === "captured" ? "is-captured" : ""}`}>
          <span className="corner corner--tl" /><span className="corner corner--tr" /><span className="corner corner--bl" /><span className="corner corner--br" />
          {scanState === "scanning" && <span className="scan-line" />}
          {cameraState !== "ready" && <div className="face-placeholder"><span>◉</span><p>Đặt khuôn mặt vào khung hình</p></div>}
        </div>

        <div className="camera-copy">
          <h2>{demoBypassed ? "Mô phỏng Face AI" : scanState === "captured" ? "Đã thu mẫu thử nghiệm" : cameraState === "ready" ? "Nhìn thẳng vào camera" : "Cho phép truy cập camera"}</h2>
          <p>{demoBypassed ? "Không có ảnh hoặc dữ liệu sinh trắc học nào được thu trong chế độ demo." : scanState === "captured" ? "AI Face & Liveness sẽ được kết nối ở bước tiếp theo." : cameraState === "denied" ? "Không thể mở camera. Hãy kiểm tra quyền của trình duyệt." : "Giữ điện thoại ngang tầm mắt và ở nơi đủ sáng."}</p>
        </div>

        <div className="liveness-status">
          <span className={cameraState === "ready" ? "active" : ""}><b>✓</b>Đủ sáng</span>
          <span className={scanState === "scanning" || scanState === "captured" ? "active" : ""}><b>○</b>Góc mặt</span>
          <span className={scanState === "captured" ? "active" : ""}><b>✓</b>Chuyển động</span>
        </div>

        {cameraState !== "ready" && scanState !== "captured" && <button className="primary-button camera-action" onClick={startCamera} disabled={cameraState === "loading"}>{cameraState === "loading" ? "Đang mở camera…" : cameraState === "denied" ? "Thử lại camera" : "Bật camera"}</button>}
        {demoMode && cameraState !== "ready" && scanState !== "captured" && <button className="secondary-button camera-demo-action" onClick={continueDemo}>Tiếp tục bản mô phỏng</button>}
        {cameraState === "ready" && scanState === "idle" && <button className="primary-button camera-action" onClick={startScan}>Bắt đầu quét thử</button>}
        {scanState === "scanning" && <button className="primary-button camera-action" disabled>Đang kiểm tra người thật…</button>}
        {error && <p className="camera-error" role="alert">{error}</p>}
        {scanState === "captured" && <button className="primary-button camera-action" onClick={complete} disabled={submitting}>{submitting ? "Đang ghi nhận chấm công…" : "Xác nhận chấm công"}</button>}
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
  const [screen, setScreen] = useState<Screen>("login");
  const [time, setTime] = useState("07:52");
  const [toast, setToast] = useState("");
  const [user, setUser] = useState<AttendanceUser | null>(null);
  const [precheck, setPrecheck] = useState<PrecheckData | null>(null);
  const [location, setLocation] = useState<DeviceLocation | null>(null);
  const [checkInResult, setCheckInResult] = useState<CheckInResult | null>(null);

  useEffect(() => {
    const update = () => setTime(new Intl.DateTimeFormat("vi-VN", { hour: "2-digit", minute: "2-digit", hour12: false, timeZone: "Asia/Ho_Chi_Minh" }).format(new Date()));
    update();
    const timer = window.setInterval(update, 30000);
    return () => window.clearInterval(timer);
  }, []);

  async function handleLogin(employeeId: string, password: string) {
    const loggedInUser = await loginEmployee(employeeId, password);
    setUser(loggedInUser);
    setScreen("home");
  }

  async function handleLogout() {
    await logoutEmployee(user);
    setUser(null);
    setPrecheck(null);
    setCheckInResult(null);
    setScreen("login");
  }

  async function completeCheckIn() {
    const currentLocation = location ?? await readCurrentLocation(firebaseDemoMode());
    const result = await submitCheckIn(currentLocation);
    setCheckInResult(result);
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
        <p className="phase-tag">MVP · GIAI ĐOẠN 01</p>
        <h2>Chấm công rõ ràng.<br /><span>Bằng chứng đáng tin.</span></h2>
        <p className="context-lead">Nền móng trải nghiệm nhân viên cho hệ thống chấm công đa lớp Face AI, vị trí và hiện diện tại cơ sở.</p>
        <div className="phase-progress">
          <div className="phase-progress__head"><span>Tiến độ luồng nền tảng</span><strong>01 / 03</strong></div>
          <div className="phase-progress__bar"><span /></div>
        </div>
        <ul className="scope-list">
          <li className="done"><span>✓</span><div><strong>Đăng nhập nhân viên</strong><small>Mật khẩu và lối vào Passkey</small></div></li>
          <li className="done"><span>✓</span><div><strong>Home ca làm</strong><small>Trạng thái sẵn sàng theo thời gian thực</small></div></li>
          <li className="active"><span>→</span><div><strong>Pre-check đa lớp</strong><small>Thiết bị, vị trí, thời gian, kết nối</small></div></li>
          <li><span>·</span><div><strong>Face AI & Presence</strong><small>Tích hợp backend ở giai đoạn kế tiếp</small></div></li>
        </ul>
        <p className="prototype-note"><span>●</span> Bản prototype tương tác · Dữ liệu mô phỏng</p>
      </aside>

      <section className="device-area" aria-label="Bản thử nghiệm ứng dụng nhân viên">
        <div className="device-caption"><span>EMPLOYEE PWA</span><span>390 × 844</span></div>
        <div className="device-frame">
          <div className="device-status"><span>{time}</span><span className="device-island" /><span>▮ ◒</span></div>
          {screen === "login" && <LoginScreen onLogin={handleLogin} />}
          {screen === "home" && user && <HomeScreen time={time} user={user} precheck={precheck} onCheckIn={() => setScreen("precheck")} onLogout={() => void handleLogout()} />}
          {screen === "precheck" && <PrecheckScreen onBack={() => setScreen("home")} onContinue={(data, currentLocation) => { setPrecheck(data); setLocation(currentLocation); setScreen("face"); }} />}
          {screen === "face" && <FaceScreen onBack={() => setScreen("precheck")} onComplete={completeCheckIn} />}
          {screen === "success" && checkInResult && precheck && <SuccessScreen result={checkInResult} precheck={precheck} onStart={() => setScreen("session")} />}
          {screen === "session" && checkInResult && precheck && <SessionScreen result={checkInResult} precheck={precheck} onCheckOut={completeCheckOut} onHeartbeat={syncActiveSession} />}
          {toast && <div className="toast" role="status"><span>✓</span>{toast}</div>}
        </div>
        <p className="demo-hint">Dùng mã demo có sẵn hoặc Passkey / Face ID để bắt đầu.</p>
      </section>
    </main>
  );
}
