---
status: complete
phase: 02-wasm-boundary-minimal-js-harness
source: [02-VERIFICATION.md]
started: 2026-04-21T00:00:00Z
updated: 2026-04-22T00:02:00Z
---

## Current Test

[testing complete]

## Tests

### 1. SC-1: wasm-pack ES-module loads in Chromium

expected: Console shows `[boot] encode_key_raw(ArrowUp, none) = [27, 65]` and `[boot] Harness ready. Terminal=... wasm.memory=...` with no red errors. Page renders textarea, Feed + 64 KB Stress buttons, two `<pre>` elements, status span. No errors in the Console tab; Network tab shows `bestialitty_core.js` and `bestialitty_core_bg.wasm` fetched with `application/javascript` and `application/wasm` MIME types.
result: pass
steps:
  1. `./scripts/build.sh`
  2. `python3 -m http.server -d www 8000` (or `basic-http-server www`)
  3. Open Chromium → `http://localhost:8000/`
  4. Open DevTools → Console tab; verify the two boot log lines appear with no errors

### 2. SC-2: paste -> feed() -> ASCII render

expected: Paste `Hello\x1BY\x21\x20World` (five chars, ESC, Y, two control bytes as literal hex-escape, five chars) into the textarea. Click Feed. Grid `<pre>` shows `Hello` on row 0 (columns 0-4) and `World` starting at row 1, column 0. Status span shows `cursor=(1,5) bell=false`. Dirty `<pre>` shows `11` followed by zeros for the first two touched rows.
result: pass
depends_on: SC-1
steps:
  1. With the harness loaded, paste `Hello\x1BY\x21\x20World` verbatim into the textarea
  2. Click "Feed"
  3. Visually inspect the grid pre — row 0 = `Hello`, row 1 starts `World`
  4. Inspect the status line — cursor position = `(1,5)`, bell = false
  5. Inspect the dirty pre — first two bytes are `1`, remainder `0`

### 3. SC-3: zero-copy Uint8Array views — no per-frame allocation growth

expected: "DevTools Performance / Memory track shows a flat allocation profile attributable to the WASM BOUNDARY when Feed is clicked 5-10 times with simple ASCII input that produces no host_reply. Specifically: zero allocations attributable to (a) the wasm-bindgen-generated `Terminal.feed` wrapper, and (b) `reDeriveViews()`. The pre-text harness paths (`renderAscii` flat-string build, `renderDirty` Array.from().join, `parseHexEscapes` Uint8Array construction) are accepted as harness-only artifacts that Phase 3's canvas renderer eliminates by replacing the pre-text grid; their per-click ~5 KB churn is expected and not in scope for SC-3."
result: pass
depends_on: SC-1
verified: 2026-04-22
steps:
  1. Open DevTools → Performance tab (or Memory → Allocation instrumentation on timeline)
  2. Click "Record", then click Feed 5-10 times in rapid succession with simple ASCII input
  3. Stop recording; inspect the Memory timeline
  4. Allocation should be steady after the first click — no growing Uint8Array allocations
notes: "Re-verified 2026-04-22 after 02-06-PLAN.md fix. SC-3 wording scoped to wasm-boundary allocations; pre-text harness churn deferred to Phase 3. Author approved after Chromium DevTools demo."

### 4. SC-4: 64 KB in ONE feed() call

expected: Click "64 KB Stress". Console shows exactly ONE occurrence per click of: `Terminal.feed 64KB: N ms`, `[SC-4] Fed 65536 bytes in ONE feed() call`, `[SC-4] Elapsed: N ms`, `[SC-4] If this log appears ONCE (not 65536 times), SC-4 is satisfied.` DevTools Performance flame graph shows a single `Terminal.feed` entry, not 65,536 stacked frames.
result: pass
depends_on: SC-1
steps:
  1. With the harness loaded and DevTools Performance tab open, click Record
  2. Click "64 KB Stress" once
  3. Stop recording
  4. Console tab: verify the four `[SC-4]` lines each appear exactly once
  5. Performance tab flame graph: zoom into the click; verify there is a single `Terminal.feed` frame, not thousands

## Summary

total: 4
passed: 4
issues: 0
pending: 0
skipped: 0
blocked: 0

## Gaps

- truth: "DevTools Performance / Memory track shows a flat allocation profile after initial view construction when Feed is clicked 5-10 times. No growing heap sawtooth from Uint8Array churn."
  status: closed
  closed: 2026-04-22
  reason: "User reported: JS jeap and Nodes show a distinct stair-case/sawtooth pattern"
  severity_original: major
  test: 3
  root_cause: "Five distinct per-Feed-click allocation sources, dominated by an invisible wasm-bindgen-generated `.slice()` on the `feed()` return value. The 'zero-copy' promise of D-03 only ever held for the grid pack-buffer READ path; the feed() return-value path, the input bytes path, the pre-text render path, and the dirty stringification path all allocate per click. Combined ~5 KB of fresh heap per click → GC reclaims in batches → sawtooth. 'Nodes' growth is a sampling artifact of the heap pressure (no actual DOM nodes are created post-init)."
  artifacts:
    - path: "crates/bestialitty-core/src/lib.rs"
      line: 70
      issue: "feed() signature returns owned Vec<u8>; forces wasm-bindgen to copy-out + free per call, regardless of whether host_reply is empty (the common case in Phase 2 — only ESC Z emits a reply)"
    - path: "www/pkg/bestialitty_core.js"
      line: 77
      issue: "Auto-generated `var v2 = getArrayU8FromWasm0(ret[0], ret[1]).slice();` allocates a fresh Uint8Array + ArrayBuffer on every feed() call (largest single contributor; invisible in www/main.js review — this is what CR-01 missed)"
    - path: "www/main.js"
      line: 35-38
      issue: "reDeriveViews() creates two fresh Uint8Array headers (~160 bytes) every render — Plan 04 explicitly chose this defensive pattern, predicting it would be invisible at 80x24/60Hz; SC-3's literal wording disagrees"
    - path: "www/main.js"
      line: 42-59
      issue: "renderAscii assembles a ~3888-byte flat String for textContent plus ~1920 cons-string intermediates (`out += ...`) per click"
    - path: "www/main.js"
      line: 84-105
      issue: "parseHexEscapes: `return new Uint8Array(out)` allocates a fresh Uint8Array + ArrayBuffer + internal JS Array per click"
    - path: "www/main.js"
      line: 63
      issue: "renderDirty: `Array.from(dirtyView).join('')` allocates a 24-element Array + 24-char String per click"
  missing:
    - "Eliminate the dominant source: change Rust feed() so the empty-reply common path doesn't return Vec<u8>. Two viable shapes: (a) split into `feed_silent(bytes) -> ()` plus `take_host_reply() -> Vec<u8>`, or (b) buffer host_reply in Terminal and expose `host_reply_ptr() / host_reply_len() / clear_host_reply()` so JS reads via a zero-copy view (mirror of pack_buf)"
    - "Cache gridView/dirtyView at module scope; only re-derive when `wasm.memory.buffer !== cachedBuffer` (detects memory growth and invalidated views without per-frame allocation). Two-line guard in reDeriveViews()"
    - "Optional / lower priority: pre-text render allocations (renderAscii, renderDirty, parseHexEscapes) become moot when Phase 3 replaces pre-text with canvas. Either accept and document, or refactor parseHexEscapes to write into a reusable scratch buffer if Phase 3 is not imminent"
    - "Update SC-3 wording in 02-VERIFICATION.md if any of the pre-text render allocations are accepted as expected debug-harness behavior, so the criterion remains testable after the Rust/JS-shell fixes"
  debug_session: ".planning/debug/sc3-zero-copy-heap-sawtooth.md"
  closure_plan: ".planning/phases/02-wasm-boundary-minimal-js-harness/02-06-PLAN.md"
