export interface AttendanceUser {
  uid: string;
  fullName: string;
  employeeCode: string;
  email: string;
  isDemo: boolean;
}

export interface PrecheckData {
  serverTime: string;
  employee: { id: string; name: string; employeeCode: string };
  branch: {
    id: string;
    name: string;
    address: string;
    latitude: number;
    longitude: number;
    radiusMeters: number;
  };
  shift: { id: string; name: string; startTime: string; endTime: string };
  requirements: {
    trustedDevice: boolean;
    location: boolean;
    faceVerification: boolean;
    liveness: boolean;
    presenceProof: boolean;
  };
}

export interface DeviceLocation {
  latitude: number;
  longitude: number;
  accuracy: number;
}

export interface AttendanceRisk {
  score: number;
  level: "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";
  decision: "ALLOW" | "FLAG" | "REVIEW" | "DENY";
  reasons: string[];
}

export interface CheckInResult {
  eventId: string;
  sessionId: string;
  status: "VALID" | "PENDING_REVIEW" | "REJECTED";
  serverTimestamp: string;
  distanceMeters: number;
  locationAccuracy: number;
  risk: AttendanceRisk;
}

export interface CheckOutResult {
  eventId: string;
  sessionId: string;
  status: "VALID" | "PENDING_REVIEW";
  serverTimestamp: string;
}

export interface LocationHeartbeatResult {
  insideGeofence: boolean;
  distanceMeters: number;
  receivedAt: string;
}
