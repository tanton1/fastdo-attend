import { initializeApp } from "firebase-admin/app";
import { randomInt, randomUUID } from "node:crypto";
import { GeoPoint, Timestamp, getFirestore } from "firebase-admin/firestore";
import { HttpsError, onCall } from "firebase-functions/v2/https";
import { setGlobalOptions } from "firebase-functions/v2/options";
import { distanceInMeters } from "./domain/geo";
import { calculateAttendanceRisk } from "./domain/risk";
import { deviceCanCheckIn, sanitizePlatform } from "./domain/device";
import { createPresenceNonce, hashPresenceQr, isSixDigitPresenceCode, signPresenceQr, verifyPresenceQr } from "./domain/presence";
import type { BranchDocument, DeviceDocument, DeviceStatus, EmployeeDocument, PresenceChallengeDocument, PresenceProofDocument } from "./domain/types";
import { buildAuditLogDocument, writeAuditLog } from "./services/audit";
import { MANAGER_ROLES, loadAttendanceContext, loadEmployeeContext, loadManagerContext, requireUserId } from "./services/context";
import { publicDeviceStatus, readOwnedDevice, registerOrTouchDevice, requireDeviceId } from "./services/devices";
import type { DeviceRegistrationInput } from "./services/devices";
import { enforceRateLimit } from "./services/rate-limit";

initializeApp();
setGlobalOptions({ region: "asia-southeast1", maxInstances: 10, memory: "256MiB", timeoutSeconds: 30 });

const callableOptions = { enforceAppCheck: process.env.FUNCTIONS_EMULATOR !== "true" } as const;
const presenceCallableOptions = { ...callableOptions, secrets: ["PRESENCE_SIGNING_KEY"] };

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

function presenceSigningSecret(): string {
  const secret = process.env.PRESENCE_SIGNING_KEY;
  if (!secret || secret.length < 32) throw new HttpsError("internal", "Khóa ký QR hiện diện chưa được cấu hình.");
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

export const getMyProfile = onCall(callableOptions, async (request) => {
  const userId = requireUserId(request);
  const context = await loadEmployeeContext(userId);
  await enforceRateLimit(userId, "getMyProfile", 30);
  return {
    uid: userId,
    fullName: context.employee.fullName,
    employeeCode: context.employee.employeeCode,
    email: context.employee.email,
    role: context.employee.role,
    companyId: context.employee.companyId,
    canManageDevices: MANAGER_ROLES.includes(context.employee.role),
  };
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

export const getPrecheck = onCall<PrecheckInput>(callableOptions, async (request) => {
  const userId = requireUserId(request);
  const context = await loadAttendanceContext(userId);
  await enforceRateLimit(userId, "getPrecheck", 20);
  const deviceId = requireDeviceId(request.data?.deviceId);
  const device = await readOwnedDevice(context, deviceId);
  if (!device) throw new HttpsError("failed-precondition", "Thiết bị chưa được đăng ký.");

  return {
    serverTime: new Date().toISOString(),
    employee: { id: userId, name: context.employee.fullName, employeeCode: context.employee.employeeCode },
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
      faceVerification: false,
      liveness: false,
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
  const presenceProofRef = db.doc(`presenceProofs/${request.data.presenceToken}`);
  const idempotencyRef = db.doc(`idempotencyKeys/${userId}_${request.data.idempotencyKey}`);
  const eventRef = db.collection("attendanceEvents").doc();
  const sessionRef = db.collection("workSessions").doc();
  const auditRef = db.collection("auditLogs").doc();
  const now = Timestamp.now();
  const clientDate = new Date(request.data.clientTimestamp);
  const clockDifferenceSeconds = Number.isNaN(clientDate.getTime()) ? 0 : (now.toMillis() - clientDate.getTime()) / 1000;
  const distance = distanceInMeters(request.data.location, context.branch);
  const insideGeofence = distance <= context.branch.geofenceRadiusMeters + Math.min(request.data.location.accuracy, 30);
  // Face/liveness/presence become required once their providers are connected.
  // Until then, missing optional signals must not create a false fraud score.
  const activePolicy = { faceVerification: false, liveness: false, presenceProof: true };

  const risk = calculateAttendanceRisk({
    insideGeofence,
    locationAccuracy: request.data.location.accuracy,
    deviceTrusted: trustedDevice,
    faceVerified: !activePolicy.faceVerification || Boolean(request.data.faceSessionId),
    livenessVerified: !activePolicy.liveness || Boolean(request.data.faceSessionId),
    presenceVerified: true,
    offline: Boolean(request.data.offline),
    clockDifferenceSeconds,
  });

  const result = await db.runTransaction(async (transaction) => {
    const existing = await transaction.get(idempotencyRef);
    if (existing.exists) return existing.data()?.response;

    const presenceProofSnapshot = await transaction.get(presenceProofRef);
    if (!presenceProofSnapshot.exists) throw new HttpsError("failed-precondition", "Bằng chứng hiện diện không tồn tại.");
    const presenceProof = presenceProofSnapshot.data() as PresenceProofDocument;
    if (presenceProof.userId !== userId || presenceProof.deviceId !== request.data.deviceId || presenceProof.companyId !== context.employee.companyId || presenceProof.branchId !== context.branchId) {
      throw new HttpsError("permission-denied", "Bằng chứng hiện diện không thuộc phiên chấm công này.");
    }
    if (presenceProof.usedAt || presenceProof.expiresAt.toMillis() <= now.toMillis()) {
      throw new HttpsError("failed-precondition", "Bằng chứng hiện diện đã dùng hoặc hết hạn.");
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
      faceSessionId: request.data.faceSessionId ?? null,
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
