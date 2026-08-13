const assert = require("node:assert/strict");
const test = require("node:test");
const { distanceInMeters } = require("../lib/domain/geo.js");
const { calculateAttendanceRisk } = require("../lib/domain/risk.js");
const { deviceCanCheckIn, isValidDeviceId, sanitizeDeviceLabel } = require("../lib/domain/device.js");
const { createPresenceNonce, hashPresenceQr, isSixDigitPresenceCode, signPresenceQr, verifyPresenceQr } = require("../lib/domain/presence.js");

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
