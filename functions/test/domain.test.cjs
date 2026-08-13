const assert = require("node:assert/strict");
const test = require("node:test");
const { distanceInMeters } = require("../lib/domain/geo.js");
const { calculateAttendanceRisk } = require("../lib/domain/risk.js");
const { deviceCanCheckIn, isValidDeviceId, sanitizeDeviceLabel } = require("../lib/domain/device.js");
const { createPresenceNonce, hashPresenceQr, isSixDigitPresenceCode, signPresenceQr, verifyPresenceQr } = require("../lib/domain/presence.js");
const {
  decryptFaceDescriptor,
  encryptFaceDescriptor,
  faceDescriptorDistance,
  faceMatchScore,
  validateFaceDescriptor,
  validateFaceLivenessEvidence,
} = require("../lib/domain/face.js");
const {
  canManageWorkforceRole,
  dateRangesOverlap,
  generateTemporaryPassword,
  isIsoDateOnly,
  isStrongPassword,
  normalizeEmployeeCode,
  normalizeEmployeeEmail,
} = require("../lib/domain/workforce.js");
const {
  isFaceEnforcementMode,
  isSafeFaceMatchThreshold,
  isValidFaceRetentionDays,
  normalizePilotRollout,
  retentionExpiryMillis,
  resolveEffectiveFacePolicy,
  safeFaceTelemetry,
} = require("../lib/domain/pilot.js");
const { boundedPage, decodeAttendanceReportCursor, encodeAttendanceReportCursor, zonedDateBoundaryUtc } = require("../lib/domain/report.js");

test("distance is zero for the same coordinate", () => {
  assert.equal(distanceInMeters({ latitude: 16.0678, longitude: 108.1895 }, { latitude: 16.0678, longitude: 108.1895 }), 0);
});

test("clean attendance evidence is allowed", () => {
  const result = calculateAttendanceRisk({
    insideGeofence: true,
    locationAccuracy: 9,
    deviceTrusted: true,
    faceVerified: true,
    livenessVerified: true,
    presenceVerified: true,
    offline: false,
    clockDifferenceSeconds: 2,
  });
  assert.equal(result.score, 0);
  assert.equal(result.decision, "ALLOW");
});

test("outside and spoof-like evidence is rejected", () => {
  const result = calculateAttendanceRisk({
    insideGeofence: false,
    locationAccuracy: 120,
    deviceTrusted: false,
    faceVerified: false,
    livenessVerified: false,
    presenceVerified: false,
    offline: true,
    clockDifferenceSeconds: 800,
  });
  assert.equal(result.score, 100);
  assert.equal(result.decision, "DENY");
  assert.ok(result.reasons.includes("OUTSIDE_GEOFENCE"));
});

test("device ids and labels are sanitized before registration", () => {
  assert.equal(isValidDeviceId("d6f91fe4-54e0-4dc7-b4b0-6d9e86ed1f19"), true);
  assert.equal(isValidDeviceId("short"), false);
  assert.equal(sanitizeDeviceLabel("  Chrome    Android  "), "Chrome Android");
});

test("only approved and unblocked devices can check in", () => {
  assert.equal(deviceCanCheckIn("PENDING", false), false);
  assert.equal(deviceCanCheckIn("TRUSTED", false), true);
  assert.equal(deviceCanCheckIn("TRUSTED", true), false);
  assert.equal(deviceCanCheckIn("BLOCKED", true), false);
});

test("presence QR signatures reject tampering", () => {
  const secret = "a-secure-test-secret-that-is-longer-than-32-chars";
  const payload = {
    version: 1,
    challengeId: "dbbd8e70-e216-4a33-8de1-318432038eef",
    companyId: "fastdo_demo",
    branchId: "aura_thanh_khe",
    expiresAtSeconds: Math.floor(Date.now() / 1000) + 45,
    nonce: createPresenceNonce(),
  };
  const token = signPresenceQr(payload, secret);
  assert.deepEqual(verifyPresenceQr(token, secret), payload);
  assert.equal(verifyPresenceQr(`${token}tampered`, secret), null);
  assert.equal(hashPresenceQr(token).length, 64);
});

test("presence fallback codes require exactly six digits", () => {
  assert.equal(isSixDigitPresenceCode("829104"), true);
  assert.equal(isSixDigitPresenceCode("82910"), false);
  assert.equal(isSixDigitPresenceCode("82A104"), false);
});

test("face descriptors require 128 finite values with a sane norm", () => {
  const descriptor = Array.from({ length: 128 }, (_, index) => index === 0 ? 1 : 0);
  assert.equal(validateFaceDescriptor(descriptor), true);
  assert.equal(validateFaceDescriptor(descriptor.slice(0, 127)), false);
  assert.equal(validateFaceDescriptor(Array(128).fill(0)), false);
  assert.equal(validateFaceDescriptor([...descriptor.slice(0, 127), Number.NaN]), false);
});

test("face distance and score enforce the 0.55 matching boundary", () => {
  const enrolled = Array(128).fill(0);
  enrolled[0] = 1;
  const close = [...enrolled];
  close[1] = 0.5;
  const far = [...enrolled];
  far[1] = 0.6;
  assert.ok(faceDescriptorDistance(enrolled, close) <= 0.55);
  assert.ok(faceDescriptorDistance(enrolled, far) > 0.55);
  assert.equal(faceMatchScore(0.2), 0.8);
});

test("face liveness validates the server challenge and evidence thresholds", () => {
  const valid = { challenge: "TURN_LEFT", durationMs: 1600, motionScore: 0.42, faceFrames: 20, neutralFrames: 8 };
  assert.deepEqual(validateFaceLivenessEvidence(valid, "TURN_LEFT"), { valid: true, reasons: [] });
  const wrongChallenge = validateFaceLivenessEvidence({ ...valid, challenge: "TURN_RIGHT" }, "TURN_LEFT");
  assert.equal(wrongChallenge.valid, false);
  assert.ok(wrongChallenge.reasons.includes("CHALLENGE_MISMATCH"));
  assert.equal(validateFaceLivenessEvidence({ ...valid, motionScore: 0.01 }, "TURN_LEFT").valid, false);
});

test("face descriptors are encrypted with authenticated AES-256-GCM", () => {
  const descriptor = Array.from({ length: 128 }, (_, index) => index === 0 ? 1 : index / 10_000);
  const key = Buffer.alloc(32, 7).toString("base64");
  const encrypted = encryptFaceDescriptor(descriptor, key);
  assert.deepEqual(decryptFaceDescriptor(encrypted, key), descriptor);
  const tampered = { ...encrypted, encryptedDescriptor: `${encrypted.encryptedDescriptor.slice(0, -2)}AA` };
  assert.throws(() => decryptFaceDescriptor(tampered, key));
});

test("workforce input helpers normalize identifiers and generate strong temporary passwords", () => {
  assert.equal(normalizeEmployeeEmail("  USER@Example.COM "), "user@example.com");
  assert.equal(normalizeEmployeeEmail("invalid"), "");
  assert.equal(normalizeEmployeeCode(" fd-0238 "), "FD-0238");
  assert.equal(isIsoDateOnly("2026-08-13"), true);
  assert.equal(isIsoDateOnly("2026-02-30"), false);
  const password = generateTemporaryPassword();
  assert.ok(password.length >= 12);
  assert.match(password, /[A-Z]/);
  assert.match(password, /[a-z]/);
  assert.match(password, /\d/);
  assert.match(password, /[^A-Za-z0-9]/);
  assert.equal(isStrongPassword(password), true);
  assert.equal(isStrongPassword("not-strong"), false);
  assert.equal(dateRangesOverlap(10, 20, 20, 30), true);
  assert.equal(dateRangesOverlap(10, 19, 20, 30), false);
  assert.equal(canManageWorkforceRole("MANAGER", "EMPLOYEE"), true);
  assert.equal(canManageWorkforceRole("MANAGER", "HR"), false);
  assert.equal(canManageWorkforceRole("HR", "COMPANY_ADMIN"), false);
  assert.equal(canManageWorkforceRole("COMPANY_ADMIN", "SUPER_ADMIN"), false);
});

test("pilot policy validates security and retention boundaries", () => {
  assert.equal(isFaceEnforcementMode("OFF"), true);
  assert.equal(isFaceEnforcementMode("OPTIONAL"), false);
  assert.equal(isSafeFaceMatchThreshold(0.35), true);
  assert.equal(isSafeFaceMatchThreshold(0.65), true);
  assert.equal(isSafeFaceMatchThreshold(0.651), false);
  assert.equal(isValidFaceRetentionDays(1), true);
  assert.equal(isValidFaceRetentionDays(365), true);
  assert.equal(isValidFaceRetentionDays(0), false);
  assert.equal(isValidFaceRetentionDays(12.5), false);
  assert.deepEqual(normalizePilotRollout({
    label: "  Pilot   Da Nang ", cohortPercent: 25,
    startsAt: "2026-08-13T00:00:00+07:00", endsAt: null, notes: " safe metadata ",
  }), {
    label: "Pilot Da Nang", cohortPercent: 25,
    startsAt: "2026-08-12T17:00:00.000Z", endsAt: null, notes: "safe metadata",
  });
  assert.equal(normalizePilotRollout({ label: "Bad", cohortPercent: 0 }), null);
});

test("rollout policy is deterministic and respects windows and cohorts", () => {
  const base = {
    enforcementMode: "REQUIRED",
    cohortPercent: 50,
    startsAtMillis: 1_000,
    endsAtMillis: 5_000,
    identity: "company:branch:user-1",
  };
  const first = resolveEffectiveFacePolicy({ ...base, nowMillis: 2_000 });
  const second = resolveEffectiveFacePolicy({ ...base, nowMillis: 2_000 });
  assert.deepEqual(first, second);
  assert.equal(first.effectiveEnforcementMode, first.inCohort ? "REQUIRED" : "MONITOR");
  assert.equal(resolveEffectiveFacePolicy({ ...base, nowMillis: 999 }).effectiveEnforcementMode, "MONITOR");
  assert.equal(resolveEffectiveFacePolicy({ ...base, enforcementMode: "MONITOR", nowMillis: 999 }).effectiveEnforcementMode, "OFF");
  assert.equal(resolveEffectiveFacePolicy({ ...base, enforcementMode: "OFF", nowMillis: 2_000 }).effectiveEnforcementMode, "OFF");
});

test("face telemetry schema cannot carry biometric payloads or tokens", () => {
  const telemetry = safeFaceTelemetry({
    companyId: "company", branchId: "branch", eventType: "SESSION_COMPLETED",
    purpose: "VERIFY", enforcementMode: "MONITOR", outcome: "VERIFIED",
    matchScore: 0.812345, threshold: 0.55, livenessPassed: true,
  });
  assert.equal(telemetry.matchScore, 0.8123);
  assert.deepEqual(Object.keys(telemetry).sort(), [
    "branchId", "companyId", "enforcementMode", "eventType", "livenessPassed",
    "matchScore", "outcome", "purpose", "threshold",
  ]);
  assert.equal("descriptor" in telemetry, false);
  assert.equal("token" in telemetry, false);
});

test("report boundaries use branch timezone rather than UTC calendar days", () => {
  assert.equal(zonedDateBoundaryUtc("2026-08-13", "Asia/Ho_Chi_Minh").toISOString(), "2026-08-12T17:00:00.000Z");
  assert.equal(zonedDateBoundaryUtc("2026-08-13", "Asia/Ho_Chi_Minh", true).toISOString(), "2026-08-13T16:59:59.999Z");
});

test("bounded report pages expose truncation without claiming a global total", () => {
  assert.deepEqual(boundedPage([1, 2, 3], 2), { rows: [1, 2], hasMore: true });
  assert.deepEqual(boundedPage([1, 2], 2), { rows: [1, 2], hasMore: false });
  assert.throws(() => boundedPage([1], 0));
});

test("report cursors round-trip and reject malformed client input", () => {
  const encoded = encodeAttendanceReportCursor({ timestamp: Date.UTC(2026, 7, 13, 3), documentId: "attendanceEvent_123" });
  assert.deepEqual(decodeAttendanceReportCursor(encoded), { timestamp: Date.UTC(2026, 7, 13, 3), documentId: "attendanceEvent_123" });
  assert.equal(decodeAttendanceReportCursor(undefined), null);
  assert.throws(() => decodeAttendanceReportCursor("not-a-cursor"));
  assert.throws(() => decodeAttendanceReportCursor(42));
});

test("retention backfill only adds or shortens expiry and never extends it", () => {
  const day = 24 * 60 * 60 * 1000;
  const enrolledAt = Date.UTC(2026, 7, 1);
  assert.equal(retentionExpiryMillis(enrolledAt, 90), enrolledAt + 90 * day);
  assert.equal(retentionExpiryMillis(enrolledAt, 30, enrolledAt + 90 * day), enrolledAt + 30 * day);
  assert.equal(retentionExpiryMillis(enrolledAt, 365, enrolledAt + 90 * day), enrolledAt + 90 * day);
  assert.throws(() => retentionExpiryMillis(enrolledAt, 0));
});
