import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

export const FACE_DESCRIPTOR_LENGTH = 128;
export const FACE_MATCH_DISTANCE_THRESHOLD = 0.55;
export const FACE_CONSENT_VERSION = "biometric-consent-v1";

export type FaceChallenge = "TURN_LEFT" | "TURN_RIGHT";

export interface FaceLivenessEvidence {
  challenge: FaceChallenge;
  durationMs: number;
  motionScore: number;
  faceFrames: number;
  neutralFrames: number;
}

export interface FaceLivenessResult {
  valid: boolean;
  reasons: string[];
}

export interface EncryptedFaceDescriptor {
  encryptedDescriptor: string;
  descriptorIv: string;
  descriptorAuthTag: string;
}

function decodeFaceDataKey(encodedKey: string): Buffer {
  const key = Buffer.from(encodedKey, "base64");
  if (key.length !== 32) throw new Error("FACE_DATA_KEY must be a base64 encoded 32-byte key.");
  return key;
}

export function encryptFaceDescriptor(descriptor: readonly number[], encodedKey: string): EncryptedFaceDescriptor {
  if (!validateFaceDescriptor(descriptor)) throw new Error("Invalid face descriptor.");
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", decodeFaceDataKey(encodedKey), iv);
  const plaintext = Buffer.from(new Float64Array(descriptor).buffer);
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  return {
    encryptedDescriptor: ciphertext.toString("base64"),
    descriptorIv: iv.toString("base64"),
    descriptorAuthTag: cipher.getAuthTag().toString("base64"),
  };
}

export function decryptFaceDescriptor(value: EncryptedFaceDescriptor, encodedKey: string): number[] {
  const iv = Buffer.from(value.descriptorIv, "base64");
  const authTag = Buffer.from(value.descriptorAuthTag, "base64");
  const ciphertext = Buffer.from(value.encryptedDescriptor, "base64");
  if (iv.length !== 12 || authTag.length !== 16 || ciphertext.length !== FACE_DESCRIPTOR_LENGTH * 8) {
    throw new Error("Invalid encrypted face descriptor envelope.");
  }
  const decipher = createDecipheriv("aes-256-gcm", decodeFaceDataKey(encodedKey), iv);
  decipher.setAuthTag(authTag);
  const plaintext = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
  const descriptor = Array.from(new Float64Array(plaintext.buffer, plaintext.byteOffset, FACE_DESCRIPTOR_LENGTH));
  if (!validateFaceDescriptor(descriptor)) throw new Error("Decrypted face descriptor is invalid.");
  return descriptor;
}

export function validateFaceDescriptor(value: unknown): value is number[] {
  if (!Array.isArray(value) || value.length !== FACE_DESCRIPTOR_LENGTH) return false;
  if (!value.every((entry) => typeof entry === "number" && Number.isFinite(entry) && Math.abs(entry) <= 10)) return false;
  const norm = Math.sqrt(value.reduce((sum, entry) => sum + entry * entry, 0));
  return Number.isFinite(norm) && norm >= 0.1 && norm <= 20;
}

export function faceDescriptorDistance(left: readonly number[], right: readonly number[]): number {
  if (!validateFaceDescriptor(left) || !validateFaceDescriptor(right)) return Number.POSITIVE_INFINITY;
  return Math.sqrt(left.reduce((sum, entry, index) => {
    const delta = entry - right[index];
    return sum + delta * delta;
  }, 0));
}

export function faceMatchScore(distance: number): number {
  if (!Number.isFinite(distance) || distance < 0) return 0;
  return Math.round(Math.max(0, Math.min(1, 1 - distance)) * 10_000) / 10_000;
}

export function validateFaceLivenessEvidence(
  value: unknown,
  expectedChallenge: FaceChallenge,
): FaceLivenessResult {
  const reasons: string[] = [];
  if (!value || typeof value !== "object") return { valid: false, reasons: ["EVIDENCE_REQUIRED"] };
  const evidence = value as Partial<FaceLivenessEvidence>;

  if (evidence.challenge !== expectedChallenge) reasons.push("CHALLENGE_MISMATCH");
  if (!Number.isFinite(evidence.durationMs) || Number(evidence.durationMs) < 800 || Number(evidence.durationMs) > 15_000) {
    reasons.push("INVALID_DURATION");
  }
  if (!Number.isFinite(evidence.motionScore) || Number(evidence.motionScore) < 0.12 || Number(evidence.motionScore) > 1) {
    reasons.push("INSUFFICIENT_MOTION");
  }
  if (!Number.isInteger(evidence.faceFrames) || Number(evidence.faceFrames) < 8 || Number(evidence.faceFrames) > 600) {
    reasons.push("INSUFFICIENT_FACE_FRAMES");
  }
  if (
    !Number.isInteger(evidence.neutralFrames)
    || Number(evidence.neutralFrames) < 3
    || Number(evidence.neutralFrames) > Number(evidence.faceFrames)
  ) {
    reasons.push("INSUFFICIENT_NEUTRAL_FRAMES");
  }
  return { valid: reasons.length === 0, reasons };
}
