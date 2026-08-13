type OperationalValue = boolean | number | string | null;

interface OperationalEvent {
  event: string;
  functionName: string;
  companyId?: string;
  branchId?: string;
  status?: string;
  durationMs?: number;
  riskScore?: number;
  rowCount?: number;
  truncated?: boolean;
  errorCode?: string;
  metadata?: Record<string, OperationalValue>;
}

function emit(severity: "INFO" | "WARNING" | "ERROR", input: OperationalEvent): void {
  // Keep logs structured and deliberately omit user IDs, coordinates, Face
  // descriptors, tokens, secrets and raw request payloads.
  console.log(JSON.stringify({
    severity,
    component: "fastdo-attend",
    timestamp: new Date().toISOString(),
    ...input,
  }));
}

export function logOperationalEvent(input: OperationalEvent): void {
  emit("INFO", input);
}

export function logOperationalWarning(input: OperationalEvent): void {
  emit("WARNING", input);
}

export function logOperationalError(input: OperationalEvent): void {
  emit("ERROR", input);
}
