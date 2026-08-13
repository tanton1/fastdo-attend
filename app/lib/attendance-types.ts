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
