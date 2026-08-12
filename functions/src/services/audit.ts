import { Timestamp, getFirestore } from "firebase-admin/firestore";
import type { CallableRequest } from "firebase-functions/v2/https";
import type { AttendanceContext } from "./context";

interface AuditInput {
  action: string;
  targetType: string;
  targetId: string;
  metadata?: Record<string, boolean | number | string | null>;
}

export function buildAuditLogDocument(
  request: CallableRequest<unknown>,
  context: AttendanceContext,
  input: AuditInput,
) {
  const userAgent = request.rawRequest.get("user-agent")?.slice(0, 180) ?? "unknown";
  return {
    companyId: context.employee.companyId,
    actorId: context.userId,
    actorRole: context.employee.role,
    action: input.action,
    targetType: input.targetType,
    targetId: input.targetId,
    metadata: input.metadata ?? {},
    appId: request.app?.appId ?? null,
    userAgent,
    createdAt: Timestamp.now(),
  };
}

export async function writeAuditLog(
  request: CallableRequest<unknown>,
  context: AttendanceContext,
  input: AuditInput,
): Promise<void> {
  await getFirestore().collection("auditLogs").add(buildAuditLogDocument(request, context, input));
}
