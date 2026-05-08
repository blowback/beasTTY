# Phase 11 Deferred Items

Items discovered during Plan 11-01 execution that are out of scope for this plan
(per executor SCOPE BOUNDARY rule — only auto-fix issues directly caused by the
current task).

## 2026-05-08 — Plan 11-01 Task 2 baseline run

| Item | Spec | Reproduction | Notes |
|------|------|--------------|-------|
| `slide-dispatcher.spec.js:90` post-feed-invariant-ESC-Z-returns-host-reply | Pre-existing | Fails ~1/N runs under full 10-worker parallel test:fast load; timeout polling for `_reader`. Passes 7/7 in isolation. | Same parallelism-flake class noted in Phase 10's `deferred-items.md` (slide-cancel timing-window flake). The Plan 11-01 mock-bot extension does NOT touch the dispatcher path — `bot.send.wakeupDelayMs` defaults to 0 so `pushSlideHostWakeup` behavior is byte-identical to the Phase 9/10 implementation. |
