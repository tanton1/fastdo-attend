import { initializeApp } from "firebase-admin/app";
import { FieldPath, Timestamp, getFirestore } from "firebase-admin/firestore";
import {
  DEFAULT_FACE_RETENTION_DAYS,
  isValidFaceRetentionDays,
  retentionExpiryMillis,
} from "../domain/pilot";
import type { EmployeeDocument, PilotPolicyDocument } from "../domain/types";

interface Options {
  projectId: string;
  apply: boolean;
  pageSize: number;
  limit: number;
}

function argumentValue(argumentsList: string[], name: string): string | null {
  const index = argumentsList.indexOf(name);
  return index >= 0 && index + 1 < argumentsList.length ? argumentsList[index + 1] : null;
}

function positiveInteger(value: string | null, fallback: number, maximum: number): number {
  if (value === null) return fallback;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > maximum) {
    throw new Error(`Invalid numeric option: ${value}`);
  }
  return parsed;
}

function parseOptions(argumentsList: string[]): Options {
  const projectId = argumentValue(argumentsList, "--project")?.trim() ?? "";
  if (!/^[a-z][a-z0-9-]{4,61}[a-z0-9]$/.test(projectId)) {
    throw new Error("A valid explicit --project Firebase project id is required.");
  }
  return {
    projectId,
    apply: argumentsList.includes("--apply"),
    pageSize: positiveInteger(argumentValue(argumentsList, "--page-size"), 200, 400),
    limit: positiveInteger(argumentValue(argumentsList, "--limit"), 100_000, 1_000_000),
  };
}

async function main(): Promise<void> {
  const options = parseOptions(process.argv.slice(2));
  initializeApp({ projectId: options.projectId });
  const db = getFirestore();
  const policyCache = new Map<string, Promise<Map<string, number>>>();

  const loadCompanyPolicies = (companyId: string): Promise<Map<string, number>> => {
    const existing = policyCache.get(companyId);
    if (existing) return existing;
    const pending = db.collection("pilotPolicies")
      .where("companyId", "==", companyId)
      .get()
      .then((snapshot) => new Map(snapshot.docs.flatMap((document) => {
        const policy = document.data() as Partial<PilotPolicyDocument>;
        return typeof policy.branchId === "string" && isValidFaceRetentionDays(policy.retentionDays)
          ? [[policy.branchId, policy.retentionDays] as const]
          : [];
      })));
    policyCache.set(companyId, pending);
    return pending;
  };

  let scanned = 0;
  let candidates = 0;
  let updated = 0;
  let skippedInvalid = 0;
  let lastDocumentId: string | null = null;
  let writeBatch = db.batch();
  let pendingWrites = 0;

  const flush = async (): Promise<void> => {
    if (!options.apply || pendingWrites === 0) return;
    await writeBatch.commit();
    updated += pendingWrites;
    writeBatch = db.batch();
    pendingWrites = 0;
  };

  while (scanned < options.limit) {
    const remaining = options.limit - scanned;
    let query = db.collection("faceProfiles")
      .select("companyId", "enrolledAt", "retentionExpiresAt")
      .orderBy(FieldPath.documentId())
      .limit(Math.min(options.pageSize, remaining));
    if (lastDocumentId) query = query.startAfter(lastDocumentId);
    const profiles = await query.get();
    if (profiles.empty) break;

    const employeeSnapshots = await db.getAll(
      ...profiles.docs.map((profile) => db.doc(`employees/${profile.id}`)),
      { fieldMask: ["branchIds"] },
    );
    const employees = new Map(employeeSnapshots.filter((snapshot) => snapshot.exists)
      .map((snapshot) => [snapshot.id, snapshot.data() as EmployeeDocument]));

    for (const profileSnapshot of profiles.docs) {
      scanned += 1;
      lastDocumentId = profileSnapshot.id;
      const profile = profileSnapshot.data();
      const companyId = typeof profile.companyId === "string" ? profile.companyId : "";
      const enrolledAt = profile.enrolledAt;
      if (!companyId || !(enrolledAt instanceof Timestamp)) {
        skippedInvalid += 1;
        continue;
      }

      const policies = await loadCompanyPolicies(companyId);
      const branchIds = employees.get(profileSnapshot.id)?.branchIds ?? [];
      const applicableRetentionDays = branchIds.length
        ? branchIds.map((branchId) => policies.get(branchId) ?? DEFAULT_FACE_RETENTION_DAYS)
        : [DEFAULT_FACE_RETENTION_DAYS, ...policies.values()];
      const retentionDays = Math.min(...applicableRetentionDays);
      const currentExpiry = profile.retentionExpiresAt instanceof Timestamp
        ? profile.retentionExpiresAt.toMillis()
        : null;
      const desiredExpiry = retentionExpiryMillis(enrolledAt.toMillis(), retentionDays, currentExpiry);
      if (currentExpiry !== null && currentExpiry <= desiredExpiry) continue;

      candidates += 1;
      if (options.apply) {
        writeBatch.update(profileSnapshot.ref, {
          retentionExpiresAt: Timestamp.fromMillis(desiredExpiry),
          retentionBackfilledAt: Timestamp.now(),
          retentionBackfillVersion: 1,
        });
        pendingWrites += 1;
        if (pendingWrites >= 400) await flush();
      }
    }
    if (profiles.size < Math.min(options.pageSize, remaining)) break;
  }

  await flush();
  console.log(JSON.stringify({
    projectId: options.projectId,
    mode: options.apply ? "APPLY" : "DRY_RUN",
    scanned,
    candidates,
    updated: options.apply ? updated : 0,
    skippedInvalid,
    policy: "shortest assigned-branch retention; default 90 days when unconfigured",
  }, null, 2));
}

void main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : "Face retention backfill failed.");
  process.exitCode = 1;
});
