export interface AttendanceRiskInput {
  insideGeofence: boolean;
  locationAccuracy: number;
  deviceTrusted: boolean;
  faceVerified: boolean;
  livenessVerified: boolean;
  presenceVerified: boolean;
  offline: boolean;
  clockDifferenceSeconds: number;
}

export interface AttendanceRiskResult {
  score: number;
  level: "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";
  decision: "ALLOW" | "FLAG" | "REVIEW" | "DENY";
  reasons: string[];
}

export function calculateAttendanceRisk(input: AttendanceRiskInput): AttendanceRiskResult {
  let score = 0;
  const reasons: string[] = [];

  if (!input.insideGeofence) {
    score += 40;
    reasons.push("OUTSIDE_GEOFENCE");
  }
  if (input.locationAccuracy > 50) {
    score += 20;
    reasons.push("POOR_LOCATION_ACCURACY");
  }
  if (!input.deviceTrusted) {
    score += 20;
    reasons.push("UNTRUSTED_DEVICE");
  }
  if (!input.faceVerified) {
    score += 20;
    reasons.push("FACE_NOT_VERIFIED");
  }
  if (!input.livenessVerified) {
    score += 25;
    reasons.push("LIVENESS_NOT_VERIFIED");
  }
  if (!input.presenceVerified) {
    score += 10;
    reasons.push("PRESENCE_NOT_VERIFIED");
  }
  if (input.offline) {
    score += 25;
    reasons.push("OFFLINE_SUBMISSION");
  }
  if (Math.abs(input.clockDifferenceSeconds) > 120) {
    score += 15;
    reasons.push("CLIENT_CLOCK_DRIFT");
  }

  const boundedScore = Math.min(score, 100);
  const decision = boundedScore >= 80 ? "DENY" : boundedScore >= 60 ? "REVIEW" : boundedScore >= 30 ? "FLAG" : "ALLOW";
  const level = boundedScore >= 80 ? "CRITICAL" : boundedScore >= 60 ? "HIGH" : boundedScore >= 30 ? "MEDIUM" : "LOW";

  return { score: boundedScore, level, decision, reasons };
}
