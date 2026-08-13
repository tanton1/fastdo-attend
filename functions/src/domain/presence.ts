import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";

export interface PresenceQrPayload {
  version: 1;
  challengeId: string;
  companyId: string;
  branchId: string;
  expiresAtSeconds: number;
  nonce: string;
}

function encode(value: string | Buffer): string {
  return Buffer.from(value).toString("base64url");
}

export function createPresenceNonce(): string {
  return randomBytes(18).toString("base64url");
}

export function signPresenceQr(payload: PresenceQrPayload, secret: string): string {
  const encodedPayload = encode(JSON.stringify(payload));
  const signature = createHmac("sha256", secret).update(encodedPayload).digest("base64url");
  return `${encodedPayload}.${signature}`;
}

export function verifyPresenceQr(token: string, secret: string): PresenceQrPayload | null {
  const [encodedPayload, signature, extra] = token.split(".");
  if (!encodedPayload || !signature || extra) return null;
  const expected = createHmac("sha256", secret).update(encodedPayload).digest("base64url");
  const actualBuffer = Buffer.from(signature);
  const expectedBuffer = Buffer.from(expected);
  if (actualBuffer.length !== expectedBuffer.length || !timingSafeEqual(actualBuffer, expectedBuffer)) return null;

  try {
    const parsed = JSON.parse(Buffer.from(encodedPayload, "base64url").toString("utf8")) as PresenceQrPayload;
    if (parsed.version !== 1 || !parsed.challengeId || !parsed.companyId || !parsed.branchId || !parsed.nonce || !Number.isFinite(parsed.expiresAtSeconds)) return null;
    return parsed;
  } catch {
    return null;
  }
}

export function hashPresenceQr(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export function isSixDigitPresenceCode(value: unknown): value is string {
  return typeof value === "string" && /^\d{6}$/.test(value);
}
