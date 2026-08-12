import { HttpsError } from "firebase-functions/v2/https";
import { getFirestore } from "firebase-admin/firestore";
import type { CallableRequest } from "firebase-functions/v2/https";
import type { BranchDocument, EmployeeDocument, EmployeeRole, ShiftAssignmentDocument, ShiftDocument } from "../domain/types";

export const MANAGER_ROLES: EmployeeRole[] = ["SUPER_ADMIN", "COMPANY_ADMIN", "HR", "MANAGER"];

export interface EmployeeContext {
  userId: string;
  employee: EmployeeDocument;
}

export interface AttendanceContext extends EmployeeContext {
  branchId: string;
  branch: BranchDocument;
  shiftId: string;
  shift: ShiftDocument;
}

export function requireUserId(request: CallableRequest<unknown>): string {
  if (!request.auth?.uid) {
    throw new HttpsError("unauthenticated", "Bạn cần đăng nhập để thực hiện thao tác này.");
  }
  return request.auth.uid;
}

export async function loadEmployeeContext(userId: string): Promise<EmployeeContext> {
  const db = getFirestore();
  const employeeSnapshot = await db.doc(`employees/${userId}`).get();
  if (!employeeSnapshot.exists) {
    throw new HttpsError("failed-precondition", "Hồ sơ nhân viên chưa được tạo.");
  }

  const employee = employeeSnapshot.data() as EmployeeDocument;
  if (employee.status !== "ACTIVE") {
    throw new HttpsError("permission-denied", "Tài khoản nhân viên không hoạt động.");
  }

  return { userId, employee };
}

export async function loadAttendanceContext(userId: string): Promise<AttendanceContext> {
  const db = getFirestore();
  const employeeContext = await loadEmployeeContext(userId);

  const now = new Date();
  const assignments = await db
    .collection("shiftAssignments")
    .where("userId", "==", userId)
    .where("startDate", "<=", now)
    .where("endDate", ">=", now)
    .limit(1)
    .get();

  if (assignments.empty) {
    throw new HttpsError("failed-precondition", "Hôm nay bạn chưa được phân ca.");
  }

  const assignment = assignments.docs[0].data() as ShiftAssignmentDocument;
  const [branchSnapshot, shiftSnapshot] = await Promise.all([
    db.doc(`branches/${assignment.branchId}`).get(),
    db.doc(`shifts/${assignment.shiftId}`).get(),
  ]);

  if (!branchSnapshot.exists || !shiftSnapshot.exists) {
    throw new HttpsError("data-loss", "Dữ liệu chi nhánh hoặc ca làm không hợp lệ.");
  }

  return {
    ...employeeContext,
    branchId: assignment.branchId,
    branch: branchSnapshot.data() as BranchDocument,
    shiftId: assignment.shiftId,
    shift: shiftSnapshot.data() as ShiftDocument,
  };
}

export async function loadManagerContext(userId: string): Promise<EmployeeContext> {
  const context = await loadEmployeeContext(userId);
  if (!MANAGER_ROLES.includes(context.employee.role)) {
    throw new HttpsError("permission-denied", "Bạn không có quyền quản lý thiết bị.");
  }
  return context;
}
