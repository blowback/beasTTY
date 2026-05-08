# Phase 11: SLIDE JS Bridge & v1.0 Integration - Context

**Gathered:** 2026-05-08
**Status:** Ready for planning

<domain>
## Phase Boundary

Wire the SLIDE protocol (Phases 7–10) into the existing v1.0 systems so the
milestone feels native: a floating SLIDE chip that mirrors the Phase 6
scrollback chip pattern (opposite corner, theme-aware, minimal footprint), a
Settings sub-block exposing the auto-send command + show-summary toggle +
Compatibility mode selector, session-log pause + paste-pump gating during
active SLIDE sessions, symmetric port-lost teardown, an auto-type
swallow-echo filter, a `visibilitychange` best-effort CTRL_CAN, and a
graceful Z80-didn't-respond fallback chip with `[Retry] [Cancel] [Force
start]`. Phase 11 ships the integration glue that turns a working SLIDE
protocol into a daily-driver feature.

**In scope:**
- New `www/renderer/slide-chip.js` — floating chip module (sibling to
  `scroll-state.js`); single-line dense layout; auto-scaled throughput on
  a 2-second sliding window; Cancel button; lifecycle states (active /
  awaiting-wakeup / cancelled-summary / error / drop-rejected-flash).
- New chip DOM element in `www/index.html` — `<button id="slide-chip"
  hidden>` parented to `#terminal-wrapper`, positioned `bottom: 8px;
  left: 8px` (opposite the Phase 6 scrollback chip at `right: 8px`).
- New CSS rules mirroring `#scrollback-indicator` (Phase 6 D-03 visual
  treatment; theme-aware via `--chrome-accent` and `--phosphor-fg`).
- Chip data source: extend the `__slide` introspection consumer pattern
  into a `subscribe(fn)` callback so the chip module redraws on
  state/progress changes without a polling interval.
- Replace Phase 9's silent ignore in `file-source.js` `onDragEnter` /
  `onDrop` (lines 178-183, 207-211) with a transient chip flash
  "Transfer in progress — cancel first" (SLIDE-11).
- New `prefs.js` keys: `slideAutoSendCommand` (default `"B:SLIDE R\r"`),
  `slideShowSummary` (default `true`), `slideCompatibilityMode` (default
  `"auto"`). No CURRENT_VERSION bump — Phase 6 D-32 defensive merge fills
  missing fields from DEFAULTS.
- Settings pane SLIDE sub-block — nested `<details class="reserved">`
  with summary "SLIDE file transfer", containing the existing Phase 10
  "Save received files to a folder" row plus three new rows:
  auto-send-command text input, show-summary checkbox, Compatibility
  mode 3-way `<select>`.
- Auto-type swallow-echo filter (SLIDE-14) — ~500 ms byte-for-byte match
  in `dispatchInbound`'s terminal branch; matched bytes silently
  consumed; mismatch flushes swallow buffer to `term.feed`.
- `slide.js` reads `prefs.slideAutoSendCommand` instead of the hardcoded
  constant (replaces Phase 9 D-14); empty string disables auto-type
  (SLIDE-13 semantic preserved).
- Z80-didn't-respond timeout chip (SLIDE-35) — 3-second timer started at
  auto-type completion; chip enters `awaiting-wakeup` state with
  `[Retry]` / `[Cancel]` / `[Force start]` buttons; Compatibility mode
  governs whether the timer arms.
- `visibilitychange` listener extension in `chrome.js` (SLIDE-31) —
  during active session emit fire-and-forget `CTRL_CAN` (single 0x18)
  + `slide.cancel()`; also fires on `pagehide`.
- Real `slidePumpOnPortLost` (SLIDE-32) — replaces the no-op stubs in
  `slide.js` and `slide-recv.js`; symmetric to `pastePumpOnPortLost`;
  wired from `serial.js` teardown + handleReadError +
  onNavSerialDisconnect (lines 496, 527, 670).
- Session-log pause (SLIDE-33) — wrap `sessionLog.append(value)` call
  site in `serial.js` read loop with `if (!isSlideActive()) ...`
  predicate.
- Paste-pump gate (SLIDE-33) — at SLIDE wakeup match completion, call
  `pastePump.cancelPaste()`; gate `enqueuePaste` to no-op while
  `isSlideActive()`. In-flight large paste interrupts to the user via
  the existing Phase 5 D-18 cancel UI.
- Post-cancel summary chip "Cancelled — N of M files transferred" with
  5-second auto-hide (SLIDE-28) — implemented as a chip lifecycle
  state, not a separate element.
- Playwright coverage: chip lifecycle (active / cancelled-summary /
  error / drop-rejected / awaiting-wakeup), session-log pause, paste
  cancel on session start, port-lost teardown, visibilitychange
  CTRL_CAN, Compatibility-mode timeout behavior. Mock-bot reuse from
  Phase 9/10.

**Out of scope:**
- Filename collision auto-rename UX on SEND (`NAME~1.TXT, NAME~2.TXT`) —
  Phase 12 (SLIDE-36).
- Drag-drop vs pointer-select isolation regression spec — Phase 12
  (SLIDE-12).
- Auto-send command safety validation (alphanumeric + `:` + `\r` only +
  first-use confirmation chip for non-default values) — Phase 12
  (SLIDE-38).
- `docs/SLIDE_Z80_REQUIREMENT.md`, README "File transfer" section,
  `docs/SLIDE-UAT.md` real-hardware UAT — Phase 12 (SLIDE-40, SLIDE-41,
  SLIDE-42).
- ETA calculation, NAK counter display, pre-send confirm chip,
  open-downloads link, backgrounded-tab redraw skip, auto-send-command
  preset dropdown — P2 differentiators per FEATURES.md / SUMMARY §4 DI-*;
  Phase 11 lands the P0/P1 requirements only.
- Bulk save / batch download UI, IndexedDB virtual filesystem, long
  filename support beyond 8.3 — out of scope per PROJECT.md
  §"Out of scope for v1.1".

</domain>

<decisions>
## Implementation Decisions

### Floating SLIDE chip — visual & content (SLIDE-25, SLIDE-26)

- **D-01:** **Single-line dense layout.** Chip content during an active
  transfer:
  ```
  ↑ MY-DOC.TXT  2/3  47%  482 KB  12.3 KB/s  [Cancel]
  ```
  Direction arrow (`↑` send, `↓` recv) + 8.3 filename verbatim + `N/M`
  file index + percent + bytes done + throughput + Cancel. Mirrors the
  Phase 6 scrollback chip's terseness; minimal vertical real estate;
  single render path with token-by-token concatenation. (Locked.)

- **D-02:** **Throughput auto-scaled units; first 2 s shows `—`.**
  Below 1 KB/s: `847 B/s`. 1–999 KB/s: `12.3 KB/s` (1 decimal place).
  ≥ 1 MB/s: `1.4 MB/s`. Window: 2-second sliding sample ring.
  Implementation: `samples: { t: number, bytes: number }[]` capped to
  the 2-second window; throughput = `(samples[last].bytes -
  samples[0].bytes) / (samples[last].t - samples[0].t)` in bytes-per-
  second; while `samples.length < 2` OR window age < 2000 ms, render
  `—`. (Locked.)

- **D-03:** **Filename verbatim from header frame.** CP/M 8.3 caps
  filenames at ≤ 12 chars; the chip width fits the longest case
  comfortably. No truncation function, no ellipsis. Mirrors Phase 10
  CONTEXT D-07 verbatim policy. Edge case (collision-rewritten
  `~N` suffix on RECV per Phase 10 D-05) — chip displays the
  rewritten name as it lands on disk. (Locked.)

- **D-04:** **`[Cancel]` text button matching Phase 6 chip style.**
  Same typography, same border treatment, same rgba(0,0,0,0.65)
  background. Click → calls existing recv-side `cancelSlideRecv()` or
  the sender-side equivalent (planner picks the dispatcher entry per
  current direction). Esc-key parity preserved (Phase 10 D-* slot 2 in
  the disambiguation chain) — the chip button and Esc are equivalent
  paths into the same cancel state machine. (Locked.)

### Chip placement & lifecycle (Claude's Discretion bounds)

- **C-01:** **Chip placement: `bottom: 8px; left: 8px`.** Opposite
  corner from the Phase 6 scrollback chip (`right: 8px`) per Pitfall 14
  + SUMMARY TS-8 collision policy. Theme-aware via `--chrome-accent`
  (clean theme) and `--phosphor-fg` (CRT theme); same `rgba(0,0,0,0.65)`
  background; same 4px border-radius; same `box-shadow:
  0 2px 8px rgba(0,0,0,0.5)`. Carry-forward — locked by Pitfall 14.

- **C-02:** **Chip module location: new `www/renderer/slide-chip.js`.**
  Sibling to `scroll-state.js`. Module-scope state with a
  `wireSlideChip({ chipEl, getSlideState, onCancel })` initializer.
  Subscribe to dispatcher state-change events for redraws + a 250 ms
  refresh tick for throughput updates (a polling interval is acceptable
  here because SLIDE sessions are bounded in duration). Expose
  `enterAwaitingWakeup(autoSendCmd)`, `enterError(reason)`,
  `flashDropRejected()`, `enterCancelledSummary({ done, total })` for
  imperative state transitions; the active-session render driven by
  `__slide` introspection. Carry-forward.

### Settings pane SLIDE sub-block (SLIDE-37, SLIDE-39)

- **D-05:** **Nested `<details class="reserved">` SLIDE block** with
  summary `"SLIDE file transfer"`. Contains, in this order:
  1. The existing Phase 10 "Save received files to a folder" row
     (moved into the SLIDE sub-block from its current top-level
     position in the Settings pane).
  2. **Auto-send command** text input row.
  3. **Show transfer summary chip** checkbox row.
  4. **Compatibility mode** 3-way `<select>` row.
  Mirrors the existing `details.reserved` styling (Plan 04-03 stylesheet
  line 298). Keeps Settings pane scannable; collapses out of the way for
  daily-driver users who never edit SLIDE config. (Locked.)

- **D-06:** **Auto-send command text input pre-filled with literal
  `B:SLIDE R`.** Hint text below: `\r appended automatically`. Empty
  input disables auto-type per SLIDE-13 semantic (preserves Phase 9
  D-14 logic; Phase 11 just changes the source from a constant to
  `prefs.slideAutoSendCommand`). On change, `savePrefs({
  slideAutoSendCommand: input.value + '\r' })` (the trailing `\r` is
  appended at save time, not displayed in the input — keeps the input
  human-readable). (Locked.)

- **D-07:** **Compatibility mode 3-way `<select>`:**
  - `Auto` (default) — auto-type + 3-second wakeup wait + timeout
    chip on miss.
  - `Wakeup-required` — auto-type + indefinite wait for wakeup; no
    timeout chip ever surfaces (modern slide.com that always emits
    `ESC ^ S L I D E`).
  - `Force-start (legacy slide.com)` — auto-type + skip wakeup wait
    entirely; jump straight into send mode after the auto-type completes
    (treats the Z80 as if it had emitted the wakeup signature). For
    pre-v0.2.1 slide.com.
  Verbatim PITFALLS §15 prescription. (Locked.)

- **D-08:** **Show transfer summary chip checkbox; default ON.**
  When ON, after a successful session closes the chip stays visible
  for 5 seconds with `Sent N files — X.X MB → MicroBeast` (or
  `Received N files — X.X MB`). When OFF, the chip hides immediately
  on session close. SLIDE-28 post-cancel summary chip (`Cancelled —
  N of M files transferred`) is **not** governed by this checkbox —
  it always shows for 5 s on cancel; the checkbox covers happy-path
  summaries only. (Locked.)

### Prefs schema additions (SLIDE-37)

- **D-09:** **New `prefs.js` DEFAULTS keys:**
  ```js
  slideAutoSendCommand: 'B:SLIDE R\r',
  slideShowSummary: true,
  slideCompatibilityMode: 'auto',     // 'auto' | 'wakeup-required' | 'force-start'
  ```
  No `CURRENT_VERSION` bump — Phase 6 D-32 defensive merge fills
  missing fields from DEFAULTS on load; existing users get the new
  defaults transparently. The 250 ms debounced save (Phase 6 D-33)
  applies to all three. Phase 12 SLIDE-38 will add a safety
  validation pass on `slideAutoSendCommand` (alphanumeric + `:` +
  `\r` only) — Phase 11 stores whatever the user types. (Locked.)

### Drops during active SLIDE session (SLIDE-11)

- **D-10:** **Replace Phase 9 silent ignore with chip flash "Transfer
  in progress — cancel first".** In `file-source.js` `onDragEnter`
  (line 178) and `onDrop` (line 208): when `isSessionActive()`, call
  `slideChip.flashDropRejected()` instead of returning silently.
  Flash state lasts 3 seconds then reverts to the prior chip content
  (active session continues). Implementation: a `dropRejectedUntil:
  number` module-scope flag in `slide-chip.js`; the render function
  prepends `Transfer in progress — cancel first` while
  `Date.now() < dropRejectedUntil`, otherwise renders the active
  state. (Locked.)

### Session-log pause + paste-pump gate (SLIDE-33)

- **D-11:** **Session-log pause: gate at the call site.** In
  `serial.js` read loop (the existing `sessionLog.append(value)` call
  after `dispatchInbound(value)`), wrap with:
  ```js
  if (!isSlideActive()) sessionLog.append(value);
  ```
  Simpler than gating inside `append()`; preserves the existing
  one-call-per-chunk semantics. Wakeup-swallowed bytes (the 7-byte
  signature itself) are also excluded because the dispatcher consumes
  them before they reach the log gate (the wakeup matcher's swallow
  buffer is never replayed during session-active state). (Locked.)

- **D-12:** **Paste-pump gate: `cancelPaste()` on session start +
  no-op `enqueuePaste` while session active.** At SLIDE wakeup match
  completion (`slide.js` `enterRecvMode` / `enterSendMode` entry
  points), call `pastePump.cancelPaste()`. Gate `enqueuePaste(bytes)`
  with `if (isSlideActive()) { logAndNoop(); return; }`. User-visible:
  a long paste in flight when SLIDE wakeup arrives is interrupted via
  the existing Phase 5 D-18 cancel chip (`Paste cancelled`). Subsequent
  Ctrl+Shift+V attempts during the SLIDE session no-op silently (no
  user surface — chip already says SLIDE is active). (Locked.)

### `visibilitychange` CTRL_CAN handler (SLIDE-31)

- **D-13:** **Extend existing `chrome.js` visibilitychange listener;
  fire-and-forget single-byte CTRL_CAN.** The Phase 3 BEL prefix
  listener at `chrome.js:210` already exists. Phase 11 adds:
  ```js
  if (document.visibilityState === 'hidden' && isSlideActive()) {
      try { slide.cancel(); } catch {}
      try { txSinkRef.writeSlideFrame(new Uint8Array([0x18])); } catch {}
  }
  ```
  No await. No 5-step state machine. No chip update (page is hidden).
  Best-effort means: it might not reach the wire if the tab is being
  torn down, and that's acceptable per PITFALLS §6 documentation.
  Also register a `pagehide` listener with the same body — `pagehide`
  fires on bfcache eviction where `visibilitychange` may not. (Locked.)

### `slidePumpOnPortLost` real implementation (SLIDE-32)

- **D-14:** **`slidePumpOnPortLost` lives in `slide-recv.js`; `slide.js`
  forwards.** Phase 10 already laid the foundation in `slide-recv.js`
  (`function slidePumpOnPortLost()` at line 688). Phase 11's full
  implementation:
  ```js
  export function slidePumpOnPortLost() {
      if (!isSlideActive()) return;
      try { slide.force_idle(); } catch {}    // Phase 7 D-08 escape hatch
      txSinkRef.setWireOwner('terminal');
      slideChip.enterError('port lost');       // 5-second auto-hide
      // Reset module state (mode, pendingSendSession, recv buffers)
      reset();
  }
  ```
  Wired from `serial.js` teardown / handleReadError /
  onNavSerialDisconnect — symmetric with the existing `pastePumpOnPortLost`
  calls at lines 496, 527, 670. The `slide.js` stub at line 199
  forwards to the real impl in `slide-recv.js` so existing imports
  keep resolving. (Locked.)

### Z80-didn't-respond timeout chip (SLIDE-35)

- **D-15:** **3-second timeout from auto-type completion.** Counted
  from the last byte of the auto-type command being written to the
  wire (not from the user clicking Send). Chip enters
  `awaiting-wakeup` state immediately after auto-type completes; if
  the wakeup arrives before 3 s, chip transitions to `active`. If
  3 s elapses without wakeup AND `slideCompatibilityMode === 'auto'`,
  chip displays:
  ```
  Z80 didn't respond.  [Retry]  [Cancel]  [Force start]
  ```
  Buttons:
  - **`[Retry]`** — re-emit auto-type, restart 3 s timer.
  - **`[Cancel]`** — clear `pendingSendSession`, return chip to hidden,
    return mode to `terminal`.
  - **`[Force start]`** — skip wakeup wait; jump directly into send
    mode (call `enterSendModeInternal(pendingSendSession)`); equivalent
    to switching `slideCompatibilityMode` to `'force-start'` for this
    one session. (Locked.)

- **D-16:** **Compatibility mode governs whether the 3 s timer arms.**
  - `'auto'` (default) — 3 s timer + timeout chip on miss.
  - `'wakeup-required'` — no timer; user waits indefinitely (or hits
    Esc / chip Cancel). Suitable for modern slide.com that always
    emits the wakeup; avoids the timeout chip flash for users who
    have a slow Z80.
  - `'force-start'` — skip wakeup wait entirely; auto-type completes,
    immediately transition to send mode without arming the matcher.
    For pre-v0.2.1 slide.com. (Locked.)

### Auto-type swallow-echo filter (SLIDE-14)

- **C-03:** **Byte-for-byte match; lives in `dispatchInbound`'s
  terminal branch; ~500 ms timeout.** PITFALLS §11 prescription:
  on auto-type, push the typed bytes into a swallow buffer with a
  500 ms expiry; for inbound bytes during `mode === 'terminal'`, if
  swallow buffer non-empty AND first byte matches buffer head: shift
  buffer, swallow byte (do NOT forward to `term.feed`); on mismatch
  OR expiry, flush remaining buffer to `term.feed` (preserves any
  echo that didn't fully match) and resume normal forwarding.
  Edge case: local-echo on (Phase 4 D-12) means typed bytes are
  already painted on screen; the echo from CP/M is a duplicate, and
  swallowing it preserves the local-echo display. CR/LF mode
  rewrite: TX bytes go through Phase 4 D-13 rewrite; CP/M echoes
  what it received; the swallow buffer compares against the
  post-rewrite TX bytes (what actually went on the wire), so CR/LF
  mode is transparent. Filter location: a new
  `www/transport/echo-swallow.js` module called from
  `dispatchInbound`'s terminal-branch byte loop, before the wakeup
  matcher; or inline in `slide.js` as module-scope state. Planner
  picks based on readability. Carry-forward — locked by PITFALLS §11.

### Carry-forward (locked from prior context, not re-asked)

- **C-04:** Esc disambiguation chain, slot 2 = SLIDE cancel
  (Phase 10). Chip Cancel button is a click equivalent to the Esc
  path; both call the same `cancelSlideRecv()` (or sender-side
  equivalent) entry point.
- **C-05:** `__slide` introspection shape (Phase 9 D-18 + Phase 10
  C-05): `{ mode, state, file_idx, total_files, bytes_in_file_done,
  bytes_in_file_total, current_filename }`. Chip reads this on every
  redraw; no new fields needed for Phase 11.
- **C-06:** `prefs.js` versioned blob + 250 ms debounced save
  (Phase 6 D-32/D-33). Phase 11 adds three keys to DEFAULTS only;
  no migration step.
- **C-07:** `showDirectoryPicker` + IndexedDB FileSystemDirectoryHandle
  for the Phase 10 "Save to folder" row (Phase 10 D-03). Phase 11
  inherits unchanged; the row moves into the SLIDE sub-block (D-05)
  but its behavior is locked by Phase 10.
- **C-08:** ADR-003 5-step cancel state machine (Phase 10). Chip
  Cancel button hands off to the existing implementation in
  `slide-recv.js`; Phase 11 does not reimplement.
- **C-09:** No `std::time` in Rust core (ADR-002 + ADR-003 + the
  `core_02_no_browser_deps.rs` enforcement). All Phase 11 timing
  (3 s wakeup timeout, 500 ms swallow-echo, 250 ms throughput tick,
  5 s summary auto-hide, 3 s drop-rejected flash) lives in JS via
  `setTimeout` / `Promise.race(timeoutPromise(ms))`.
- **C-10:** Per-session `new Slide()` lifecycle (Phase 8 dispatcher
  pattern). Phase 11 chip state resets on every `new Slide()`
  construction.

### Claude's Discretion

The following intentionally remain unlocked at the planning stage:

- **Chip update mechanism — observer pattern vs polling tick.** The
  default is a hybrid: dispatcher fires `slideChip.onStateChange()`
  callbacks on state transitions (mode change, file_idx change,
  EVT_FILE_COMPLETE / EVT_RECV_FILE_DONE) AND a 250 ms refresh tick
  for throughput updates between state events. Planner may revise to
  pure-polling at 100 ms (simpler, slightly higher idle CPU) or
  pure-observer with a self-scheduling `setTimeout` chain (more
  complex, lower idle CPU). Cost difference is negligible; pick the
  one with the cleaner test surface.

- **Chip DOM shape.** `<button id="slide-chip">` (the Phase 6 chip
  pattern — focusable, click-targetable) vs `<div id="slide-chip">`
  with an inner `<button>` for Cancel (separates chip surface from
  cancel target). Default: `<button>` with the Cancel as a nested
  `<button>` (matches Phase 6 verbatim — the chip itself is
  click-target for "snap to bottom" in Phase 6, but in Phase 11 the
  whole chip click surface has no action; only the inner Cancel does).
  Planner may flip to `<div>` if the nested-button accessibility model
  surfaces issues.

- **Awaiting-wakeup chip layout.** During the 3 s wait, what does the
  chip show? Default: `↑ Waiting for Z80…  [Cancel]` (compact, mirrors
  the active layout). Planner may add an animated `…` ellipsis or a
  countdown (`2 s remaining`) — neither in scope for Phase 11
  decisions, but acceptable polish if test surface remains clean.

- **Throughput sample ring data structure.** Default: `Array<{ t,
  bytes }>` with a tail-pop loop on each sample to discard entries
  older than 2 s. Planner may use a `CircularBuffer` or a small
  fixed-size ring if the polling tick produces a stable sample count.
  Cost difference is negligible at 4 samples/sec × 2 s = 8 entries
  steady-state.

- **Compatibility-mode 'force-start' UX.** When the user picks
  `force-start` in Settings, does the chip skip the
  `awaiting-wakeup` state entirely (transition `auto-type-complete →
  active` directly)? Default: yes. Alternative: show
  `awaiting-wakeup` for ~100 ms as a visual cue that the auto-type
  succeeded. Default is cleaner; planner may add the 100 ms flash
  if real-hardware UAT (Phase 12) finds users confused by an
  instant transition.

- **Settings row order within the SLIDE sub-block.** D-05 specifies
  the order: (1) Save to folder (Phase 10 carry), (2) Auto-send
  command, (3) Show summary, (4) Compatibility mode. Planner may
  reorder to (1) Auto-send + (2) Compatibility (both about session
  initiation), (3) Save to folder (about the receive direction
  specifically), (4) Show summary (cosmetic). Default sticks with
  D-05 to keep "Save to folder" visually adjacent to the rest of
  the SLIDE config without splitting.

- **Auto-send command "Reset to default" affordance.** Settings
  row may add a small `[Reset]` button that re-fills the input with
  `B:SLIDE R`. Default: omit (rely on the user remembering or
  copy-pasting). Planner may add if the input feels easy to corrupt
  by accident; the cost is one button + one event handler.

- **Phase 9 button-state-observer cleanup (file-source.js:115).**
  The 200 ms `setInterval` polling the `__slide` state can become
  event-driven via the new chip lifecycle observers. Default: leave
  Phase 9's poller in place (working code; no urgency). Planner may
  refactor opportunistically if the chip module's observer
  registration surfaces a clean shared-subscriber pattern.

- **Chip error-state copy.** `enterError(reason)` displays a
  short string; the reason map (`'port lost'`, `'CRC retries
  exhausted'`, `'wire desync'`, `'force_idle escape'`) is internal.
  Default copy: `Transfer failed — {reason}.  [Retry]` where
  `[Retry]` re-arms the wakeup matcher (or re-emits auto-type if
  send-mode). Planner may simplify to `Transfer failed.  [Retry]`
  if the reason strings prove confusing in UAT; SLIDE-29 just
  requires "error with a 'Retry' hint".

- **Awaiting-wakeup timer storage.** Module-scope `setTimeout`
  handle in `slide-chip.js` (if chip owns the timer) vs `slide.js`
  (if dispatcher owns the timer + emits an event for the chip).
  Default: chip owns the timer (matches Phase 6 chip ownership of
  `newLinesSinceUserScrolled`). Planner picks based on test
  isolation needs.

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Project intent

- `.planning/PROJECT.md` §Current Milestone — v1.1 FileTransfer locked
  scope (Rust core / JS shell split; SLIDE owns the wire from `ESC ^`
  to FIN-FIN; floating chip mirrors Phase 6 scrollback chip pattern)
- `.planning/REQUIREMENTS.md` §SLIDE floating chip + cancellation
  (SLIDE-25, SLIDE-26, SLIDE-28); §SLIDE integration with existing
  v1.0 systems (SLIDE-11, SLIDE-14, SLIDE-31, SLIDE-32, SLIDE-33,
  SLIDE-35); §SLIDE settings & persistence (SLIDE-37, SLIDE-39)
- `.planning/ROADMAP.md` §Phase 11 — goal, dependencies, 5 success
  criteria

### v1.1 milestone research

- `.planning/research/SUMMARY.md` §3 Architecture Decisions, §4 P0/P1
  table-stakes (TS-3, TS-4, TS-8, TS-11, TS-12, TS-13, TS-14, TS-17,
  TS-21, TS-25), §5 phase boundaries (Phase 11 = "Ph E JS bridge /
  integration"), §6 OQ-5 (wakeup-tail timing — locked at 3 s default,
  Compatibility mode for legacy)
- `.planning/research/ARCHITECTURE.md` — **§3 TX-sink integration /
  wire-owner handoff** (Phase 11 reuses `setWireOwner` for chip-
  cancelled session cleanup); **§4 prefs persistence pattern**
  (Phase 11 adds 3 keys to the Phase 6 versioned blob); §6 chip
  lifecycle (mirror Phase 6); §7 cancellation propagation (Phase 11
  chip Cancel button hands off to Phase 10's 5-step machine);
  Anti-Pattern 4 (no `std::time` in Rust)
- `.planning/research/PITFALLS.md` — **§6 tab close mid-transfer
  (HIGH; Phase 11's primary correctness gate for SLIDE-31);** §11
  echo of auto-typed `B:SLIDE R\r` (HIGH; SLIDE-14); §14 floating
  chip conflicts with scrollback chip (MEDIUM; SLIDE-25 placement);
  §15 Z80-side version skew (MEDIUM; SLIDE-35 fallback chip + SLIDE-39
  Compatibility mode); §16 SLIDE bytes leaking into session log (LOW;
  SLIDE-33); §18 paste-during-SLIDE (LOW; SLIDE-33 paste-pump gate)
- `.planning/research/STACK.md` §Recommended Stack — Additions (no new
  Rust/JS deps; locked)
- `.planning/research/FEATURES.md` §P0/P1 (Phase 11 covers TS-3, TS-4,
  TS-8, TS-11, TS-12, TS-13, TS-14, TS-17, TS-21); §P2 differentiators
  DI-1/DI-2/DI-7/DI-13/DI-14/DI-15 — explicitly out of scope for
  Phase 11

### Existing project decisions

- `.planning/decisions/ADR-001-parser-strategy.md` — `vte = "=0.15"`;
  irrelevant to Phase 11's chip / Settings work but the swallow-echo
  filter (D-14 / C-03) must not subvert vte's torn-chunk invariants
- `.planning/decisions/ADR-002-wasm-gating.md` — wasm-bindgen attrs
  gated to `target_arch = "wasm32"` in `lib.rs` only; Phase 11 makes
  zero changes to the Rust crate
- `.planning/decisions/ADR-003-slide-v0-2-1-can-amendment.md` —
  bidirectional CTRL_CAN echo contract; Phase 11 chip Cancel button
  + visibilitychange CTRL_CAN both consume this contract; no protocol
  changes

### Prior phase context (cross-phase consistency)

- `.planning/phases/03-canvas-renderer/03-CONTEXT.md` — `[data-focused]`
  attribute pattern (Phase 11 chip uses `[hidden]` toggle, not a new
  attribute); BEL flash + title prefix pattern (Phase 11 `chrome.js`
  visibilitychange listener extends the existing one for SLIDE-31)
- `.planning/phases/04-keyboard-input/04-CONTEXT.md` — Settings pane
  DOM + CSS conventions (Phase 11 SLIDE sub-block follows the
  `details.reserved` styling at stylesheet line 298); CR/LF rewrite
  table (Phase 11 swallow-echo filter compares against post-rewrite
  TX bytes per C-03)
- `.planning/phases/05-web-serial-transport/05-CONTEXT.md` — D-18
  paste-pump cancelPaste() pattern (Phase 11 D-12 reuses for the
  session-start gate); D-20 `pastePumpOnPortLost` symmetric extension
  (Phase 11 D-14 mirrors as `slidePumpOnPortLost`); error log shape
  (Phase 11 chip error states do NOT pollute the error log — port-lost
  is already logged by Phase 5)
- `.planning/phases/06-daily-driver-polish-session-deployment/06-CONTEXT.md`
  — **D-03 floating chip pattern (the visual contract Phase 11 mirrors
  for `#slide-chip`); D-32/D-33 prefs versioned blob + 250 ms
  debounced save (Phase 11 adds 3 keys to DEFAULTS); D-29 session-log
  per-connection lifecycle (Phase 11 D-11 wraps the append call site);
  Pitfall 14 chip collision policy (chip placement at opposite corner)**
- `.planning/phases/08-wasm-boundary-js-dispatcher-esc-wakeup/08-CONTEXT.md`
  — D-01/D-02 wakeup matcher (Phase 11 swallow-echo filter sits BEFORE
  the wakeup matcher in the inbound byte stream); D-09 setWireOwner
  contract (Phase 11 cancel paths reuse); D-10 Slide façade contract
  (Phase 11 makes zero Rust changes)
- `.planning/phases/09-slide-sender-host-z80-send/09-CONTEXT.md` —
  D-13 auto-type flow (Phase 11 D-15 timer arms after this completes);
  D-14 hardcoded `B:SLIDE R\r` (Phase 11 D-09 replaces with prefs);
  D-15 send-pending NO timeout (Phase 11 D-15 adds the timeout chip);
  D-18 `__slide` introspection (Phase 11 chip data source); the
  Phase 9 button-state observer at file-source.js:115 (Phase 11
  cleanup opportunity per Claude's Discretion)
- `.planning/phases/10-slide-receiver-cancellation/10-CONTEXT.md` —
  **D-01/D-02 Save-to-folder Settings row (Phase 11 D-05 moves into
  SLIDE sub-block);** D-15 (no chip in Phase 10 — Phase 11 adds);
  C-06 Esc disambiguation chain slot 2; ADR-003 5-step cancel state
  machine (Phase 11 chip Cancel hands off); existing
  `slidePumpOnPortLost` stub at slide-recv.js:688 (Phase 11 D-14
  fills in)

### Existing JS shell seams (Phase 11 modifies / honours)

- `www/renderer/scroll-state.js:194-207` — Phase 6 chip lifecycle
  pattern; **Phase 11's `www/renderer/slide-chip.js` mirrors this
  module's shape verbatim** (module-scope state, `wireXxx` initializer,
  `refreshChip()` render fn, `[hidden]` toggle, theme-aware via CSS
  variables, `pointer-events: none` while hidden via the `[hidden]`
  attribute)
- `www/renderer/chrome.js:200-225` — Phase 3 visibilitychange
  listener (BEL prefix); **Phase 11 D-13 extends this listener body**
  with the SLIDE CTRL_CAN best-effort emission
- `www/transport/slide.js:199-201` — Phase 8 stub
  `slidePumpOnPortLost` (no-op); **Phase 11 D-14 forwards to the real
  impl in `slide-recv.js`**
- `www/transport/slide-recv.js:683-690` — Phase 10 stub
  `slidePumpOnPortLost` (5-line minimum); **Phase 11 D-14 fills the
  full body** (force_idle + setWireOwner + chip enterError + reset)
- `www/transport/serial.js:496, 527, 670` — `pastePumpOnPortLost`
  call sites; **Phase 11 adds parallel `slidePumpOnPortLost()` calls
  immediately after each** (symmetric port-lost teardown)
- `www/transport/serial.js` read loop — the existing
  `sessionLog.append(value)` post-feed call; **Phase 11 D-11 wraps
  with `if (!isSlideActive())` predicate**
- `www/transport/slide.js` — `enterRecvMode` / wakeup-completion
  clauses; **Phase 11 D-12 inserts `pastePump.cancelPaste()` at
  session start**; D-09 swap source from hardcoded `'B:SLIDE R\r'`
  to `prefs.slideAutoSendCommand`
- `www/input/file-source.js:178-183, 207-211` — Phase 9 silent
  ignore branches; **Phase 11 D-10 replaces with
  `slideChip.flashDropRejected()`**
- `www/input/file-source.js:115` — 200 ms button-state observer
  setInterval; Phase 11 cleanup opportunity (Claude's Discretion)
- `www/input/paste-pump.js` — Phase 5 pump module; **Phase 11 D-12
  gates `enqueuePaste` with `if (isSlideActive()) return;` no-op
  early-return**
- `www/state/prefs.js:18-30` — Phase 6 DEFAULTS Object.freeze; **Phase
  11 D-09 adds three keys**: `slideAutoSendCommand`,
  `slideShowSummary`, `slideCompatibilityMode`
- `www/index.html` — Phase 6 Settings pane; **Phase 11 D-05 wraps
  the existing Phase 10 "Save to folder" row + three new rows in a
  nested `<details class="reserved">` block**; adds
  `<button id="slide-chip" hidden>` parented to `#terminal-wrapper`;
  adds CSS rules mirroring `#scrollback-indicator` at
  `<style>` line 138-164
- `www/main.js` — boot wiring; **Phase 11 adds
  `wireSlideChip({ chipEl, getSlideState, onCancel, prefs })`** AFTER
  `wireSlideRecv` and the existing `wireSlideDispatcher`; chip
  observer registration; visibilitychange + pagehide listeners

### SLIDE upstream protocol & reference impls

- `/home/ant/src/microbeast/SLIDE/SPEC-v0.2.md` — protocol spec
  (Phase 11 makes zero protocol changes; consumes the existing
  contract)
- `/home/ant/src/microbeast/SLIDE/slide-rs/src/protocol.rs` —
  reference impl (CRC, frame builder); irrelevant to Phase 11 except
  via the existing wasm boundary contract
- ADR-003 §3 5-step cancel state machine (already implemented in
  Phase 10) — Phase 11 chip Cancel button + visibilitychange
  CTRL_CAN both reuse this contract

### Browser API references

- [Page Visibility API](https://developer.mozilla.org/en-US/docs/Web/API/Page_Visibility_API)
  — `visibilitychange` + `document.visibilityState === 'hidden'`
  for SLIDE-31
- [pagehide event](https://developer.mozilla.org/en-US/docs/Web/API/Window/pagehide_event)
  — bfcache-safe complement to `visibilitychange` for SLIDE-31
- [HTMLDetailsElement](https://developer.mozilla.org/en-US/docs/Web/API/HTMLDetailsElement)
  — `<details class="reserved">` styling for the SLIDE sub-block
  (D-05); mirrors the existing Settings-pane idiom
- [HTMLSelectElement](https://developer.mozilla.org/en-US/docs/Web/API/HTMLSelectElement)
  — Compatibility mode 3-way `<select>` (D-07)

### Build / test orchestration

- `scripts/build.sh` — `wasm-pack build --target web` driver; Phase 11
  makes ZERO Rust changes; `www/pkg/` regeneration is a no-op for this
  phase (kept for parity with the standard build flow)
- `www/tests/transport/` Playwright suite — Phase 11 adds
  `slide-chip.spec.js` (chip lifecycle states), `slide-bridge.spec.js`
  (session-log pause + paste-pump gate + visibilitychange + port-lost),
  `slide-compatibility.spec.js` (3-way Compatibility mode behavior),
  `slide-prefs.spec.js` (Settings persistence)
- Mock-bot reuse from Phase 9/10 (`www/tests/mock-serial-slide-bot.js`);
  Phase 11 adds wakeup-delay injection (mock waits N ms before
  emitting `ESC ^ S L I D E`) for the timeout-chip tests

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets

- **Phase 6 `scroll-state.js` chip module** (lines 194-207): exact
  template for `slide-chip.js`. Same module-scope state, same
  `refreshChip()` render fn, same `[hidden]` toggle, same theme-aware
  CSS variable references.
- **Phase 6 `#scrollback-indicator` CSS** (`index.html` style block
  lines 138-164): direct visual contract for `#slide-chip`. Same
  `position: absolute`, same `bottom: 8px`, same `z-index: 5`, same
  font/padding/background/border/box-shadow — only `right: 8px`
  changes to `left: 8px`.
- **Phase 9 `file-source.js` `isSessionActive()` helper** (line 169):
  reusable as the predicate for D-10's chip flash trigger; D-12's
  paste-pump gate predicate; D-13's visibilitychange CTRL_CAN
  predicate. Single source of truth (already exported pattern via
  `__slide.isActive`).
- **Phase 10 `slidePumpOnPortLost` stub** (`slide-recv.js:688`):
  Phase 11 fills the body; the function symbol is already exported
  and wired into the Phase 10 module structure.
- **Phase 5 `pastePumpOnPortLost`** (`paste-pump.js`, called from
  `serial.js:496,527,670`): exact symmetry template for D-14's full
  `slidePumpOnPortLost` body; the call sites in serial.js are the
  pattern Phase 11 mirrors.
- **Phase 5 `pastePump.cancelPaste()`** (paste-pump.js export):
  Phase 11 D-12 calls this at SLIDE wakeup match completion;
  existing Phase 5 D-18 cancel chip surface is the user-visible
  cue.
- **Phase 6 `prefs.savePrefs({ key: value })` debounced 250 ms**
  (prefs.js): Phase 11 D-09 adds three keys; the save mechanism is
  unchanged.
- **Phase 6 `bestialitty.prefs` versioned blob load** (`prefs.js`
  lines 46-80): Phase 11 D-09 relies on the existing defensive
  merge (line 66) to fill missing fields; no migration step needed.
- **Phase 6 `details.reserved` Settings styling** (stylesheet line
  298): Phase 11 D-05 reuses for the SLIDE sub-block.
- **Phase 3 `chrome.js` visibilitychange listener** (line 210):
  Phase 11 D-13 extends the existing listener body; no new event
  registration.
- **Phase 9 `__slide` introspection accessor** (`slide.js` lines
  223-262): Phase 11 chip subscribes for redraws; the shape is
  already extended for sender + receiver fields.
- **Phase 9 `file-source.js` button-state observer** (line 115): if
  Phase 11 reuses the same observer pattern for chip lifecycle, the
  Phase 9 polling loop becomes redundant (Claude's Discretion
  cleanup).
- **Phase 4 `mousedown preventDefault` pattern**: Phase 11 chip
  Cancel button + Settings new-row controls follow this idiom
  verbatim (retain canvas focus through chrome interaction).

### Established Patterns

- **Module-scope JS state with `wireXxx({...})` initializers** —
  `slide-chip.js` follows the exact pattern of `paste-pump.js`,
  `scroll-state.js`, `file-source.js`, `slide-recv.js`.
- **Theme-aware via CSS custom properties** — `var(--chrome-accent)`
  for clean theme, `var(--phosphor-fg)` for CRT theme. Phase 11
  chip styling reuses this pattern (zero theme JS).
- **`[hidden]` attribute for show/hide** (Phase 6 D-03): no
  `display: none` toggling in JS; toggle the attribute, let CSS
  handle the rule (`#slide-chip[hidden] { display: none; }`).
- **Versioned prefs blob with debounced save** (Phase 6 D-32/D-33):
  Phase 11 inherits unchanged.
- **`<details>`-collapsible Settings panes** — Phase 11 D-05 keeps
  the SLIDE sub-block collapsible to manage Settings-pane visual
  density.
- **Single-line hot-path edits** (Phase 5 + Phase 8): Phase 11
  wraps `sessionLog.append(value)` (D-11) with a single-line
  predicate; replaces `'B:SLIDE R\r'` constant with
  `prefs.slideAutoSendCommand` at one site.
- **No Rust changes in JS-bridge phases** — Phase 11 ships zero
  modifications to `crates/bestialitty-core/`. The wasm boundary
  contract is locked from Phase 10.
- **`__slide` introspection as the single subscription point** —
  Phase 11 chip + tests both subscribe through the same accessor.

### Integration Points

- **`www/renderer/slide-chip.js`** (NEW) — chip module: state,
  render, lifecycle states (hidden / active / awaiting-wakeup /
  cancelled-summary / error / drop-rejected-flash); ~150 lines.
- **`www/index.html`** — chip DOM element + CSS rules + Settings
  SLIDE sub-block markup (auto-send input + show-summary checkbox +
  Compatibility mode select).
- **`www/state/prefs.js`** — Phase 11 adds three DEFAULTS keys
  (D-09).
- **`www/transport/slide.js`** — D-09 swap source for autoSendCommand;
  D-12 paste-pump cancel at wakeup match completion; D-14 forward
  `slidePumpOnPortLost` to slide-recv.js's real impl.
- **`www/transport/slide-recv.js`** — D-14 fill `slidePumpOnPortLost`
  body.
- **`www/transport/serial.js`** — D-11 wrap session-log append; add
  `slidePumpOnPortLost()` calls at lines 496/527/670 (parallel to
  existing `pastePumpOnPortLost()` calls).
- **`www/input/file-source.js`** — D-10 replace silent-ignore
  branches with chip flash; optional Claude's Discretion cleanup of
  the Phase 9 button-state observer at line 115.
- **`www/input/paste-pump.js`** — D-12 add `isSlideActive()` early-
  return in `enqueuePaste`.
- **`www/renderer/chrome.js`** — D-13 extend visibilitychange
  listener body with SLIDE CTRL_CAN; add `pagehide` listener with
  same body.
- **`www/main.js`** — boot wiring: import + call `wireSlideChip(...)`
  AFTER `wireSlideRecv` and `wireSlideDispatcher`; chip observer
  registration; ensure `__slide` accessor exposes the chip's
  consumed shape.
- **`www/transport/echo-swallow.js`** (NEW, optional per C-03) —
  swallow-echo filter for SLIDE-14; ~50 lines.
- **`www/tests/transport/slide-chip.spec.js`** (NEW) — chip
  lifecycle Playwright coverage.
- **`www/tests/transport/slide-bridge.spec.js`** (NEW) —
  session-log pause + paste-pump gate + visibilitychange + port-lost
  Playwright coverage.
- **`www/tests/transport/slide-compatibility.spec.js`** (NEW) —
  3-way Compatibility mode behavior coverage.
- **`www/tests/transport/slide-prefs.spec.js`** (NEW) — Settings
  persistence Playwright coverage.

</code_context>

<specifics>
## Specific Ideas

- **Chip layout — single-line dense (D-01):**
  ```
  ↑ MY-DOC.TXT  2/3  47%  482 KB  12.3 KB/s  [Cancel]
  ```
  Token order is locked. Direction arrow is `↑` for send (PC → Z80) and
  `↓` for recv (Z80 → PC). `N/M` follows the convention in
  REQUIREMENTS.md SLIDE-25 ("File N of M"); the chip uses the compact
  `N/M` form. Throughput unit per D-02. Cancel button per D-04.

- **Chip awaiting-wakeup state (D-15):**
  ```
  ↑ Waiting for Z80…  [Cancel]
  ```
  After 3 s timeout (Compatibility mode = `auto`):
  ```
  Z80 didn't respond.  [Retry]  [Cancel]  [Force start]
  ```

- **Chip post-cancel summary (SLIDE-28):**
  ```
  Cancelled — 2 of 3 files transferred
  ```
  5-second auto-hide. Always shown on cancel, regardless of the
  `slideShowSummary` checkbox state (D-08).

- **Chip happy-path summary (D-08, when `slideShowSummary === true`):**
  ```
  Sent 3 files — 1.2 MB → MicroBeast
  ```
  or
  ```
  Received 2 files — 482 KB
  ```
  5-second auto-hide.

- **Chip error state (C-09, default Claude's Discretion copy):**
  ```
  Transfer failed — port lost.  [Retry]
  ```
  5-second auto-hide unless user clicks `[Retry]`. The `[Retry]`
  button re-arms the wakeup matcher (recv mode) or re-emits auto-type
  (send mode); behavior depends on which direction the failed
  session was in.

- **Drop-during-active-session flash (D-10):**
  ```
  Transfer in progress — cancel first
  ```
  3-second flash; reverts to the active-session chip content after.

- **Settings SLIDE sub-block visual sketch:**
  ```
  ▶ SLIDE file transfer
    [ ] Save received files to a folder
         [Choose folder…]   No folder selected
    Auto-send command: [B:SLIDE R              ]
                       \r appended automatically
    [x] Show transfer summary chip
    Compatibility mode: [Auto                  ▾]
  ```
  Collapsed by default; expands on summary click.

- **Throughput sampling cadence:** 250 ms tick polls
  `__slide.bytes_in_file_done` + `Date.now()`; pushes `{ t, bytes }`
  to the sample ring; trims entries older than 2000 ms; redraws
  chip.

- **`pagehide` vs `visibilitychange` (D-13):** modern Chromium fires
  `visibilitychange` on tab close, but `pagehide` is the spec-
  guaranteed signal for bfcache eviction. Phase 11 registers BOTH
  with the same handler body to cover both signals; the inner
  guard `if (isSlideActive())` ensures duplicate calls are safe
  (the second one no-ops because `slide.cancel()` already
  transitioned to CancelPending).

- **Compatibility mode decision tree:**
  ```
  user clicks Send → auto-type completes →
    if slideCompatibilityMode === 'force-start':
        skip wakeup wait; enterSendModeInternal() immediately
    elif slideCompatibilityMode === 'wakeup-required':
        chip shows 'Waiting for Z80…'; no timeout
    else (default 'auto'):
        chip shows 'Waiting for Z80…'; 3 s timer arms;
        on timeout, chip shows 'Z80 didn't respond. [Retry] [Cancel] [Force start]'
  ```

- **`slidePumpOnPortLost` body (D-14):**
  ```js
  export function slidePumpOnPortLost() {
      if (!isSlideActive()) return;
      try { slide.force_idle(); } catch {}
      try { txSinkRef.setWireOwner('terminal'); } catch {}
      slideChip.enterError('port lost');
      // Reset module-scope state without closing port (mirrors paste-pump pattern).
      reset();
  }
  ```
  Identical to `pastePumpOnPortLost` shape; symmetry is the
  invariant.

</specifics>

<deferred>
## Deferred Ideas

Out of scope for Phase 11; tracked here so they're not lost:

- **Filename collision auto-rename UX on SEND** (`NAME~1.TXT,
  NAME~2.TXT`) — Phase 12 (SLIDE-36). Phase 11 ships without
  send-side collision detection; users see Z80-side overwrites
  for now.
- **Drag-drop vs pointer-select isolation regression spec**
  (`selection.js:onPointerDown` early-return when drop overlay
  active) — Phase 12 (SLIDE-12).
- **Auto-send command safety validation** (alphanumeric + `:` +
  `\r` only; first-use confirmation chip for non-default values) —
  Phase 12 (SLIDE-38). Phase 11 stores whatever the user types in
  `slideAutoSendCommand`.
- **`docs/SLIDE_Z80_REQUIREMENT.md`, README "File transfer"
  section, `docs/SLIDE-UAT.md` real-hardware UAT** — Phase 12
  (SLIDE-40, SLIDE-41, SLIDE-42).
- **ETA display in the chip (DI-1)** — P2 differentiator per
  FEATURES.md / SUMMARY §4. Computable as `(bytes_total - bytes_done) /
  throughput`; but throughput is noisy on the 2 s window and ETA
  jitters badly. Ship if real-hardware UAT (Phase 12) finds users
  asking for it.
- **NAK counter display in the chip (DI-2)** — P2 differentiator.
  Helpful for diagnosing a flaky cable or wrong baud rate; not in
  the daily-driver happy path.
- **Pre-send confirm chip (DI-7)** — Phase 9's `<dialog>` modal
  already covers this for send-mode (file rewrite/rejection
  confirmation). Recv-mode has no pre-confirmation step.
- **Open-downloads link (DI-13)** — `chrome://downloads/` link in
  the post-receive summary chip. Browser-specific; nice polish; out
  of v1 scope.
- **Backgrounded-tab redraw skip (DI-14)** — pause the chip 250 ms
  refresh tick when `document.visibilityState === 'hidden'`. Phase 5
  D-39 already handles backgrounded-tab serial throttling; chip is
  a pure rAF/setTimeout consumer that costs nothing while hidden.
- **Auto-send command preset dropdown (DI-15)** — `[B:SLIDE R\r]
  [A:SLIDE R\r] [Custom…]`. Useful if users habitually swap drives;
  not in the v1 daily-driver path.
- **Animated `…` ellipsis or countdown in the awaiting-wakeup chip
  state** — minor polish; default static `…` is fine.
- **`[Reset]` button next to the auto-send command input** — minor
  polish; user can manually re-type.
- **Phase 9 button-state observer cleanup** (file-source.js:115) —
  optional refactor opportunity per Claude's Discretion. Working
  code; no urgency.

</deferred>

---

*Phase: 11-slide-js-bridge-v1-0-integration*
*Context gathered: 2026-05-08*
