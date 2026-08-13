import { Timestamp, getFirestore } from "firebase-admin/firestore";
import {
  DEFAULT_FACE_ENFORCEMENT_MODE,
  DEFAULT_FACE_MATCH_THRESHOLD,
  DEFAULT_FACE_RETENTION_DAYS,
} from "../domain/pilot";
import type { PilotPolicyDocument } from "../domain/types";

export function pilotPolicyDocumentId(companyId: string, branchId: string): string {
  return Buffer.from(`${companyId}\u0000${branchId}`, "utf8").toString("base64url");
}

export function defaultPilotPolicy(companyId: string, branchId: string): PilotPolicyDocument {
  return {
    companyId,
    branchId,
    enforcementMode: DEFAULT_FACE_ENFORCEMENT_MODE,
    faceMatchThreshold: DEFAULT_FACE_MATCH_THRESHOLD,
    retentionDays: DEFAULT_FACE_RETENTION_DAYS,
    rollout: {
      label: "Phase 8 pilot",
      cohortPercent: 100,
      startsAt: null,
      endsAt: null,
      notes: null,
    },
    version: 0,
    updatedAt: null,
    updatedBy: null,
  };
}

export function pilotPolicyFromData(
  companyId: string,
  branchId: string,
  stored?: Partial<PilotPolicyDocument>,
): PilotPolicyDocument {
  const fallback = defaultPilotPolicy(companyId, branchId);
  if (!stored) return fallback;
  return {
    ...fallback,
    ...stored,
    companyId,
    branchId,
    rollout: { ...fallback.rollout, ...stored.rollout },
  };
}

export async function loadPilotPolicy(companyId: string, branchId: string): Promise<PilotPolicyDocument> {
  const snapshot = await getFirestore().doc(`pilotPolicies/${pilotPolicyDocumentId(companyId, branchId)}`).get();
  return pilotPolicyFromData(
    companyId,
    branchId,
    snapshot.exists ? snapshot.data() as Partial<PilotPolicyDocument> : undefined,
  );
}

export function publicPilotPolicy(policy: PilotPolicyDocument) {
  const toIso = (value: Timestamp | null | undefined): string | null => value instanceof Timestamp ? value.toDate().toISOString() : null;
  return {
    branchId: policy.branchId,
    enforcementMode: policy.enforcementMode,
    faceMatchThreshold: policy.faceMatchThreshold,
    retentionDays: policy.retentionDays,
    rollout: {
      label: policy.rollout.label,
      cohortPercent: policy.rollout.cohortPercent,
      startsAt: toIso(policy.rollout.startsAt),
      endsAt: toIso(policy.rollout.endsAt),
      notes: policy.rollout.notes,
    },
    version: policy.version,
    updatedAt: toIso(policy.updatedAt),
    updatedBy: policy.updatedBy,
  };
}
