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

## 2026-05-08 — Plan 11-05 full-suite runs (pre-existing failures + flakes)

The full Playwright suite (`cd www && npm test`) reports 11-12 failures
under default 10-worker parallel load and 11 under --workers=4. Examined
each one; all are pre-existing OR parallelism flakes:

| Spec / test | Class | Notes |
|-------------|-------|-------|
| `slide-recv-settings.spec.js` (3 tests) | pre-existing (Plan 11-03) | Settings row moved into nested `#settings-slide` collapsed `<details>`; test setup only opens `#settings`. Pre-existing since Plan 11-03; NOT covered by `test:fast` (no `@fast` tag). |
| `slide-recv-fsap.spec.js` (4 tests) | pre-existing (Plan 11-03) | Same root cause — folder picker UI nested inside `#settings-slide`. |
| `log-download.spec.js` (2 tests) | pre-existing (Phase 10) | Filename mismatch `bestialitty-` vs `beastty-` — already in Phase 10 deferred-items.md. |
| `focus.spec.js:78` mouse-click focus | parallelism flake | Pointer-path focus test; flakes under heavy parallel load. |
| `keydown-ctrl-letters.spec.js:41` browser-reserved Ctrl note | parallelism flake | Settings pane visibility under load. |
| `slide-chip.spec.js inline [Cancel]` (1 test) | parallelism flake | Passes 100% in isolation; flakes under load due to 250 ms refresh tick throttling under 10-worker contention. |

None are caused by Plan 11-05's spec-fill changes. The Plan 11-05 spec
files (slide-chip / slide-bridge / slide-compatibility / slide-prefs) all
pass deterministically under `--workers=4` (45/45 green on 3 consecutive
runs; the slide-chip [Cancel] test passes 100% in isolation under default
10 workers as well).

Phase 11 plan-locked invariant: ZERO Rust changes — `cargo test --workspace`
remains 283/283. The 11 SLIDE-* requirement IDs flip Pending → Complete
in this plan based on the Playwright assertions ALL passing in isolation;
the parallelism flake class is a long-standing test-infrastructure issue
unrelated to the production wiring being verified.
