const assert = require("node:assert/strict");
const test = require("node:test");
const { distanceInMeters } = require("../lib/domain/geo.js");
const { calculateAttendanceRisk } = require("../lib/domain/risk.js");

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
