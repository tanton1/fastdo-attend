import { Timestamp, getFirestore } from "firebase-admin/firestore";
import { HttpsError } from "firebase-functions/v2/https";
import { logOperationalEvent } from "./observability";

export async function enforceRateLimit(userId: string, action: string, limit: number, windowSeconds = 60): Promise<void> {
  const nowSeconds = Math.floor(Date.now() / 1000);
  const windowStart = Math.floor(nowSeconds / windowSeconds) * windowSeconds;
  const documentId = `${userId}_${action}_${windowStart}`;
  const reference = getFirestore().doc(`rateLimits/${documentId}`);

  const allowed = await getFirestore().runTransaction(async (transaction) => {
    const snapshot = await transaction.get(reference);
    const count = snapshot.exists ? Number(snapshot.data()?.count ?? 0) : 0;
    if (count >= limit) return false;
    transaction.set(reference, {
      userId,
      action,
      count: count + 1,
      windowStartedAt: Timestamp.fromMillis(windowStart * 1000),
      expiresAt: Timestamp.fromMillis((windowStart + windowSeconds * 2) * 1000),
      updatedAt: Timestamp.now(),
    });
    return true;
  });

  if (!allowed) {
    logOperationalEvent({ event: "RATE_LIMIT_EXCEEDED", functionName: action, status: "BLOCKED", metadata: { limit, windowSeconds } });
    throw new HttpsError("resource-exhausted", "Bạn thao tác quá nhanh. Vui lòng đợi một phút rồi thử lại.");
  }
}
