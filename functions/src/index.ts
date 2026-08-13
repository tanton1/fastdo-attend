import { initializeApp } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { randomInt, randomUUID } from "node:crypto";
import { GeoPoint, Timestamp, getFirestore } from "firebase-admin/firestore";
import { HttpsError, onCall } from "firebase-functions/v2/https";
import { setGlobalOptions } from "firebase-functions/v2/options";
import { distanceInMeters } from "./domain/geo";
import { calculateAttendanceRisk } from "./domain/risk";
import { deviceCanCheckIn, sanitizePlatform } from "./domain/device";
import {
  FACE_CONSENT_VERSION,
  FACE_MATCH_DISTANCE_THRESHOLD,
  decryptFaceDescriptor,
  encryptFaceDescriptor,
  faceDescriptorDistance,
  faceMatchScore,
  validateFaceDescriptor,
  validateFaceLivenessEvidence,
} from "./domain/face";
import { createPresenceNonce, hashPresenceQr, isSixDigitPresenceCode, signPresenceQr, verifyPresenceQr } from "./domain/presence";
import type {
  BranchDocument,
  DeviceDocument,
  DeviceStatus,
  EmployeeDocument,
  EmployeeRole,
  FaceProfileDocument,
  FaceProofDocument,
  FacePurpose,
  FaceSessionDocument,
  PresenceChallengeDocument,
  PresenceProofDocument,
  ShiftAssignmentDocument,
  ShiftDocument,
} from "./domain/types";
import {
  canManageWorkforceRole,
  dateRangesOverlap,
  generateTemporaryPassword,
  isIsoDateOnly,
  isStrongPassword,
  normalizeEmployeeCode,
  normalizeEmployeeEmail,
  sanitizeEmployeeName,
} from "./domain/workforce";
import { buildAuditLogDocument, writeAuditLog } from "./services/audit";
import { MANAGER_ROLES, loadAttendanceContext, loadEmployeeContext, loadManagerContext, requireUserId } from "./services/context";
import { publicDeviceStatus, readOwnedDevice, registerOrTouchDevice, requireDeviceId } from "./services/devices";
import type { DeviceRegistrationInput } from "./services/devices";
import { enforceRateLimit } from "./services/rate-limit";

initializeApp();
setGlobalOptions({ region: "asia-southeast1", maxInstances: 10, memory: "256MiB", timeoutSeconds: 30 });

const callableOptions = { enforceAppCheck: process.env.FUNCTIONS_EMULATOR !== "true" } as const;
const presenceCallableOptions = { ...callableOptions, secrets: ["PRESENCE_SIGNING_KEY"] };
const faceCallableOptions = { ...callableOptions, secrets: ["FACE_DATA_KEY"] };

interface LocationInput {
  latitude: number;
  longitude: number;
  accuracy: number;
}

interface AttendanceInput {
  idempotencyKey: string;
  deviceId: string;
  location: LocationInput;
  clientTimestamp: string;
  faceSessionId?: string;
  presenceToken?: string;
  offline?: boolean;
}

interface PrecheckInput {
  deviceId: string;
}

interface DeviceReviewInput {
  deviceId: string;
  decision: Extract<DeviceStatus, "TRUSTED" | "BLOCKED">;
  reason?: string;
}

interface PresenceChallengeInput {
  branchId?: string;
}

interface PresenceVerificationInput {
  deviceId: string;
  qrToken?: string;
  code?: string;
}

interface StartFaceSessionInput {
  deviceId: string;
  purpose: FacePurpose;
}

interface CompleteFaceSessionInput {
  sessionId: string;
  deviceId: string;
  descriptor: number[];
  evidence: unknown;
  consentVersion: string;
}

interface ShiftAssignmentInput {
  employeeId: string;
  branchId: string;
  shiftId: string;
  startDate: string;
  endDate: string;
}

interface CreateEmployeeInput {
  fullName: string;
  employeeCode: string;
  email: string;
  role?: EmployeeRole;
  branchIds?: string[];
  assignment?: Omit<ShiftAssignmentInput, "employeeId">;
}

interface UpdateEmployeeInput {
  employeeId: string;
  fullName?: string;
  status?: EmployeeDocument["status"];
  role?: EmployeeRole;
  branchIds?: string[];
}

interface ChangeTemporaryPasswordInput {
  newPassword: string;
}

function presenceSigningSecret(): string {
  const secret = process.env.PRESENCE_SIGNING_KEY;
  if (!secret || secret.length < 32) throw new HttpsError("internal", "Khóa ký QR hiện diện chưa được cấu hình.");
  return secret;
}

function faceDataKey(): string {
  const secret = process.env.FACE_DATA_KEY;
  if (!secret) throw new HttpsError("internal", "Khóa mã hóa dữ liệu khuôn mặt chưa được cấu hình.");
  return secret;
}

function requireAttendanceInput(input: AttendanceInput): void {
  if (!input?.idempotencyKey || !input?.deviceId || !input?.location) {
    throw new HttpsError("invalid-argument", "Thiếu bằng chứng chấm công bắt buộc.");
  }
  if (!Number.isFinite(input.location.latitude) || !Number.isFinite(input.location.longitude) || !Number.isFinite(input.location.accuracy)) {
    throw new HttpsError("invalid-argument", "Tọa độ chấm công không hợp lệ.");
  }
  if (input.location.accuracy <= 0 || input.location.accuracy > 1000) {
    throw new HttpsError("invalid-argument", "Độ chính xác vị trí không hợp lệ.");
  }
}

const WORKFORCE_ROLES: EmployeeRole[] = ["SUPER_ADMIN", "COMPANY_ADMIN", "HR", "MANAGER"];

function assertWorkforceAccess(role: EmployeeRole): void {
  if (!WORKFORCE_ROLES.includes(role)) throw new HttpsError("permission-denied", "Bạn không có quyền quản lý nhân sự.");
}

function assertRoleAssignmentAllowed(actorRole: EmployeeRole, currentRole: EmployeeRole | null, requestedRole: EmployeeRole): void {
  if (currentRole) assertCanManageTargetRole(actorRole, currentRole);
  if (!canManageWorkforceRole(actorRole, requestedRole)) {
    throw new HttpsError("permission-denied", "Bạn không được cấp vai trò cao hơn phạm vi quản trị của mình.");
  }
}

function assertCanManageTargetRole(actorRole: EmployeeRole, targetRole: EmployeeRole): void {
  if (!canManageWorkforceRole(actorRole, targetRole)) {
    throw new HttpsError("permission-denied", "Bạn không được quản lý tài khoản có vai trò này.");
  }
}

function sanitizeBranchIds(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.filter((entry): entry is string => typeof entry === "string")
    .map((entry) => entry.trim()).filter((entry) => /^[A-Za-z0-9_-]{2,100}$/.test(entry)))].slice(0, 20);
}

function timestampToIso(value: unknown): string | null {
  return value instanceof Timestamp ? value.toDate().toISOString() : null;
}

async function validateAssignmentScope(
  companyId: string,
  assignment: Omit<ShiftAssignmentInput, "employeeId">,
): Promise<{ branch: BranchDocument; shift: ShiftDocument; startDate: Timestamp; endDate: Timestamp }> {
  if (!assignment || !isIsoDateOnly(assignment.startDate) || !isIsoDateOnly(assignment.endDate)) {
    throw new HttpsError("invalid-argument", "Khoảng ngày phân ca không hợp lệ.");
  }
  const startDate = Timestamp.fromDate(new Date(`${assignment.startDate}T00:00:00.000Z`));
  const endDate = Timestamp.fromDate(new Date(`${assignment.endDate}T23:59:59.999Z`));
  if (endDate.toMillis() < startDate.toMillis()) throw new HttpsError("invalid-argument", "Ngày kết thúc phải sau ngày bắt đầu.");
  if (endDate.toMillis() - startDate.toMillis() > 366 * 24 * 60 * 60 * 1000) {
    throw new HttpsError("invalid-argument", "Một phân ca không được dài quá 366 ngày.");
  }
  const db = getFirestore();
  const [branchSnapshot, shiftSnapshot] = await Promise.all([
    db.doc(`branches/${assignment.branchId}`).get(),
    db.doc(`shifts/${assignment.shiftId}`).get(),
  ]);
  if (!branchSnapshot.exists || !shiftSnapshot.exists) throw new HttpsError("not-found", "Chi nhánh hoặc ca làm không tồn tại.");
  const branch = branchSnapshot.data() as BranchDocument;
  const shift = shiftSnapshot.data() as ShiftDocument;
  if (branch.companyId !== companyId || shift.companyId !== companyId || shift.branchId !== assignment.branchId) {
    throw new HttpsError("permission-denied", "Chi nhánh hoặc ca làm không thuộc doanh nghiệp.");
  }
  if (!branch.isActive || !shift.isActive) throw new HttpsError("failed-precondition", "Chi nhánh hoặc ca làm đã ngừng hoạt động.");
  return { branch, shift, startDate, endDate };
}

export const getMyProfile = onCall(callableOptions, async (request) => {
  const userId = requireUserId(request);
  const context = await loadEmployeeContext(userId, true);
  await enforceRateLimit(userId, "getMyProfile", 30);
  return {
    uid: userId,
    fullName: context.employee.fullName,
    employeeCode: context.employee.employeeCode,
    email: context.employee.email,
    role: context.employee.role,
    companyId: context.employee.companyId,
    canManageDevices: MANAGER_ROLES.includes(context.employee.role),
    mustChangePassword: Boolean(context.employee.mustChangePassword),
  };
});

export const changeTemporaryPassword = onCall<ChangeTemporaryPasswordInput>(callableOptions, async (request) => {
  const userId = requireUserId(request);
  const context = await loadEmployeeContext(userId, true);
  await enforceRateLimit(userId, "changeTemporaryPassword", 5, 300);
  if (!context.employee.mustChangePassword) {
    throw new HttpsError("failed-precondition", "Tài khoản không yêu cầu đổi mật khẩu tạm thời.");
  }
  if (!isStrongPassword(request.data?.newPassword)) {
    throw new HttpsError("invalid-argument", "Mật khẩu cần ít nhất 12 ký tự, gồm chữ hoa, chữ thường, số và ký tự đặc biệt.");
  }
  await getAuth().updateUser(userId, { password: request.data.newPassword });
  const now = Timestamp.now();
  const db = getFirestore();
  const batch = db.batch();
  batch.update(db.doc(`employees/${userId}`), { mustChangePassword: false, passwordChangedAt: now, updatedAt: now });
  batch.create(db.collection("auditLogs").doc(), buildAuditLogDocument(request, context, {
    action: "TEMPORARY_PASSWORD_CHANGED",
    targetType: "EMPLOYEE",
    targetId: userId,
  }));
  await batch.commit();
  return { changed: true };
});

export const registerDevice = onCall<DeviceRegistrationInput>(callableOptions, async (request) => {
  const userId = requireUserId(request);
  const context = await loadAttendanceContext(userId);
  await enforceRateLimit(userId, "registerDevice", 5);
  const registration = await registerOrTouchDevice(context, request.data, buildAuditLogDocument(request, context, {
    action: "DEVICE_REGISTERED",
    targetType: "DEVICE",
    targetId: request.data.deviceId,
    metadata: { status: "PENDING", platform: sanitizePlatform(request.data.platform) },
  }));

  return publicDeviceStatus(request.data.deviceId, registration.device);
});

export const getDeviceStatus = onCall<{ deviceId: string }>(callableOptions, async (request) => {
  const userId = requireUserId(request);
  const context = await loadAttendanceContext(userId);
  await enforceRateLimit(userId, "getDeviceStatus", 30);
  const deviceId = requireDeviceId(request.data?.deviceId);
  const device = await readOwnedDevice(context, deviceId);
  if (!device) throw new HttpsError("not-found", "Thiết bị chưa được đăng ký.");
  return publicDeviceStatus(deviceId, device);
});

export const listDevices = onCall(callableOptions, async (request) => {
  const userId = requireUserId(request);
  const context = await loadManagerContext(userId);
  await enforceRateLimit(userId, "listDevices", 30);
  const snapshots = await getFirestore()
    .collection("devices")
    .where("companyId", "==", context.employee.companyId)
    .orderBy("createdAt", "desc")
    .limit(100)
    .get();

  const devices = snapshots.docs.map((snapshot) => ({ id: snapshot.id, data: snapshot.data() as DeviceDocument }));
  const employeeIds = [...new Set(devices.map(({ data }) => data.userId))];
  const employeeSnapshots = employeeIds.length
    ? await getFirestore().getAll(...employeeIds.map((employeeId) => getFirestore().doc(`employees/${employeeId}`)))
    : [];
  const employees = new Map(employeeSnapshots.filter((snapshot) => snapshot.exists).map((snapshot) => [snapshot.id, snapshot.data() as EmployeeDocument]));

  return {
    devices: devices.map(({ id, data }) => {
      const owner = employees.get(data.userId);
      return {
        ...publicDeviceStatus(id, data),
        userId: data.userId,
        employeeName: owner?.fullName ?? "Nhân viên",
        employeeCode: owner?.employeeCode ?? "—",
        createdAt: data.createdAt?.toDate?.().toISOString() ?? null,
        lastSeenAt: data.lastSeenAt?.toDate?.().toISOString() ?? null,
        reviewedAt: data.reviewedAt?.toDate?.().toISOString() ?? null,
      };
    }),
  };
});

export const reviewDevice = onCall<DeviceReviewInput>(callableOptions, async (request) => {
  const userId = requireUserId(request);
  const context = await loadManagerContext(userId);
  await enforceRateLimit(userId, "reviewDevice", 20);
  const deviceId = requireDeviceId(request.data?.deviceId);
  if (!["TRUSTED", "BLOCKED"].includes(request.data?.decision)) {
    throw new HttpsError("invalid-argument", "Quyết định duyệt thiết bị không hợp lệ.");
  }

  const reference = getFirestore().doc(`devices/${deviceId}`);
  const snapshot = await reference.get();
  if (!snapshot.exists || snapshot.data()?.companyId !== context.employee.companyId) {
    throw new HttpsError("not-found", "Không tìm thấy thiết bị trong doanh nghiệp.");
  }

  const now = Timestamp.now();
  const decision = request.data.decision;
  const batch = getFirestore().batch();
  batch.update(reference, {
    status: decision,
    isBlocked: decision === "BLOCKED",
    reviewedAt: now,
    reviewedBy: userId,
    reviewReason: typeof request.data.reason === "string" ? request.data.reason.trim().slice(0, 200) : null,
    updatedAt: now,
  });
  batch.create(getFirestore().collection("auditLogs").doc(), buildAuditLogDocument(request, context, {
    action: decision === "TRUSTED" ? "DEVICE_APPROVED" : "DEVICE_BLOCKED",
    targetType: "DEVICE",
    targetId: deviceId,
    metadata: { previousStatus: String(snapshot.data()?.status ?? "UNKNOWN"), decision },
  }));
  await batch.commit();
  return { deviceId, status: decision, trusted: decision === "TRUSTED" };
});

export const getAdminWorkforce = onCall(callableOptions, async (request) => {
  const userId = requireUserId(request);
  const context = await loadManagerContext(userId);
  assertWorkforceAccess(context.employee.role);
  await enforceRateLimit(userId, "getAdminWorkforce", 20);
  const db = getFirestore();
  const [employeesSnapshot, branchesSnapshot, shiftsSnapshot, assignmentsSnapshot] = await Promise.all([
    db.collection("employees").where("companyId", "==", context.employee.companyId).limit(500).get(),
    db.collection("branches").where("companyId", "==", context.employee.companyId).limit(100).get(),
    db.collection("shifts").where("companyId", "==", context.employee.companyId).limit(200).get(),
    db.collection("shiftAssignments").where("companyId", "==", context.employee.companyId).limit(500).get(),
  ]);
  const assignments = assignmentsSnapshot.docs
    .map((snapshot) => ({ id: snapshot.id, ...snapshot.data() as ShiftAssignmentDocument }))
    .sort((left, right) => right.startDate.toMillis() - left.startDate.toMillis())
    .slice(0, 250)
    .map((assignment) => ({
      ...assignment,
      startDate: assignment.startDate.toDate().toISOString(),
      endDate: assignment.endDate.toDate().toISOString(),
    }));
  return {
    employees: employeesSnapshot.docs.map((snapshot) => {
      const employee = snapshot.data() as EmployeeDocument;
      return {
        id: snapshot.id,
        employeeCode: employee.employeeCode,
        fullName: employee.fullName,
        email: employee.email,
        role: employee.role,
        branchIds: employee.branchIds ?? [],
        status: employee.status,
        faceEnrollmentStatus: employee.faceEnrollmentStatus,
        mustChangePassword: Boolean(employee.mustChangePassword),
        createdAt: timestampToIso(employee.createdAt),
        updatedAt: timestampToIso(employee.updatedAt),
      };
    }),
    branches: branchesSnapshot.docs.map((snapshot) => ({ id: snapshot.id, ...snapshot.data() as BranchDocument })),
    shifts: shiftsSnapshot.docs.map((snapshot) => ({ id: snapshot.id, ...snapshot.data() as ShiftDocument })),
    assignments,
  };
});

export const createEmployee = onCall<CreateEmployeeInput>(callableOptions, async (request) => {
  const actorId = requireUserId(request);
  const context = await loadManagerContext(actorId);
  assertWorkforceAccess(context.employee.role);
  await enforceRateLimit(actorId, "createEmployee", 8, 300);
  const fullName = sanitizeEmployeeName(request.data?.fullName);
  const email = normalizeEmployeeEmail(request.data?.email);
  const employeeCode = normalizeEmployeeCode(request.data?.employeeCode);
  const role = request.data?.role ?? "EMPLOYEE";
  if (!fullName || !email || !employeeCode || !WORKFORCE_ROLES.concat("EMPLOYEE").includes(role)) {
    throw new HttpsError("invalid-argument", "Tên, email, mã nhân viên hoặc vai trò không hợp lệ.");
  }
  assertRoleAssignmentAllowed(context.employee.role, null, role);
  const branchIds = sanitizeBranchIds(request.data?.branchIds);
  if (request.data?.assignment?.branchId && !branchIds.includes(request.data.assignment.branchId)) {
    branchIds.push(request.data.assignment.branchId);
  }
  const validatedAssignment = request.data.assignment
    ? await validateAssignmentScope(context.employee.companyId, request.data.assignment)
    : null;
  const db = getFirestore();
  const [existingCode, existingEmail] = await Promise.all([
    db.collection("employees")
      .where("companyId", "==", context.employee.companyId)
      .where("employeeCode", "==", employeeCode)
      .limit(1)
      .get(),
    db.collection("employees")
      .where("companyId", "==", context.employee.companyId)
      .where("email", "==", email)
      .limit(1)
      .get(),
  ]);
  if (!existingCode.empty) throw new HttpsError("already-exists", "Mã nhân viên đã tồn tại.");
  if (!existingEmail.empty) throw new HttpsError("already-exists", "Email nhân viên đã tồn tại.");
  if (branchIds.length) {
    const branchSnapshots = await db.getAll(...branchIds.map((branchId) => db.doc(`branches/${branchId}`)));
    if (branchSnapshots.some((snapshot) => !snapshot.exists || snapshot.data()?.companyId !== context.employee.companyId)) {
      throw new HttpsError("permission-denied", "Danh sách chi nhánh không thuộc doanh nghiệp.");
    }
  }
  const temporaryPassword = generateTemporaryPassword();
  let authUser: Awaited<ReturnType<ReturnType<typeof getAuth>["createUser"]>> | null = null;
  try {
    authUser = await getAuth().createUser({ email, password: temporaryPassword, displayName: fullName, disabled: false });
    const now = Timestamp.now();
    const employee: EmployeeDocument = {
      companyId: context.employee.companyId,
      employeeCode,
      fullName,
      email,
      role,
      branchIds,
      status: "ACTIVE",
      faceEnrollmentStatus: "NOT_STARTED",
      mustChangePassword: true,
      passwordChangedAt: null,
      createdAt: now,
      updatedAt: now,
    };
    await db.runTransaction(async (transaction) => {
      const codeRef = db.doc(`employeeCodes/${context.employee.companyId}_${employeeCode}`);
      const emailRef = db.doc(`employeeEmails/${context.employee.companyId}_${email.replace(/[^a-z0-9]/g, "_")}`);
      const [codeSnapshot, emailSnapshot] = await Promise.all([transaction.get(codeRef), transaction.get(emailRef)]);
      if (codeSnapshot.exists) throw new HttpsError("already-exists", "Mã nhân viên đã tồn tại.");
      if (emailSnapshot.exists) throw new HttpsError("already-exists", "Email nhân viên đã tồn tại.");
      transaction.create(db.doc(`employees/${authUser!.uid}`), employee);
      transaction.create(codeRef, { companyId: context.employee.companyId, employeeCode, userId: authUser!.uid, createdAt: now });
      transaction.create(emailRef, { companyId: context.employee.companyId, email, userId: authUser!.uid, createdAt: now });
      if (validatedAssignment && request.data.assignment) {
        transaction.create(db.collection("shiftAssignments").doc(), {
          companyId: context.employee.companyId,
          userId: authUser!.uid,
          branchId: request.data.assignment.branchId,
          shiftId: request.data.assignment.shiftId,
          startDate: validatedAssignment.startDate,
          endDate: validatedAssignment.endDate,
          createdAt: now,
          createdBy: actorId,
        });
      }
      transaction.create(db.collection("auditLogs").doc(), buildAuditLogDocument(request, context, {
        action: "EMPLOYEE_CREATED",
        targetType: "EMPLOYEE",
        targetId: authUser!.uid,
        metadata: { employeeCode, role, assignmentCreated: Boolean(validatedAssignment) },
      }));
    });
    return {
      employee: {
        id: authUser.uid,
        fullName,
        employeeCode,
        email,
        role,
        branchIds,
        status: "ACTIVE" as const,
        faceEnrollmentStatus: "NOT_STARTED" as const,
        mustChangePassword: true,
      },
      temporaryPassword,
    };
  } catch (error) {
    if (authUser) await getAuth().deleteUser(authUser.uid).catch(() => undefined);
    const authCode = typeof error === "object" && error && "code" in error ? String(error.code) : "";
    if (authCode === "auth/email-already-exists") throw new HttpsError("already-exists", "Email đã được sử dụng trong hệ thống đăng nhập.");
    throw error;
  }
});

export const updateEmployee = onCall<UpdateEmployeeInput>(callableOptions, async (request) => {
  const actorId = requireUserId(request);
  const context = await loadManagerContext(actorId);
  assertWorkforceAccess(context.employee.role);
  await enforceRateLimit(actorId, "updateEmployee", 20);
  const employeeId = typeof request.data?.employeeId === "string" ? request.data.employeeId.trim() : "";
  if (!/^[A-Za-z0-9]{20,128}$/.test(employeeId)) throw new HttpsError("invalid-argument", "Nhân viên không hợp lệ.");
  const db = getFirestore();
  const employeeRef = db.doc(`employees/${employeeId}`);
  const snapshot = await employeeRef.get();
  if (!snapshot.exists || snapshot.data()?.companyId !== context.employee.companyId) throw new HttpsError("not-found", "Không tìm thấy nhân viên.");
  const employee = snapshot.data() as EmployeeDocument;
  assertCanManageTargetRole(context.employee.role, employee.role);
  if (request.data.role) {
    if (!WORKFORCE_ROLES.concat("EMPLOYEE").includes(request.data.role)) throw new HttpsError("invalid-argument", "Vai trò không hợp lệ.");
    assertRoleAssignmentAllowed(context.employee.role, employee.role, request.data.role);
  }
  if (employeeId === actorId && request.data.status === "INACTIVE") {
    throw new HttpsError("failed-precondition", "Bạn không thể tự vô hiệu hóa tài khoản đang đăng nhập.");
  }
  const updates: Record<string, unknown> = { updatedAt: Timestamp.now() };
  if (request.data.fullName !== undefined) {
    const fullName = sanitizeEmployeeName(request.data.fullName);
    if (!fullName) throw new HttpsError("invalid-argument", "Tên nhân viên không hợp lệ.");
    updates.fullName = fullName;
  }
  if (request.data.status !== undefined) {
    if (!["ACTIVE", "INACTIVE"].includes(request.data.status)) throw new HttpsError("invalid-argument", "Trạng thái không hợp lệ.");
    updates.status = request.data.status;
  }
  if (request.data.role !== undefined) updates.role = request.data.role;
  if (request.data.branchIds !== undefined) {
    const branchIds = sanitizeBranchIds(request.data.branchIds);
    if (branchIds.length) {
      const branchSnapshots = await db.getAll(...branchIds.map((branchId) => db.doc(`branches/${branchId}`)));
      if (branchSnapshots.some((branch) => !branch.exists || branch.data()?.companyId !== context.employee.companyId)) {
        throw new HttpsError("permission-denied", "Danh sách chi nhánh không thuộc doanh nghiệp.");
      }
    }
    updates.branchIds = branchIds;
  }
  const batch = db.batch();
  batch.update(employeeRef, updates);
  batch.create(db.collection("auditLogs").doc(), buildAuditLogDocument(request, context, {
    action: "EMPLOYEE_UPDATED",
    targetType: "EMPLOYEE",
    targetId: employeeId,
    metadata: { status: request.data.status ?? employee.status, role: request.data.role ?? employee.role },
  }));
  const statusChanged = request.data.status !== undefined && request.data.status !== employee.status;
  if (statusChanged) await getAuth().updateUser(employeeId, { disabled: request.data.status === "INACTIVE" });
  try {
    await batch.commit();
  } catch (error) {
    if (statusChanged) {
      try {
        await getAuth().updateUser(employeeId, { disabled: employee.status === "INACTIVE" });
      } catch (compensationError) {
        console.error("Failed to compensate Firebase Auth employee status", {
          employeeId,
          requestedStatus: request.data.status,
          compensationError: compensationError instanceof Error ? compensationError.message : "unknown",
        });
      }
    }
    throw error;
  }
  return {
    employee: {
      id: employeeId,
      fullName: String(updates.fullName ?? employee.fullName),
      employeeCode: employee.employeeCode,
      email: employee.email,
      role: (updates.role ?? employee.role) as EmployeeRole,
      branchIds: (updates.branchIds ?? employee.branchIds) as string[],
      status: (updates.status ?? employee.status) as EmployeeDocument["status"],
      faceEnrollmentStatus: employee.faceEnrollmentStatus,
      mustChangePassword: Boolean(employee.mustChangePassword),
    },
  };
});

export const assignEmployeeShift = onCall<ShiftAssignmentInput>(callableOptions, async (request) => {
  const actorId = requireUserId(request);
  const context = await loadManagerContext(actorId);
  assertWorkforceAccess(context.employee.role);
  await enforceRateLimit(actorId, "assignEmployeeShift", 20);
  const employeeId = typeof request.data?.employeeId === "string" ? request.data.employeeId.trim() : "";
  const employeeSnapshot = await getFirestore().doc(`employees/${employeeId}`).get();
  if (!employeeSnapshot.exists || employeeSnapshot.data()?.companyId !== context.employee.companyId) {
    throw new HttpsError("not-found", "Không tìm thấy nhân viên trong doanh nghiệp.");
  }
  assertCanManageTargetRole(context.employee.role, (employeeSnapshot.data() as EmployeeDocument).role);
  const assignment = await validateAssignmentScope(context.employee.companyId, request.data);
  const now = Timestamp.now();
  const db = getFirestore();
  const assignmentRef = db.collection("shiftAssignments").doc();
  await db.runTransaction(async (transaction) => {
    const existingAssignments = await transaction.get(
      db.collection("shiftAssignments").where("userId", "==", employeeId),
    );
    const hasOverlap = existingAssignments.docs.some((snapshot) => {
      const existing = snapshot.data() as ShiftAssignmentDocument;
      return existing.companyId === context.employee.companyId && dateRangesOverlap(
        existing.startDate.toMillis(),
        existing.endDate.toMillis(),
        assignment.startDate.toMillis(),
        assignment.endDate.toMillis(),
      );
    });
    if (hasOverlap) throw new HttpsError("already-exists", "Nhân viên đã có phân ca trùng khoảng thời gian này.");
    transaction.create(assignmentRef, {
      companyId: context.employee.companyId,
      userId: employeeId,
      branchId: request.data.branchId,
      shiftId: request.data.shiftId,
      startDate: assignment.startDate,
      endDate: assignment.endDate,
      createdAt: now,
      createdBy: actorId,
    });
    transaction.create(db.collection("auditLogs").doc(), buildAuditLogDocument(request, context, {
      action: "EMPLOYEE_SHIFT_ASSIGNED",
      targetType: "SHIFT_ASSIGNMENT",
      targetId: assignmentRef.id,
      metadata: { employeeId, branchId: request.data.branchId, shiftId: request.data.shiftId },
    }));
  });
  return {
    assignment: {
      id: assignmentRef.id,
      userId: employeeId,
      branchId: request.data.branchId,
      shiftId: request.data.shiftId,
      startDate: request.data.startDate,
      endDate: request.data.endDate,
    },
  };
});

export const resetEmployeeFace = onCall<{ employeeId: string }>(callableOptions, async (request) => {
  const actorId = requireUserId(request);
  const context = await loadManagerContext(actorId);
  assertWorkforceAccess(context.employee.role);
  await enforceRateLimit(actorId, "resetEmployeeFace", 10, 300);
  const employeeId = typeof request.data?.employeeId === "string" ? request.data.employeeId.trim() : "";
  if (!/^[A-Za-z0-9]{20,128}$/.test(employeeId)) throw new HttpsError("invalid-argument", "Nhân viên không hợp lệ.");
  const db = getFirestore();
  const employeeRef = db.doc(`employees/${employeeId}`);
  const employeeSnapshot = await employeeRef.get();
  if (!employeeSnapshot.exists || employeeSnapshot.data()?.companyId !== context.employee.companyId) {
    throw new HttpsError("not-found", "Không tìm thấy nhân viên trong doanh nghiệp.");
  }
  const target = employeeSnapshot.data() as EmployeeDocument;
  assertCanManageTargetRole(context.employee.role, target.role);
  const now = Timestamp.now();
  await db.runTransaction(async (transaction) => {
    const [activeSessions, unusedProofs] = await Promise.all([
      transaction.get(db.collection("faceSessions").where("userId", "==", employeeId).where("status", "==", "ACTIVE")),
      transaction.get(db.collection("faceProofs").where("userId", "==", employeeId).where("usedAt", "==", null)),
    ]);
    if (activeSessions.size + unusedProofs.size > 450) {
      throw new HttpsError("resource-exhausted", "Có quá nhiều phiên khuôn mặt đang chờ; vui lòng liên hệ quản trị hệ thống.");
    }
    transaction.delete(db.doc(`faceProfiles/${employeeId}`));
    transaction.update(employeeRef, { faceEnrollmentStatus: "NOT_STARTED", faceResetAt: now, updatedAt: now });
    for (const session of activeSessions.docs) {
      transaction.update(session.ref, { status: "FAILED", usedAt: now, outcome: "RESET" });
    }
    for (const proof of unusedProofs.docs) transaction.delete(proof.ref);
    transaction.create(db.collection("auditLogs").doc(), buildAuditLogDocument(request, context, {
      action: "EMPLOYEE_FACE_RESET",
      targetType: "EMPLOYEE",
      targetId: employeeId,
      metadata: { revokedSessions: activeSessions.size, revokedProofs: unusedProofs.size },
    }));
  });
  return { userId: employeeId, faceEnrollmentStatus: "NOT_STARTED" };
});

export const createPresenceChallenge = onCall<PresenceChallengeInput>(presenceCallableOptions, async (request) => {
  const userId = requireUserId(request);
  const context = await loadManagerContext(userId);
  await enforceRateLimit(userId, "createPresenceChallenge", 15);
  const branchId = typeof request.data?.branchId === "string" && request.data.branchId.trim()
    ? request.data.branchId.trim()
    : context.employee.branchIds?.[0];
  if (!branchId || !context.employee.branchIds?.includes(branchId)) {
    throw new HttpsError("permission-denied", "Bạn không có quyền phát mã cho chi nhánh này.");
  }

  const db = getFirestore();
  const branchSnapshot = await db.doc(`branches/${branchId}`).get();
  if (!branchSnapshot.exists) throw new HttpsError("not-found", "Không tìm thấy chi nhánh.");
  const branch = branchSnapshot.data() as BranchDocument;
  if (branch.companyId !== context.employee.companyId || !branch.isActive) {
    throw new HttpsError("permission-denied", "Chi nhánh không thuộc phạm vi quản trị.");
  }

  const now = Timestamp.now();
  const expiresAt = Timestamp.fromMillis(now.toMillis() + 45_000);
  const challengeId = randomUUID();
  const code = String(randomInt(100000, 1_000_000));
  const nonce = createPresenceNonce();
  const qrToken = signPresenceQr({
    version: 1,
    challengeId,
    companyId: context.employee.companyId,
    branchId,
    expiresAtSeconds: Math.floor(expiresAt.toMillis() / 1000),
    nonce,
  }, presenceSigningSecret());
  const challenge: PresenceChallengeDocument = {
    companyId: context.employee.companyId,
    branchId,
    createdBy: userId,
    code,
    tokenHash: hashPresenceQr(qrToken),
    nonce,
    status: "ACTIVE",
    createdAt: now,
    expiresAt,
  };
  const batch = db.batch();
  batch.create(db.doc(`presenceChallenges/${challengeId}`), challenge);
  batch.set(db.doc(`presenceCodes/${context.employee.companyId}_${code}`), { challengeId, companyId: context.employee.companyId, expiresAt });
  batch.create(db.collection("auditLogs").doc(), buildAuditLogDocument(request, context, {
    action: "PRESENCE_CHALLENGE_CREATED",
    targetType: "PRESENCE_CHALLENGE",
    targetId: challengeId,
    metadata: { branchId, expiresAt: expiresAt.toDate().toISOString() },
  }));
  await batch.commit();
  return {
    challengeId,
    qrToken,
    code,
    branch: { id: branchId, name: branch.name },
    expiresAt: expiresAt.toDate().toISOString(),
  };
});

export const verifyPresenceChallenge = onCall<PresenceVerificationInput>(presenceCallableOptions, async (request) => {
  const userId = requireUserId(request);
  const context = await loadAttendanceContext(userId);
  await enforceRateLimit(userId, "verifyPresenceChallenge", 12);
  const device = await readOwnedDevice(context, request.data?.deviceId);
  if (!device || !deviceCanCheckIn(device.status, device.isBlocked)) {
    throw new HttpsError("failed-precondition", "Thiết bị phải được duyệt trước khi xác minh hiện diện.");
  }

  const db = getFirestore();
  let challengeId = "";
  let expectedTokenHash: string | null = null;
  if (typeof request.data?.qrToken === "string" && request.data.qrToken.length <= 1600) {
    const payload = verifyPresenceQr(request.data.qrToken, presenceSigningSecret());
    if (!payload || payload.expiresAtSeconds * 1000 <= Date.now()) throw new HttpsError("failed-precondition", "Mã QR không hợp lệ hoặc đã hết hạn.");
    if (payload.companyId !== context.employee.companyId || payload.branchId !== context.branchId) {
      throw new HttpsError("permission-denied", "Mã QR không thuộc chi nhánh chấm công của bạn.");
    }
    challengeId = payload.challengeId;
    expectedTokenHash = hashPresenceQr(request.data.qrToken);
  } else if (isSixDigitPresenceCode(request.data?.code)) {
    const codeSnapshot = await db.doc(`presenceCodes/${context.employee.companyId}_${request.data.code}`).get();
    if (!codeSnapshot.exists) throw new HttpsError("not-found", "Mã hiện diện không tồn tại hoặc đã hết hạn.");
    challengeId = String(codeSnapshot.data()?.challengeId ?? "");
  } else {
    throw new HttpsError("invalid-argument", "Cần quét QR hoặc nhập mã hiện diện 6 số.");
  }

  const challengeRef = db.doc(`presenceChallenges/${challengeId}`);
  const proofId = `${challengeId}_${userId}`;
  const proofRef = db.doc(`presenceProofs/${proofId}`);
  const now = Timestamp.now();
  const proofExpiresAt = Timestamp.fromMillis(now.toMillis() + 90_000);
  await db.runTransaction(async (transaction) => {
    const [challengeSnapshot, proofSnapshot] = await Promise.all([transaction.get(challengeRef), transaction.get(proofRef)]);
    if (!challengeSnapshot.exists) throw new HttpsError("not-found", "Mã hiện diện không tồn tại.");
    const challenge = challengeSnapshot.data() as PresenceChallengeDocument;
    if (challenge.status !== "ACTIVE" || challenge.expiresAt.toMillis() <= now.toMillis()) {
      throw new HttpsError("failed-precondition", "Mã hiện diện đã hết hạn.");
    }
    if (challenge.companyId !== context.employee.companyId || challenge.branchId !== context.branchId) {
      throw new HttpsError("permission-denied", "Mã hiện diện không thuộc ca làm hiện tại.");
    }
    if (expectedTokenHash && challenge.tokenHash !== expectedTokenHash) throw new HttpsError("permission-denied", "Chữ ký QR không hợp lệ.");
    if (!expectedTokenHash && challenge.code !== request.data.code) throw new HttpsError("permission-denied", "Mã hiện diện không hợp lệ.");

    if (proofSnapshot.exists) {
      const proof = proofSnapshot.data() as PresenceProofDocument;
      if (proof.usedAt) throw new HttpsError("already-exists", "Bằng chứng hiện diện này đã được sử dụng.");
      if (proof.expiresAt.toMillis() > now.toMillis()) return;
    }
    const proof: PresenceProofDocument = {
      companyId: context.employee.companyId,
      branchId: context.branchId,
      challengeId,
      userId,
      deviceId: request.data.deviceId,
      createdAt: now,
      expiresAt: proofExpiresAt,
      usedAt: null,
      usedEventId: null,
    };
    transaction.set(proofRef, proof);
    transaction.create(db.collection("auditLogs").doc(), buildAuditLogDocument(request, context, {
      action: "PRESENCE_VERIFIED",
      targetType: "PRESENCE_PROOF",
      targetId: proofId,
      metadata: { challengeId, branchId: context.branchId },
    }));
  });
  return { proofId, branchId: context.branchId, expiresAt: proofExpiresAt.toDate().toISOString() };
});

export const startFaceSession = onCall<StartFaceSessionInput>(callableOptions, async (request) => {
  const userId = requireUserId(request);
  const context = await loadAttendanceContext(userId);
  await enforceRateLimit(userId, "startFaceSession", 8);
  const deviceId = requireDeviceId(request.data?.deviceId);
  if (!(["ENROLL", "VERIFY"] as FacePurpose[]).includes(request.data?.purpose)) {
    throw new HttpsError("invalid-argument", "Mục đích xác thực khuôn mặt không hợp lệ.");
  }
  const device = await readOwnedDevice(context, deviceId);
  if (!device || !deviceCanCheckIn(device.status, device.isBlocked)) {
    throw new HttpsError("failed-precondition", "Thiết bị phải được phê duyệt trước khi xác thực khuôn mặt.");
  }
  if (request.data.purpose === "VERIFY" && context.employee.faceEnrollmentStatus !== "APPROVED") {
    throw new HttpsError("failed-precondition", "Bạn cần đăng ký khuôn mặt trước khi xác minh.");
  }
  if (request.data.purpose === "ENROLL" && context.employee.faceEnrollmentStatus === "APPROVED") {
    throw new HttpsError("already-exists", "Khuôn mặt đã được đăng ký. Quản trị viên phải đặt lại hồ sơ trước khi đăng ký mới.");
  }

  const db = getFirestore();
  const now = Timestamp.now();
  const expiresAt = Timestamp.fromMillis(now.toMillis() + 60_000);
  const sessionId = randomUUID();
  const challenge = randomInt(0, 2) === 0 ? "TURN_LEFT" : "TURN_RIGHT";
  const session: FaceSessionDocument = {
    companyId: context.employee.companyId,
    branchId: context.branchId,
    userId,
    deviceId,
    purpose: request.data.purpose,
    challenge,
    status: "ACTIVE",
    createdAt: now,
    expiresAt,
    consentVersion: null,
    consentAcceptedAt: null,
    usedAt: null,
    outcome: null,
  };
  const batch = db.batch();
  batch.create(db.doc(`faceSessions/${sessionId}`), session);
  batch.create(db.collection("auditLogs").doc(), buildAuditLogDocument(request, context, {
    action: "FACE_SESSION_STARTED",
    targetType: "FACE_SESSION",
    targetId: sessionId,
    metadata: { purpose: request.data.purpose, challenge, deviceId },
  }));
  await batch.commit();
  return {
    sessionId,
    purpose: request.data.purpose,
    challenge,
    expiresAt: expiresAt.toDate().toISOString(),
    enrollmentStatus: context.employee.faceEnrollmentStatus,
  };
});

export const completeFaceSession = onCall<CompleteFaceSessionInput>(faceCallableOptions, async (request) => {
  const userId = requireUserId(request);
  const context = await loadAttendanceContext(userId);
  await enforceRateLimit(userId, "completeFaceSession", 8);
  const sessionId = typeof request.data?.sessionId === "string" ? request.data.sessionId.trim() : "";
  if (!/^[A-Za-z0-9_-]{20,160}$/.test(sessionId)) throw new HttpsError("invalid-argument", "Phiên xác thực khuôn mặt không hợp lệ.");
  const deviceId = requireDeviceId(request.data?.deviceId);
  const device = await readOwnedDevice(context, deviceId);
  if (!device || !deviceCanCheckIn(device.status, device.isBlocked)) {
    throw new HttpsError("failed-precondition", "Thiết bị phải được phê duyệt trước khi xác thực khuôn mặt.");
  }
  if (!validateFaceDescriptor(request.data?.descriptor)) {
    throw new HttpsError("invalid-argument", "Vector khuôn mặt phải gồm đúng 128 số hữu hạn và có chuẩn hợp lệ.");
  }
  if (request.data?.consentVersion !== FACE_CONSENT_VERSION) {
    throw new HttpsError("failed-precondition", "Cần chấp thuận phiên bản đồng ý xử lý dữ liệu sinh trắc học hiện hành.");
  }

  const db = getFirestore();
  const sessionRef = db.doc(`faceSessions/${sessionId}`);
  const profileRef = db.doc(`faceProfiles/${userId}`);
  const employeeRef = db.doc(`employees/${userId}`);
  const faceProofId = randomUUID();
  const proofRef = db.doc(`faceProofs/${faceProofId}`);
  const now = Timestamp.now();
  const expiresAt = Timestamp.fromMillis(now.toMillis() + 90_000);

  const encryptedDescriptor = encryptFaceDescriptor(request.data.descriptor, faceDataKey());
  const completion = await db.runTransaction(async (transaction) => {
    const sessionSnapshot = await transaction.get(sessionRef);
    const profileSnapshot = await transaction.get(profileRef);
    if (!sessionSnapshot.exists) throw new HttpsError("not-found", "Phiên xác thực khuôn mặt không tồn tại.");
    const session = sessionSnapshot.data() as FaceSessionDocument;
    if (
      session.userId !== userId
      || session.deviceId !== deviceId
      || session.companyId !== context.employee.companyId
      || session.branchId !== context.branchId
    ) {
      throw new HttpsError("permission-denied", "Phiên khuôn mặt không thuộc người dùng, thiết bị hoặc ca làm này.");
    }
    if (session.status !== "ACTIVE" || session.usedAt || session.expiresAt.toMillis() <= now.toMillis()) {
      throw new HttpsError("failed-precondition", "Phiên khuôn mặt đã dùng hoặc hết hạn.");
    }
    if (session.purpose === "ENROLL" && profileSnapshot.exists) {
      throw new HttpsError("already-exists", "Khuôn mặt đã được đăng ký. Quản trị viên phải đặt lại hồ sơ trước khi đăng ký mới.");
    }

    const liveness = validateFaceLivenessEvidence(request.data.evidence, session.challenge);
    let distance = 0;
    let matchScore = 1;
    let failure: "LIVENESS_FAILED" | "PROFILE_REQUIRED" | "FACE_MISMATCH" | null = null;
    if (!liveness.valid) {
      failure = "LIVENESS_FAILED";
    } else if (session.purpose === "VERIFY") {
      if (!profileSnapshot.exists) {
        failure = "PROFILE_REQUIRED";
      } else {
        let storedDescriptor: number[];
        try {
          const profile = profileSnapshot.data() as FaceProfileDocument;
          storedDescriptor = decryptFaceDescriptor({
            encryptedDescriptor: profile.encryptedDescriptor,
            descriptorIv: profile.descriptorIv,
            descriptorAuthTag: profile.descriptorAuthTag,
          }, faceDataKey());
        } catch {
          throw new HttpsError("data-loss", "Hồ sơ khuôn mặt không thể giải mã. Vui lòng liên hệ quản trị viên.");
        }
        distance = faceDescriptorDistance(request.data.descriptor, storedDescriptor);
        matchScore = faceMatchScore(distance);
        if (distance > FACE_MATCH_DISTANCE_THRESHOLD) failure = "FACE_MISMATCH";
      }
    }

    const auditRef = db.collection("auditLogs").doc();
    if (failure) {
      transaction.update(sessionRef, {
        status: "FAILED",
        usedAt: now,
        outcome: failure === "LIVENESS_FAILED" ? "LIVENESS_FAILED" : "FACE_MISMATCH",
      });
      transaction.create(auditRef, buildAuditLogDocument(request, context, {
        action: "FACE_SESSION_REJECTED",
        targetType: "FACE_SESSION",
        targetId: sessionId,
        metadata: {
          reason: failure,
          livenessReasons: liveness.reasons.join(",").slice(0, 180),
          matchScore,
        },
      }));
      return { failure, matchScore, enrolled: false };
    }

    if (session.purpose === "ENROLL") {
      const existingProfile = profileSnapshot.exists ? profileSnapshot.data() as FaceProfileDocument : null;
      const profile: FaceProfileDocument = {
        companyId: context.employee.companyId,
        userId,
        ...encryptedDescriptor,
        descriptorVersion: 1,
        consentVersion: FACE_CONSENT_VERSION,
        consentAcceptedAt: now,
        consentPurpose: session.purpose,
        enrolledAt: existingProfile?.enrolledAt ?? now,
        updatedAt: now,
        lastVerifiedAt: now,
      };
      transaction.set(profileRef, profile);
      transaction.update(employeeRef, { faceEnrollmentStatus: "APPROVED", updatedAt: now });
    } else {
      transaction.update(profileRef, { lastVerifiedAt: now, updatedAt: now });
    }

    const proof: FaceProofDocument = {
      companyId: context.employee.companyId,
      branchId: context.branchId,
      userId,
      deviceId,
      faceSessionId: sessionId,
      purpose: session.purpose,
      faceVerified: true,
      livenessVerified: true,
      matchScore,
      createdAt: now,
      expiresAt,
      usedAt: null,
      usedEventId: null,
    };
    transaction.create(proofRef, proof);
    transaction.update(sessionRef, {
      status: "COMPLETED",
      usedAt: now,
      consentVersion: FACE_CONSENT_VERSION,
      consentAcceptedAt: now,
      outcome: session.purpose === "ENROLL" ? "ENROLLED" : "VERIFIED",
    });
    transaction.create(auditRef, buildAuditLogDocument(request, context, {
      action: session.purpose === "ENROLL" ? "FACE_ENROLLED" : "FACE_VERIFIED",
      targetType: "FACE_PROOF",
      targetId: faceProofId,
      metadata: { purpose: session.purpose, matchScore, deviceId },
    }));
    return { failure: null, matchScore, enrolled: true };
  });

  if (completion.failure === "LIVENESS_FAILED") throw new HttpsError("failed-precondition", "Kiểm tra chuyển động khuôn mặt không đạt.");
  if (completion.failure === "PROFILE_REQUIRED") throw new HttpsError("failed-precondition", "Chưa có hồ sơ khuôn mặt hợp lệ. Vui lòng đăng ký lại.");
  if (completion.failure === "FACE_MISMATCH") throw new HttpsError("permission-denied", "Khuôn mặt không khớp hồ sơ đã đăng ký.");
  return {
    faceProofId,
    matchScore: completion.matchScore,
    enrolled: completion.enrolled,
    enrollmentStatus: "APPROVED" as const,
    expiresAt: expiresAt.toDate().toISOString(),
  };
});

export const getPrecheck = onCall<PrecheckInput>(callableOptions, async (request) => {
  const userId = requireUserId(request);
  const context = await loadAttendanceContext(userId);
  await enforceRateLimit(userId, "getPrecheck", 20);
  const deviceId = requireDeviceId(request.data?.deviceId);
  const device = await readOwnedDevice(context, deviceId);
  if (!device) throw new HttpsError("failed-precondition", "Thiết bị chưa được đăng ký.");

  return {
    serverTime: new Date().toISOString(),
    employee: {
      id: userId,
      name: context.employee.fullName,
      employeeCode: context.employee.employeeCode,
      faceEnrollmentStatus: context.employee.faceEnrollmentStatus,
    },
    branch: {
      id: context.branchId,
      name: context.branch.name,
      address: context.branch.address,
      latitude: context.branch.latitude,
      longitude: context.branch.longitude,
      radiusMeters: context.branch.geofenceRadiusMeters,
    },
    shift: { id: context.shiftId, name: context.shift.name, startTime: context.shift.startTime, endTime: context.shift.endTime },
    device: publicDeviceStatus(deviceId, device),
    requirements: {
      trustedDevice: true,
      location: true,
      faceVerification: true,
      liveness: true,
      presenceProof: true,
    },
  };
});

export const checkIn = onCall<AttendanceInput>(callableOptions, async (request) => {
  const userId = requireUserId(request);
  requireAttendanceInput(request.data);

  const context = await loadAttendanceContext(userId);
  await enforceRateLimit(userId, "checkIn", 5);
  const device = await readOwnedDevice(context, request.data.deviceId);
  const trustedDevice = Boolean(device && deviceCanCheckIn(device.status, device.isBlocked));
  if (!trustedDevice) {
    await writeAuditLog(request, context, {
      action: "CHECK_IN_BLOCKED_UNTRUSTED_DEVICE",
      targetType: "DEVICE",
      targetId: request.data.deviceId,
      metadata: { status: device?.status ?? "UNREGISTERED" },
    });
    throw new HttpsError("failed-precondition", "Thiết bị chưa được quản trị viên phê duyệt.");
  }
  const db = getFirestore();
  if (!request.data.presenceToken || !/^[A-Za-z0-9_-]{20,160}$/.test(request.data.presenceToken)) {
    throw new HttpsError("failed-precondition", "Bạn cần xác minh QR hiện diện trước khi chấm công.");
  }
  if (!request.data.faceSessionId || !/^[A-Za-z0-9_-]{20,160}$/.test(request.data.faceSessionId)) {
    throw new HttpsError("failed-precondition", "Bạn cần hoàn tất xác thực khuôn mặt và liveness trước khi chấm công.");
  }
  const presenceProofRef = db.doc(`presenceProofs/${request.data.presenceToken}`);
  const faceProofRef = db.doc(`faceProofs/${request.data.faceSessionId}`);
  const idempotencyRef = db.doc(`idempotencyKeys/${userId}_${request.data.idempotencyKey}`);
  const eventRef = db.collection("attendanceEvents").doc();
  const sessionRef = db.collection("workSessions").doc();
  const auditRef = db.collection("auditLogs").doc();
  const now = Timestamp.now();
  const clientDate = new Date(request.data.clientTimestamp);
  const clockDifferenceSeconds = Number.isNaN(clientDate.getTime()) ? 0 : (now.toMillis() - clientDate.getTime()) / 1000;
  const distance = distanceInMeters(request.data.location, context.branch);
  const insideGeofence = distance <= context.branch.geofenceRadiusMeters + Math.min(request.data.location.accuracy, 30);
  const risk = calculateAttendanceRisk({
    insideGeofence,
    locationAccuracy: request.data.location.accuracy,
    deviceTrusted: trustedDevice,
    faceVerified: true,
    livenessVerified: true,
    presenceVerified: true,
    offline: Boolean(request.data.offline),
    clockDifferenceSeconds,
  });

  const result = await db.runTransaction(async (transaction) => {
    const existing = await transaction.get(idempotencyRef);
    if (existing.exists) return existing.data()?.response;

    const presenceProofSnapshot = await transaction.get(presenceProofRef);
    const faceProofSnapshot = await transaction.get(faceProofRef);
    if (!presenceProofSnapshot.exists) throw new HttpsError("failed-precondition", "Bằng chứng hiện diện không tồn tại.");
    const presenceProof = presenceProofSnapshot.data() as PresenceProofDocument;
    if (presenceProof.userId !== userId || presenceProof.deviceId !== request.data.deviceId || presenceProof.companyId !== context.employee.companyId || presenceProof.branchId !== context.branchId) {
      throw new HttpsError("permission-denied", "Bằng chứng hiện diện không thuộc phiên chấm công này.");
    }
    if (presenceProof.usedAt || presenceProof.expiresAt.toMillis() <= now.toMillis()) {
      throw new HttpsError("failed-precondition", "Bằng chứng hiện diện đã dùng hoặc hết hạn.");
    }
    if (!faceProofSnapshot.exists) throw new HttpsError("failed-precondition", "Bằng chứng khuôn mặt không tồn tại.");
    const faceProof = faceProofSnapshot.data() as FaceProofDocument;
    if (
      faceProof.userId !== userId
      || faceProof.deviceId !== request.data.deviceId
      || faceProof.companyId !== context.employee.companyId
      || faceProof.branchId !== context.branchId
      || !faceProof.faceVerified
      || !faceProof.livenessVerified
    ) {
      throw new HttpsError("permission-denied", "Bằng chứng khuôn mặt không thuộc phiên chấm công này.");
    }
    if (faceProof.usedAt || faceProof.expiresAt.toMillis() <= now.toMillis()) {
      throw new HttpsError("failed-precondition", "Bằng chứng khuôn mặt đã dùng hoặc hết hạn.");
    }

    const activeSessions = await transaction.get(
      db.collection("workSessions").where("userId", "==", userId).where("status", "==", "ACTIVE").limit(1),
    );
    if (!activeSessions.empty) {
      throw new HttpsError("already-exists", "Bạn đã có một ca làm đang hoạt động.");
    }

    const attendanceStatus = risk.decision === "DENY" ? "REJECTED" : risk.decision === "REVIEW" ? "PENDING_REVIEW" : "VALID";
    const response = {
      eventId: eventRef.id,
      sessionId: sessionRef.id,
      status: attendanceStatus,
      serverTimestamp: now.toDate().toISOString(),
      distanceMeters: Math.round(distance),
      locationAccuracy: request.data.location.accuracy,
      risk,
    };

    transaction.create(eventRef, {
      companyId: context.employee.companyId,
      branchId: context.branchId,
      userId,
      shiftId: context.shiftId,
      sessionId: sessionRef.id,
      type: "CHECK_IN",
      status: attendanceStatus,
      serverTimestamp: now,
      clientTimestamp: request.data.clientTimestamp,
      location: new GeoPoint(request.data.location.latitude, request.data.location.longitude),
      latitude: request.data.location.latitude,
      longitude: request.data.location.longitude,
      locationAccuracy: request.data.location.accuracy,
      distanceToBranchMeters: distance,
      insideGeofence,
      deviceId: request.data.deviceId,
      deviceVerified: trustedDevice,
      faceProofId: request.data.faceSessionId,
      faceSessionId: faceProof.faceSessionId,
      faceVerified: true,
      livenessVerified: true,
      faceMatchScore: faceProof.matchScore,
      presenceProofId: request.data.presenceToken,
      presenceVerified: true,
      riskScore: risk.score,
      riskLevel: risk.level,
      riskReasons: risk.reasons,
      immutable: true,
    });

    transaction.create(sessionRef, {
      companyId: context.employee.companyId,
      branchId: context.branchId,
      userId,
      shiftId: context.shiftId,
      checkInEventId: eventRef.id,
      startedAt: now,
      endedAt: null,
      status: risk.decision === "DENY" ? "REJECTED" : "ACTIVE",
      lastHeartbeatAt: now,
      outsideSince: null,
      totalOutsideMinutes: 0,
      riskScore: risk.score,
    });

    transaction.create(idempotencyRef, { userId, operation: "CHECK_IN", createdAt: now, response });
    transaction.update(presenceProofRef, { usedAt: now, usedEventId: eventRef.id });
    transaction.update(faceProofRef, { usedAt: now, usedEventId: eventRef.id });
    transaction.create(auditRef, buildAuditLogDocument(request, context, {
      action: "ATTENDANCE_CHECK_IN_DECIDED",
      targetType: "ATTENDANCE_EVENT",
      targetId: eventRef.id,
      metadata: { decision: risk.decision, status: attendanceStatus },
    }));
    return response;
  });

  return result;
});

export const checkOut = onCall<AttendanceInput>(callableOptions, async (request) => {
  const userId = requireUserId(request);
  requireAttendanceInput(request.data);

  const context = await loadAttendanceContext(userId);
  await enforceRateLimit(userId, "checkOut", 5);
  const device = await readOwnedDevice(context, request.data.deviceId);
  if (!device) throw new HttpsError("failed-precondition", "Thiết bị chưa được đăng ký.");
  const db = getFirestore();
  const idempotencyRef = db.doc(`idempotencyKeys/${userId}_${request.data.idempotencyKey}`);
  const eventRef = db.collection("attendanceEvents").doc();
  const auditRef = db.collection("auditLogs").doc();
  const now = Timestamp.now();
  const distance = distanceInMeters(request.data.location, context.branch);
  const insideGeofence = distance <= context.branch.geofenceRadiusMeters + Math.min(request.data.location.accuracy, 30);

  const result = await db.runTransaction(async (transaction) => {
    const existing = await transaction.get(idempotencyRef);
    if (existing.exists) return existing.data()?.response;

    const activeSessions = await transaction.get(
      db.collection("workSessions").where("userId", "==", userId).where("status", "==", "ACTIVE").limit(1),
    );
    if (activeSessions.empty) throw new HttpsError("failed-precondition", "Không có ca làm đang hoạt động.");

    const sessionRef = activeSessions.docs[0].ref;
    const response = {
      eventId: eventRef.id,
      sessionId: sessionRef.id,
      status: insideGeofence ? "VALID" : "PENDING_REVIEW",
      serverTimestamp: now.toDate().toISOString(),
    };

    transaction.create(eventRef, {
      companyId: context.employee.companyId,
      branchId: context.branchId,
      userId,
      shiftId: context.shiftId,
      sessionId: sessionRef.id,
      type: "CHECK_OUT",
      status: insideGeofence ? "VALID" : "PENDING_REVIEW",
      serverTimestamp: now,
      clientTimestamp: request.data.clientTimestamp,
      latitude: request.data.location.latitude,
      longitude: request.data.location.longitude,
      locationAccuracy: request.data.location.accuracy,
      distanceToBranchMeters: distance,
      insideGeofence,
      deviceId: request.data.deviceId,
      immutable: true,
    });
    transaction.update(sessionRef, { status: "ENDED", endedAt: now, checkOutEventId: eventRef.id, lastHeartbeatAt: now });
    transaction.create(idempotencyRef, { userId, operation: "CHECK_OUT", createdAt: now, response });
    transaction.create(auditRef, buildAuditLogDocument(request, context, {
      action: "ATTENDANCE_CHECK_OUT_RECORDED",
      targetType: "ATTENDANCE_EVENT",
      targetId: eventRef.id,
      metadata: { status: response.status },
    }));
    return response;
  });

  return result;
});

export const sendLocationHeartbeat = onCall<{ sessionId: string; location: LocationInput }>(callableOptions, async (request) => {
  const userId = requireUserId(request);
  if (!request.data?.sessionId || !request.data?.location) throw new HttpsError("invalid-argument", "Thiếu dữ liệu heartbeat.");

  const db = getFirestore();
  const sessionRef = db.doc(`workSessions/${request.data.sessionId}`);
  const sessionSnapshot = await sessionRef.get();
  if (!sessionSnapshot.exists || sessionSnapshot.data()?.userId !== userId || sessionSnapshot.data()?.status !== "ACTIVE") {
    throw new HttpsError("permission-denied", "Phiên làm việc không hợp lệ.");
  }

  const context = await loadAttendanceContext(userId);
  await enforceRateLimit(userId, "sendLocationHeartbeat", 30);
  const distance = distanceInMeters(request.data.location, context.branch);
  const insideGeofence = distance <= context.branch.exitRadiusMeters + Math.min(request.data.location.accuracy, 30);
  const now = Timestamp.now();
  const heartbeatRef = db.collection("locationHeartbeats").doc();

  const batch = db.batch();
  batch.create(heartbeatRef, {
    companyId: context.employee.companyId,
    branchId: context.branchId,
    userId,
    sessionId: request.data.sessionId,
    ...request.data.location,
    distanceToBranchMeters: distance,
    insideGeofence,
    createdAt: now,
  });
  batch.update(sessionRef, { lastHeartbeatAt: now, lastDistanceMeters: distance, insideGeofence });
  await batch.commit();

  return { insideGeofence, distanceMeters: Math.round(distance), receivedAt: now.toDate().toISOString() };
});
