# FASTDO ATTEND — Production monitoring

## Structured event contract

Cloud Functions emit JSON logs with:

- `component=fastdo-attend`
- `event` — for example `CHECK_IN_DECIDED`, `CHECK_IN_FAILED`, `CHECK_OUT_RECORDED`, `ATTENDANCE_CORRECTION_REVIEWED`, `LEAVE_REVIEWED`, `PAYROLL_CSV_EXPORTED`, `RATE_LIMIT_EXCEEDED`
- `functionName`, `status`, `durationMs`, `riskScore`, `rowCount`, `truncated`
- optional tenant-safe `companyId`/`branchId`

Logs deliberately omit employee IDs, coordinates, Face descriptors, raw images/video, tokens, secrets and request payloads.

## Cloud Logging queries

In Google Cloud Logging, select resource **Cloud Function** and use queries like:

```text
jsonPayload.component="fastdo-attend"
jsonPayload.event="CHECK_IN_FAILED"
```

```text
jsonPayload.component="fastdo-attend"
jsonPayload.event="RATE_LIMIT_EXCEEDED"
```

```text
jsonPayload.component="fastdo-attend"
jsonPayload.event="CHECK_IN_DECIDED"
jsonPayload.durationMs>=8000
```

For a pilot branch, add `jsonPayload.branchId="<branch-id>"` only inside an authorized operations view.

## Recommended alerts

Create log-based metrics and alerts with an evaluation window of 5–15 minutes:

| Alert | Starting threshold | Response |
| --- | --- | --- |
| Check-in failures | ≥5 `CHECK_IN_FAILED` events / 5 min | Inspect Functions errors and App Check/Auth; if user impact is broad, set branch policy to `OFF`. |
| High latency | ≥5 `CHECK_IN_DECIDED` events with `durationMs >= 8000` / 10 min | Check Cloud Functions latency, Firestore indexes and regional quota. |
| Rate limiting | ≥20 `RATE_LIMIT_EXCEEDED` events / 5 min | Check abuse, retry loops or a broken client release; do not disable rate limiting blindly. |
| Payroll truncation | Any `PAYROLL_CSV_EXPORTED` with `truncated=true` | Require a narrower period/branch before payroll reconciliation. |
| Billing/quota | Firebase/Cloud Billing budget ≥50%, 80%, 100% | Review invocations, Firestore reads/writes and Cloud Run CPU quota. |

Thresholds are pilot defaults; the owner must tune them after the first 1–2 weeks of normal traffic.

## Release verification

1. Run `npm run lint`, `npm run test` and `npm run test:functions`.
2. Run the emulator smoke suite when Java is available:

   ```bash
   firebase emulators:exec --only auth,firestore,functions "npm --prefix functions run test:emulators"
   ```

3. Confirm all callable Functions are `ACTIVE` and Firestore Rules compile.
4. Open the production Vercel deployment and verify the source commit is `main`.
5. Trigger one controlled check-in/check-out in `MONITOR`; confirm an operational event appears without biometric/location payloads.
6. Record the release commit, test output, deployment timestamp and any known gate still blocked.

## Known gate

The local Windows environment may not have Java, which is required by the Firebase Firestore emulator. Until the suite runs in local or CI, the emulator gate remains **blocked**, even when unit/build tests are green. Do not mark tenant isolation, Rules and transaction concurrency as fully verified without that run.
