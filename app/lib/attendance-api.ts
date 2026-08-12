import { browserLocalPersistence, browserSessionPersistence, sendPasswordResetEmail, setPersistence, signInWithEmailAndPassword, signOut } from "firebase/auth";
import { httpsCallable } from "firebase/functions";
import { firebaseDemoMode, getFirebaseServices } from "./firebase-client";
import type { AttendanceUser, CheckInResult, CheckOutResult, DeviceLocation, LocationHeartbeatResult, PrecheckData } from "./attendance-types";

const demoUser: AttendanceUser = {
  uid: "demo_hai_au",
  fullName: "Hải Âu",
  employeeCode: "FD0238",
  email: "fd0238@fastdo.attend",
  isDemo: true,
};

const demoPrecheck: PrecheckData = {
  serverTime: new Date().toISOString(),
  employee: { id: demoUser.uid, name: demoUser.fullName, employeeCode: demoUser.employeeCode },
  branch: {
    id: "aura_thanh_khe",
    name: "Aura Thanh Khê",
    address: "276 Thái Thị Bôi, Đà Nẵng",
    latitude: 16.0678,
    longitude: 108.1895,
    radiusMeters: 50,
  },
  shift: { id: "shift_office", name: "Ca hành chính", startTime: "08:00", endTime: "17:00" },
  device: { id: "demo-device", label: "Thiết bị mô phỏng", platform: "web", status: "TRUSTED", trusted: true, isBlocked: false },
  requirements: { trustedDevice: true, location: true, faceVerification: false, liveness: false, presenceProof: false },
};

function employeeEmail(identifier: string): string {
  const value = identifier.trim().toLowerCase();
  return value.includes("@") ? value : `${value}@fastdo.attend`;
}

function wait(milliseconds: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, milliseconds));
}

function firebaseErrorMessage(reason: unknown, fallback: string): string {
  const code = typeof reason === "object" && reason && "code" in reason ? String(reason.code) : "";
  const message = reason instanceof Error ? reason.message : "";
  if (code.includes("invalid-credential") || code.includes("wrong-password") || code.includes("user-not-found")) return "Mã nhân viên hoặc mật khẩu chưa đúng.";
  if (code.includes("too-many-requests")) return "Tài khoản đang tạm khóa do thử quá nhiều lần. Vui lòng thử lại sau.";
  if (code.includes("resource-exhausted")) return "Bạn thao tác quá nhanh. Vui lòng đợi một phút rồi thử lại.";
  if (code.includes("failed-precondition") && message) return message.replace(/^Firebase:\s*/i, "");
  if (code.includes("permission-denied")) return "Bạn không có quyền thực hiện thao tác này.";
  if (code.includes("unauthenticated")) return "Phiên đăng nhập đã hết hạn. Vui lòng đăng nhập lại.";
  if (code.includes("internal") || message === "INTERNAL") return "Dịch vụ chấm công đang gặp lỗi tạm thời. Vui lòng thử lại.";
  if (message && !message.startsWith("Firebase:")) return message;
  return fallback;
}

export async function loginEmployee(identifier: string, password: string, remember = true): Promise<AttendanceUser> {
  if (firebaseDemoMode()) {
    await wait(450);
    if (identifier.trim().toUpperCase() !== "FD0238" || password !== "fastdo2026") {
      throw new Error("Thông tin demo không đúng. Dùng FD0238 / fastdo2026.");
    }
    return demoUser;
  }

  const { auth } = getFirebaseServices();
  let credential;
  try {
    await setPersistence(auth, remember ? browserLocalPersistence : browserSessionPersistence);
    credential = await signInWithEmailAndPassword(auth, employeeEmail(identifier), password);
  } catch (reason) {
    throw new Error(firebaseErrorMessage(reason, "Không thể đăng nhập. Vui lòng thử lại."));
  }
  return {
    uid: credential.user.uid,
    fullName: credential.user.displayName ?? identifier,
    employeeCode: identifier.toUpperCase(),
    email: credential.user.email ?? employeeEmail(identifier),
    isDemo: false,
  };
}

export async function restoreAuthenticatedUser(): Promise<AttendanceUser | null> {
  if (firebaseDemoMode()) return null;
  const { auth } = getFirebaseServices();
  await auth.authStateReady();
  const current = auth.currentUser;
  if (!current) return null;
  const email = current.email ?? "";
  const employeeCode = email.includes("@") ? email.split("@")[0].toUpperCase() : "NHÂN VIÊN";
  return {
    uid: current.uid,
    fullName: current.displayName ?? employeeCode,
    employeeCode,
    email,
    isDemo: false,
  };
}

export async function requestPasswordReset(identifier: string): Promise<string> {
  if (!identifier.trim()) throw new Error("Nhập mã nhân viên hoặc email trước khi khôi phục mật khẩu.");
  if (firebaseDemoMode()) return "Bản demo không gửi email. Hãy dùng mật khẩu fastdo2026.";
  try {
    await sendPasswordResetEmail(getFirebaseServices().auth, employeeEmail(identifier));
    return "Đã gửi hướng dẫn đặt lại mật khẩu nếu tài khoản tồn tại.";
  } catch (reason) {
    throw new Error(firebaseErrorMessage(reason, "Chưa thể gửi email đặt lại mật khẩu. Vui lòng thử lại."));
  }
}

export async function logoutEmployee(user: AttendanceUser | null): Promise<void> {
  if (!user || user.isDemo) return;
  await signOut(getFirebaseServices().auth);
}

export async function getPrecheck(): Promise<PrecheckData> {
  if (firebaseDemoMode()) {
    await wait(600);
    return { ...demoPrecheck, serverTime: new Date().toISOString() };
  }
  const deviceId = getOrCreateDeviceId();
  const services = getFirebaseServices();
  const register = httpsCallable(services.functions, "registerDevice");
  const callable = httpsCallable<{ deviceId: string }, PrecheckData>(services.functions, "getPrecheck");
  try {
    await register({
      deviceId,
      label: browserDeviceLabel(),
      platform: browserPlatform(),
    });
    return (await callable({ deviceId })).data;
  } catch (reason) {
    throw new Error(firebaseErrorMessage(reason, "Không thể tải ca làm và điều kiện chấm công."));
  }
}

function browserPlatform(): string {
  if (typeof navigator === "undefined") return "web";
  const value = navigator.userAgent.toLowerCase();
  if (/iphone|ipad|ipod/.test(value)) return "ios-web";
  if (/android/.test(value)) return "android-web";
  if (/windows/.test(value)) return "windows-web";
  if (/macintosh|mac os/.test(value)) return "macos-web";
  return "web";
}

function browserDeviceLabel(): string {
  if (typeof navigator === "undefined") return "Trình duyệt web";
  const platform = browserPlatform();
  const browser = /edg\//i.test(navigator.userAgent) ? "Edge" : /chrome\//i.test(navigator.userAgent) ? "Chrome" : /safari\//i.test(navigator.userAgent) ? "Safari" : "Trình duyệt";
  return `${browser} · ${platform}`;
}

export function getOrCreateDeviceId(): string {
  const storageKey = "fastdo-attend-device-id";
  const current = window.localStorage.getItem(storageKey);
  if (current) return current;
  const value = crypto.randomUUID();
  window.localStorage.setItem(storageKey, value);
  return value;
}

export async function readCurrentLocation(fallbackToDemo = false): Promise<DeviceLocation> {
  if (firebaseDemoMode() && fallbackToDemo) {
    return { latitude: demoPrecheck.branch.latitude + 0.00008, longitude: demoPrecheck.branch.longitude + 0.00008, accuracy: 9 };
  }

  return new Promise((resolve, reject) => {
    if (!navigator.geolocation) {
      reject(new Error("Thiết bị không hỗ trợ định vị."));
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (position) => resolve({ latitude: position.coords.latitude, longitude: position.coords.longitude, accuracy: position.coords.accuracy }),
      () => reject(new Error("Không thể lấy vị trí. Hãy cấp quyền vị trí chính xác cho ứng dụng.")),
      { enableHighAccuracy: true, timeout: 12000, maximumAge: 15000 },
    );
  });
}

export async function submitCheckIn(location: DeviceLocation): Promise<CheckInResult> {
  if (firebaseDemoMode()) {
    await wait(800);
    return {
      eventId: `demo_event_${Date.now()}`,
      sessionId: `demo_session_${Date.now()}`,
      status: "VALID",
      serverTimestamp: new Date().toISOString(),
      distanceMeters: 12,
      locationAccuracy: location.accuracy,
      risk: { score: 0, level: "LOW", decision: "ALLOW", reasons: [] },
    };
  }

  const callable = httpsCallable(getFirebaseServices().functions, "checkIn");
  const response = await callable({
    idempotencyKey: crypto.randomUUID(),
    deviceId: getOrCreateDeviceId(),
    location,
    clientTimestamp: new Date().toISOString(),
  });
  return response.data as CheckInResult;
}

export async function submitCheckOut(sessionId: string, location: DeviceLocation): Promise<CheckOutResult> {
  if (firebaseDemoMode()) {
    await wait(700);
    return { eventId: `demo_checkout_${Date.now()}`, sessionId, status: "VALID", serverTimestamp: new Date().toISOString() };
  }

  const callable = httpsCallable(getFirebaseServices().functions, "checkOut");
  const response = await callable({
    idempotencyKey: crypto.randomUUID(),
    deviceId: getOrCreateDeviceId(),
    location,
    clientTimestamp: new Date().toISOString(),
  });
  return response.data as CheckOutResult;
}

export async function sendLocationHeartbeat(sessionId: string, location: DeviceLocation): Promise<LocationHeartbeatResult> {
  if (firebaseDemoMode()) {
    await wait(350);
    return {
      insideGeofence: true,
      distanceMeters: 12,
      receivedAt: new Date().toISOString(),
    };
  }

  const callable = httpsCallable(getFirebaseServices().functions, "sendLocationHeartbeat");
  const response = await callable({ sessionId, location });
  return response.data as LocationHeartbeatResult;
}
