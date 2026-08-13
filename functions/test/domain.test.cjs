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
