import type { DeviceStatus } from "./types";

const deviceIdPattern = /^[A-Za-z0-9_-]{16,128}$/;

export function isValidDeviceId(deviceId: string): boolean {
  return deviceIdPattern.test(deviceId);
}

export function sanitizeDeviceLabel(value: unknown): string {
  if (typeof value !== "string") return "Thiết bị web";
  const normalized = value.trim().replace(/\s+/g, " ");
  return normalized.slice(0, 80) || "Thiết bị web";
}

export function sanitizePlatform(value: unknown): string {
  if (typeof value !== "string") return "web";
  const normalized = value.trim().toLowerCase().replace(/[^a-z0-9._ -]/g, "");
  return normalized.slice(0, 40) || "web";
}

export function deviceCanCheckIn(status: DeviceStatus, isBlocked: boolean): boolean {
  return status === "TRUSTED" && !isBlocked;
}
