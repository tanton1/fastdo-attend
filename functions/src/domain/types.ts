import type { Timestamp } from "firebase-admin/firestore";

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
