export type FaceEnforcementMode = "OFF" | "MONITOR" | "REQUIRED";

export interface PilotRolloutInput {
  label: string;
  cohortPercent: number;
  startsAt: string | null;
  endsAt: string | null;
  notes: string | null;
}

export interface EffectiveFacePolicy {
  effectiveEnforcementMode: FaceEnforcementMode;
  rolloutActive: boolean;
  inCohort: boolean;
  cohortBucket: number;
}

export const DEFAULT_FACE_ENFORCEMENT_MODE: FaceEnforcementMode = "REQUIRED";
export const DEFAULT_FACE_MATCH_THRESHOLD = 0.55;
export const MIN_FACE_MATCH_THRESHOLD = 0.35;
export const MAX_FACE_MATCH_THRESHOLD = 0.65;
export const DEFAULT_FACE_RETENTION_DAYS = 90;
export const MIN_FACE_RETENTION_DAYS = 1;
export const MAX_FACE_RETENTION_DAYS = 365;

export function isFaceEnforcementMode(value: unknown): value is FaceEnforcementMode {
  return value === "OFF" || value === "MONITOR" || value === "REQUIRED";
}

export function isSafeFaceMatchThreshold(value: unknown): value is number {
  return typeof value === "number"
    && Number.isFinite(value)
    && value >= MIN_FACE_MATCH_THRESHOLD
    && value <= MAX_FACE_MATCH_THRESHOLD;
}

export function isValidFaceRetentionDays(value: unknown): value is number {
  return Number.isInteger(value)
    && Number(value) >= MIN_FACE_RETENTION_DAYS
    && Number(value) <= MAX_FACE_RETENTION_DAYS;
}

function normalizedIsoTimestamp(value: unknown): string | null | undefined {
  if (value === null || value === undefined || value === "") return null;
  if (typeof value !== "string" || value.length > 40) return undefined;
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return undefined;
  return parsed.toISOString();
}

export function normalizePilotRollout(value: unknown): PilotRolloutInput | null {
  if (!value || typeof value !== "object") return null;
  const input = value as Record<string, unknown>;
  const label = typeof input.label === "string" ? input.label.trim().replace(/\s+/g, " ").slice(0, 80) : "";
  const cohortPercent = Number(input.cohortPercent);
  const startsAt = normalizedIsoTimestamp(input.startsAt);
  const endsAt = normalizedIsoTimestamp(input.endsAt);
  const notes = input.notes === null || input.notes === undefined || input.notes === ""
    ? null
    : typeof input.notes === "string" ? input.notes.trim().replace(/\s+/g, " ").slice(0, 300) : undefined;
  if (!label || !Number.isInteger(cohortPercent) || cohortPercent < 1 || cohortPercent > 100) return null;
  if (startsAt === undefined || endsAt === undefined || notes === undefined) return null;
  if (startsAt && endsAt && new Date(startsAt).getTime() >= new Date(endsAt).getTime()) return null;
  return { label, cohortPercent, startsAt, endsAt, notes };
}

export function faceIsRequired(mode: FaceEnforcementMode): boolean {
  return mode === "REQUIRED";
}

export function faceMayBeCollected(mode: FaceEnforcementMode): boolean {
  return mode !== "OFF";
}

export function retentionExpiryMillis(
  enrolledAtMillis: number,
  retentionDays: number,
  currentExpiryMillis?: number | null,
): number {
  if (!Number.isFinite(enrolledAtMillis) || !isValidFaceRetentionDays(retentionDays)) {
    throw new RangeError("Invalid Face retention input.");
  }
  const policyExpiry = enrolledAtMillis + retentionDays * 24 * 60 * 60 * 1000;
  return typeof currentExpiryMillis === "number" && Number.isFinite(currentExpiryMillis)
    ? Math.min(policyExpiry, currentExpiryMillis)
    : policyExpiry;
}

function deterministicCohortBucket(identity: string): number {
  // FNV-1a gives a stable, non-secret distribution without storing an assignment.
  let hash = 0x811c9dc5;
  for (let index = 0; index < identity.length; index += 1) {
    hash ^= identity.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash % 100;
}

export function resolveEffectiveFacePolicy(input: {
  enforcementMode: FaceEnforcementMode;
  cohortPercent: number;
  startsAtMillis: number | null;
  endsAtMillis: number | null;
  identity: string;
  nowMillis: number;
}): EffectiveFacePolicy {
  const cohortBucket = deterministicCohortBucket(input.identity);
  const inCohort = cohortBucket < input.cohortPercent;
  const rolloutActive = (input.startsAtMillis === null || input.nowMillis >= input.startsAtMillis)
    && (input.endsAtMillis === null || input.nowMillis < input.endsAtMillis);
  if (input.enforcementMode === "OFF") return { effectiveEnforcementMode: "OFF", rolloutActive, inCohort, cohortBucket };
  if (rolloutActive && inCohort) {
    return { effectiveEnforcementMode: input.enforcementMode, rolloutActive, inCohort, cohortBucket };
  }
  // Outside a REQUIRED cohort we retain measurement-only behavior; outside a
  // MONITOR cohort collection is disabled entirely.
  return {
    effectiveEnforcementMode: input.enforcementMode === "REQUIRED" ? "MONITOR" : "OFF",
    rolloutActive,
    inCohort,
    cohortBucket,
  };
}

export function safeFaceTelemetry(input: {
  companyId: string;
  branchId: string;
  eventType: "SESSION_STARTED" | "SESSION_COMPLETED" | "SESSION_REJECTED" | "CHECK_IN_WITHOUT_FACE";
  purpose: "ENROLL" | "VERIFY" | "CHECK_IN";
  enforcementMode: FaceEnforcementMode;
  outcome: string;
  matchScore?: number | null;
  threshold?: number | null;
  livenessPassed?: boolean | null;
}): Record<string, string | number | boolean | null> {
  return {
    companyId: input.companyId,
    branchId: input.branchId,
    eventType: input.eventType,
    purpose: input.purpose,
    enforcementMode: input.enforcementMode,
    outcome: input.outcome.slice(0, 64),
    matchScore: typeof input.matchScore === "number" && Number.isFinite(input.matchScore)
      ? Math.round(input.matchScore * 10_000) / 10_000
      : null,
    threshold: typeof input.threshold === "number" && Number.isFinite(input.threshold)
      ? Math.round(input.threshold * 10_000) / 10_000
      : null,
    livenessPassed: typeof input.livenessPassed === "boolean" ? input.livenessPassed : null,
  };
}
