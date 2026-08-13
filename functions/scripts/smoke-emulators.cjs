const { initializeApp } = require("firebase-admin/app");
const { getAuth } = require("firebase-admin/auth");
const { getFirestore, Timestamp } = require("firebase-admin/firestore");

const projectId = process.env.GCLOUD_PROJECT || "fastdo-attend-2026";
const companyId = "fastdo_demo";
const branchId = "aura_thanh_khe";
const shiftId = "shift_office";
const employeeId = "demo_hai_au";
const managerId = "demo_manager";
const employeeEmail = "fd0238@fastdo.attend";
const managerEmail = "admin@fastdo.attend";
const password = "fastdo2026";
const deviceId = "emulator_device";
const presenceToken = "emulator_presence_proof_001";

initializeApp({ projectId });

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function dateOnly(offsetDays = 0) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Ho_Chi_Minh",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date(Date.now() + offsetDays * 24 * 60 * 60 * 1000));
  const values = Object.fromEntries(parts.map(({ type, value }) => [type, value]));
  return `${values.year}-${values.month}-${values.day}`;
}

function pilotPolicyDocumentId() {
  return Buffer.from(`${companyId}\u0000${branchId}`, "utf8").toString("base64url");
}

async function ensureAuthUser(auth, input) {
  try {
    await auth.createUser(input);
  } catch (error) {
    if (error.code !== "auth/uid-already-exists" && error.code !== "auth/email-already-exists") throw error;
    await auth.updateUser(input.uid, {
      email: input.email,
      password: input.password,
      emailVerified: true,
      displayName: input.displayName,
    });
  }
}

async function seed() {
  const auth = getAuth();
  await ensureAuthUser(auth, {
    uid: employeeId,
    email: employeeEmail,
    password,
    emailVerified: true,
    displayName: "Hai Au",
  });
  await ensureAuthUser(auth, {
    uid: managerId,
    email: managerEmail,
    password,
    emailVerified: true,
    displayName: "Demo Manager",
  });

  const db = getFirestore();
  const now = Timestamp.now();
  const batch = db.batch();
  batch.set(db.doc(`companies/${companyId}`), {
    name: "FASTDO Demo",
    code: "FASTDO",
    timezone: "Asia/Ho_Chi_Minh",
    status: "ACTIVE",
  });
  batch.set(db.doc(`branches/${branchId}`), {
    companyId,
    name: "Aura Thanh Khe",
    address: "276 Thai Thi Boi, Da Nang",
    latitude: 16.0678,
    longitude: 108.1895,
    geofenceRadiusMeters: 50,
    exitRadiusMeters: 100,
    timezone: "Asia/Ho_Chi_Minh",
    presenceMode: "GPS_QR_WIFI_GATEWAY",
    allowedWifiSsids: ["Aura Staff"],
    isActive: true,
  });
  batch.set(db.doc(`shifts/${shiftId}`), {
    companyId,
    branchId,
    name: "Ca hanh chinh",
    startTime: "08:00",
    endTime: "17:00",
    allowedEarlyMinutes: 30,
    lateAfterMinutes: 5,
    isActive: true,
  });
  batch.set(db.doc(`employees/${employeeId}`), {
    companyId,
    employeeCode: "FD0238",
    fullName: "Hai Au",
    email: employeeEmail,
    role: "EMPLOYEE",
    branchIds: [branchId],
    status: "ACTIVE",
    faceEnrollmentStatus: "NOT_STARTED",
    mustChangePassword: false,
  });
  batch.set(db.doc(`employees/${managerId}`), {
    companyId,
    employeeCode: "FD0001",
    fullName: "Demo Manager",
    email: managerEmail,
    role: "COMPANY_ADMIN",
    branchIds: [branchId],
    status: "ACTIVE",
    faceEnrollmentStatus: "NOT_STARTED",
    mustChangePassword: false,
  });
  batch.set(db.doc("shiftAssignments/assignment_hai_au_emulator"), {
    companyId,
    userId: employeeId,
    shiftId,
    branchId,
    startDate: Timestamp.fromMillis(Date.now() - 24 * 60 * 60 * 1000),
    endDate: Timestamp.fromMillis(Date.now() + 365 * 24 * 60 * 60 * 1000),
  });
  batch.set(db.doc(`devices/${deviceId}`), {
    companyId,
    userId: employeeId,
    label: "Emulator device",
    platform: "WEB",
    status: "TRUSTED",
    isBlocked: false,
    createdAt: now,
    updatedAt: now,
    lastSeenAt: now,
    reviewedAt: now,
    reviewedBy: managerId,
  });
  batch.set(db.doc(`pilotPolicies/${pilotPolicyDocumentId()}`), {
    companyId,
    branchId,
    enforcementMode: "OFF",
    faceMatchThreshold: 0.62,
    retentionDays: 30,
    rollout: {
      label: "Emulator smoke",
      cohortPercent: 100,
      startsAt: null,
      endsAt: null,
      notes: "Face is intentionally OFF for deterministic backend smoke testing.",
    },
    version: 1,
    updatedAt: now,
    updatedBy: managerId,
  });
  batch.set(db.doc(`presenceProofs/${presenceToken}`), {
    companyId,
    branchId,
    challengeId: "emulator_presence_challenge_001",
    userId: employeeId,
    deviceId,
    createdAt: now,
    expiresAt: Timestamp.fromMillis(Date.now() + 5 * 60 * 1000),
    usedAt: null,
    usedEventId: null,
  });
  await batch.commit();
}

async function signIn(email) {
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
  const employeeToken = await signIn(employeeEmail);
  const managerToken = await signIn(managerEmail);

  const precheck = await callFunction("getPrecheck", employeeToken, { deviceId });
  assert(precheck.branch.id === branchId, "Precheck returned the wrong branch.");
  assert(precheck.device.trusted === true, "Precheck did not return a trusted device.");
  assert(precheck.requirements.faceVerification === false, "Smoke policy must disable Face enforcement.");

  const clientTimestamp = new Date().toISOString();
  const checkInEvidence = {
    idempotencyKey: "emulator-check-in-001",
    deviceId,
    presenceToken,
    clientTimestamp,
    location: { latitude: 16.06788, longitude: 108.18958, accuracy: 9 },
  };
  const checkIn = await callFunction("checkIn", employeeToken, checkInEvidence);
  assert(checkIn.status === "VALID" && checkIn.risk.score === 0, "Check-in was not accepted as low risk.");
  const checkInReplay = await callFunction("checkIn", employeeToken, checkInEvidence);
  assert(checkInReplay.eventId === checkIn.eventId && checkInReplay.sessionId === checkIn.sessionId, "Check-in idempotency replay changed the result.");

  const myEvents = await callFunction("getMyAttendanceEvents", employeeToken, { limit: 10 });
  assert(myEvents.events.some((event) => event.id === checkIn.eventId), "Employee event history did not include the check-in.");

  const checkOut = await callFunction("checkOut", employeeToken, {
    idempotencyKey: "emulator-check-out-001",
    deviceId,
    clientTimestamp: new Date().toISOString(),
    location: checkInEvidence.location,
  });
  assert(checkOut.status === "VALID", "Check-out was not accepted.");

  const correction = await callFunction("createAttendanceRequest", employeeToken, {
    eventId: checkIn.eventId,
    requestedTimestamp: new Date(Date.now() - 60 * 60 * 1000).toISOString(),
    reason: "Emulator correction workflow",
  });
  assert(correction.request.status === "PENDING", "Attendance correction did not start in PENDING state.");
  const employeeCorrections = await callFunction("listAttendanceRequests", employeeToken, {});
  assert(employeeCorrections.requests.some((request) => request.id === correction.request.id), "Employee request list did not include the correction.");
  const reviewedCorrection = await callFunction("reviewAttendanceRequest", managerToken, {
    requestId: correction.request.id,
    decision: "APPROVED",
    reviewNote: "Approved by emulator manager",
  });
  assert(reviewedCorrection.request.status === "APPROVED", "Attendance correction was not approved.");

  const leaveStartDate = dateOnly(1);
  const leave = await callFunction("createLeaveRequest", employeeToken, {
    startDate: leaveStartDate,
    endDate: leaveStartDate,
    leaveType: "ANNUAL",
    reason: "Emulator leave workflow",
  });
  assert(leave.request.status === "PENDING", "Leave request did not start in PENDING state.");
  const reviewedLeave = await callFunction("reviewLeaveRequest", managerToken, {
    requestId: leave.request.id,
    decision: "APPROVED",
    reviewNote: "Approved by emulator manager",
  });
  assert(reviewedLeave.request.status === "APPROVED", "Leave request was not approved.");
  const managerLeaves = await callFunction("listLeaveRequests", managerToken, { branchId, status: "APPROVED" });
  assert(managerLeaves.requests.some((request) => request.id === leave.request.id), "Manager leave list did not include the approved request.");

  const today = dateOnly();
  const report = await callFunction("getAttendanceReport", managerToken, { startDate: today, endDate: today, branchId, limit: 10 });
  assert(report.pageSummary.checkIns >= 1 && report.pageSummary.checkOuts >= 1, "Attendance report missed the smoke events.");
  const payroll = await callFunction("exportPayrollCsv", managerToken, { startDate: today, endDate: today, branchId });
  assert(payroll.rowCount >= 2 && payroll.truncated === false && payroll.csv.includes("event_id"), "Payroll export did not include the smoke events.");

  console.log("Emulator E2E OK: auth -> precheck -> check-in/idempotency -> check-out -> correction -> leave -> report/payroll.");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
