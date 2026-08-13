import { isIsoDateOnly } from "./workforce";

export interface AttendanceReportCursor {
  timestamp: number;
  documentId: string;
}

const REPORT_CURSOR_VERSION = 1;

export function encodeAttendanceReportCursor(cursor: AttendanceReportCursor): string {
  const payload = JSON.stringify({ v: REPORT_CURSOR_VERSION, t: cursor.timestamp, d: cursor.documentId });
  return Buffer.from(payload, "utf8").toString("base64url");
}

export function decodeAttendanceReportCursor(value: unknown): AttendanceReportCursor | null {
  if (value === undefined || value === null || value === "") return null;
  if (typeof value !== "string" || value.length > 300) throw new RangeError("Invalid report cursor.");
  let parsed: unknown;
  try {
    parsed = JSON.parse(Buffer.from(value, "base64url").toString("utf8"));
  } catch {
    throw new RangeError("Invalid report cursor.");
  }
  if (!parsed || typeof parsed !== "object") throw new RangeError("Invalid report cursor.");
  const payload = parsed as Record<string, unknown>;
  if (payload.v !== REPORT_CURSOR_VERSION
    || typeof payload.t !== "number"
    || !Number.isSafeInteger(payload.t)
    || payload.t <= 0
    || typeof payload.d !== "string"
    || !/^[A-Za-z0-9_-]{10,160}$/.test(payload.d)) {
    throw new RangeError("Invalid report cursor.");
  }
  return { timestamp: payload.t, documentId: payload.d };
}

export function boundedPage<T>(items: readonly T[], limit: number): { rows: T[]; hasMore: boolean } {
  if (!Number.isInteger(limit) || limit < 1) throw new RangeError("Invalid page limit.");
  return { rows: items.slice(0, limit), hasMore: items.length > limit };
}

export function zonedDateBoundaryUtc(dateOnly: string, timeZone: string, endOfDay = false): Date {
  if (!isIsoDateOnly(dateOnly)) throw new RangeError("Invalid ISO date.");
  // Validate IANA timezone eagerly. The iterative conversion handles ordinary
  // offsets as well as daylight-saving transitions without a runtime package.
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  });
  const [year, month, day] = dateOnly.split("-").map(Number);
  const targetAsUtc = Date.UTC(year, month - 1, day, endOfDay ? 23 : 0, endOfDay ? 59 : 0, endOfDay ? 59 : 0, endOfDay ? 999 : 0);
  let candidate = targetAsUtc;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const parts = Object.fromEntries(formatter.formatToParts(new Date(candidate))
      .filter((part) => part.type !== "literal")
      .map((part) => [part.type, Number(part.value)]));
    const representedAsUtc = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second);
    const offset = representedAsUtc - Math.floor(candidate / 1000) * 1000;
    candidate = targetAsUtc - offset;
  }
  return new Date(candidate);
}
