export type EmployeeRole = "SUPER_ADMIN" | "COMPANY_ADMIN" | "HR" | "MANAGER" | "EMPLOYEE";
export type DeviceStatus = "PENDING" | "TRUSTED" | "BLOCKED";
export type FaceEnrollmentStatus = "NOT_STARTED" | "PENDING" | "APPROVED" | "REJECTED";
export type FacePurpose = "ENROLL" | "VERIFY";
export type FaceChallenge = "TURN_LEFT" | "TURN_RIGHT";

export interface AttendanceUser {
  uid: string;
  fullName: string;
  employeeCode: string;
  email: string;
  role: EmployeeRole;
  companyId: string;
  canManageDevices: boolean;
  mustChangePassword: boolean;
  isDemo: boolean;
}

export interface AdminDevice {
  id: string;
  label: string;
  platform: string;
  status: DeviceStatus;
  trusted: boolean;
  isBlocked: boolean;
  userId: string;
  employeeName: string;
  employeeCode: string;
  createdAt: string | null;
  lastSeenAt: string | null;
  reviewedAt: string | null;
}

export interface DeviceReviewResult {
  deviceId: string;
  status: Extract<DeviceStatus, "TRUSTED" | "BLOCKED">;
  trusted: boolean;
}

export interface PresenceChallenge {
  challengeId: string;
  qrToken: string;
  code: string;
  branch: { id: string; name: string };
  expiresAt: string;
}

export interface PresenceProof {
  proofId: string;
  branchId: string;
  expiresAt: string;
}

export interface PrecheckData {
  serverTime: string;
  employee: { id: string; name: string; employeeCode: string; faceEnrollmentStatus: FaceEnrollmentStatus };
  branch: {
    id: string;
    name: string;
    address: string;
    latitude: number;
    longitude: number;
    radiusMeters: number;
  };
  shift: { id: string; name: string; startTime: string; endTime: string };
  device: {
    id: string;
    label: string;
    platform: string;
    status: DeviceStatus;
    trusted: boolean;
    isBlocked: boolean;
  };
  requirements: {
    trustedDevice: boolean;
    location: boolean;
    faceVerification: boolean;
    liveness: boolean;
    presenceProof: boolean;
  };
  facePolicy?: PilotBranchPolicy;
}

export interface FaceSession {
  sessionId: string;
  purpose: FacePurpose;
  challenge: FaceChallenge;
  expiresAt: string;
  enrollmentStatus: FaceEnrollmentStatus;
}

export interface FaceEvidence {
  challenge: FaceChallenge;
  durationMs: number;
  motionScore: number;
  faceFrames: number;
  neutralFrames: number;
}

export interface FaceCompletion {
  faceProofId: string;
  matchScore: number;
  enrolled: boolean;
  enrollmentStatus: FaceEnrollmentStatus;
  expiresAt: string;
}

export interface WorkforceEmployee {
  id: string;
  fullName: string;
  employeeCode: string;
  email: string;
  role: EmployeeRole;
  status: "ACTIVE" | "INACTIVE";
  branchIds: string[];
  faceEnrollmentStatus: FaceEnrollmentStatus;
}

export interface WorkforceBranch {
  id: string;
  name: string;
  address: string;
  isActive: boolean;
}

export interface WorkforceShift {
  id: string;
  branchId: string;
  name: string;
  startTime: string;
  endTime: string;
  isActive: boolean;
}

export interface WorkforceAssignment {
  id: string;
  userId: string;
  shiftId: string;
  branchId: string;
  startDate: string;
  endDate: string;
}

export interface AdminWorkforce {
  employees: WorkforceEmployee[];
  branches: WorkforceBranch[];
  shifts: WorkforceShift[];
  assignments: WorkforceAssignment[];
}

export interface CreateEmployeeInput {
  fullName: string;
  employeeCode: string;
  email: string;
  role: EmployeeRole;
  branchIds: string[];
}

export interface CreateEmployeeResult {
  employee: WorkforceEmployee;
  temporaryPassword: string;
}

export interface DeviceLocation {
  latitude: number;
  longitude: number;
  accuracy: number;
}

export interface AttendanceRisk {
  score: number;
  level: "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";
  decision: "ALLOW" | "FLAG" | "REVIEW" | "DENY";
  reasons: string[];
}

export interface CheckInResult {
  eventId: string;
  sessionId: string;
  status: "VALID" | "PENDING_REVIEW" | "REJECTED";
  serverTimestamp: string;
  distanceMeters: number;
  locationAccuracy: number;
  risk: AttendanceRisk;
}

export interface CheckOutResult {
  eventId: string;
  sessionId: string;
  status: "VALID" | "PENDING_REVIEW";
  serverTimestamp: string;
}

export interface LocationHeartbeatResult {
  insideGeofence: boolean;
  distanceMeters: number;
  receivedAt: string;
}

export type PilotEnforcementMode = "OFF" | "MONITOR" | "REQUIRED";

export interface PilotRollout {
  label: string;
  cohortPercent: number;
  startsAt: string | null;
  endsAt: string | null;
  notes: string | null;
}

export interface PilotBranchPolicy {
  branchId: string;
  enforcementMode: PilotEnforcementMode;
  effectiveEnforcementMode?: PilotEnforcementMode;
  rolloutActive?: boolean;
  inCohort?: boolean;
  cohortBucket?: number;
  faceMatchThreshold: number;
  retentionDays: number;
  rollout: PilotRollout;
  version: number;
  updatedAt: string | null;
  updatedBy: string | null;
}

export interface PilotPolicy {
  policies: PilotBranchPolicy[];
}

export interface PilotPolicyUpdate {
  branchId: string;
  enforcementMode: PilotEnforcementMode;
  faceMatchThreshold: number;
  retentionDays: number;
  rollout: PilotRollout;
}

export interface AttendanceReportSummary {
  returnedEvents: number;
  checkIns: number;
  checkOuts: number;
  valid: number;
  pendingReview: number;
  rejected: number;
  uniqueEmployees: number;
  averageRiskScore: number;
}

export interface AttendanceReportRecord {
  id: string;
  userId: string;
  employeeName: string;
  employeeCode: string;
  branchId: string;
  branchName: string;
  type: "CHECK_IN" | "CHECK_OUT";
  status: "VALID" | "PENDING_REVIEW" | "REJECTED";
  serverTimestamp: string;
  distanceMeters: number | null;
  locationAccuracy: number | null;
  riskScore: number;
  riskLevel: "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";
  faceVerified: boolean;
  presenceVerified: boolean;
  deviceVerified: boolean;
}

export interface AttendanceReport {
  range: { startDate: string; endDate: string; branchId: string | null; timezone: string };
  pageSummary: AttendanceReportSummary;
  rows: AttendanceReportRecord[];
  truncated: boolean;
  hasMore: boolean;
  pagination: { limit: number; returned: number; hasMore: boolean };
}

export interface RealtimeAttendanceEntry {
  sessionId: string;
  userId: string;
  employeeName: string;
  employeeCode: string;
  branchId: string;
  branchName: string;
  status: string;
  startedAt: string;
  lastHeartbeatAt: string | null;
  insideGeofence: boolean | null;
  distanceMeters: number | null;
  riskScore: number;
  heartbeatStale: boolean;
}

export interface RealtimeMonitor {
  generatedAt: string;
  pageSummary: {
    returnedActive: number;
    insideGeofence: number;
    outsideGeofence: number;
    unknownGeofence: number;
    staleHeartbeat: number;
    highRisk: number;
  };
  rows: RealtimeAttendanceEntry[];
  truncated: boolean;
  hasMore: boolean;
  pagination: { limit: number; returned: number; hasMore: boolean };
}

export interface FaceConsentWithdrawal {
  withdrawn: boolean;
  faceEnrollmentStatus: "NOT_STARTED";
  revokedSessions: number;
  revokedProofs: number;
  withdrawnAt: string;
}
