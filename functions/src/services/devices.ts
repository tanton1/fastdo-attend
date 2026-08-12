import { Timestamp, getFirestore } from "firebase-admin/firestore";
import { HttpsError } from "firebase-functions/v2/https";
import { deviceCanCheckIn, isValidDeviceId, sanitizeDeviceLabel, sanitizePlatform } from "../domain/device";
import type { DeviceDocument } from "../domain/types";
import type { AttendanceContext } from "./context";

export interface DeviceRegistrationInput {
  deviceId: string;
  label?: string;
  platform?: string;
}

export function requireDeviceId(deviceId: unknown): string {
  if (typeof deviceId !== "string" || !isValidDeviceId(deviceId)) {
    throw new HttpsError("invalid-argument", "Mã thiết bị không hợp lệ.");
  }
  return deviceId;
}

export async function readOwnedDevice(context: AttendanceContext, deviceIdValue: unknown): Promise<DeviceDocument | null> {
  const deviceId = requireDeviceId(deviceIdValue);
  const snapshot = await getFirestore().doc(`devices/${deviceId}`).get();
  if (!snapshot.exists) return null;
  const device = snapshot.data() as DeviceDocument;
  if (device.userId !== context.userId || device.companyId !== context.employee.companyId) {
    throw new HttpsError("permission-denied", "Thiết bị đã thuộc về một tài khoản khác.");
  }
  return device;
}

export async function registerOrTouchDevice(
  context: AttendanceContext,
  input: DeviceRegistrationInput,
  auditDocument: Record<string, unknown>,
): Promise<{ device: DeviceDocument; created: boolean }> {
  const deviceId = requireDeviceId(input?.deviceId);
  const reference = getFirestore().doc(`devices/${deviceId}`);
  const now = Timestamp.now();

  return getFirestore().runTransaction(async (transaction) => {
    const snapshot = await transaction.get(reference);
    if (snapshot.exists) {
      const device = snapshot.data() as DeviceDocument;
      if (device.userId !== context.userId || device.companyId !== context.employee.companyId) {
        throw new HttpsError("permission-denied", "Thiết bị đã thuộc về một tài khoản khác.");
      }
      transaction.update(reference, { lastSeenAt: now, updatedAt: now });
      return { device: { ...device, lastSeenAt: now, updatedAt: now }, created: false };
    }

    const device: DeviceDocument = {
      companyId: context.employee.companyId,
      userId: context.userId,
      label: sanitizeDeviceLabel(input.label),
      platform: sanitizePlatform(input.platform),
      status: "PENDING",
      isBlocked: false,
      createdAt: now,
      updatedAt: now,
      lastSeenAt: now,
      reviewedAt: null,
      reviewedBy: null,
    };
    transaction.create(reference, device);
    transaction.create(getFirestore().collection("auditLogs").doc(), auditDocument);
    return { device, created: true };
  });
}

export function publicDeviceStatus(deviceId: string, device: DeviceDocument) {
  return {
    id: deviceId,
    label: device.label,
    platform: device.platform,
    status: device.status,
    trusted: deviceCanCheckIn(device.status, device.isBlocked),
    isBlocked: device.isBlocked,
  };
}
