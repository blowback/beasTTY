---
phase: 10-slide-receiver-cancellation
plan: 02
subsystem: integration

tags: [rust, wasm-boundary, js, slide-recv, skeleton, idb, prefs, fsap]

# Dependency graph
requires:
  - phase: 10-01
    provides: "Slide inner API: recv_ptr/recv_len/clear_recv triple + recv_filename_ptr/recv_filename_len/clear_recv_filename triple + recv_file_size + recv_current_file_idx scalars; EVT_HEADER_RECEIVED (11<<16) / EVT_RECV_DATA (12<<16) / EVT_RECV_FILE_DONE (13<<16) constants pinned in slide_boundary_shape.rs + slide_wasm_boundary_shape.rs sibling-mirror with runtime reachability test for the 8 new methods + EVT_DATA_FRAME arm extensions in HeaderPhase / DataPhase + W3 multi-data-frames-in-one-chunk contract pinned"
  - phase: 09-slide-sender-host-z80-send
    provides: "Phase 9 sender extension shape — wasm boundary one-line forwards in lib.rs:wasm_boundary at lines 286-312 (verbatim template extended by Plan 10-02)"
provides:
  - "Eight one-line forwards on the Slide #[wasm_bindgen] façade in lib.rs (recv_ptr/recv_len/clear_recv triple + recv_filename triple + recv_file_size + recv_current_file_idx) — ADR-002 single-rule preserved (only lib.rs has #[wasm_bindgen])"
  - "www/state/idb.js NEW (~85 LOC) — minimal IndexedDB wrapper with 3 exports (getRecvDirHandle/setRecvDirHandle/clearRecvDirHandle), all wrapped in try/catch + console.warn for incognito-mode tolerance"
  - "www/state/prefs.js DEFAULTS extended with slideRecvToFolder: false (CONTEXT D-02 default OFF); CURRENT_VERSION NOT bumped — defensive merge fills missing field on prior-version blobs"
  - "www/transport/slide-recv.js NEW skeleton (~310 LOC) — 9 exports including wireSlideRecv/setSlideRef/isSlideActive/onRecvEvent/cancelSlideRecv (STUB)/slidePumpOnPortLost (STUB)/recoverHardFail (STUB)/__resetForTests/__getStateForTests"
  - "Per-file Blob accumulator + anchor-click + folder-save dispatch via FSAP + ensureUnique ~N suffix retry up to ~999"
  - "W4 lastDownloadAt-serialised inter-file gap (250 ms) — read BEFORE click + written AFTER click in BOTH anchor-click and folder-save branches; actually serialises SLIDE-19"
  - "W3 multi-data-frame-per-chunk assumption documented in slide-recv.js head comment + Pitfall 4/5 verbatim in sliceRecvBytesToOwned + readRecvFilenameOwned"
  - "Wasm rebuild: www/pkg/bestialitty_core.{js,d.ts,_bg.wasm} regenerated with 8 new method exports on class Slide"
affects:
  - phase: 10-03
    why: "Plan 10-03 plugs the 5-step CTRL_CAN cancel state machine into the cancelSlideRecv STUB, fills slidePumpOnPortLost and recoverHardFail real impls, and wires onRecvEvent into slide.js's drainEventsAndOutbound + setSlideRef into enterRecvMode + isSlideActive into keyboard.js Esc-disambiguation. Plan 10-03 also wires wireSlideRecv into main.js boot."
  - phase: 10-04
    why: "Plan 10-04 (Settings UI) populates the wireSlideRecv DOM refs (rowEl/toggleEl/folderButtonEl/statusEl/helpEl currently null-tolerant) and adds change/click listeners; populates cachedHandle via showDirectoryPicker."
  - phase: 11
    why: "Phase 11 chip lifecycle replaces slidePumpOnPortLost STUB with chip-emitting logic per SLIDE-32; the skeleton's STUB no-op is forward-compatible."

# Tech tracking
tech-stack:
  added: []  # No new crates / npm packages — IndexedDB + File System Access API are browser built-ins
  patterns:
    - "Wasm boundary one-line forwards (Phase 8/9 verbatim template) — recv accessors mirror sender accessors with same self.inner.METHOD() shape; 8 forwards in 48 lines"
    - "Module-scope state + DI initializer (file-source.js verbatim) — wireSlideRecv accepts deps via opts.{prefs,savePrefs,idb,txSink,wasm,slideRef} + DOM refs; module-scope let bindings populated at boot; __resetForTests clears between Playwright tests"
    - "Pitfall 4 + Pitfall 5 verbatim from slide.js outbound triple consumer (lines 330-344) — re-derive view on memory.buffer change + slice BEFORE clear"
    - "lastDownloadAt-serialised inter-file gap (W4 pattern, NEW) — module-scope timestamp + Math.max(0, GAP - elapsed) + await delay(wait) BEFORE click + write AFTER; replaces broken fire-and-forget .finally(delay) pattern"
    - "ensureUnique ~N suffix retry — split on last '.', insert ~N before extension, getFileHandle({create:false}) probes existence, NotFoundError → return candidate, ~999 exhaustion → return null (anchor fallback)"
    - "incognito-tolerant IDB wrapper — every export wraps IDB calls in try/catch + console.warn; failure mode is null handle + slide-recv falls through to anchor-click (D-04 silent fallback)"

key-files:
  created:
    - "www/state/idb.js (Task 2 — verbatim from RESEARCH Example 4 lines 1067-1130 + cited header comment)"
    - "www/transport/slide-recv.js (Task 3 — skeleton with 9 exports including 3 STUBs)"
  modified:
    - "crates/bestialitty-core/src/lib.rs (Task 1 — 8 one-line forwards appended after send_current_file_idx in #[wasm_bindgen] impl Slide block)"
    - "www/state/prefs.js (Task 2 — DEFAULTS gains slideRecvToFolder: false; CURRENT_VERSION unchanged)"

key-decisions:
  - "Three-task split: Task 1 isolated to wasm-boundary forwards + wasm rebuild + .d.ts inspection; Task 2 idb.js NEW + prefs.js DEFAULTS extension (single commit because pref schema and IDB persistence are paired contracts); Task 3 slide-recv.js skeleton creation in isolation (preserves the explicit STUB markers that Plan 10-03 will replace)"
  - "Boundary-shape pin already shipped in Plan 10-01 (sibling-mirror discipline) — slide_wasm_boundary_shape.rs::slide_recv_payload_methods_have_stable_signatures + runtime reachability extension are already green; Task 1 verified the test stays green and ADR-002 invariant (only lib.rs has #[wasm_bindgen]) holds"
  - "ensureUnique returns null on ~999 exhaustion — caller's downloadToFolder branches to downloadViaAnchor (T-10-04 mitigation: existing files NEVER overwritten silently); the single console.warn line at the boundary is the user-visible signal"
  - "lastDownloadAt is module-scope (not per-currentFile) — the 250 ms gap is between SUCCESSIVE downloads, not relative to header arrival; module-scope timestamp + Date.now() comparison is the simplest correct expression of SLIDE-19"
  - "DOM refs (rowEl/toggleEl/folderButtonEl/statusEl/helpEl) accept null in Plan 10-02 wireSlideRecv — Plan 10-04's Settings UI passes non-null refs and adds change/click handlers; the skeleton's anchor-click default path works regardless"

requirements-completed: []
# SLIDE-18..24 are claimed by Plan 10-02 frontmatter as in-flight; full requirement closure
# happens at end of Plan 10-04 (Settings UI) and Plan 10-05 (Playwright e2e GREEN gate).
# Plan 10-02 ships skeleton infrastructure; the requirement check-marks land on the plan
# that delivers the user-facing functionality:
#   - SLIDE-18 (recv mode entry) — Plan 10-03 wires onRecvEvent + setSlideRef into slide.js
#   - SLIDE-19 (250 ms inter-file gap) — Plan 10-02 ships the W4 wiring; Plan 10-05 verifies
#   - SLIDE-20 (filename verbatim) — Plan 10-05 e2e verifies
#   - SLIDE-21..24 (header/data/done events + 100 MB cap) — Plan 10-01 shipped Rust side;
#     Plan 10-03 wires the JS dispatcher
# Final REQUIREMENTS.md flips happen at Plan 10-05.

# Metrics
duration: 5m
completed: 2026-05-08
---

# Phase 10 Plan 02: Wasm Boundary Forwards + Receiver Skeleton Summary

**Slide #[wasm_bindgen] façade gains 8 one-line forwards (recv accessor triple + filename triple + 2 scalars), www/state/idb.js ships as minimal incognito-tolerant IndexedDB wrapper, www/state/prefs.js DEFAULTS gains slideRecvToFolder=false, and www/transport/slide-recv.js NEW (~310 LOC) ships skeleton with per-file Blob accumulator, anchor-click + FSAP folder-save dispatch, ~N collision retry, MAX_FILE_SIZE 100 MB cap, and W4 lastDownloadAt-serialised inter-file gap — cancelSlideRecv / slidePumpOnPortLost / recoverHardFail are explicit STUBs that Plan 10-03 fills.**

## Performance

- **Duration:** 5 min (302s wall-clock)
- **Started:** 2026-05-08T10:53:00Z
- **Completed:** 2026-05-08T10:58:02Z
- **Tasks:** 3
- **Commits:** 3 atomic + 1 metadata
- **Files modified:** 4 (1 src + 1 src new + 1 state + 1 transport new) — counts as 4 because lib.rs and prefs.js are modifications, idb.js and slide-recv.js are net-new

## Accomplishments

- **Task 1: 8 wasm-boundary forwards.** lib.rs:wasm_boundary `impl Slide` block gains 8 one-line forwards after `send_current_file_idx` and before the closing `}` — recv_ptr/recv_len/clear_recv triple, recv_filename_ptr/recv_filename_len/clear_recv_filename triple, recv_file_size + recv_current_file_idx scalars. Each method body is `self.inner.METHOD()` per ADR-002 (Phase 9 verbatim template). The boundary-shape pin in tests/slide_wasm_boundary_shape.rs::slide_recv_payload_methods_have_stable_signatures + runtime reachability check were already shipped in Plan 10-01 (sibling-mirror discipline) and stay green post-edit.
- **Task 2: idb.js + prefs.js DEFAULTS.** www/state/idb.js NEW (~85 LOC) — verbatim from RESEARCH Example 4 with cited header comment; 3 exports (getRecvDirHandle/setRecvDirHandle/clearRecvDirHandle) all wrapped in try/catch + console.warn for incognito tolerance. www/state/prefs.js DEFAULTS gains `slideRecvToFolder: false`; CURRENT_VERSION NOT bumped (defensive merge at line 55 fills the field on prior-version blobs per Phase 6 precedent).
- **Task 3: slide-recv.js skeleton.** www/transport/slide-recv.js NEW (~310 LOC). 9 exports: wireSlideRecv (boot init with null-tolerant DOM refs for Plan 10-04), setSlideRef (per-session lifecycle), isSlideActive (Esc-disambiguation gate for Plan 10-03), onRecvEvent (event dispatcher with HEADER/DATA/FILE_DONE branches), cancelSlideRecv (STUB throwing "not implemented until Plan 10-03"), slidePumpOnPortLost (STUB no-op), recoverHardFail (STUB error log), __resetForTests + __getStateForTests for Playwright. Internal: per-file currentFile accumulator, ensureUnique ~N retry up to ~999, MAX_FILE_SIZE 100 MB cap (T-10-01), Pitfall 4 + Pitfall 5 verbatim in sliceRecvBytesToOwned + readRecvFilenameOwned, latin1 filename decoder (Open Question 5).
- **W4 inter-file gap actually serialised.** Module-scope `let lastDownloadAt = 0`. Inside `assembleAndDownload`: `const wait = Math.max(0, INTER_FILE_GAP_MS - (Date.now() - lastDownloadAt)); if (wait > 0) await delay(wait);` BEFORE the click; `lastDownloadAt = Date.now();` AFTER the click. Both branches (folder-save and anchor-click) honour the gap. This replaces the broken fire-and-forget `.finally(() => delay(250))` pattern that did NOT block subsequent file dispatch — the W4 fix from plan-checker iteration 1.
- **W3 multi-data-frames-per-chunk assumption documented** in slide-recv.js head comment, anchored to Plan 10-01's recv_corpus_multi_data_frames_in_one_chunk Rust test that pins the contract.
- **Wasm rebuild:** `bash scripts/build.sh` exits 0; new methods present in www/pkg/bestialitty_core.d.ts (`recv_ptr(): number;` / `recv_filename_ptr(): number;` / `recv_file_size(): number;` etc.) and bestialitty_core.js (slide_recv_ptr / slide_recv_filename_ptr / slide_recv_file_size wasm wrappers).
- **Whole-crate cargo test:** 283 baseline → 283 final (Plan 10-02 modifies lib.rs only — boundary-shape tests already shipped in Plan 10-01); cargo test --test slide_wasm_boundary_shape 10/10 green; cargo test --test core_02_no_browser_deps 3/3 green (lib.rs wasm-bindgen exemption preserved). cd www && npm run test:fast 81/81 green on two consecutive runs.

## Task Commits

Each task was committed atomically:

1. **Task 1: Add 8 wasm-boundary forwards for Slide recv accessors** — `a3428b4` (feat)
2. **Task 2: Add www/state/idb.js + slideRecvToFolder pref default** — `0342c05` (feat)
3. **Task 3: Add www/transport/slide-recv.js skeleton module** — `dc66def` (feat)

## Wasm Rebuild Confirmation (W5)

- `bash scripts/build.sh` exits 0; wasm-pack regenerates www/pkg/bestialitty_core.{js,d.ts,_bg.wasm}.
- New `.d.ts` entries present:
  ```
  recv_file_size(): number;
  recv_filename_ptr(): number;
  recv_ptr(): number;
  recv_len(): number;
  recv_filename_len(): number;
  clear_recv(): void;
  clear_recv_filename(): void;
  recv_current_file_idx(): number;
  ```
- New `.js` wasm wrappers present: `slide_recv_ptr`, `slide_recv_filename_ptr`, `slide_recv_file_size` (and 5 others); 2 occurrences of `recv_ptr` in the .js file (export wrapper + internal binding).
- **Hard reload (Ctrl+Shift+R) required** for any developer running `npm run dev` or `python3 -m http.server -d www 8000` — soft reload serves stale wasm per MEMORY.md `project_wasm_cache_workflow`.

## Module Export Inventory

### www/state/idb.js (NEW)
- `getRecvDirHandle(): Promise<FileSystemDirectoryHandle | null>` — wraps IDBObjectStore.get; returns null on incognito or missing key.
- `setRecvDirHandle(handle): Promise<void>` — wraps IDBObjectStore.put with structuredClone-compatible handle.
- `clearRecvDirHandle(): Promise<void>` — wraps IDBObjectStore.delete.
- All three: try/catch + `console.warn('[idb] METHOD failed:', e)` swallow.

### www/state/prefs.js (MODIFIED)
- DEFAULTS extended: `slideRecvToFolder: false` (Phase 10 — CONTEXT D-02 default OFF).

### www/transport/slide-recv.js (NEW)
- `wireSlideRecv(opts)` — boot-time DI initializer; opts = { prefs, savePrefs, idb, txSink, wasm, slideRef, wrapperEl, rowEl, toggleEl, folderButtonEl, statusEl, helpEl } (DOM refs null-tolerant for Plan 10-04).
- `setSlideRef(slide)` — per-session lifecycle (Plan 10-03 calls from slide.js's enterRecvMode).
- `isSlideActive()` — returns true when slideRef && state ∈ {WaitingRdy, HeaderPhase, DataPhase, FinPending, CancelPending}.
- `onRecvEvent(evt)` — dispatches on `evt & 0xFFFF_0000` to onHeaderReceived / onRecvData / onRecvFileDone.
- `cancelSlideRecv()` — **STUB** — throws `Error('cancelSlideRecv not implemented until Plan 10-03')`.
- `slidePumpOnPortLost()` — **STUB** — no-op (Plan 10-03 wires force_idle + setWireOwner('terminal')).
- `recoverHardFail(reason)` — **STUB** — `console.error('[slide-recv] hard-fail STUB: ${reason}')`.
- `__resetForTests()` — clears module-scope state for Playwright isolation.
- `__getStateForTests()` — returns `{ currentFilename, bytesInFileDone, bytesInFileTotal, recvToFolder, cancelInFlight, sessionFolderFallback, lastDownloadAt, hasHandle, handleName, permission }`.

## W4 Wiring Confirmation (lastDownloadAt-Serialised Inter-File Gap)

In `assembleAndDownload`:
1. **READ BEFORE click:** `const sinceLast = Date.now() - lastDownloadAt; const wait = Math.max(0, INTER_FILE_GAP_MS - sinceLast); if (wait > 0) await delay(wait);` — line 207.
2. **WRITE AFTER click in folder-save branch:** `await downloadToFolder(file.name, blob); lastDownloadAt = Date.now(); return;` — line 213.
3. **WRITE AFTER click in anchor-click branch:** `downloadViaAnchor(file.name, blob); lastDownloadAt = Date.now();` — line 220.

`grep -c lastDownloadAt www/transport/slide-recv.js` returns 10 (≥4 required by acceptance): 1 declaration + 1 read in assembleAndDownload + 2 writes (one per branch) + 1 declaration in __resetForTests + 1 reset assignment + 1 in __getStateForTests + 4 in head-comment / W4 explanatory comments.

## W3 Wiring Confirmation (Per-Frame EVT_RECV_DATA Assumption)

slide-recv.js head comment (lines 32-39):

> W3 assumption (documented per checker review): feed_chunk produces at most one EVT_RECV_DATA per call to step() because framer.step processes one frame per byte sequence terminated by CRC; subsequent frames in the same chunk emit subsequent EVT_RECV_DATA events that are drained sequentially with per-frame clear_recv() per Pitfall 5. Plan 10-01's slide_recv_corpus.rs includes a recv_corpus_multi_data_frames_in_one_chunk test that pins this contract — the JS drain loop relies on calling clear_recv() between events so each EVT_RECV_DATA refers only to the bytes from that single frame.

## Phase 4/5/6/8/9 Regression Confirmation

`cd www && npm run test:fast` returns 81 passed on two consecutive runs (3rd run also 81 passed). The first run had 2 transient failures (`tests/render/keyboard.spec.js` zoom test + `tests/transport/lifecycle.spec.js` beforeunload race) — known flake patterns from prior phases unrelated to this plan. slide-recv.js is not yet wired into main.js (Plan 10-03 wires it) so test:fast does not exercise it at all.

## Deviations from Plan

None — plan executed exactly as written. Plan 10-01 had already shipped the boundary-shape pin in slide_wasm_boundary_shape.rs (sibling-mirror discipline), so Task 1's "extend the pin" sub-step was a no-op verification rather than an actual edit; this is documented in the plan's Task 1 read_first which noted "Read the file first. If Plan 10-01 already added a slide_recv_payload_methods_have_stable_signatures test pinning the inner-API methods, the test continues to pin the inner API." — correctly anticipated.

## Issues Encountered

None. Two transient Playwright flakes on the first test:fast run (zoom + beforeunload) cleared on subsequent runs and are documented in prior phase decisions as known flakes.

## Threat Surface Scan

No new security-relevant surface beyond what the plan's `<threat_model>` documents:
- T-10-01 (DoS via 100 MB recv_buf) — mitigated by MAX_FILE_SIZE check in onRecvData.
- T-10-stale-view (wasm memory.buffer growth detaches view) — mitigated by Pitfall 4 re-derive in sliceRecvBytesToOwned + readRecvFilenameOwned.
- T-10-04 (silent file overwrite via FSAP) — mitigated by ensureUnique ~N retry + ~999 anchor fallback.
- T-10-prefs-merge (additive schema drift) — accepted; Phase 6 defensive merge fills the field.
- T-10-incognito-idb (IndexedDB unavailable in incognito) — mitigated by try/catch + console.warn in all 3 idb.js exports.
- T-10-slide19-gap (W4 fix) — mitigated by lastDownloadAt module-scope timestamp + Math.max(0, ...) wait BEFORE click.

cancelSlideRecv / slidePumpOnPortLost / recoverHardFail are STUBs with no security surface beyond the explicit `throw` / no-op / `console.error` they perform — Plan 10-03 will introduce real surface.

## Confirmation Notes (per plan output spec)

- **Wasm-pack build status:** exit 0; .d.ts entries for all 8 new methods present (recv_ptr/recv_len/clear_recv/recv_filename_ptr/recv_filename_len/clear_recv_filename/recv_file_size/recv_current_file_idx).
- **Hard-reload requirement (Ctrl+Shift+R):** flagged for any developer running live-server / npm run dev / python3 http.server — soft reload serves stale wasm per MEMORY.md project_wasm_cache_workflow.
- **slide-recv.js export inventory:** wireSlideRecv + setSlideRef + isSlideActive + onRecvEvent + cancelSlideRecv (STUB) + slidePumpOnPortLost (STUB) + recoverHardFail (STUB) + __resetForTests + __getStateForTests (9 exports total).
- **idb.js export inventory:** getRecvDirHandle + setRecvDirHandle + clearRecvDirHandle (3 exports total; all incognito-tolerant via try/catch + console.warn).
- **Phase 4/5/6/8/9 Playwright suite green post-plan:** 81 passed on two consecutive `npm run test:fast` runs.
- **W4 wiring (lastDownloadAt) actually serialises the gap:** read BEFORE click in assembleAndDownload + written AFTER click in BOTH branches (folder-save line 213 + anchor-click line 220).
- **W3 assumption documented in file head:** head comment lines 32-39, anchored to Plan 10-01's recv_corpus_multi_data_frames_in_one_chunk Rust test.
- **Pointer to Plan 10-03:** the cancel state machine + dispatcher rewrite + keyboard.js Esc-slot insertion + main.js boot wiring all land in Plan 10-03; the 3 STUBs (cancelSlideRecv / slidePumpOnPortLost / recoverHardFail) are the explicit insertion points.

## Next Phase Readiness

Plan 10-03 (cancel state machine + dispatcher rewrite + main.js boot) is unblocked:
- Wasm boundary forwards in place — Plan 10-03's slide.js can call slideRef.recv_ptr() / slideRef.recv_filename_ptr() / slideRef.recv_file_size() etc. on the imported wasm Slide class.
- slide-recv.js skeleton mounted with explicit STUB markers — Plan 10-03 replaces the throw-Error in cancelSlideRecv with the 5-step CTRL_CAN sequence (CTRL_CAN echo → 200/500/2000 ms windows → force_idle on tail timeout).
- idb.js + prefs.slideRecvToFolder ready for Plan 10-04 Settings UI to wire toggle + folder-picker click handlers.
- Phase 4/5/6/8/9 regression suite stays green — slide-recv.js is not yet imported by main.js so it does not affect boot or any test path.

## Self-Check: PASSED

Created files:
- FOUND: www/state/idb.js
- FOUND: www/transport/slide-recv.js

Modified files (verified via git log):
- FOUND: crates/bestialitty-core/src/lib.rs (commit a3428b4)
- FOUND: www/state/prefs.js (commit 0342c05)

Commits:
- FOUND: a3428b4 (Task 1)
- FOUND: 0342c05 (Task 2)
- FOUND: dc66def (Task 3)

Wasm exports:
- FOUND: recv_ptr / recv_filename_ptr / recv_file_size in www/pkg/bestialitty_core.d.ts
- FOUND: slide_recv_ptr / slide_recv_filename_ptr / slide_recv_file_size in www/pkg/bestialitty_core.js

---
*Phase: 10-slide-receiver-cancellation*
*Completed: 2026-05-08*
