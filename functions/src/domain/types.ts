import type { Timestamp } from "firebase-admin/firestore";
import type { FaceEnforcementMode } from "./pilot";

export type EmployeeRole = "SUPER_ADMIN" | "COMPANY_ADMIN" | "HR" | "MANAGER" | "EMPLOYEE";

export interface EmployeeDocument {
  companyId: string;
  employeeCode: string;
  fullName: string;
  email: string;
  role: EmployeeRole;
  branchIds: string[];
  status: "ACTIVE" | "INACTIVE";
  faceEnrollmentStatus: "NOT_STARTED" | "PENDING" | "APPROVED" | "REJECTED";
  mustChangePassword?: boolean;
  passwordChangedAt?: Timestamp | null;
  createdAt?: Timestamp;
  updatedAt?: Timestamp;
}

export interface BranchDocument {
  companyId: string;
  name: string;
  address: string;
  latitude: number;
  longitude: number;
  geofenceRadiusMeters: number;
  exitRadiusMeters: number;
  timezone: string;
  isActive: boolean;
}

export interface ShiftDocument {
  companyId: string;
  branchId: string;
  name: string;
  startTime: string;
  endTime: string;
  allowedEarlyMinutes: number;
  lateAfterMinutes: number;
  isActive: boolean;
}

export interface ShiftAssignmentDocument {
  companyId: string;
  userId: string;
  shiftId: string;
  branchId: string;
  startDate: Timestamp;
  endDate: Timestamp;
}

export type DeviceStatus = "PENDING" | "TRUSTED" | "BLOCKED";

export interface DeviceDocument {
  companyId: string;
  userId: string;
  label: string;
  platform: string;
  status: DeviceStatus;
  isBlocked: boolean;
  createdAt: Timestamp;
  updatedAt: Timestamp;
  lastSeenAt: Timestamp;
  reviewedAt: Timestamp | null;
  reviewedBy: string | null;
}

export interface PresenceChallengeDocument {
  companyId: string;
  branchId: string;
  createdBy: string;
  code: string;
  tokenHash: string;
  nonce: string;
  status: "ACTIVE" | "REVOKED";
  createdAt: Timestamp;
  expiresAt: Timestamp;
}

export interface PresenceProofDocument {
  companyId: string;
  branchId: string;
  challengeId: string;
  userId: string;
  deviceId: string;
  createdAt: Timestamp;
  expiresAt: Timestamp;
  usedAt: Timestamp | null;
  usedEventId: string | null;
}

export type FacePurpose = "ENROLL" | "VERIFY";
export type FaceChallenge = "TURN_LEFT" | "TURN_RIGHT";

export interface FaceSessionDocument {
  companyId: string;
  branchId: string;
  userId: string;
  deviceId: string;
  purpose: FacePurpose;
  challenge: FaceChallenge;
  status: "ACTIVE" | "COMPLETED" | "FAILED";
  createdAt: Timestamp;
  expiresAt: Timestamp;
  consentVersion: "biometric-consent-v1" | null;
  consentAcceptedAt: Timestamp | null;
  usedAt: Timestamp | null;
  outcome: "ENROLLED" | "VERIFIED" | "FACE_MISMATCH" | "LIVENESS_FAILED" | "PROFILE_REQUIRED" | "PROFILE_EXPIRED" | "RESET" | "CONSENT_WITHDRAWN" | "POLICY_OFF" | null;
  enforcementMode?: FaceEnforcementMode;
  faceMatchThreshold?: number;
  retentionDays?: number;
}

export interface FaceProfileDocument {
  companyId: string;
  userId: string;
  encryptedDescriptor: string;
  descriptorIv: string;
  descriptorAuthTag: string;
  descriptorVersion: 1;
  consentVersion: "biometric-consent-v1";
  consentAcceptedAt: Timestamp;
  consentPurpose: FacePurpose;
  enrolledAt: Timestamp;
  updatedAt: Timestamp;
  lastVerifiedAt: Timestamp | null;
  retentionExpiresAt?: Timestamp;
}

export interface FaceProofDocument {
  companyId: string;
  branchId: string;
  userId: string;
  deviceId: string;
  faceSessionId: string;
  purpose: FacePurpose;
  faceVerified: true;
  livenessVerified: true;
  matchScore: number;
  createdAt: Timestamp;
  expiresAt: Timestamp;
  usedAt: Timestamp | null;
  usedEventId: string | null;
}

export interface PilotPolicyDocument {
  companyId: string;
  branchId: string;
  enforcementMode: FaceEnforcementMode;
  faceMatchThreshold: number;
  retentionDays: number;
  rollout: {
    label: string;
    cohortPercent: number;
    startsAt: Timestamp | null;
    endsAt: Timestamp | null;
    notes: string | null;
  };
  version: number;
  updatedAt: Timestamp | null;
  updatedBy: string | null;
}
