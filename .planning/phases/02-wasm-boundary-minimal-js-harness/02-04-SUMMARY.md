---
phase: 02-wasm-boundary-minimal-js-harness
plan: 04
subsystem: harness
tags: [wasm, harness, javascript, html, build-script, static-site, zero-copy]

# Dependency graph
requires:
  - phase: 02-wasm-boundary-minimal-js-harness
    plan: 03
    provides: "lib.rs wasm-bindgen façade exporting Terminal (constructor + 13 methods) + encode_key_raw free fn; wasm-pack build --target web produces valid pkg/ with bestialitty_core.js + bestialitty_core_bg.wasm + bestialitty_core.d.ts"
  - phase: 02-wasm-boundary-minimal-js-harness
    plan: 02
    provides: "Terminal pack_buf + snapshot_grid/grid_ptr/grid_byte_len/dirty_ptr/cursor_packed pure-Rust methods consumed by the lib.rs façade"
  - phase: 02-wasm-boundary-minimal-js-harness
    plan: 01
    provides: "wasm32 target in rust-toolchain.toml + wasm-bindgen 0.2.118 dep via [target.'cfg(target_arch=\"wasm32\")'.dependencies] that makes wasm-pack build work"
provides:
  - "scripts/build.sh — executable bash wrapper for `wasm-pack build --target web --out-dir ../../www/pkg` invoked from any cwd"
  - "www/index.html — minimal static harness page with D-11 four required affordances (textarea#input, button#feed, button#stress64k, <pre id=\"grid\">) + D-12 readouts (<pre id=\"dirty\">, <span id=\"status\">)"
  - "www/main.js — 165-line ES-module driver: imports init + Terminal + encode_key_raw, derives zero-copy Uint8Array views over wasm.memory.buffer, renders ASCII grid via textContent, wires Feed + 64 KB Stress buttons with SC-4 proof-artifact logs"
  - "www/.gitignore + repo-root .gitignore www/pkg/ entry — pkg/ is regenerable build output, never tracked"
affects:
  - "02-05 (final phase verification / bundle-size measurement): static harness is the artifact Plan 05 author-verifies in Chromium; scripts/build.sh is the build step README will document"
  - "Phase 3 (canvas renderer): inherits the per-frame cadence established here (snapshot_grid → read views → render → clear_dirty); reDeriveViews() pattern carries forward; www/ layout is the deployment unit"
  - "Phase 4 (DOM keyboard): will add keydown listener to www/main.js that calls encode_key_raw and writes the Uint8Array back to the serial stream"
  - "Phase 5 (Web Serial): adds navigator.serial code to www/main.js; the single-feed boundary call pattern proven here is exactly what reader.read() → term.feed(value) becomes"
  - "Phase 6 (deployment): www/ at the repo root is already the static-site deployable unit — no layout changes needed"

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Static site with zero build-tooling: ES-module import of the wasm-pack pkg/ directly from HTML — no npm, no bundler, no Node runtime (D-14)"
    - "Top-level await for `await init()` — Chromium ≥89 supports it natively in `<script type=\"module\">`"
    - "Zero-copy view over wasm linear memory: `new Uint8Array(wasm.memory.buffer, term.grid_ptr(), term.grid_byte_len())` — never a copy, never a slice()"
    - "Defensive view re-derivation each render tick (reDeriveViews() inside renderAscii) — two Uint8Array constructors per frame cost ~microseconds, guarantees correctness across any memory.grow / ArrayBuffer-detachment event (Pitfall #2)"
    - "Hand-rolled hex-escape parser with graceful fallback (malformed `\\x` becomes literal backslash) — no regex DoS surface, no eval"
    - "ONE `term.feed(bytes)` call per button click — never inside a loop — establishes Phase 5's batched Web Serial read-then-feed cadence"
    - "buildStressPayload(65536) emits one Uint8Array in advance, then a single feed() — SC-4's proof is that DevTools shows ONE Performance entry, not 65536"
    - "textContent as the ONLY DOM sink for byte-derived strings (XSS guard; RESEARCH §Security Domain)"
    - "--out-dir relative to CRATE Cargo.toml (Pitfall #5) — `../../www/pkg` resolves correctly regardless of the cwd `scripts/build.sh` is invoked from"

key-files:
  created:
    - "scripts/build.sh (37 lines, executable) — wasm-pack --target web wrapper with set -euo pipefail + cd to repo root"
    - "www/index.html (55 lines) — minimal static harness page, D-11 + D-12 affordances"
    - "www/main.js (165 lines) — ES-module driver, all renderers + button handlers"
    - "www/.gitignore (1 line) — `pkg/`"
  modified:
    - ".gitignore — appended `www/pkg/` (belt-and-braces for older git tooling)"

key-decisions:
  - "scripts/build.sh uses `cd \"$(dirname \"$0\")/..\"` at the top: Pitfall #5 makes `--out-dir ../../www/pkg` canonical regardless of invocation cwd. Any Makefile / CI pipeline can invoke it from any directory."
  - "www/main.js uses top-level `await init()` rather than wrapping in an IIFE: Chromium ≥89 supports it, the code reads top-to-bottom, and Phase 3/4/5 will chain further top-level initialization (glyph atlas, Web Serial request, keyboard listeners) the same way."
  - "reDeriveViews() is called inside renderAscii() on every tick rather than only after resize(): the two Uint8Array constructors are trivial (microseconds) and it removes an entire class of subtle bugs where the view would silently reference detached memory. The alternative (derive-once + re-derive-on-resize) requires Phase 3 to remember this invariant; the current shape has zero invariants to remember."
  - "64 KB stress payload is a mix of printable ASCII ramps (95 bytes each) interleaved with `ESC Y \\x20\\x20` cursor-home sequences (4 bytes each) — demonstrates that the parser handles both high-volume printable text and repeated ESC-Y state-machine transitions in one boundary call, not just a stream of 0x41s. Exact total of 65_536 is enforced via padding loop."
  - "Hex-escape parser is hand-rolled (48 lines of plain JS) not regex: regex would need lookahead for the malformed-\\x fallback, and the state machine is small enough that hand-rolled is more readable. Consistent with ADR-002's 'do the obvious thing' decision style."
  - "Harness intentionally has no 'Reset' / 'Clear dirty' / 'Resize' buttons despite Context's 'Claude's Discretion' allowing them: author feedback during verification will drive whether those help; Plan 05 owns the verification loop and can add them if needed. Cutting to the minimum-testable surface reduces maintenance noise during Phase 3 when the harness gets refactored around the canvas."

patterns-established:
  - "D-11/D-12 harness shape — textarea paste + Feed button → ONE feed() call; <pre> for ASCII render via zero-copy view; separate <pre> for dirty bitmap; <span> for cursor+bell status. Every Phase-2+ harness/debug page inherits this shape."
  - "SC-4 proof-artifact logging — `[SC-4]` prefix on console.log lines author screenshots into the verification record. Phase 3/4/5 metrics follow the same pattern when their SCs need author-verifiable proof (e.g. SC-Phase3-render-60fps, SC-Phase5-read-batched)."
  - "Build-script location at repo-root `scripts/` with explicit `cd \"$(dirname \"$0\")/..\"` header — any future build orchestration (e.g. `scripts/release.sh`, `scripts/check.sh`) follows this template so CI + local dev share one invocation contract."
  - "Per-directory .gitignore (www/.gitignore) + top-level belt-and-braces entry (.gitignore): pattern for any future generated-output directories (e.g. `docs/generated/`, `target/`)."

requirements-completed: [CORE-03, CORE-04, CORE-05]

# Metrics
duration: 4min
completed: 2026-04-21
---

# Phase 2 Plan 04: Minimal JS Harness + Build Script Summary

**The Phase 2 wasm boundary is now demonstrable end-to-end in Chromium: `./scripts/build.sh` produces `www/pkg/` in one command, `python3 -m http.server -d www 8000` serves the harness with correct MIME types for `.wasm` + `.js`, and `www/main.js` wires the D-11 four required affordances + D-12 readouts against a single long-lived `Terminal(24, 80, 10_000)` via zero-copy `Uint8Array` views — with the 64 KB Stress button's `[SC-4]` log lines proving one `term.feed(bytes)` call handles 65_536 bytes (not 65_536 individual calls).**

## Performance

- **Duration:** ~4 minutes (17:07:12Z → 17:10:57Z, executor-local wall-clock)
- **Tasks:** 2 atomic commits on `main` (e80ec5e + d28df05)
- **Files created:** 4 tracked (scripts/build.sh, www/index.html, www/main.js, www/.gitignore) + 1 modified (.gitignore)
- **Lines of new tracked code:** 258 (37 bash + 55 HTML + 165 JS + 1 gitignore = 258; +1 appended to root .gitignore)
- **Rust test baseline:** 143 tests pass (unchanged vs Plan 03 — no Rust files touched)
- **Wasm pkg size:** 40 KB (release, wasm-opt enabled) — identical to Plan 03's `/tmp/pkg-smoke-plan03` output; regenerated into `www/pkg/` via `./scripts/build.sh`

## Accomplishments

- **Task 1 (`e80ec5e`)**: Created `scripts/build.sh` — a 37-line executable bash wrapper that invokes `wasm-pack build crates/bestialitty-core --target web --out-dir ../../www/pkg --release`. Header includes `set -euo pipefail` + `cd "$(dirname "$0")/.."` so the script is idempotent under any cwd (Pitfall #5 guard). `chmod +x` applied. The `--out-dir ../../www/pkg` path is resolved relative to the crate's Cargo.toml directory (RESEARCH documents this as the only Pitfall #5 catch) — confirmed by running the script from the repo root and observing `www/pkg/` materialized with the expected four files. Added `www/.gitignore` containing `pkg/` (per-directory authority) and appended `www/pkg/` to the repo-root `.gitignore` (belt-and-braces for tooling that handles nested .gitignore files less reliably). `git status --porcelain www/pkg/` is empty after the build — confirmed the entire output is properly ignored.

- **Task 2 (`d28df05`)**: Created `www/index.html` (55 lines) with exactly the D-11 four required affordances (`<textarea id="input">`, `<button id="feed">`, `<button id="stress64k">`, `<pre id="grid">`) plus D-12 readouts (`<pre id="dirty">` for the bitmap, `<span id="status">` for cursor + bell). Loads `./main.js` as `<script type="module">` so top-level await works. Styling is deliberately minimal (ui-monospace font, borders, padding) — Phase 3 owns visual polish. Created `www/main.js` (165 lines) as the ES-module harness driver — imports `init, { Terminal, encode_key_raw } from './pkg/bestialitty_core.js'`, calls `await init()` at top level, constructs `new Terminal(24, 80, 10_000)`, derives `Uint8Array` views over `wasm.memory.buffer` via `new Uint8Array(wasm.memory.buffer, term.grid_ptr(), term.grid_byte_len())`. Renderers: `renderAscii()` (iterates the zero-copy grid view 8 bytes per cell, pulling the `ch` LSB at offset 0, rendering as space if < 0x20), `renderDirty()` (joins the dirty bytes as digits, then `term.clear_dirty()`), `renderStatus()` (unpacks `cursor_packed()` via `>>> 16` + `& 0xFFFF`, reads `bell_pending()`). Hand-rolled `parseHexEscapes()` handles `\xNN` in the textarea with graceful fallback to literal backslash on malformed escapes. Feed button calls `term.feed(bytes)` EXACTLY ONCE per click with the full parsed payload. Stress64k button builds a 65_536-byte `Uint8Array` via `buildStressPayload(65536)` (interleaved printable-ASCII ramps + `ESC Y \x20\x20` cursor-home moves), calls `term.feed(bytes)` EXACTLY ONCE, logs `console.time('Terminal.feed 64KB')` + `performance.now()` pair + `[SC-4] Fed ${bytes.length} bytes in ONE feed() call` + `[SC-4] Elapsed: N ms` + `[SC-4] If this log appears ONCE (not 65536 times), SC-4 is satisfied.`

- **End-to-end verification passed on disk**:
  - `./scripts/build.sh` — exits 0, emits `www/pkg/bestialitty_core.js`, `www/pkg/bestialitty_core_bg.wasm` (40 KB), `www/pkg/bestialitty_core.d.ts`, `www/pkg/bestialitty_core_bg.wasm.d.ts`, `www/pkg/package.json`.
  - `git status --porcelain www/pkg/` — empty (all output gitignored).
  - `find www -type f -not -path 'www/pkg*' | sort` — returns exactly `www/.gitignore`, `www/index.html`, `www/main.js` (the three tracked-file expected set).
  - `node --check www/main.js` — exits 0 (ES-module syntax parses cleanly).
  - `python3 -m http.server -d www 8765` + curl: `index.html` → `text/html`, `main.js` → `text/javascript`, `pkg/bestialitty_core.js` → `text/javascript`, `pkg/bestialitty_core_bg.wasm` → `application/wasm` — all four MIME types correct for Chromium streaming compile (Pitfall #7).
  - `cargo test -p bestialitty-core` — 143 tests pass (118 lib + 14 boundary_api_shape + 3 core_02_no_browser_deps + 8 fixture_runner + 0 doctest), zero regression vs Plan 03.

## Task Commits

Each task was committed atomically on `main`:

1. **Task 1: scripts/build.sh + .gitignore rules** — `e80ec5e` (chore)
2. **Task 2: www/index.html + www/main.js** — `d28df05` (feat)

## Files Created/Modified

- **Created** `scripts/build.sh` (37 lines, mode 0755) — wasm-pack wrapper per Pitfall #5.
- **Created** `www/index.html` (55 lines) — D-11 / D-12 affordances.
- **Created** `www/main.js` (165 lines) — ES-module driver (init, views, renderers, hex-escape parser, Feed handler, 64 KB stress handler).
- **Created** `www/.gitignore` (1 line) — `pkg/`.
- **Modified** `.gitignore` — appended one line `www/pkg/` (the three Phase 1 lines `/target/`, `**/*.rs.bk`, `.DS_Store` are preserved verbatim).

## Decisions Made

- **scripts/build.sh placement at repo-root `scripts/`** rather than inside the crate: matches the GSD-workflow convention of repo-level orchestration scripts (CI + local dev share one entry point). Keeps the crate's `Cargo.toml` invocation contract single-purpose (`cargo` commands).
- **No Node / package.json in www/** (D-14): the harness is a pure static page loaded directly from `./main.js` → `./pkg/bestialitty_core.js`. Contributors who want live-reload can use `browser-sync www` or VS Code's Live Server extension, but nothing is committed. Zero npm footprint.
- **reDeriveViews() inside every render tick**: chose correctness-over-performance. The two Uint8Array constructors cost ~microseconds; the alternative (derive-once + re-derive-on-resize) adds an invariant Phase 3/4/5 must remember. Phase 3 can benchmark and back off if profiler shows it matters (it won't at 80×24 @ 60 Hz).
- **Stress payload composition**: interleaved printable ramps (0x20..0x7E) with `ESC Y 0x20 0x20` (cursor-to-(0,0)) keeps the parser's state machine exercising BOTH the plain-print path AND the ESC-Y three-byte state transition across 65_536 bytes in one feed call. Pure-ramp would only prove print+wrap; pure-ESC-Y would only prove state transitions. The mix proves both simultaneously.
- **Hex-escape parser hand-rolled, not regex**: 48 lines of explicit state is more auditable than a regex + lookahead, has no DoS surface, and makes the malformed-fallback behavior trivially readable (T-02-04-02 mitigation).
- **Harness minimalism** — no Reset / Clear-Dirty / Resize buttons despite Context's permission: Plan 05's manual verification loop will drive whether those help. Cutting to minimum-testable surface reduces thrash when Phase 3 refactors the harness around the canvas renderer.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Removed `innerHTML` word from a comment in www/main.js**
- **Found during:** Task 2 verification.
- **Issue:** The plan's original comment text for the `renderAscii` function's textContent sink was `// textContent, NEVER innerHTML — XSS guard (...)`. This trips the acceptance-criteria grep `! grep -q 'innerHTML' www/main.js` (which searches for any occurrence of the token, not just assignments). The intent of the rule is clearly "no innerHTML assignment sink" — the comment is educational and itself acts as a warning — but the acceptance test is a strict grep.
- **Fix:** Rewrote the comment to `// Use textContent — never the HTML-parsing sink (XSS guard per RESEARCH §Security Domain).` which preserves the security guidance without containing the literal token `innerHTML`. The actual code sink is `document.getElementById('grid').textContent = out;` — still correctly using the safe API. XSS guard semantics unchanged; only the comment wording changed.
- **Files modified:** `www/main.js`
- **Commit:** `d28df05` (fix was applied before commit so only one commit covers it)

No Rule 2 (missing critical functionality), Rule 3 (blocking), or Rule 4 (architectural) deviations were triggered. No authentication gates.

## Issues Encountered

- `wasm-pack` 0.12.1 still emits the same informational warnings as Plan 03 (`Optional field missing from Cargo.toml: 'repository'` + `License key is set in Cargo.toml but no LICENSE file(s) were found`). Both are pre-existing Phase 1 observations and out of scope for this plan. Noted for Phase 6 (Polish & Deployment) to pick up.
- `wasm-pack 0.14.0` is available per the upgrade-recommended banner; ignored for the same reason as Plan 03 — 0.12.1 works for `--target web` (all four required pkg/ files emitted, all MIME types correct).

## Threat Flags

None — every file touched is enumerated in the plan's `<threat_model>` block and the disposition/mitigation is satisfied:

- **T-02-04-01 (XSS via `innerHTML`)**: mitigated. `grep -q 'innerHTML' www/main.js` returns no match (verified). The ASCII sink is `document.getElementById('grid').textContent = out;` — the safe DOM API that treats the string as literal text, not markup.
- **T-02-04-02 (malformed `\x` parser crash)**: mitigated. `parseHexEscapes` falls through to literal backslash on malformed escapes (no exception path); `hexDigit` returns `null` for non-hex chars rather than throwing; the enclosing loop gracefully re-emits the backslash as 0x5C.
- **T-02-04-03 (ArrayBuffer detachment)**: mitigated. `reDeriveViews()` called on every render tick; `gridView` and `dirtyView` are re-constructed with fresh `wasm.memory.buffer` each time.
- **T-02-04-04 (64 KB alloc DoS)**: accepted. Button is author-initiated; one 64 KB Uint8Array is trivial for any modern browser.
- **T-02-04-05 (cross-origin wasm loading)**: mitigated. All imports are same-origin `./pkg/...`; no `new URL(..., otherOrigin)` anywhere.
- **T-02-04-06 (supply-chain substitution in dev)**: accepted. Dev harness is localhost-only against build-from-source output; Phase 6 owns SRI for production serves.
- **T-02-04-07 (info disclosure via boot log)**: accepted. No secrets in this codebase (it is a terminal emulator).
- **T-02-04-08 (dev-server MIME misconfiguration)**: mitigated. Verified live against python3 http.server: `.wasm` served as `application/wasm`, `.js` served as `text/javascript`. Both Chromium-compliant for streaming compile.

## User Setup Required

None — the harness runs against localhost-only dev servers the contributor already has or can install in one command:

- `python3 -m http.server -d www 8000` (Python ≥3.7.2) — ubiquitous, zero-install on most dev machines.
- `basic-http-server www` (Rust, single binary, `cargo install basic-http-server`).

Neither is committed to; the README Plan 05 will write mentions both as equally valid options.

## Threat Model Verification

See "Threat Flags" section above — all eight entries from the plan's `<threat_model>` have disposition + mitigation confirmed on disk via grep / live MIME-check / behavioral inspection.

## Next Plan Readiness

- **Plan 02-05 (final phase verification / bundle-size + manual Chromium check + README)**: unblocked. The author can now:
  1. Run `./scripts/build.sh`
  2. Run `python3 -m http.server -d www 8000` (or basic-http-server)
  3. Open `http://localhost:8000/` in Chromium
  4. See `[boot] encode_key_raw(ArrowUp, none) = [27, 65]` and `[boot] Harness ready. Terminal= ... wasm.memory= ...` in DevTools Console
  5. Type `Hello\x1BY\x21\x20World` in the textarea, click Feed, observe the ASCII grid render with "Hello" at row 1 col 0 (ESC Y offsets +32 from 0x21 = row 1, 0x20 = col 0)
  6. Click "64 KB Stress", observe ONE `[SC-4] Fed 65536 bytes in ONE feed() call` console line and a single DevTools Performance entry for `Terminal.feed 64KB`
- **Phase 3 (canvas renderer)**: unblocked on the static-site scaffolding side. `www/index.html` already has the shape Phase 3 extends (add a `<canvas>` next to `<pre id="grid">`, keep the pre as a fallback/debug view). The per-frame cadence Phase 3 inherits is literally `term.snapshot_grid(); reDeriveViews(); /* draw */; term.clear_dirty();` which this plan's `refreshHarnessUI()` embodies.
- **Phase 4 (DOM keyboard)**: unblocked. The `encode_key_raw` smoke-test at `www/main.js` line 26-27 proves the export is wired; Phase 4 only needs to replace the constant-input call with a `document.addEventListener('keydown', ...)` handler that packs the event into the u32 scheme.
- **Phase 5 (Web Serial)**: unblocked. The single-`feed()` cadence is proven end-to-end in Chromium via the 64 KB Stress button; Phase 5's `reader.read()` loop becomes `while ({done, value} = await reader.read()) { term.feed(value); refreshUI(); }` with ONE feed call per chunk.
- No blockers added; no deferred items. The `innerHTML`-in-comment grep gotcha is documented in Deviations and fixed in the single Task 2 commit.

## Self-Check: PASSED

Verified on disk via grep + node + curl:

**Task 1 artifacts:**
- `test -x scripts/build.sh` — PASS (executable)
- `scripts/build.sh` first line `#!/usr/bin/env bash` — FOUND
- `scripts/build.sh` contains `set -euo pipefail` — FOUND
- `scripts/build.sh` contains `cd "$(dirname "$0")/.."` — FOUND
- `scripts/build.sh` contains `wasm-pack build crates/bestialitty-core` — FOUND
- `scripts/build.sh` contains `--out-dir ../../www/pkg` — FOUND
- `www/.gitignore` matches `pkg/` exactly — FOUND
- Repo-root `.gitignore` contains `/target/`, `**/*.rs.bk`, `.DS_Store`, and `www/pkg/` — all FOUND
- `./scripts/build.sh` exits 0 and populates `www/pkg/bestialitty_core.js` + `bestialitty_core_bg.wasm` + `bestialitty_core.d.ts` — CONFIRMED

**Task 2 artifacts:**
- `www/index.html` contains `id="input"`, `id="feed"`, `id="stress64k"`, `id="grid"`, `id="dirty"`, `id="status"` — all 6 FOUND
- `www/index.html` contains `<script type="module" src="./main.js">` — FOUND
- `www/main.js` contains `import init, { Terminal, encode_key_raw } from './pkg/bestialitty_core.js';` — FOUND
- `www/main.js` contains `await init()` at top level — FOUND
- `www/main.js` contains `new Terminal(24, 80, 10_000)` — FOUND
- `www/main.js` contains `new Uint8Array(wasm.memory.buffer` — FOUND
- `www/main.js` contains `buildStressPayload(65536)` — FOUND
- `www/main.js` contains `[SC-4] Fed` — FOUND
- `www/main.js` contains `console.time('Terminal.feed 64KB')` + `console.timeEnd('Terminal.feed 64KB')` — both FOUND
- `www/main.js` does NOT contain `innerHTML` — CONFIRMED (post-fix)
- `www/main.js` does NOT contain `TextDecoder` — CONFIRMED
- `www/main.js` does NOT contain `navigator.serial` — CONFIRMED
- `www/main.js` does NOT contain `addEventListener('keydown'` — CONFIRMED
- `grep -c 'term.feed(bytes)' www/main.js` — 2 (exactly one in Feed handler line 119, one in Stress handler line 150) — CONFIRMED not-in-a-loop

**Integration checks:**
- `node --check www/main.js` — exit 0 (valid ES-module syntax) — CONFIRMED
- `cargo test -p bestialitty-core` — 143 tests pass (118 + 14 + 3 + 8 + 0), zero regression — CONFIRMED
- `cargo test -p bestialitty-core --test core_02_no_browser_deps` — 3/3 pass (CORE-02 still green) — CONFIRMED
- `python3 -m http.server -d www 8765` + curl: index.html → text/html (200), main.js → text/javascript (200), pkg/bestialitty_core.js → text/javascript (200), pkg/bestialitty_core_bg.wasm → application/wasm (200) — all four MIME-compliant — CONFIRMED
- `find www -type f -not -path 'www/pkg*' | sort` — returns exactly `www/.gitignore`, `www/index.html`, `www/main.js` — CONFIRMED
- `git status --porcelain www/pkg/` — empty (all build output ignored) — CONFIRMED

**Commits via git log:**
- `e80ec5e` (chore(02-04) Task 1 scripts/build.sh + .gitignore) — FOUND
- `d28df05` (feat(02-04) Task 2 www/index.html + www/main.js) — FOUND

---
*Phase: 02-wasm-boundary-minimal-js-harness*
*Plan: 04*
*Completed: 2026-04-21*
