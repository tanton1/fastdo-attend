import { browserLocalPersistence, browserSessionPersistence, sendPasswordResetEmail, setPersistence, signInWithEmailAndPassword, signOut } from "firebase/auth";
import { httpsCallable } from "firebase/functions";
import { firebaseDemoMode, getFirebaseServices } from "./firebase-client";
import type { AdminDevice, AdminWorkforce, AttendanceReport, AttendanceUser, CheckInResult, CheckOutResult, CreateEmployeeInput, CreateEmployeeResult, DeviceLocation, DeviceReviewResult, DeviceStatus, EmployeeRole, FaceChallenge, FaceCompletion, FaceConsentWithdrawal, FaceEvidence, FacePurpose, FaceSession, LocationHeartbeatResult, PilotPolicy, PilotPolicyUpdate, PrecheckData, PresenceChallenge, PresenceProof, RealtimeMonitor, WorkforceAssignment, WorkforceEmployee } from "./attendance-types";

const demoUser: AttendanceUser = {
  uid: "demo_hai_au",
  fullName: "Hải Âu",
  employeeCode: "FD0238",
  email: "fd0238@fastdo.attend",
  role: "COMPANY_ADMIN",
  companyId: "fastdo_demo",
  faceEnrollmentStatus: "NOT_STARTED",
  canManageDevices: true,
  mustChangePassword: false,
  isDemo: true,
};

const demoDevices: AdminDevice[] = [
  {
    id: "d6f91fe4-54e0-4dc7-b4b0-6d9e86ed1f19",
    label: "Chrome · windows-web",
    platform: "windows-web",
    status: "PENDING",
    trusted: false,
    isBlocked: false,
    userId: demoUser.uid,
    employeeName: demoUser.fullName,
    employeeCode: demoUser.employeeCode,
    createdAt: new Date().toISOString(),
    lastSeenAt: new Date().toISOString(),
    reviewedAt: null,
  },
];

const demoPrecheck: PrecheckData = {
  serverTime: new Date().toISOString(),
  employee: { id: demoUser.uid, name: demoUser.fullName, employeeCode: demoUser.employeeCode, faceEnrollmentStatus: "NOT_STARTED" },
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

const demoWorkforce: AdminWorkforce = {
  employees: [
    {
      id: demoUser.uid,
      fullName: demoUser.fullName,
      employeeCode: demoUser.employeeCode,
      email: demoUser.email,
      role: demoUser.role,
      status: "ACTIVE",
      branchIds: [demoPrecheck.branch.id],
      faceEnrollmentStatus: "NOT_STARTED",
    },
    {
      id: "demo_minh_anh",
      fullName: "Minh Anh",
      employeeCode: "FD0241",
      email: "fd0241@fastdo.attend",
      role: "EMPLOYEE",
      status: "ACTIVE",
      branchIds: [demoPrecheck.branch.id],
      faceEnrollmentStatus: "APPROVED",
    },
  ],
  branches: [{ id: demoPrecheck.branch.id, name: demoPrecheck.branch.name, address: demoPrecheck.branch.address, isActive: true }],
  shifts: [{ id: demoPrecheck.shift.id, branchId: demoPrecheck.branch.id, name: demoPrecheck.shift.name, startTime: demoPrecheck.shift.startTime, endTime: demoPrecheck.shift.endTime, isActive: true }],
  assignments: [],
};

const demoPilotPolicy: PilotPolicy = {
  policies: [{
    branchId: demoPrecheck.branch.id,
    enforcementMode: "MONITOR",
    faceMatchThreshold: 0.55,
    retentionDays: 90,
    rollout: { label: "Pilot Aura Thanh Khê", cohortPercent: 100, startsAt: new Date().toISOString().slice(0, 10), endsAt: null, notes: "Theo dõi Face AI trước khi bắt buộc." },
    version: 1,
    updatedAt: new Date().toISOString(),
    updatedBy: demoUser.uid,
  }],
};

demoPrecheck.facePolicy = demoPilotPolicy.policies[0];

function demoAttendanceReport(from: string, to: string): AttendanceReport {
  const now = new Date();
  const earlier = new Date(now.getTime() - 38 * 60_000);
  return {
    range: { startDate: from, endDate: to, branchId: null, timezone: "Asia/Ho_Chi_Minh" },
    pageSummary: { returnedEvents: 2, checkIns: 2, checkOuts: 0, valid: 1, pendingReview: 1, rejected: 0, uniqueEmployees: 2, averageRiskScore: 35 },
    rows: [
      { id: "demo_report_1", userId: demoUser.uid, employeeName: demoUser.fullName, employeeCode: demoUser.employeeCode, branchId: demoPrecheck.branch.id, branchName: demoPrecheck.branch.name, type: "CHECK_IN", status: "VALID", serverTimestamp: earlier.toISOString(), distanceMeters: 12, locationAccuracy: 9, riskScore: 8, riskLevel: "LOW", faceVerified: true, presenceVerified: true, deviceVerified: true },
      { id: "demo_report_2", userId: "demo_minh_anh", employeeName: "Minh Anh", employeeCode: "FD0241", branchId: demoPrecheck.branch.id, branchName: demoPrecheck.branch.name, type: "CHECK_IN", status: "PENDING_REVIEW", serverTimestamp: now.toISOString(), distanceMeters: 68, locationAccuracy: 16, riskScore: 62, riskLevel: "HIGH", faceVerified: false, presenceVerified: true, deviceVerified: true },
    ],
    truncated: false,
    hasMore: false,
    pagination: { limit: 500, returned: 2, hasMore: false, nextCursor: null },
  };
}

function demoRealtimeMonitor(): RealtimeMonitor {
  const now = new Date().toISOString();
  return {
    generatedAt: now,
    pageSummary: { returnedActive: 2, insideGeofence: 1, outsideGeofence: 1, unknownGeofence: 0, staleHeartbeat: 0, highRisk: 0 },
    rows: [
      { sessionId: "demo_session_1", userId: demoUser.uid, employeeName: demoUser.fullName, employeeCode: demoUser.employeeCode, branchId: demoPrecheck.branch.id, branchName: demoPrecheck.branch.name, status: "ACTIVE", startedAt: new Date(Date.now() - 44 * 60_000).toISOString(), lastHeartbeatAt: now, insideGeofence: true, distanceMeters: 12, riskScore: 8, heartbeatStale: false },
      { sessionId: "demo_session_2", userId: "demo_minh_anh", employeeName: "Minh Anh", employeeCode: "FD0241", branchId: demoPrecheck.branch.id, branchName: demoPrecheck.branch.name, status: "ACTIVE", startedAt: new Date(Date.now() - 31 * 60_000).toISOString(), lastHeartbeatAt: now, insideGeofence: false, distanceMeters: 146, riskScore: 58, heartbeatStale: false },
    ],
    truncated: false,
    hasMore: false,
    pagination: { limit: 100, returned: 2, hasMore: false },
  };
}

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

async function loadMyProfile(): Promise<AttendanceUser> {
  const callable = httpsCallable<undefined, Omit<AttendanceUser, "isDemo">>(getFirebaseServices().functions, "getMyProfile");
  try {
    return { ...(await callable()).data, isDemo: false };
  } catch (reason) {
    throw new Error(firebaseErrorMessage(reason, "Không thể tải hồ sơ và quyền truy cập của bạn."));
  }
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
  try {
    await setPersistence(auth, remember ? browserLocalPersistence : browserSessionPersistence);
    await signInWithEmailAndPassword(auth, employeeEmail(identifier), password);
  } catch (reason) {
    throw new Error(firebaseErrorMessage(reason, "Không thể đăng nhập. Vui lòng thử lại."));
  }
  return loadMyProfile();
}

export async function restoreAuthenticatedUser(): Promise<AttendanceUser | null> {
  if (firebaseDemoMode()) return null;
  const { auth } = getFirebaseServices();
  await auth.authStateReady();
  const current = auth.currentUser;
  if (!current) return null;
  return loadMyProfile();
}

export async function listManagedDevices(): Promise<AdminDevice[]> {
  if (firebaseDemoMode()) {
    await wait(400);
    return demoDevices.map((device) => ({ ...device }));
  }
  const callable = httpsCallable<undefined, { devices: AdminDevice[] }>(getFirebaseServices().functions, "listDevices");
  try {
    return (await callable()).data.devices;
  } catch (reason) {
    throw new Error(firebaseErrorMessage(reason, "Không thể tải danh sách thiết bị."));
  }
}

export async function reviewManagedDevice(deviceId: string, decision: Extract<DeviceStatus, "TRUSTED" | "BLOCKED">): Promise<DeviceReviewResult> {
  if (firebaseDemoMode()) {
    await wait(350);
    return { deviceId, status: decision, trusted: decision === "TRUSTED" };
  }
  const callable = httpsCallable<{ deviceId: string; decision: Extract<DeviceStatus, "TRUSTED" | "BLOCKED">; reason: string }, DeviceReviewResult>(
    getFirebaseServices().functions,
    "reviewDevice",
  );
  try {
    return (await callable({ deviceId, decision, reason: decision === "TRUSTED" ? "Duyệt từ bảng quản trị" : "Khóa từ bảng quản trị" })).data;
  } catch (reason) {
    throw new Error(firebaseErrorMessage(reason, "Không thể cập nhật trạng thái thiết bị."));
  }
}

export async function createPresenceChallenge(branchId?: string): Promise<PresenceChallenge> {
  if (firebaseDemoMode()) {
    await wait(300);
    return {
      challengeId: crypto.randomUUID(),
      qrToken: `fastdo-presence-demo-${crypto.randomUUID()}`,
      code: "829104",
      branch: { id: demoPrecheck.branch.id, name: demoPrecheck.branch.name },
      expiresAt: new Date(Date.now() + 45_000).toISOString(),
    };
  }
  const callable = httpsCallable<{ branchId?: string }, PresenceChallenge>(getFirebaseServices().functions, "createPresenceChallenge");
  try {
    return (await callable(branchId ? { branchId } : {})).data;
  } catch (reason) {
    throw new Error(firebaseErrorMessage(reason, "Không thể tạo mã hiện diện mới."));
  }
}

export async function verifyPresenceChallenge(input: { qrToken?: string; code?: string }): Promise<PresenceProof> {
  if (firebaseDemoMode()) {
    await wait(350);
    if (input.code !== "829104" && !input.qrToken?.startsWith("fastdo-presence-demo-")) throw new Error("Mã hiện diện demo không hợp lệ.");
    return { proofId: crypto.randomUUID(), branchId: demoPrecheck.branch.id, expiresAt: new Date(Date.now() + 90_000).toISOString() };
  }
  const callable = httpsCallable<{ deviceId: string; qrToken?: string; code?: string }, PresenceProof>(getFirebaseServices().functions, "verifyPresenceChallenge");
  try {
    return (await callable({ deviceId: getOrCreateDeviceId(), ...input })).data;
  } catch (reason) {
    throw new Error(firebaseErrorMessage(reason, "Không thể xác minh mã hiện diện."));
  }
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

export async function changeTemporaryPassword(newPassword: string): Promise<AttendanceUser> {
  if (firebaseDemoMode()) return { ...demoUser, mustChangePassword: false };
  const callable = httpsCallable<{ newPassword: string }, { changed: boolean }>(getFirebaseServices().functions, "changeTemporaryPassword");
  try {
    await callable({ newPassword });
    return { ...(await loadMyProfile()), mustChangePassword: false };
  } catch (reason) {
    throw new Error(firebaseErrorMessage(reason, "Không thể đổi mật khẩu tạm thời."));
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

export async function startFaceSession(purpose: FacePurpose): Promise<FaceSession> {
  const deviceId = getOrCreateDeviceId();
  if (firebaseDemoMode()) {
    await wait(300);
    const challenge: FaceChallenge = Math.random() > 0.5 ? "TURN_LEFT" : "TURN_RIGHT";
    return {
      sessionId: `demo_face_${crypto.randomUUID()}`,
      purpose,
      challenge,
      expiresAt: new Date(Date.now() + 120_000).toISOString(),
      enrollmentStatus: demoPrecheck.employee.faceEnrollmentStatus,
    };
  }
  const callable = httpsCallable<{ deviceId: string; purpose: FacePurpose }, FaceSession>(getFirebaseServices().functions, "startFaceSession");
  try {
    return (await callable({ deviceId, purpose })).data;
  } catch (reason) {
    throw new Error(firebaseErrorMessage(reason, "Không thể bắt đầu phiên xác thực khuôn mặt."));
  }
}

export async function completeFaceSession(input: {
  sessionId: string;
  descriptor: number[];
  evidence: FaceEvidence;
}): Promise<FaceCompletion> {
  if (input.descriptor.length !== 128 || input.descriptor.some((value) => !Number.isFinite(value))) {
    throw new Error("Mẫu khuôn mặt chưa hợp lệ. Vui lòng quét lại trong điều kiện đủ sáng.");
  }
  if (firebaseDemoMode()) {
    await wait(500);
    const enrolled = demoPrecheck.employee.faceEnrollmentStatus !== "APPROVED";
    demoPrecheck.employee.faceEnrollmentStatus = "APPROVED";
    return {
      faceProofId: `demo_face_proof_${crypto.randomUUID()}`,
      matchScore: enrolled ? 1 : 0.94,
      enrolled,
      enrollmentStatus: "APPROVED",
      expiresAt: new Date(Date.now() + 90_000).toISOString(),
    };
  }
  const callable = httpsCallable<{
    sessionId: string;
    deviceId: string;
    descriptor: number[];
    evidence: FaceEvidence;
    consentVersion: "biometric-consent-v1";
  }, FaceCompletion>(getFirebaseServices().functions, "completeFaceSession");
  try {
    return (await callable({
      sessionId: input.sessionId,
      deviceId: getOrCreateDeviceId(),
      descriptor: input.descriptor,
      evidence: input.evidence,
      consentVersion: "biometric-consent-v1",
    })).data;
  } catch (reason) {
    throw new Error(firebaseErrorMessage(reason, "Không thể hoàn tất xác thực khuôn mặt."));
  }
}

export async function getAdminWorkforce(): Promise<AdminWorkforce> {
  if (firebaseDemoMode()) {
    await wait(350);
    return {
      employees: demoWorkforce.employees.map((item) => ({ ...item, branchIds: [...item.branchIds] })),
      branches: demoWorkforce.branches.map((item) => ({ ...item })),
      shifts: demoWorkforce.shifts.map((item) => ({ ...item })),
      assignments: demoWorkforce.assignments.map((item) => ({ ...item })),
    };
  }
  const callable = httpsCallable<undefined, AdminWorkforce>(getFirebaseServices().functions, "getAdminWorkforce");
  try {
    return (await callable()).data;
  } catch (reason) {
    throw new Error(firebaseErrorMessage(reason, "Không thể tải dữ liệu nhân sự và ca làm."));
  }
}

export async function createEmployee(input: CreateEmployeeInput): Promise<CreateEmployeeResult> {
  if (firebaseDemoMode()) {
    await wait(450);
    const employee: WorkforceEmployee = {
      id: `demo_${crypto.randomUUID()}`,
      ...input,
      status: "ACTIVE",
      faceEnrollmentStatus: "NOT_STARTED",
    };
    demoWorkforce.employees.unshift(employee);
    return { employee, temporaryPassword: `Fd@${Math.floor(100000 + Math.random() * 900000)}` };
  }
  const callable = httpsCallable<CreateEmployeeInput, CreateEmployeeResult>(getFirebaseServices().functions, "createEmployee");
  try {
    return (await callable(input)).data;
  } catch (reason) {
    throw new Error(firebaseErrorMessage(reason, "Không thể tạo tài khoản nhân viên."));
  }
}

export async function updateEmployee(employeeId: string, updates: { status?: "ACTIVE" | "INACTIVE"; role?: EmployeeRole }): Promise<WorkforceEmployee> {
  if (firebaseDemoMode()) {
    await wait(300);
    const index = demoWorkforce.employees.findIndex((item) => item.id === employeeId);
    if (index < 0) throw new Error("Không tìm thấy nhân viên.");
    demoWorkforce.employees[index] = { ...demoWorkforce.employees[index], ...updates };
    return { ...demoWorkforce.employees[index] };
  }
  const callable = httpsCallable<{ employeeId: string; status?: "ACTIVE" | "INACTIVE"; role?: EmployeeRole }, { employee: WorkforceEmployee }>(getFirebaseServices().functions, "updateEmployee");
  try {
    return (await callable({ employeeId, ...updates })).data.employee;
  } catch (reason) {
    throw new Error(firebaseErrorMessage(reason, "Không thể cập nhật nhân viên."));
  }
}

export async function assignEmployeeShift(input: { userId: string; shiftId: string; branchId: string; startDate: string; endDate: string }): Promise<WorkforceAssignment> {
  if (firebaseDemoMode()) {
    await wait(350);
    const assignment: WorkforceAssignment = { id: `demo_assignment_${crypto.randomUUID()}`, ...input };
    demoWorkforce.assignments.unshift(assignment);
    return assignment;
  }
  const callable = httpsCallable<{ employeeId: string; shiftId: string; branchId: string; startDate: string; endDate: string }, { assignment: WorkforceAssignment }>(getFirebaseServices().functions, "assignEmployeeShift");
  try {
    return (await callable({ employeeId: input.userId, shiftId: input.shiftId, branchId: input.branchId, startDate: input.startDate, endDate: input.endDate })).data.assignment;
  } catch (reason) {
    throw new Error(firebaseErrorMessage(reason, "Không thể phân ca cho nhân viên."));
  }
}

export async function resetEmployeeFace(employeeId: string): Promise<{ employeeId: string; faceEnrollmentStatus: "NOT_STARTED" }> {
  if (firebaseDemoMode()) {
    await wait(300);
    const employee = demoWorkforce.employees.find((item) => item.id === employeeId);
    if (employee) employee.faceEnrollmentStatus = "NOT_STARTED";
    if (employeeId === demoUser.uid) demoPrecheck.employee.faceEnrollmentStatus = "NOT_STARTED";
    return { employeeId, faceEnrollmentStatus: "NOT_STARTED" };
  }
  const callable = httpsCallable<{ employeeId: string }, { userId: string; faceEnrollmentStatus: "NOT_STARTED" }>(getFirebaseServices().functions, "resetEmployeeFace");
  try {
    const result = (await callable({ employeeId })).data;
    return { employeeId: result.userId, faceEnrollmentStatus: result.faceEnrollmentStatus };
  } catch (reason) {
    throw new Error(firebaseErrorMessage(reason, "Không thể đặt lại hồ sơ khuôn mặt."));
  }
}

export async function getPilotPolicy(branchId?: string): Promise<PilotPolicy> {
  if (firebaseDemoMode()) {
    await wait(350);
    return { policies: demoPilotPolicy.policies.filter((policy) => !branchId || policy.branchId === branchId).map((policy) => ({ ...policy, rollout: { ...policy.rollout } })) };
  }
  const callable = httpsCallable<{ branchId?: string }, PilotPolicy>(getFirebaseServices().functions, "getPilotPolicy");
  try {
    return (await callable(branchId ? { branchId } : {})).data;
  } catch (reason) {
    throw new Error(firebaseErrorMessage(reason, "Không thể tải chính sách pilot."));
  }
}

export async function updatePilotPolicy(input: PilotPolicyUpdate): Promise<PilotPolicy> {
  if (firebaseDemoMode()) {
    await wait(400);
    demoPilotPolicy.policies = demoPilotPolicy.policies.map((policy) => policy.branchId === input.branchId ? {
      ...policy,
      ...input,
      version: policy.version + 1,
      updatedAt: new Date().toISOString(),
      updatedBy: demoUser.uid,
    } : policy);
    return { policies: demoPilotPolicy.policies.map((policy) => ({ ...policy, rollout: { ...policy.rollout } })) };
  }
  const callable = httpsCallable<PilotPolicyUpdate, { policy: PilotPolicy["policies"][number] }>(getFirebaseServices().functions, "updatePilotPolicy");
  try {
    return { policies: [(await callable(input)).data.policy] };
  } catch (reason) {
    throw new Error(firebaseErrorMessage(reason, "Không thể cập nhật chính sách pilot."));
  }
}

export async function getAttendanceReport(input: { startDate: string; endDate: string; branchId?: string; limit?: number; cursor?: string }): Promise<AttendanceReport> {
  if (firebaseDemoMode()) {
    await wait(450);
    return demoAttendanceReport(input.startDate, input.endDate);
  }
  const callable = httpsCallable<typeof input, AttendanceReport>(getFirebaseServices().functions, "getAttendanceReport");
  try {
    return (await callable(input)).data;
  } catch (reason) {
    throw new Error(firebaseErrorMessage(reason, "Không thể tải báo cáo chấm công."));
  }
}

export async function getRealtimeMonitor(input: { branchId?: string; limit?: number } = {}): Promise<RealtimeMonitor> {
  if (firebaseDemoMode()) {
    await wait(350);
    return demoRealtimeMonitor();
  }
  const callable = httpsCallable<{ branchId?: string; limit?: number }, RealtimeMonitor>(getFirebaseServices().functions, "getRealtimeMonitor");
  try {
    return (await callable(input)).data;
  } catch (reason) {
    throw new Error(firebaseErrorMessage(reason, "Không thể tải trạng thái chấm công realtime."));
  }
}

export async function withdrawFaceConsent(): Promise<FaceConsentWithdrawal> {
  if (firebaseDemoMode()) {
    await wait(450);
    demoPrecheck.employee.faceEnrollmentStatus = "NOT_STARTED";
    const demoEmployee = demoWorkforce.employees.find((employee) => employee.id === demoUser.uid);
    if (demoEmployee) demoEmployee.faceEnrollmentStatus = "NOT_STARTED";
    return { withdrawn: true, faceEnrollmentStatus: "NOT_STARTED", revokedSessions: 1, revokedProofs: 1, withdrawnAt: new Date().toISOString() };
  }
  const callable = httpsCallable<undefined, FaceConsentWithdrawal>(getFirebaseServices().functions, "withdrawFaceConsent");
  try {
    return (await callable()).data;
  } catch (reason) {
    throw new Error(firebaseErrorMessage(reason, "Không thể rút đồng ý dữ liệu khuôn mặt."));
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

export async function submitCheckIn(location: DeviceLocation, presenceToken: string, faceProofId?: string): Promise<CheckInResult> {
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
    presenceToken,
    ...(faceProofId ? { faceProofId, faceSessionId: faceProofId } : {}),
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
