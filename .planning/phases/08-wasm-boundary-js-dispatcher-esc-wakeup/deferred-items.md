# Deferred items — Phase 08

Out-of-scope discoveries during phase execution. Not fixed by Phase 8 plans
(scope boundary — only fix issues directly caused by current task changes).

## Pre-existing test/source filename mismatch (session-log.js)

**Found during:** Plan 08-03 execution (regression run on `pnpm playwright test session/`)

**Failing tests:**
- `tests/session/log-download.spec.js:57` — "download produces correct Blob with all bytes (application/octet-stream)"
- `tests/session/log-download.spec.js:94` — "filename uses connect-time UTC stamp YYYYMMDD-HHMMSS.bin"

**Symptom:** Both tests assert `expect(download.suggestedFilename()).toMatch(/^bestialitty-\d{8}-\d{6}\.bin$/)` but the source emits `beastty-{stamp}.bin`.

**Root cause:** Source/test name drift — commit `7571ce0` ("Reluctantly retire highly-amusing pun name in favour of 'BeasTTY'") renamed the download filename in `www/transport/session-log.js:91-99` from `bestialitty-` to `beastty-` but did not update `www/tests/session/log-download.spec.js` lines 66 + 103.

**Why deferred:** Pre-existing failure, completely unrelated to Plan 08-03's dispatcher work. The dispatcher does not touch session-log.js or its filename generator. Per scope boundary rule, do not fix issues outside the current task's changes.

**Recommended fix:** Phase 06 or a follow-up phase should either:
1. Update the test regex to `/^beastty-\d{8}-\d{6}\.bin$/`, or
2. Revert the source rename if `bestialitty-` is the canonical filename.
