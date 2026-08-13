import { randomBytes } from "node:crypto";

const EMAIL_PATTERN = /^[^\s@]{1,64}@[^\s@]{1,190}$/;
const EMPLOYEE_CODE_PATTERN = /^[A-Z0-9][A-Z0-9_-]{2,31}$/;

export function normalizeEmployeeEmail(value: unknown): string {
  if (typeof value !== "string") return "";
  const normalized = value.trim().toLowerCase();
  return EMAIL_PATTERN.test(normalized) ? normalized : "";
}

export function normalizeEmployeeCode(value: unknown): string {
  if (typeof value !== "string") return "";
  const normalized = value.trim().toUpperCase();
  return EMPLOYEE_CODE_PATTERN.test(normalized) ? normalized : "";
}

export function sanitizeEmployeeName(value: unknown): string {
  if (typeof value !== "string") return "";
  return value.trim().replace(/\s+/g, " ").slice(0, 100);
}

export function generateTemporaryPassword(): string {
  // Includes characters from every Firebase Auth password-manager category.
  return `T${randomBytes(9).toString("base64url")}!7a`;
}

export function isStrongPassword(value: unknown): value is string {
  return typeof value === "string"
    && value.length >= 12
    && value.length <= 128
    && /[a-z]/.test(value)
    && /[A-Z]/.test(value)
    && /\d/.test(value)
    && /[^A-Za-z0-9]/.test(value);
}

export function isIsoDateOnly(value: unknown): value is string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

export function dateRangesOverlap(
  leftStartMs: number,
  leftEndMs: number,
  rightStartMs: number,
  rightEndMs: number,
): boolean {
  return [leftStartMs, leftEndMs, rightStartMs, rightEndMs].every(Number.isFinite)
    && leftStartMs <= rightEndMs
    && leftEndMs >= rightStartMs;
}

export type WorkforceRole = "SUPER_ADMIN" | "COMPANY_ADMIN" | "HR" | "MANAGER" | "EMPLOYEE";

export function canManageWorkforceRole(actorRole: WorkforceRole, targetRole: WorkforceRole): boolean {
  const manageableRoles: Record<WorkforceRole, WorkforceRole[]> = {
    SUPER_ADMIN: ["SUPER_ADMIN", "COMPANY_ADMIN", "HR", "MANAGER", "EMPLOYEE"],
    COMPANY_ADMIN: ["COMPANY_ADMIN", "HR", "MANAGER", "EMPLOYEE"],
    HR: ["HR", "MANAGER", "EMPLOYEE"],
    MANAGER: ["EMPLOYEE"],
    EMPLOYEE: [],
  };
  return manageableRoles[actorRole].includes(targetRole);
}
