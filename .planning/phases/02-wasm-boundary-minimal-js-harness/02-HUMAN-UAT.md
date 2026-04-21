---
status: partial
phase: 02-wasm-boundary-minimal-js-harness
source: [02-VERIFICATION.md]
started: 2026-04-21T00:00:00Z
updated: 2026-04-21T00:00:00Z
---

## Current Test

[awaiting human testing]

## Tests

### 1. SC-1: wasm-pack ES-module loads in Chromium

expected: Console shows `[boot] encode_key_raw(ArrowUp, none) = [27, 65]` and `[boot] Harness ready. Terminal=... wasm.memory=...` with no red errors. Page renders textarea, Feed + 64 KB Stress buttons, two `<pre>` elements, status span. No errors in the Console tab; Network tab shows `bestialitty_core.js` and `bestialitty_core_bg.wasm` fetched with `application/javascript` and `application/wasm` MIME types.
result: [pending]
steps:
  1. `./scripts/build.sh`
  2. `python3 -m http.server -d www 8000` (or `basic-http-server www`)
  3. Open Chromium → `http://localhost:8000/`
  4. Open DevTools → Console tab; verify the two boot log lines appear with no errors

### 2. SC-2: paste -> feed() -> ASCII render

expected: Paste `Hello\x1BY\x21\x20World` (five chars, ESC, Y, two control bytes as literal hex-escape, five chars) into the textarea. Click Feed. Grid `<pre>` shows `Hello` on row 0 (columns 0-4) and `World` starting at row 1, column 0. Status span shows `cursor=(1,5) bell=false`. Dirty `<pre>` shows `11` followed by zeros for the first two touched rows.
result: [pending]
depends_on: SC-1
steps:
  1. With the harness loaded, paste `Hello\x1BY\x21\x20World` verbatim into the textarea
  2. Click "Feed"
  3. Visually inspect the grid pre — row 0 = `Hello`, row 1 starts `World`
  4. Inspect the status line — cursor position = `(1,5)`, bell = false
  5. Inspect the dirty pre — first two bytes are `1`, remainder `0`

### 3. SC-3: zero-copy Uint8Array views — no per-frame allocation growth

expected: DevTools Performance / Memory track shows a flat allocation profile after initial view construction when Feed is clicked 5-10 times. No growing heap sawtooth from Uint8Array churn.
result: [pending]
depends_on: SC-1
steps:
  1. Open DevTools → Performance tab (or Memory → Allocation instrumentation on timeline)
  2. Click "Record", then click Feed 5-10 times in rapid succession with simple ASCII input
  3. Stop recording; inspect the Memory timeline
  4. Allocation should be steady after the first click — no growing Uint8Array allocations

### 4. SC-4: 64 KB in ONE feed() call

expected: Click "64 KB Stress". Console shows exactly ONE occurrence per click of: `Terminal.feed 64KB: N ms`, `[SC-4] Fed 65536 bytes in ONE feed() call`, `[SC-4] Elapsed: N ms`, `[SC-4] If this log appears ONCE (not 65536 times), SC-4 is satisfied.` DevTools Performance flame graph shows a single `Terminal.feed` entry, not 65,536 stacked frames.
result: [pending]
depends_on: SC-1
steps:
  1. With the harness loaded and DevTools Performance tab open, click Record
  2. Click "64 KB Stress" once
  3. Stop recording
  4. Console tab: verify the four `[SC-4]` lines each appear exactly once
  5. Performance tab flame graph: zoom into the click; verify there is a single `Terminal.feed` frame, not thousands

## Summary

total: 4
passed: 0
issues: 0
pending: 4
skipped: 0
blocked: 0

## Gaps
