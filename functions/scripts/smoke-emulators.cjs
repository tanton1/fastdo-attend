const { initializeApp } = require("firebase-admin/app");
const { getAuth } = require("firebase-admin/auth");
const { getFirestore, Timestamp } = require("firebase-admin/firestore");

const projectId = process.env.GCLOUD_PROJECT || "fastdo-attend-2026";
const email = "fd0238@fastdo.attend";
const password = "fastdo2026";
const userId = "demo_hai_au";

initializeApp({ projectId });

async function seed() {
  const auth = getAuth();
  try {
    await auth.createUser({ uid: userId, email, password, emailVerified: true, displayName: "Hải Âu" });
  } catch (error) {
    if (error.code !== "auth/uid-already-exists" && error.code !== "auth/email-already-exists") throw error;
  }

  const db = getFirestore();
  const batch = db.batch();
  batch.set(db.doc("companies/fastdo_demo"), {
    name: "FASTDO Demo",
    code: "FASTDO",
    timezone: "Asia/Ho_Chi_Minh",
    status: "ACTIVE",
  });
  batch.set(db.doc("branches/aura_thanh_khe"), {
    companyId: "fastdo_demo",
    name: "Aura Thanh Khê",
    address: "276 Thái Thị Bôi, Đà Nẵng",
    latitude: 16.0678,
    longitude: 108.1895,
    geofenceRadiusMeters: 50,
    exitRadiusMeters: 100,
    timezone: "Asia/Ho_Chi_Minh",
    presenceMode: "GPS_QR_WIFI_GATEWAY",
    allowedWifiSsids: ["Aura Staff"],
    isActive: true,
  });
  batch.set(db.doc("shifts/shift_office"), {
    companyId: "fastdo_demo",
    branchId: "aura_thanh_khe",
    name: "Ca hành chính",
    startTime: "08:00",
    endTime: "17:00",
    allowedEarlyMinutes: 30,
    lateAfterMinutes: 5,
    isActive: true,
  });
  batch.set(db.doc(`employees/${userId}`), {
    companyId: "fastdo_demo",
    employeeCode: "FD0238",
    fullName: "Hải Âu",
    email,
    role: "EMPLOYEE",
    branchIds: ["aura_thanh_khe"],
    status: "ACTIVE",
    faceEnrollmentStatus: "NOT_STARTED",
  });
  batch.set(db.doc("shiftAssignments/assignment_hai_au_2026"), {
    companyId: "fastdo_demo",
    userId,
    shiftId: "shift_office",
    branchId: "aura_thanh_khe",
    startDate: Timestamp.fromDate(new Date("2026-01-01T00:00:00.000Z")),
    endDate: Timestamp.fromDate(new Date("2027-01-01T00:00:00.000Z")),
  });
  batch.set(db.doc("devices/emulator_device"), {
    companyId: "fastdo_demo",
    userId,
    status: "TRUSTED",
    isBlocked: false,
  });
  await batch.commit();
}

async function signIn() {
  const host = process.env.FIREBASE_AUTH_EMULATOR_HOST || "127.0.0.1:9099";
  const response = await fetch(`http://${host}/identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=demo-key`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email, password, returnSecureToken: true }),
  });
  const payload = await response.json();
  if (!response.ok) throw new Error(`Auth emulator login failed: ${JSON.stringify(payload)}`);
  return payload.idToken;
}

async function callFunction(name, idToken, data) {
  const host = process.env.FUNCTIONS_EMULATOR_HOST || "127.0.0.1:5001";
  const response = await fetch(`http://${host}/${projectId}/asia-southeast1/${name}`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${idToken}`,
    },
    body: JSON.stringify({ data }),
  });
  const payload = await response.json();
  if (!response.ok || payload.error) throw new Error(`${name} failed: ${JSON.stringify(payload)}`);
  return payload.result;
}

async function main() {
  await seed();
  const idToken = await signIn();
  const precheck = await callFunction("getPrecheck", idToken, {});
  if (precheck.branch.id !== "aura_thanh_khe") throw new Error("Precheck returned the wrong branch.");

  const evidence = {
    idempotencyKey: "emulator-check-in-001",
    deviceId: "emulator_device",
    clientTimestamp: new Date().toISOString(),
    location: { latitude: 16.06788, longitude: 108.18958, accuracy: 9 },
  };
  const checkIn = await callFunction("checkIn", idToken, evidence);
  if (checkIn.status !== "VALID" || checkIn.risk.score !== 0) throw new Error("Check-in was not accepted as low risk.");

  const checkOut = await callFunction("checkOut", idToken, {
    ...evidence,
    idempotencyKey: "emulator-check-out-001",
  });
  if (checkOut.status !== "VALID") throw new Error("Check-out was not accepted.");

  console.log("Emulator E2E OK: auth -> precheck -> check-in -> check-out.");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
