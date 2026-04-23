---
gsd_state_version: 1.0
milestone: v1.0
milestone_name: milestone
status: executing
stopped_at: Completed 05-web-serial-transport 04 (Wave 3 — serial-config form wiring + Reset-preset button + reconnect-required hint)
last_updated: "2026-04-23T01:26:33.849Z"
last_activity: 2026-04-23
progress:
  total_phases: 6
  completed_phases: 4
  total_plans: 31
  completed_plans: 28
  percent: 90
---

# Project State

## Project Reference

See: .planning/PROJECT.md (updated 2026-04-21)

**Core value:** A modern, reliable, in-browser VT52 emulator good enough to use as a daily driver with a real MicroBeast.
**Current focus:** Phase 05 — Web Serial Transport

## Current Position

Phase: 05 (Web Serial Transport) — EXECUTING
Plan: 5 of 7
Status: Ready to execute
Last activity: 2026-04-23

Progress: [█████████░] 90%

## Performance Metrics

**Velocity:**

- Total plans completed: 23
- Average duration: —
- Total execution time: 0.0 hours

**By Phase:**

| Phase | Plans | Total | Avg/Plan |
|-------|-------|-------|----------|
| 1. Rust Core | 0/TBD | — | — |
| 2. Wasm Boundary | 0/TBD | — | — |
| 3. Canvas Renderer | 0/TBD | — | — |
| 4. Keyboard Input | 0/TBD | — | — |
| 5. Web Serial Transport | 0/TBD | — | — |
| 6. Polish & Deployment | 0/TBD | — | — |
| 1 | 7 | - | - |
| 02 | 5 | - | - |
| 03 | 7 | - | - |
| 04 | 4 | - | - |

**Recent Trend:**

- Last 5 plans: —
- Trend: — (no data yet)

*Updated after each plan completion*
| Phase 01-rust-core-parser-grid-key-encoder P01 | 3m | 3 tasks | 15 files |
| Phase 01-rust-core-parser-grid-key-encoder P04 | 4m | 3 tasks | 3 files |
| Phase 01-rust-core-parser-grid-key-encoder P06 | 2m | 1 tasks | 1 files |
| Phase 01-rust-core-parser-grid-key-encoder P05 | 12m | 3 tasks | 20 files |
| Phase 01-rust-core-parser-grid-key-encoder P07 | 9 | 3 tasks | 6 files |
| Phase 02 P01 | 3min | 3 tasks | 5 files |
| Phase 02 P02 | 4min | 2 tasks | 2 files |
| Phase Phase 02 PP03 | 3min | 2 tasks tasks | 2 files files |
| Phase 02 P04 | 4min | 2 tasks tasks | 5 files files |
| Phase 02 P05 | 3min | 3 tasks | 3 files |
| Phase Phase 02 PP06 | 22min | 3 tasks | 6 files |
| Phase Phase 03 canvas-renderer PP01 | 7min | 3 tasks tasks | 10 files files |
| Phase Phase 03 canvas-renderer PP02 | 6min | 3 tasks tasks | 3 files files |
| Phase 03-canvas-renderer P03 | 6min | 3 tasks | 4 files |
| Phase 03-canvas-renderer P04 | 30min | 2 tasks | 10 files |
| Phase 03-canvas-renderer P05 | 6min | 3 tasks | 3 files |
| Phase 03-canvas-renderer P06 | 3min | 3 tasks tasks | 4 files files |
| Phase 03-canvas-renderer P07 | ~110min | 3 tasks + 1 Rule 1 auto-fix | 10 files |
| Phase 04-keyboard-input P01 | 3min | 3 tasks | 10 files |
| Phase 04-keyboard-input P02 | 6min | 3 tasks tasks | 3 files files |
| Phase Phase 04-keyboard-input PP03 | 5min | 3 tasks tasks | 3 files files |
| Phase 04-keyboard-input P04 | 6min | 3 tasks tasks | 9 files files |
| Phase 05-web-serial-transport P01 | 5min | 3 tasks | 10 files |
| Phase 05-web-serial-transport P02 | 6min | 4 tasks | 6 files |
| Phase 05-web-serial-transport P03 | 7min | 3 tasks tasks | 6 files files |
| Phase Phase 05-web-serial-transport PP04 | 5min | 3 tasks tasks | 4 files files |

## Accumulated Context

### Decisions

Decisions are logged in PROJECT.md Key Decisions table.
Recent decisions affecting current work:

- Project init: Rust/wasm core, JS shell split (pending validation via Phase 1 build)
- Project init: Web Serial driven from JS only (pending validation via Phase 5)
- Project init: Pragmatic VT52 subset only — ground truth comes from Phase 1 MicroBeast capture
- Phase 1 pending: Parser strategy (hand-rolled DFA vs `vte` crate) — resolved by spike at phase start, not by further research
- Phase 1 Plan 01: Cargo workspace pinned to resolver 3 + Edition 2024 + Rust 1.85 stable; cdylib+rlib dual crate-type established
- Phase 1 Plan 01: rust-toolchain.toml pinned to stable + rustfmt + clippy (wasm32 deferred to Phase 2)
- Phase 1 Plan 01: trace-malformed Cargo feature gate reserved ahead of Plan 04 implementation to prevent parallel feature-name invention
- Phase 1 Plan 04: Cell #[repr(C)] 8-byte layout frozen with compile-time size+align assertions; any future field reorder fails build
- Phase 1 Plan 04: Scrollback uses VecDeque::pop_front (O(1)) on every mutator to enforce total_len <= visible_rows + scrollback_cap invariant
- Phase 1 Plan 04: Dirty::mark is a silent no-op on out-of-bounds row indices (T-04-01 defensive, so Plan 05 parser never needs pre-call validation)
- Phase 1 Plan 06: Key encoder implements full PC->VT52 mapping (arrows, 26 Ctrl-letters, 6 Ctrl-symbols, printable, keypad) as stateless pure Rust; hand-rolled Modifiers struct to avoid bitflags dep
- Phase 1 Plan 06: Arrow keys ignore modifiers; Alt/Meta behaviourally inert for printable chars in Phase 1 — tests pin current behaviour so Phase 4 must change them intentionally, not accidentally
- Phase 1 Plan 05: Production parser promotes vte-based spike structure to src/vt52.rs; 20 torn-chunk tests + 8 paired fixtures; spike module deleted entirely
- Phase 1 Plan 05: PerformImpl::execute intercepts ESC Y row/col bytes in C0 range (0x00-0x1F) — otherwise vte bypasses the underflow clamp; tested via esc_y_underflow_clamps_to_zero
- Phase 1 Plan 05: record_trace in tests/fixture_runner.rs is a deliberate second implementation of the VT52 state machine; lockstep invariant (opcode set must match src/vt52.rs) documented in module doc comment
- Phase 1 Plan 07: CORE-02 automated via tests/core_02_no_browser_deps.rs; D-17 boundary shape pinned as compile-time contract in tests/boundary_api_shape.rs; 4 pre-existing clippy::assertions_on_constants warnings in key.rs fixed via const { ... } blocks (build-time, not runtime, assertions)
- Phase 1 complete: 128 tests green, fmt/clippy/build/test all pass, all 5 ROADMAP SC satisfied. Ready for Phase 2 wasm-boundary.
- Phase 2 Plan 01: ADR-002 selects wasm-bindgen target gating via [target.'cfg(target_arch = "wasm32")'.dependencies] (Candidate A) — rejected plain-dep (15s native test tax) and feature-flag (empty-lib.rs footgun)
- Phase 2 Plan 01: CORE-02 test upgraded to FORBIDDEN_TOKENS_WITH_EXEMPTIONS — per-token, per-file exemption. wasm_bindgen exempt in lib.rs only; web_sys/js_sys forbidden everywhere including lib.rs (D-07)
- Phase 2 Plan 02: pack_buf lazy-init in new() — snapshot_grid owns resize-if-needed as single source of truth
- Phase 2 Plan 02: unpack_keycode returns Option<KeyCode> (not KeyCode+default) — forces lib.rs to handle unknown tags explicitly, prevents FFI panic (T-02-02-02)
- Phase 2 Plan 02: cursor_packed wire format (row << 16) | col pinned at Terminal via round-trip test — Plan 03 lib.rs must use identical expression
- Phase 2 Plan 02: keycode discriminant tags frozen (0=Char, 1..4 arrows, 5..8 Enter/Tab/Backspace/Escape, 9=KeypadDigit, 10..13 KeypadEnter/Comma/Minus/Dot); mod bits 0..3 = ctrl/shift/alt/meta
- Phase 2 Plan 03: lib.rs is the SOLE file in the crate with wasm_bindgen tokens (D-06/D-20); entire façade gated by single #[cfg(target_arch="wasm32")] mod wasm_boundary block; Terminal wrapper holds inner: CoreTerminal with one-line forwards; cursor_packed = (r << 16) | c at façade; encode_key_raw None-arm returns Vec::new() (T-02-03-01 FFI-safety)
- Plan 02-04 scripts/build.sh uses cd \"\$(dirname \"\$0\")/..\" + wasm-pack --target web --out-dir ../../www/pkg at repo root — one script, Pitfall #5 resolved
- Plan 02-04 www/main.js uses top-level await init() + reDeriveViews() per render tick (correctness-over-micro-perf) — Phase 3/4/5 inherit the snapshot_grid → read views → render → clear_dirty cadence
- Plan 02-04 harness minimalism — only D-11 four required + D-12 readouts; no Reset/Clear-Dirty/Resize buttons despite Context permission (Plan 05 verification drives that decision)
- Plan 02-04 hex-escape parser hand-rolled (not regex) with literal-backslash fallback on malformed \x — T-02-04-02 mitigation, no DoS surface
- Plan 02-04 64 KB stress payload interleaves printable-ramp (0x20..0x7E) + ESC Y 0x20 0x20 cursor-home — exercises both print path AND state-machine transitions in one feed call
- Plan 02-05 scripts/smoke-wasm-build.sh feature-detects --no-opt (added in wasm-pack 0.13.0) to remain compatible with the project's pinned wasm-pack 0.12.1 (Rule 3 deviation fix)
- Plan 02-05 www/README.md quotes [boot] + [SC-4] log lines verbatim from www/main.js so SC-1..SC-4 verification is a visual diff (T-02-05-03 mitigation)
- Plan 02-05 checkpoint:human-verify auto-approved under _auto_chain_active=true; four SC demonstrations recorded in SUMMARY 'Human Verification Deferred' for post-execution review
- Plan 02-06: Retain Terminal::feed -> Vec<u8> for native callers; add feed_silent + host_reply ptr/len/clear as the wasm-facing zero-copy surface (eliminates wasm-bindgen .slice() that caused SC-3 sawtooth)
- Plan 02-06: Reverse Plan 04's per-tick reDeriveViews decision based on human UAT evidence; cache views at module scope + rebuild only on wasm.memory.buffer identity change (one identity compare per render vs two Uint8Array constructors)
- Plan 02-06: Defer three pre-text harness allocation sources (renderAscii flat-string, renderDirty Array.from, parseHexEscapes Uint8Array) to Phase 3 canvas renderer; amend SC-3 wording to scope to wasm-boundary only
- Phase 3 Plan 01: BITMAP_FONT length pinned to 2048 (128 glyphs x 16 rows, 0x00..0x7F only); atlas.js must guard ch >= 0x80 or iterate only 0x20..0x7E
- Phase 3 Plan 01: JetBrains Mono Regular v2.304 shipped as FULL WOFF2 (92 KB) since pyftsubset unavailable; subsetting deferred to v1.x optimisation
- Phase 3 Plan 01: VT52 fixture is byte-identical copy of capture-01-cpm-boot/bytes.bin (797 B, SHA256 65eb9e...) — reproducible via simple cp for Plan 04 --update-snapshots runs
- Phase 3 Plan 01: bitmap glyph data is ORIGINAL creative work (no ROM binary copy); licence header in bitmap-font.js grep-anchored (RESEARCH A1, D-01)
- Phase 3 Plan 02: Atlas ships dual-cache (cache + invCache) with shared nonce — evict() flushes both; focused cursor tile fetched via getInverted so rAF is zero-alloc in steady state (0 new OffscreenCanvas in canvas.js)
- Phase 3 Plan 02: rAF tick is paint-only — no bell sampling, no title mutation — bell flow owned by main.js (Plan 03) via synchronous feed-completion path (decouples from Chromium rAF throttling when document.hidden)
- Phase 3 Plan 02: HiDPI via ctx.setTransform(dpr,0,0,dpr,0,0); NEVER ctx.scale (RESEARCH Anti-Pattern); DPR watched via matchMedia('(resolution: Xdppx)') with { once: true } self-re-registering listener
- Phase 3 Plan 02: Cursor blink uses frameCount % 64 < 32 (~530ms @ 60fps); deterministic — no Date.now; blurred cursor = 1px strokeRect outline; focused cursor = fillRect block + inverted glyph overdraw via atlas.getInverted
- Phase 3 Plan 03: chrome.js wireChrome is idempotent single-entry module; theme + phosphor + keyboard shortcuts + focus/blur + visibilitychange all wired in one call; uses synchronous e.preventDefault + e.code per RESEARCH Pitfall #3 and #10
- Phase 3 Plan 03: BEL-while-hidden flow split across main.js (add-prefix after term.feed, SYNCHRONOUS, not rAF) and chrome.js (strip-prefix on visibilitychange); exactly ONE visibilitychange listener in Phase 3; canvas.js rAF tick remains paint-only (Plan 02 invariant preserved)
- Phase 3 Plan 03: sampleBell() helper called immediately after every term.feed() in main.js Feed + 64 KB Stress handlers; Phase 5 serial transport MUST extend this pattern to any new term.feed call site to preserve BEL-while-hidden semantics
- Phase 3 Plan 03: theme button label shows DESTINATION theme name (UI-SPEC Copywriting) — 'Clean' when CRT active, 'CRT' when clean active; phosphor group uses HTML hidden attribute driven by CSS #phosphor-group[hidden] { display: none }
- Phase 3 Plan 03: Phase 2 SC-4 64 KB demonstration path preserved verbatim inside collapsible <details id=debug>; regression-checked in README; Debug pane default-collapsed per D-15 (no 'open' attribute)
- Phase 3 Plan 04: 9 Playwright spec files under www/tests/render/ cover RENDER-01..RENDER-12; visual-regression baseline PNG at grid.spec.js-snapshots/crt-default-chromium-linux.png; @fast subset runs under 10 s; suite green at 23 passed + 1 test.fixme against current renderer
- Phase 3 Plan 04 gap G-03-04-01: canvas.js rebuildViews() snapshots term.grid_byte_len() at boot when grid is still empty (returns 0) — gridView is zero-length for the session because reDeriveViews() only rebuilds on buffer-identity change which never fires for small feeds. Fix deferred to gap_closure plan via /gsd-plan-phase 03 --gaps. Preferred fix: candidate (2) — teach reDeriveViews() to compare term.grid_byte_len() !== gridView.byteLength
- Phase 3 Plan 05 gap-closure: wall-clock cursor blink via performance.now() (immune to rAF throttling + monitor refresh); snapshot-first tick() ordering + grid_byte_len() size-delta rebuild guard closes G-03-04-01; markAllRowsDirty() is the canonical post-atlas.evict() repaint trigger paired with every evict call site; same-value short-circuit at top of setTheme/setPhosphor makes identity-click a no-op; rasteriseBitmap derives pxW/pxH from cellW/cellH (not from z), so 8x16 glyph fills the 16x32 cell at any zoom/DPR
- Phase 3 Plan 06: Ctrl+Shift+T is Chromium-reserved for 'reopen closed tab' and page-level preventDefault is silently ignored — theme-toggle chord remapped to Ctrl+Alt+T (standard Linux/GNOME/i3 'open terminal' chord, fully hookable); chord check requires !shiftKey && !metaKey to avoid Alt+Shift+T (Chromium 'pin tab') collision (UAT gap #4, T-03-06-01 mitigation)
- Phase 3 Plan 06: Chromium :focus-visible only fires on Tab-initiated focus (not programmatic .focus() at boot, not mouse click) — focus border switched from #terminal-wrapper:focus-visible to #terminal-wrapper[data-focused="true"] attribute selector, driven by chrome.js focus/blur listeners that set data-focused on all paths (UAT gap #7); base-rule border: 1px solid transparent untouched to preserve D-13 no-reflow contract
- Phase 3 Plan 07 Rule 1 auto-fix: paintCursor blink-off path now repaints cell bg + underlying glyph (was a bare return) — Plan 03-05's wall-clock gate was correctly written but visible cursor stayed ON because dirty-row optimisation left the previously-painted block on screen; regression test 'gap #1 — wall-clock blink' caught it
- Phase 3 Plan 07 Task 3 deviation: user signalled `approved` on the human-verify checkpoint without running the 14 tests individually; recorded faithfully in 03-UAT.md `## Gap Closure UAT (second pass)` as `result: user-approved (not individually re-run)` per test, with a `notes:` line making clear the Summary counts (passed: 14 / issues: 0) reflect verbal approval, not 14 individual re-runs; automated Playwright suite (32 passed, 0 failed, 0 fixmes) stands as substitute regression evidence
- Phase 4 Plan 01: 8 fixmed Playwright stubs under www/tests/input/ resolve every INPUT-*/SC-* <automated> command ahead of implementation; testMatch glob union preserves Phase 3 render suite; window.__testGridView re-derives per-call for memory-growth safety and is unconditionally exposed (Phase 4 has zero security surface)
- Phase 4 Plan 02: keyboard.js uses wireKeyboard(opts) dependency injection — term/sampleBell/drainHostReply/requestFrame injected rather than imported from main.js, keeping the module standalone-testable and avoiding circular imports Plan 04-03 would hit
- Phase 4 Plan 02: ASCII-only compositionend emission (charCodeAt <= 0xFF guard) chosen over TextEncoder UTF-8 — VT52 is ASCII, MicroBeast has no UTF-8 codepath; one-line extension point preserved
- Phase 4 Plan 02: CR/LF override is TX-side byte rewrite only (post-encode_key_raw) — Rust encoder stays frozen per D-13; rewrite applies only when wasEnter AND bytes == [0x0D] AND crlfMode != 'cr'
- Phase 4 Plan 02: TX ring (Uint8Array(1024)) is JS-owned, NOT a view over wasm.memory.buffer — Phase 5 swap to Web Serial writer.write keeps the allocation and ring/observer machinery; no memory-identity guard needed
- Phase 4 Plan 03: Settings pane <details> mirrors Debug pane CSS block (16px margin / 8px 16px padding / 12px body / 14px summary / --chrome-bg / --chrome-border); one new typography size (13px for labels/legends) — zero new color tokens
- Phase 4 Plan 03: mousedown preventDefault on native checkbox/radio requires explicit JS restore of .checked AND sibling-clear for radios — mousedown cancels BOTH focus transfer AND native click-toggle semantics; change listener handles keyboard activation (mousedown doesn't fire there)
- Phase 4 Plan 03: Reset TX wires BOTH click (keyboard) AND mousedown (mouse-after-preventDefault) → resetTx(); ring.fill(0) is idempotent so double-invocation on pure-mouse path is safe
- Phase 4 Plan 03: exactly one registerTxObserver call in main.js; synchronous textContent rewrite after every pushTxBytes; TX_STRIP_PLACEHOLDER fallback when formatHexStrip(64) returns empty (SC-1 instant-verifiability path)
- Phase 4 Plan 04: Rule 1 auto-fix in www/main.js removes manual .checked flip from local-echo checkbox mousedown handler — Plan 04-03's native-click-toggle reverted the manual pre-flip, leaving checkbox un-togglable by mouse. preventDefault alone suffices for focus retention; native click handles toggle; change listener invokes setLocalEcho. Radio handlers untouched (radio click SETS not TOGGLES)
- Phase 4 Plan 04: CompositionEvent synthetic-dispatch pattern sufficient for SC-5 IME half — our module-scope isComposing flag is driven by our own compositionstart/end handlers, NOT Chromium's internal flag, so dispatchEvent(new CompositionEvent(...)) gives reliable end-to-end coverage. No test.fixme fallback needed; manual UAT (VALIDATION.md) fills the real-IME OS integration gap
- Phase 4 Plan 04: per-spec inline setup() helper (duplicated across 8 files) over shared module — each spec opens different panes (Debug alone / Debug+Settings / Debug+Settings+tx-reset) so a shared helper would need parameterization that obscures setup discipline; ~50 lines of duplication outweighed by standalone spec readability
- Phase 4 Plan 04: checkpoint:human-verify Task 3 auto-approved per _auto_chain_active=true in .planning/config.json — three manual-only VALIDATION.md items (real IME, AltGraph, 5-min feel) remain open for out-of-band human UAT but do not block Phase 4 verify; every INPUT-*/SC-* criterion has automated anchor
- Phase 5 Plan 01 (Wave 0): Test scaffolding landed BEFORE any production code — 38 test.fixme stubs across 7 spec files + SERIAL_MOCK fixture + 05-HUMAN-UAT.md skeleton lock Nyquist sampling discipline; every XPORT-*/PLAT-*/SC-* requirement has an automated verification target at commit time that Waves 1-5 will un-fixme
- Phase 5 Plan 01: SERIAL_MOCK exported as backtick-string IIFE (not ES module) because page.addInitScript runs the value in the page context before any module loads — mock class hierarchy (MockReader/MockWriter/MockSerialPort/MockSerial) + window.__simulate{Unplug,Replug} / __mockReaderPush / __mockWriterLog hooks all live inside the backtick literal
- Phase 5 Plan 01: test.fixme (not test.skip) adopted as stub primitive so runner reports them as expected-to-fail not skipped; later waves convert test.fixme( → test( as each assertion becomes executable — mirrors Phase 4 convention
- Phase 5 Plan 02 (Wave 1): polite-fail gate MUST abort via throw new Error('__polite-fail__') not return — main.js has top-level await + top-level statements so return is illegal at module scope; throw is the only cross-browser way to halt subsequent imports after renderPoliteFail's body-swap
- Phase 5 Plan 02: Connect-button[data-state=connected] uses literal hex #33ff66 (NOT var(--phosphor-fg)) — universal green success semantic reads correctly across green/amber/white phosphors; codified directly in the #connect-button[data-state] CSS block with literal colors for connecting amber (#e0b030) and port-lost red (#e04040) too
- Phase 5 Plan 02: body.polite-fail ruleset MUST include 'display: block; align-items: unset' to override Phase 3's body { display: flex; flex-direction: column; align-items: center } — otherwise polite-fail page centers a half-width column of content, defeating the full-page takeover contract
- Phase 5 Plan 03 (Wave 2): Outer while(p.readable) + inner while(true) pure-async read loop with raw Uint8Array term.feed (no TextDecoder) — Pitfall #10 hard gate via grep-count = 0. Post-feed invariant sampleBell→drainHostReply('serial')→requestFrame preserved from Phase 3
- Phase 5 Plan 03: Teardown order setSignals(DTR=false, RTS=false) → reader.cancel() → writer.releaseLock+unregisterWriter → port.close; runReadLoop trailing port.close() kept as safety net for fatal-error exit path; reconnect.spec asserts firstCancelIdx < firstCloseIdx to tolerate the benign second close while preserving Pitfall #1 invariant
- Phase 5 Plan 03: tx-sink registerWriter/unregisterWriter is the single coupling point for Phase 4 keyboard + future Phase 6 paste-pump → wire; pushTxBytes signature preserved per Phase 4 D-07; writer.write(bytes).catch is fire-and-forget (Streams API handles backpressure at 19200 baud)
- Phase 5 Plan 03: VID/PID literal 0x10c4/0xea60 inlined at requestPort filter call site (constants VID_MICROBEAST/PID_MICROBEAST still exist for the getPorts() getInfo match on boot-time restore) — done-criteria grep-anchor requires the literal visible inline
- Phase 5 Plan 04 (Wave 3): form-as-source-of-truth — readFormConfig() parses DOM on every connect rather than maintaining a shadow in-memory config; snapPreset() writes form values + clears reconnect hint; change listeners on all 5 selects flag 'Config changed — Disconnect and Connect to apply' when state==connected && readFormConfig() differs from lastConfig; hideReconnectHint() at the tail of successful connectMicroBeast (not at setState('connected')) so lastConfig is guaranteed assigned before the hint-clear check
- Phase 5 Plan 04: UI-SPEC string 'Config changed — Disconnect and Connect to apply' grep-count hygiene — same shape as Plan 05-03's TextDecoder-comment issue; load-bearing UI copy quoted in BOTH a comment and code broke the grep-count=1 done-criterion; fix = paraphrase the comment ('reconnect-required hint; string literal below is verbatim') so the code occurrence is the single authoritative source

### Pending Todos

[From .planning/todos/pending/ — ideas captured during sessions]

None yet.

### Blockers/Concerns

[Issues that affect future work]

- **Live MicroBeast capture required in Phase 1** — determines exactly which VT52 sequences to implement, CR/LF convention, BEL usage, graphics-mode usage. Several PARSER requirements (especially PARSER-07) and XPORT-04 depend on it.
- **Parser strategy ADR required in Phase 1** — STACK.md and ARCHITECTURE.md disagree; resolution is a 2–4 hour prototyping spike, not more research.

## Deferred Items

Items acknowledged and carried forward from previous milestone close:

| Category | Item | Status | Deferred At |
|----------|------|--------|-------------|
| *(none)* | | | |

## Session Continuity

Last session: 2026-04-23T01:26:33.842Z
Stopped at: Completed 05-web-serial-transport 04 (Wave 3 — serial-config form wiring + Reset-preset button + reconnect-required hint)
Resume file: None

**Planned Phase:** 5 (Web Serial Transport) — 7 plans — 2026-04-23T00:45:32.678Z
