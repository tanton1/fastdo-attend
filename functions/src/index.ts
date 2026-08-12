import { initializeApp } from "firebase-admin/app";
import { GeoPoint, Timestamp, getFirestore } from "firebase-admin/firestore";
import { HttpsError, onCall } from "firebase-functions/v2/https";
import { setGlobalOptions } from "firebase-functions/v2/options";
import { distanceInMeters } from "./domain/geo";
import { calculateAttendanceRisk } from "./domain/risk";
import { loadAttendanceContext, requireUserId } from "./services/context";

initializeApp();
setGlobalOptions({ region: "asia-southeast1", maxInstances: 10, memory: "256MiB", timeoutSeconds: 30 });

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

async function deviceIsTrusted(userId: string, companyId: string, deviceId: string): Promise<boolean> {
  const snapshot = await getFirestore().doc(`devices/${deviceId}`).get();
  if (!snapshot.exists) return false;
  const data = snapshot.data();
  return data?.userId === userId && data?.companyId === companyId && data?.status === "TRUSTED" && data?.isBlocked !== true;
}

export const getPrecheck = onCall(async (request) => {
  const userId = requireUserId(request);
  const context = await loadAttendanceContext(userId);

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
    requirements: {
      trustedDevice: true,
      location: true,
      faceVerification: false,
      liveness: false,
      presenceProof: false,
    },
  };
});

export const checkIn = onCall<AttendanceInput>(async (request) => {
  const userId = requireUserId(request);
  requireAttendanceInput(request.data);

  const context = await loadAttendanceContext(userId);
  const db = getFirestore();
  const idempotencyRef = db.doc(`idempotencyKeys/${userId}_${request.data.idempotencyKey}`);
  const eventRef = db.collection("attendanceEvents").doc();
  const sessionRef = db.collection("workSessions").doc();
  const now = Timestamp.now();
  const clientDate = new Date(request.data.clientTimestamp);
  const clockDifferenceSeconds = Number.isNaN(clientDate.getTime()) ? 0 : (now.toMillis() - clientDate.getTime()) / 1000;
  const distance = distanceInMeters(request.data.location, context.branch);
  const insideGeofence = distance <= context.branch.geofenceRadiusMeters + Math.min(request.data.location.accuracy, 30);
  const trustedDevice = await deviceIsTrusted(userId, context.employee.companyId, request.data.deviceId);
  // Face/liveness/presence become required once their providers are connected.
  // Until then, missing optional signals must not create a false fraud score.
  const activePolicy = { faceVerification: false, liveness: false, presenceProof: false };

  const risk = calculateAttendanceRisk({
    insideGeofence,
    locationAccuracy: request.data.location.accuracy,
    deviceTrusted: trustedDevice,
    faceVerified: !activePolicy.faceVerification || Boolean(request.data.faceSessionId),
    livenessVerified: !activePolicy.liveness || Boolean(request.data.faceSessionId),
    presenceVerified: !activePolicy.presenceProof || Boolean(request.data.presenceToken),
    offline: Boolean(request.data.offline),
    clockDifferenceSeconds,
  });

  const result = await db.runTransaction(async (transaction) => {
    const existing = await transaction.get(idempotencyRef);
    if (existing.exists) return existing.data()?.response;

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
      presenceVerified: Boolean(request.data.presenceToken),
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
    return response;
  });

  return result;
});

export const checkOut = onCall<AttendanceInput>(async (request) => {
  const userId = requireUserId(request);
  requireAttendanceInput(request.data);

  const context = await loadAttendanceContext(userId);
  const db = getFirestore();
  const idempotencyRef = db.doc(`idempotencyKeys/${userId}_${request.data.idempotencyKey}`);
  const eventRef = db.collection("attendanceEvents").doc();
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
    return response;
  });

  return result;
});

export const sendLocationHeartbeat = onCall<{ sessionId: string; location: LocationInput }>(async (request) => {
  const userId = requireUserId(request);
  if (!request.data?.sessionId || !request.data?.location) throw new HttpsError("invalid-argument", "Thiếu dữ liệu heartbeat.");

  const db = getFirestore();
  const sessionRef = db.doc(`workSessions/${request.data.sessionId}`);
  const sessionSnapshot = await sessionRef.get();
  if (!sessionSnapshot.exists || sessionSnapshot.data()?.userId !== userId || sessionSnapshot.data()?.status !== "ACTIVE") {
    throw new HttpsError("permission-denied", "Phiên làm việc không hợp lệ.");
  }

  const context = await loadAttendanceContext(userId);
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
