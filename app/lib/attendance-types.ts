export type EmployeeRole = "SUPER_ADMIN" | "COMPANY_ADMIN" | "HR" | "MANAGER" | "EMPLOYEE";
export type DeviceStatus = "PENDING" | "TRUSTED" | "BLOCKED";

export interface AttendanceUser {
  uid: string;
  fullName: string;
  employeeCode: string;
  email: string;
  role: EmployeeRole;
  companyId: string;
  canManageDevices: boolean;
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
  employee: { id: string; name: string; employeeCode: string };
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
