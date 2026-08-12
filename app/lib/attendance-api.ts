import { signInWithEmailAndPassword, signOut } from "firebase/auth";
import { httpsCallable } from "firebase/functions";
import { firebaseDemoMode, getFirebaseServices } from "./firebase-client";
import type { AttendanceUser, CheckInResult, CheckOutResult, DeviceLocation, PrecheckData } from "./attendance-types";

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
  requirements: { trustedDevice: true, location: true, faceVerification: false, liveness: false, presenceProof: false },
};

function employeeEmail(identifier: string): string {
  const value = identifier.trim().toLowerCase();
  return value.includes("@") ? value : `${value}@fastdo.attend`;
}

function wait(milliseconds: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, milliseconds));
}

export async function loginEmployee(identifier: string, password: string): Promise<AttendanceUser> {
  if (firebaseDemoMode()) {
    await wait(450);
    if (identifier.trim().toUpperCase() !== "FD0238" || password !== "fastdo2026") {
      throw new Error("Thông tin demo không đúng. Dùng FD0238 / fastdo2026.");
    }
    return demoUser;
  }

  const { auth } = getFirebaseServices();
  const credential = await signInWithEmailAndPassword(auth, employeeEmail(identifier), password);
  return {
    uid: credential.user.uid,
    fullName: credential.user.displayName ?? identifier,
    employeeCode: identifier.toUpperCase(),
    email: credential.user.email ?? employeeEmail(identifier),
    isDemo: false,
  };
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
  const callable = httpsCallable<void, PrecheckData>(getFirebaseServices().functions, "getPrecheck");
  return (await callable()).data;
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
