---
phase: 8
slug: wasm-boundary-js-dispatcher-esc-wakeup
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-05-07
---

# Phase 8 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | Rust `cargo test` (native) + Playwright 1.x (browser) |
| **Config file** | `crates/bestialitty-core/Cargo.toml`, `www/playwright.config.js` |
| **Quick run command** | `cargo test -p bestialitty-core --lib slide && (cd www && pnpm playwright test transport/slide-*.spec.js)` |
| **Full suite command** | `cargo test -p bestialitty-core && (cd www && pnpm playwright test)` |
| **Estimated runtime** | ~45 seconds (cargo ~10 s + Playwright ~35 s) |

---

## Sampling Rate

- **After every task commit:** Run `cargo test -p bestialitty-core --lib slide` for Rust changes; `pnpm playwright test transport/slide-{wakeup,dispatcher,handoff}.spec.js` for JS changes
- **After every plan wave:** Run full suite (`cargo test -p bestialitty-core && pnpm playwright test`)
- **Before `/gsd-verify-work`:** Full suite must be green; `cargo build --target x86_64-unknown-linux-gnu` and `wasm-pack build --target web` must both succeed
- **Max feedback latency:** 45 seconds

---

## Per-Task Verification Map

> Plan-level task IDs will be assigned by the planner; this table seeds the
> required test files and acceptance gates for each Phase 8 success criterion.
> The planner fills `Task ID`, `Plan`, `Wave` once plans are written.

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|
| {TBD} | {TBD} | 1 | SLIDE-05 (SC#1) | T-08-01 | wasm Slide façade compiles cleanly via wasm-pack; boundary shape stable | integration | `cargo test --test slide_wasm_boundary_shape` (or extension to `boundary_api_shape.rs`) | ❌ W0 | ⬜ pending |
| {TBD} | {TBD} | 1 | SLIDE-05 (SC#1) | T-08-02 | EVT_* constants in JS mirror match Rust values; pin test gates drift | integration | `cargo test slide_event_constants_pinned` (Phase 7) + JS-side const-mirror test | ✅ Phase 7 + ❌ W0 | ⬜ pending |
| {TBD} | {TBD} | 2 | SLIDE-17 (SC#3) | T-08-03 | 7-byte wakeup detected at every internal split point; recv mode entered | playwright | `pnpm playwright test transport/slide-wakeup.spec.js` | ❌ W0 | ⬜ pending |
| {TBD} | {TBD} | 2 | SLIDE-17 (SC#3) | T-08-04 | Benign ESC ^ followed by non-S byte does NOT trigger wakeup; prefix replayed to term.feed in order | playwright | `pnpm playwright test transport/slide-wakeup.spec.js -g "benign"` | ❌ W0 | ⬜ pending |
| {TBD} | {TBD} | 2 | SLIDE-17 (SC#3) | T-08-05 | `ESC ^ ESC ^ S L I D E` re-process clause fires; second wakeup detected | playwright | `pnpm playwright test transport/slide-wakeup.spec.js -g "re-process"` | ❌ W0 | ⬜ pending |
| {TBD} | {TBD} | 2 | SLIDE-05 (SC#2) | T-08-06 | dispatchInbound routes to term.feed when mode='terminal'; preserves post-feed invariant (sampleBell, drainHostReply, requestFrame, sessionLog.append) | playwright | `pnpm playwright test transport/slide-dispatcher.spec.js -g "post-feed invariant"` | ❌ W0 | ⬜ pending |
| {TBD} | {TBD} | 3 | SLIDE-06 (SC#4) | T-08-07 | setWireOwner('slide') silently drops pushTxBytes; writeSlideFrame bypasses keystroke ring | playwright | `pnpm playwright test input/tx-sink.spec.js -g "wire owner"` | ❌ W0 | ⬜ pending |
| {TBD} | {TBD} | 3 | SLIDE-05 (SC#5) | T-08-08 | After full wakeup match, mode='recv'; chunk residual after 7th byte forwarded to slide.feed_chunk; subsequent bytes drive receiver SM | playwright | `pnpm playwright test transport/slide-dispatcher.spec.js -g "recv mode entry"` | ❌ W0 | ⬜ pending |
| {TBD} | {TBD} | 3 | SLIDE-05 (SC#5) | T-08-09 | On slide.state() === Done or Error, mode flips back to 'terminal'; setWireOwner('terminal') called; chunk tail forwarded to term.feed | playwright | `pnpm playwright test transport/slide-dispatcher.spec.js -g "session end"` | ❌ W0 | ⬜ pending |
| {TBD} | {TBD} | 1 | invariant | — | core_02_no_browser_deps test remains green; no `std::time` in slide module | integration | `cargo test --test core_02_no_browser_deps` | ✅ existing | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] `crates/bestialitty-core/tests/slide_wasm_boundary_shape.rs` — extend or sibling-mirror Phase 7's `slide_boundary_shape.rs` with wasm-bindgen façade method-pointer pins (covers SC#1)
- [ ] `www/tests/transport/slide-wakeup.spec.js` — torn-chunk corpus (every internal split + benign partials + re-process cases) using existing `mock-serial.js` (covers SC#3)
- [ ] `www/tests/transport/slide-dispatcher.spec.js` — terminal/recv routing + post-feed invariant + recv-mode pass-through + session-end mode flip (covers SC#2, SC#5)
- [ ] `www/tests/input/tx-sink.spec.js` — extend Phase 5 spec with `wire owner` describe block (covers SC#4)
- [ ] No new framework installs — Rust cargo test and Playwright are both already present in the repo

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Real-hardware wakeup detection against patched MicroBeast slide.com | SLIDE-17 | Requires Z80 PR merged + slide.com rebuilt + physical hardware | Deferred to Phase 12 `docs/SLIDE-UAT.md` — Phase 8 verifies via Playwright mock-serial only |
| Visual confirmation that benign ESC ^ from a real Z80 program (e.g., a thermal-printer-aware CP/M utility) does not trigger SLIDE | SLIDE-17 | Requires running real Z80 software that emits ESC ^ in a non-SLIDE context; corpus tests cover the byte-stream contract | Note in Phase 12 UAT — Phase 8 verifies the byte contract only |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references (the 4 NEW test files listed above)
- [ ] No watch-mode flags
- [ ] Feedback latency < 45s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
