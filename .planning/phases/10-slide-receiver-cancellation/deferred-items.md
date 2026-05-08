# Phase 10 — Deferred Items

Pre-existing issues discovered during Phase 10 execution that fall OUTSIDE
the scope of Phase 10 (Plan 10-05 SCOPE BOUNDARY). Logged here for triage in
a future phase / gap-closure plan; NOT auto-fixed by Plan 10-05.

## DEF-10-01: log-download.spec.js filename mismatch — RESOLVED 2026-05-08

**Discovered:** Plan 10-05 verification run (`npx playwright test`).

**Symptom:**
```
SESS-04/SESS-05 — download produces correct Blob with all bytes
SESS-04/SESS-05 — filename uses connect-time UTC stamp YYYYMMDD-HHMMSS.bin
```
Both fail because the test expects filename `bestialitty-YYYYMMDD-HHMMSS.bin`
but production code (`www/transport/session-log.js:99`) emits
`beastty-YYYYMMDD-HHMMSS.bin`.

**Root cause:** Project renamed BestialiTTY → Beastty (lowercase). Production
was updated; tests were not.

**Resolution:** User confirmed the project is renamed to `beastty` going
forward. Updated both test regex assertions in
`www/tests/session/log-download.spec.js` (lines 66 + 103) from
`/^bestialitty-\d{8}-\d{6}\.bin$/` to `/^beastty-\d{8}-\d{6}\.bin$/`.
7/7 log-download.spec.js tests green.

## Flake-watch: slide-cancel timing window test under heavy parallel load

**Symptom:** Under `npx playwright test` (full suite, 10 workers) the
`cancel timing windows — 500 ms echo wait + 100 ms drain` test occasionally
times out. Under reduced parallelism (`--workers=2`) it passes consistently.

**Root cause:** Worker contention on the dev server reduces per-worker
clock budget; the cancel sequence uses 2-second absolute timeouts but the
500 ms echo-wait can starve under load.

**Mitigation already applied:** Generous slack already encoded per
T-10-flake-timer in 10-05-PLAN.md threat model. This is the residual
flake under extreme load — it does NOT reproduce under realistic test
conditions.

**Recommended fix (future):** If flake recurrence is observed under normal
runs, raise the test-only timeout in slide-cancel.spec.js by another 200 ms.
