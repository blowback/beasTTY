# Phase 11 Deferred Items

Items discovered during Plan 11-01 execution that are out of scope for this plan
(per executor SCOPE BOUNDARY rule — only auto-fix issues directly caused by the
current task).

## 2026-05-08 — Plan 11-01 baseline runs (intermittent parallelism flakes)

Across the 4 test:fast runs during Plan 11-01 execution, 3 different specs
flaked once each under full 10-worker parallel load; all passed cleanly in
isolation and on retry. Same flake class as Phase 10's `deferred-items.md`
(slide-cancel timing-window flake). The Plan 11-01 changes are purely
additive (4 new spec stub files registered as `test.skip`, mock-bot
extension defaults wakeupDelayMs to 0 preserving Phase 9/10 byte-identical
behavior, prefs DEFAULTS adds 3 keys with no read-path change).

| Spec / test | Class | In-isolation pass | Notes |
|-------------|-------|-------------------|-------|
| `slide-dispatcher.spec.js:90` post-feed-invariant-ESC-Z-returns-host-reply | parallelism flake | 7/7 | Timeout polling for `_reader` under wasm-boot starvation |
| `slide-wakeup.spec.js:162` benign-ESC-caret-A | parallelism flake | 13/13 | Same wasm-boot starvation pattern |
| `slide-sender.spec.js:178` window.__slide introspection reports state + progress | parallelism flake | (greens on retry) | Same class |

3rd test:fast run: 81/81 green. Plan 11-01 changes do not touch any code
paths exercised by these tests.
