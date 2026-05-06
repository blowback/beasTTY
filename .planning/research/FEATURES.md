# Feature Research — v1.1 FileTransfer (SLIDE in BestialiTTY)

**Domain:** Browser-side SLIDE file-transfer for an in-browser VT52 terminal emulator
talking to a MicroBeast Z80 over Web Serial at 19200 8N1 RTS/CTS
**Researched:** 2026-04-25
**Confidence:** HIGH (locked milestone scope, two reference SLIDE PC implementations
already shipped, clear vintage-computing precedent in xmodem/ymodem/zmodem UX)

## Scope Note (Read Before Reading Tables)

v1.0 already shipped the substrate this milestone builds on:

- Web Serial transport with paste throttling, port-lost recovery, RTS/CTS flow,
  19200 8N1 preset — `www/transport/serial.js` (Phase 5).
- Floating chip pattern with theme-aware colours (CRT phosphor / clean ink),
  click-to-act, lives outside the terminal grid — `↓ N new lines` chip,
  `bestialitty-{ts}.bin` log button, large-paste confirm chip (Phase 6).
- Settings pane `<details>` rows + Connection pane `<details>` row pattern —
  prefs persistence, 250 ms debounced JSON write to `bestialitty.prefs`
  (Phase 6 D-32).
- Drag-select on the canvas for copy — pointerdown/move/up state machine that
  does NOT consume drop events (Phase 6 D-16). Drag-drop file listeners can
  coexist on the same surface as long as `dragover`/`drop` are wired
  separately and `dragstart` from the canvas itself is suppressed.
- `enqueuePaste(bytes)` paste-pump as the canonical "feed bytes onto the wire
  at link speed" primitive — the SLIDE outbound framer becomes a near-mirror
  of this pattern (Phase 5 D-12..D-23).
- Inline confirm pattern (D-25 large-paste, D-35 reset-prefs) — second-click-
  within-3s. Reused for SLIDE auto-send-command confirm if needed.

v1.1 has **already locked** the following as in-scope (not "table stakes" — these
are the milestone definition itself per `PROJECT.md` §Current Milestone):

- Host-initiated send: file picker → optional auto-typed `B:SLIDE R` → upload
- Z80-initiated receive: detect `ESC ^` (`0x1B 0x5E`) wakeup → consume session
  → save each file via Chrome download as it completes
- Drag-and-drop onto canvas to trigger host-initiated send
- Floating SLIDE chip (file count, byte count, progress, cancel)
- Settings: configurable auto-send command (default `B:SLIDE R`), with off / type-manually
- Rust core owns SLIDE state machine; JS shell owns transport + drag-drop + UI

v1.1 has **already locked out** (do not re-propose, see PROJECT.md §Out of scope for v1.1):

- Bulk save / batch download UI / "save all" zip
- IndexedDB virtual filesystem
- Long-filename support beyond CP/M 8.3 (auto-uppercase + truncate on send)
- Wildcard expansion in the auto-send command (defer to CP/M shell)
- Slack / GitHub Issues / desktop notifications

Everything below is about **how** to implement the locked scope well, plus the
genuine UX trade-offs (per-file download vs alternatives, drop-zone visuals,
cancel placement, edge cases) and the anti-features to guard against.

## Domain Categories

Findings are tagged by domain per the downstream-consumer ask:

- **SEND** — host-initiated upload (PC → Z80)
- **RECV** — Z80-initiated download (Z80 → PC, browser saves)
- **PROG** — progress / status display while a session is live
- **CANCEL** — abort / interrupt / recovery UX
- **DROP** — drag-and-drop visual feedback
- **SET** — Settings pane affordances
- **EDGE** — edge cases (zero-byte, binary, oversized, etc.)

## Reference Tools Surveyed

| Tool | What it does | Useful patterns | Limits as a reference |
|------|--------------|-----------------|----------------------|
| **slide-rs** (`slide-rs/src/{send,recv}.rs`) | CLI transfer over real serial; ships indicatif-style bars + spinner during handshake | Per-file progress bar with bytes/total + dynamic message slot ("retrying...", "NAK seq=X retransmitting...", "saved /path"); ANSI-coloured `── File N/M: name ──` separator; `disk error!` and `too many retries` failure messages; final summary `N file(s), M bytes in T s` | Terminal-process UX, not a chip; relies on indicatif for redraw — cannot be copied verbatim |
| **slide-py** (`slide-py/slide/{send,recv}.py`) | Same protocol, Python. Simpler text bar (`#`/`-`) | Confirms what minimum-viable progress looks like; `Header acknowledged. Streaming data...` reassurance line; `Sleep(0.5)` after header to let Z80 create file (a real protocol quirk to remember in JS too) | Same as above, plus less polished output |
| **xterm.js + zmodem.js** ([FGasper/zmodemjs](https://github.com/FGasper/zmodemjs)) | Browser-side ZMODEM over a webshell — closest comparable | `offer.get_details()` exposes `{name, size, mtime, files_remaining, bytes_remaining}` for the chip; per-offer `offer.skip()` for receiver decline; `Zmodem.Browser.save_to_disk(payloads, name)` triggers per-file Chrome download (the same pattern v1.1 has locked); explicit limitation that "browsers can't save partial files — must be the whole file" (drives the buffer-then-download choice) | Transport is over an existing terminal session, not a dedicated wakeup byte; ZMODEM has resume semantics SLIDE doesn't |
| **trzsz / trzsz.js** ([trzsz.github.io](https://trzsz.github.io/), [trzsz/trzsz-go](https://github.com/trzsz/trzsz-go), [trzsz.js](https://trzsz.github.io/js.html)) | xterm.js-side terminal file transfer with drag-drop + progress | Drag files onto the terminal triggers upload; progress bar shows filename + percent + size + speed + remaining time; `Ctrl+C` (SIGINT) is the documented cancel; explicitly notes "speed and transferred numbers are not precise" — sets the **honesty bar** for what to claim | Configurable colour gradient on bar; multi-file shown sequentially, not a list view; cancel is by killing the host-side process, not a button — not directly portable |
| **ttyd file-transfer** ([tsl0922/ttyd file-transfer system](https://deepwiki.com/tsl0922/ttyd/3.2-file-transfer-system)) | Web terminal with built-in transfer | Drag-drop integrated with the canvas; transfers run as part of the existing PTY session | ttyd uses ZMODEM addon; documentation thin on UI specifics |
| **Tera Term ZMODEM** ([Tera Term ZMODEM menu](https://teratermproject.github.io/manual/4/en/menu/file-transfer-zmodem.html)) | Native Windows ZMODEM client | Modal "Transferring..." dialog with file name + bytes + total + cancel button; explicit settings for `ZmodemDataLen` / `ZmodemWinSize` (don't expose these in v1) | Modal blocks the terminal — the **wrong** model for a single-pane SPA |
| **WinSCP / Windows copy dialog** ([WinSCP](https://winscp.net/), [Windows copy dialog evolution](https://blog.prototypr.io/windows-copy-function-followed-form-11cf4bf6a87e)) | Generalist file transfer UX | Per-file row with bar + ETA + speed + cancel; "more details" disclosure for power users | Multi-pane file-manager mental model; not a fit for a terminal pane |
| **Filestack / general drag-drop UX** ([Filestack 2025 guide](https://blog.filestack.com/building-modern-drag-and-drop-upload-ui/), [LogRocket](https://blog.logrocket.com/ux-design/drag-and-drop-ui-examples/), [Smashing Magazine](https://smart-interface-design-patterns.com/articles/drag-and-drop-ux/)) | Industry consensus on drop-zone visuals | Dashed border + colour change on `dragenter`; subtle shadow on the dragged item; flash/bounce on drop confirmation; large drop zone (full-component, not corner) | Most examples are file-uploader components, not terminal canvases |

## Feature Landscape

### Table Stakes (Must Have for v1.1)

Features that, if missing, the user reads as "this is half-done." Most map
directly to what `slide-rs` / `slide-py` already do, plus the browser-specific
adaptations.

| # | Domain | Feature | Why Expected | Complexity | Notes / Dependencies |
|---|--------|---------|--------------|------------|----------------------|
| TS-1 | SEND | OS file picker via `<input type="file" multiple>` (also wired to the dragdrop accept path) | Standard browser primitive; matches `slide-rs send port file1 file2` invocation | LOW | Single hidden `<input>` triggered by a top-bar / Connection pane "Send file…" button; `multiple` attribute on |
| TS-2 | SEND | Auto-type configured `B:SLIDE R<CR>` after picker resolve, then start framing | Mirrors what user would do manually — removes a step they'd otherwise repeat every transfer | LOW | Default command from prefs (`SET-1`); set blank or `(off)` to skip; sent through existing keyboard TX path so local-echo / CR-LF mode applies the user's settings |
| TS-3 | SEND | Per-file progress: percent + byte count + frame N/M | What `slide-rs` shows; users reading the terminal will look here for "is it stuck?" | LOW | Compute from `bytes_sent / file_size`; redraw at most ~10 Hz to keep the canvas free for the actual terminal text |
| TS-4 | SEND | "File N of M: NAME.EXT" header line in the chip | Mirrors slide-rs `── File 1/3: TEST1K.dat ──` separator; users want to see batch progress, not just current-file progress | LOW | Comes from `Array.length` and `i` over the picked files |
| TS-5 | RECV | Detect `ESC ^` (`0x1B 0x5E`) wakeup → suspend parser → take wire | Locked architecture; the v1.1 contract is "Z80 says I'm about to send, BestialiTTY listens" | MEDIUM | Wakeup detection in the read loop before `term.feed`; once SLIDE owns the wire, all bytes go to the SLIDE state machine until FIN-FIN; stray bytes during SLIDE = abort + restore |
| TS-6 | RECV | Per-file Chrome download as each file completes (not at end of session) | Locked decision; matches user expectation of "file done = file is on disk"; matches `Zmodem.Browser.save_to_disk` precedent ([zmodem.js](https://github.com/FGasper/zmodemjs)) | LOW | `new Blob([bytes], { type: 'application/octet-stream' })` + synthetic `<a download="NAME.EXT">` click — same pattern Phase 6 D-31 already uses for session log |
| TS-7 | RECV | Progress for the in-flight file: filename + bytes received / total | What `slide-rs recv` shows. Total is known from header frame seq=0. | LOW | Same chip slot as TS-3 (only one direction at a time per session) |
| TS-8 | PROG | Floating chip (mirrors Phase 6 `↓ N new lines` chip) | Locked decision per `PROJECT.md`; non-blocking, theme-aware, doesn't take terminal real-estate, click-to-act | LOW | Reuse the chip CSS + theme tokens; new element `<div id="slide-chip" hidden>`; absolute-positioned bottom-right of `#terminal-wrapper` |
| TS-9 | PROG | Throughput display (B/s) that updates while the bar moves | At 19200 baud (~1.9 KB/s) a 100 KB file takes ~50 s — users want to see "is it actually moving" with a number, not just a bar that crawls | LOW | Compute over a 2 s sliding window: `(bytes_in_window) / (window_secs)`; show as `1.8 KB/s`; on the very first 2 s show `—` rather than a wild number |
| TS-10 | PROG | "Suspended terminal" banner / state indicator | Without this users will type and wonder why nothing echoes; the parser is genuinely off during a session | LOW | Subtle border-tint on `#terminal-wrapper` (mirrors Phase 6 `[data-scrolled-back]` pattern as `[data-slide-active]`); top-bar status pill changes from "Connected" to "Connected · SLIDE" |
| TS-11 | CANCEL | Cancel button on the chip → send `CTRL_CAN` (`0x18`) → end session | The protocol already defines `CTRL_CAN` (see `slide-rs/src/protocol.rs:10`); without a UI affordance the user is stuck waiting; this is the "I changed my mind" path | MEDIUM | After CAN, drain the input buffer for ~250 ms (skip any in-flight frame bytes), then restore parser. Z80 sees CAN-on-wire and aborts; `slide.asm` send-mode already handles this in v0.2 spec |
| TS-12 | CANCEL | Esc key while chip is visible = same as Cancel | Mirror Phase 5 D-18 (Esc cancels paste); muscle memory says "Esc means stop the thing" | LOW | Single keyboard intercept added to `keyboard.js` guarded on `slideSession.isActive()` |
| TS-13 | CANCEL | After cancel: show `Cancelled — N of M files transferred` for ~5 s in the chip, then auto-hide | Closes the loop so the user knows the wire is back to normal terminal use | LOW | Chip stays visible for 5 s then `hidden`; click-to-dismiss available |
| TS-14 | CANCEL | Hard-fail recovery: on protocol abort (CRC retries exhausted, unexpected byte mid-frame, port lost), drain wire ~250 ms + restore parser + show error in chip with "Retry" hint | Without this the terminal can be left desynchronised and the user blames the emulator. `slide-rs/src/recv.rs:142-163` does this with `max_retries = 15` then bail | MEDIUM | Reuse Phase 5 port-lost flow for the port-disappeared case |
| TS-15 | DROP | Full-canvas drop zone (whole `#terminal-wrapper`) — no tiny corner widget | Industry consensus: drop zones must be big targets ([Filestack 2025](https://blog.filestack.com/building-modern-drag-and-drop-upload-ui/), [Smashing](https://smart-interface-design-patterns.com/articles/drag-and-drop-ux/)) | LOW | `dragenter`/`dragover` listeners on `#terminal-wrapper` + `preventDefault` to allow drop; coexists with the Phase 6 drag-select listener because drag-select uses `pointerdown`/`pointerup` (not HTML5 drag events) |
| TS-16 | DROP | Visible overlay during drag-over (dashed border + faint background tint + text "Drop file(s) to send via SLIDE") | Industry consensus on dashed border + active state ([LogRocket drag-drop UI](https://blog.logrocket.com/ux-design/drag-and-drop-ui-examples/)) | LOW | New `<div id="slide-drop-overlay" hidden>` absolutely positioned over wrapper; theme-aware colours; `pointer-events: none` while invisible |
| TS-17 | DROP | Drop confirmation flash on `drop` event (~300 ms colour pulse) | Confirms "I saw your drop" before progress chip appears; mirrors Filestack guidance "confirm it — a slight bounce, a colour flash" | LOW | One-shot CSS animation on the overlay then hide |
| TS-18 | DROP | Reject non-file drags (text, URLs, images dragged from another tab) — overlay shows "(this is not a file)" or just doesn't activate | Browsers fire `dragover` for any draggable; without this filter you accidentally try to "send" a Slack image preview | LOW | Check `dataTransfer.types.includes('Files')` in `dragenter` |
| TS-19 | DROP | Reject drags during an active SLIDE session (overlay shows "Transfer in progress — cancel first") | Otherwise users get a confusing failure when the drop happens but the wire is busy | LOW | Guard on `slideSession.isActive()` |
| TS-20 | SET | Settings row: text input for "Auto-send command" with default `B:SLIDE R` and an "Off / type manually" checkbox above (or empty-string sentinel) | Locked decision; users with a non-stock CP/M shell or non-default drive letter need to override | LOW | New row in Settings pane `<details>`; persisted via `bestialitty.prefs.slide.autoSendCommand` (string, empty = off); follows D-32 versioned schema |
| TS-21 | SET | Settings row: "Show transfer chip after session" checkbox (default on) — keep the "N files received in T s" summary chip visible until clicked | Without it the user might miss that a Z80-initiated transfer happened (especially in a backgrounded tab) | LOW | New pref `bestialitty.prefs.slide.showSummary` (bool) |
| TS-22 | EDGE | Zero-byte file send (`TEST0.dat` exists in the test corpus) | Already in the test plan (`slide-py/TEST0.dat`); protocol allows header-then-immediate-EOF; tested in `slide-rs` already | LOW | The header frame still fires; data loop has zero iterations; EOF frame sent immediately; no progress bar movement to display |
| TS-23 | EDGE | Single-byte file (and any sub-frame file) | Common edge — frame size is 1024, files smaller than that take exactly one data frame + EOF | LOW | Same path as TS-22, just one data frame |
| TS-24 | EDGE | Binary content (`.COM` files, `.HEX`, etc.) — bytes 0x00–0x7F and 0x80–0xFF must round-trip without text-mode mangling | Z80 binaries are the primary use case; ASCII vs binary mode confusion is a classic file-transfer foot-gun ([JSCAPE: FTP binary vs ASCII](https://www.jscape.com/blog/ftp-binary-and-ascii-transfer-types-and-the-case-of-corrupt-files)) | LOW | All bytes go through `Uint8Array` — no encoding step. Only the auto-send command is text. Confirm in tests by sending a `.COM` and diffing |
| TS-25 | EDGE | Filename auto-uppercase + truncate to 8.3 on send (matches `slide-rs/src/protocol.rs:50-52` `.to_uppercase()` + `Path::file_name`) | Locked decision (PROJECT.md "auto-uppercase + truncate on send"); CP/M only accepts uppercase 8.3 ([8.3 filename](https://en.wikipedia.org/wiki/8.3_filename)) | LOW | Done in JS before passing to wasm; show the resulting CP/M name in the chip ("Sending `MYFILEX.TXT` (was `MyFileExample.txt`)") so the user isn't surprised by what landed |
| TS-26 | EDGE | Filename validation: reject `<>.,;:=?*[]` per CP/M ([CP/M filesystem notes](https://ciderpress2.com/formatdoc/CPM-notes.html)) — show inline error in chip "Filename has invalid CP/M characters" | Otherwise the Z80 silently rejects and the user blames the wire | LOW | Pre-flight check in JS; reject before sending header |

### Differentiators (Nice-to-have That Elevate the Experience)

These elevate v1.1 from "works" to "feels good." Not required, but several
are very low cost on top of the table-stakes infrastructure.

| # | Domain | Feature | Value Proposition | Complexity | Notes |
|---|--------|---------|-------------------|------------|-------|
| DI-1 | PROG | ETA in chip ("~32 s remaining") | At 19200 baud a real transfer is long enough that ETA helps the user decide "do I go make tea"; `slide-rs` doesn't show this | LOW | `eta = (total - sent) / smoothed_rate`; show `—` until the rate has stabilised (3 s); display as `mm:ss` over 60 s, `Ns` under |
| DI-2 | PROG | Retransmit / NAK counter ("12 frames retransmitted") in chip subtext or DevTools log | Surfaces line-quality issues; `slide-rs send.rs:236` already prints `NAK seq=X retransmitting...` to stderr; equivalent in chip helps when wire is unreliable | LOW | Increment a counter on every NAK received (send) or NAK sent (recv); display as small dim text under main bar |
| DI-3 | PROG | Per-file batch list in chip on hover/click ("`A.TXT` ✓, `B.COM` ⏳, `C.DAT`") | Sender-side users care about the batch, not just the current file; `slide-rs` shows files sequentially in scrolling output but a batch list at-a-glance is nicer | MEDIUM | Hidden by default; click chip to expand into a small list; collapses on completion |
| DI-4 | PROG | Multi-file aggregate progress ("23% of 4 files, ~2 min remaining") in chip | When sending 12 files of varying sizes, per-file progress isn't enough; the user wants to know "how much longer overall" | LOW | Compute over total bytes across all picked files (known up front for SEND, unknown for RECV until each header arrives) |
| DI-5 | RECV | Files-received summary chip after FIN-FIN ("3 files saved (12.4 KB) — click for list") that auto-hides after 8 s unless clicked | Without it the user might miss what arrived (especially in a backgrounded tab); list expansion shows filenames + sizes; click a filename = noop for v1.1 (no virtual FS) but reads as a record | LOW | Reuses chip + the per-file batch list (DI-3); ties into TS-21 "Show transfer chip after session" pref |
| DI-6 | DROP | Drop-overlay shows file count + names ("Drop 3 files to send: `A.TXT`, `B.COM`, …") during dragover | Confirms what the browser thinks it has before commit; useful when dragging from a file manager that selected more than expected | MEDIUM | Browsers don't reveal filenames during `dragover` (security) — only count via `dataTransfer.items.length`. So show `"Drop 3 files to send"` not the names. **Verify** with a quick dragover console.log before promising names |
| DI-7 | DROP | After drop, show a "Pre-send confirm" mini-chip ("3 files (12 KB) — auto-send `B:SLIDE R` then transfer? [Send] [Cancel]") for 3 s then auto-proceed | Mirrors the Phase 6 D-25 large-paste confirm pattern; gives the user a chance to bail without having to immediately race for the cancel | LOW | Reuse the inline-confirm pattern; auto-proceed timeout configurable via prefs (default 3 s; 0 = always proceed) |
| DI-8 | SEND | "Drag a file or click 'Send file…'" hint as ghost text inside an empty Connection pane row when no transfer has happened yet | Discoverability; without it, drag-drop is the kind of feature people don't find | LOW | Static help text in Settings or Connection pane; one line; can disappear after the first successful transfer |
| DI-9 | SET | Settings row: "Auto-show DevTools frame trace" toggle (off by default) — when on, dump frame headers / NAK events to `console.debug` | Power-user diagnosability; mirrors slide-rs `--debug`; useful when the protocol misbehaves on a specific file | LOW | Single check; gated `if (prefs.slide.debug) console.debug(...)`; never logs payload bytes (privacy / noise) |
| DI-10 | SET | Settings row: "Frame timeout" slider (default 10 s, range 2–30 s) | If the user runs SLIDE on a slow Z80 task that takes a long time to flush to disk, the default `recv_control(60s)` for header / `10s` for data may not match — this is the escape hatch (slide-rs already has these as constants) | LOW | Pref `bestialitty.prefs.slide.frameTimeoutMs`; passed to wasm core as session config |
| DI-11 | EDGE | Pre-send filename collision warning when sending two files whose 8.3-truncated names collide ("Files `MyLongName1.txt` and `MyLongName2.txt` both become `MYLONGNA.TXT` — Z80 will overwrite. Continue?") | The user picked these in a file manager where they were unique; the truncation is invisible until it's too late | LOW | Compute truncated names client-side; check for dupes; inline warn in pre-send chip (DI-7) |
| DI-12 | EDGE | Per-file failure isolation: if file N of M fails (CRC retries exhausted, Z80 disk full → CAN), prompt "Skip file N and continue with file N+1?" rather than aborting the whole batch | Sender-side resilience; `slide-rs` aborts the whole session on first error (`slide-rs/src/send.rs:215`), which is wrong for a batch of 20 files where one is bad | MEDIUM | Requires Rust core to expose a "session error, choose: skip / abort" hook back to JS — moderately invasive but fits the architecture |
| DI-13 | RECV | "Open downloads folder" link in the post-session summary chip | Confirms files went somewhere the user can find — Chrome's "Show in folder" ergonomics are well-known | LOW | `chrome://downloads/` link works in Chromium and is the well-known affordance; on click, browser opens that internal page |
| DI-14 | PROG | Visible-tab-only progress redraw + use Page Visibility API to skip chip animation while backgrounded | Saves CPU + battery; aligns with Phase 5 D-39 backgrounded-tab handling already in the codebase | LOW | `document.visibilityState === 'hidden'` → skip the rAF chip update (state still tracked, just not painted); on visibilitychange-to-visible, paint once |
| DI-15 | SET | "Auto-send command" preset dropdown with stock values (`B:SLIDE R`, `A:SLIDE R`, `SLIDE R`, `(custom...)`) instead of a free text field | Most users will never deviate from one of three; dropdown is faster than typing every time and reduces typo-induced failures | LOW | Trivial; persist resolved string into prefs same way as TS-20 |

### Anti-Features (Do Not Build)

Features that look good on a feature list but cost more than they return for
the v1.1 scope. Each entry says **why someone might ask for it** and **what
to do instead**.

| # | Domain | Anti-Feature | Why Requested | Why Avoid | What to Do Instead |
|---|--------|--------------|---------------|-----------|--------------------|
| AF-1 | RECV | Save-all-as-zip / batch download dialog | "Spare me 12 download notifications for a 12-file SLIDE batch" | Locked out by PROJECT.md; needs JSZip in the bundle (~70 KB) for a feature that runs once a week; every Chromium ZIP-from-Blob solution has memory cliffs at multi-MB; the per-file pattern matches `Zmodem.Browser.save_to_disk` ([zmodem.js limitation note](https://github.com/FGasper/zmodemjs)); user can `Ctrl+J` and bulk-select in their downloads folder | Per-file Chrome download as TS-6 specifies; offer DI-13 "Open downloads folder" link |
| AF-2 | RECV | Virtual file panel inside BestialiTTY (IndexedDB-backed list of received files) | "Why do I have to leave the app to find my file?" | Locked out by PROJECT.md; introduces a whole filesystem UI (rename, delete, retention rules, quota handling, IDB version migrations) for a feature whose Chrome-native equivalent is one click away (`chrome://downloads`); cannibalises engineering time from getting the protocol right | DI-13 link; users use Chrome's downloads page |
| AF-3 | DROP | Modal overlay that blocks the rest of the page during drag-over | "Make the drop target really obvious" | Modals trap focus, break the terminal cursor flow, and feel heavy for a one-click action; Filestack 2025 guide explicitly favours dashed-border + active-state; aligns with Phase 6's "no modal infrastructure" stance ([Filestack guide](https://blog.filestack.com/building-modern-drag-and-drop-upload-ui/)) | TS-15 / TS-16 / TS-17 dashed-border overlay |
| AF-4 | PROG | Modal "Transferring…" dialog that owns the screen | "Tera Term does this so users will expect it" | Modals defeat the whole point of an in-browser daily-driver terminal where the user might want to scroll back, open Settings, or check the log mid-transfer; Phase 6 chip pattern exists exactly to avoid this | TS-8 floating chip |
| AF-5 | SEND | Drag-and-drop a folder (recursive) | "Drag my whole CP/M project at once" | CP/M has no directory hierarchy in v1.1 scope; a folder drag would need recursion + per-file checks + an n-files-with-paths preview UI; far past the locked milestone scope | Drop multiple files (which Chromium supports natively); document folder-drop as v1.2+ |
| AF-6 | SEND | Wildcard expansion in the auto-send command (`B:SLIDE R *.COM` from BestialiTTY side) | "I want to receive a known set; tell SLIDE which" | Locked out by PROJECT.md; the Z80 CP/M shell already does wildcard expansion when typed; the auto-send is just a convenience for typing the *receive* side, not a replacement for it | Type the wildcard manually if needed; user can override the auto-send command |
| AF-7 | RECV | Long-filename support (preserve original case + > 8.3 length) | "Modern filesystems support long names" | Locked out; CP/M is the receiver and CP/M doesn't; preserving them on the PC side after re-receive would require shadow metadata that doesn't survive the Z80 round-trip | TS-25 auto-uppercase + truncate; show the rewrite in the chip |
| AF-8 | SET | Per-baud / per-file-size advanced tuning UI (`ZmodemDataLen`, `WIN_SIZE`) | "I want to crank the throughput" | SLIDE protocol is fixed at `WIN_SIZE=4`, `FRAME_SIZE=1024` (`slide-rs/src/protocol.rs:12-13`); changing them on one side breaks compatibility; Tera Term lets you tune ZMODEM and the docs warn it usually breaks things ([Tera Term ZMODEM tips](https://teratermproject.github.io/manual/4/en/usage/tips/zmodem.html)) | Don't expose; the protocol is a fixed contract |
| AF-9 | PROG | Live byte-by-byte hex dump of the wire in a panel | "I want to see exactly what's flying past" | Insanely noisy at 19200 baud; the right tool is `--debug` style structured logging | DI-9 DevTools frame trace |
| AF-10 | CANCEL | Pre-cancel "Are you sure?" confirm modal | "Avoid accidental cancel" | Two-step cancel during a transfer slows the obvious case (user knows they want to cancel); the protocol is recoverable (sender retries on next session); modal infrastructure not introduced | Single-click cancel on the chip; "Cancelled — restored" message confirms; reuse Phase 6 D-25 inline-confirm only if accidents prove common in real use |
| AF-11 | RECV | Show received files in the existing scrollback as ASCII (e.g., dump `.TXT` content into the terminal grid after save) | "Let me read what just arrived without leaving the page" | Conflates file transfer with terminal content; scrollback is a record of what came over the VT52 wire, not what was saved to disk; binaries would render as garbage | If user wants to view a file, they download it and open it in their preferred app |
| AF-12 | SEND | Resume / partial-file recovery (sender knows file was 50% through, picks up from there next session) | "ZMODEM has this so SLIDE should too" | SLIDE has no resume in the protocol (`slide-rs` re-sends the whole file every time); adding it would require Z80-side filesystem-aware logic that's out of v1.1 milestone scope; for files small enough to live on a CP/M floppy this is overkill | Document; user re-runs the transfer on cancel |
| AF-13 | DROP | Click-to-paste file content (paste a file from the clipboard) | "Drag-drop is one input; clipboard is another" | The clipboard already has the Phase 6 paste path for text; "paste a file as bytes via SLIDE" overloads the clipboard semantics confusingly with the Ctrl+Shift+V text-paste users now have | Drag-drop or file-picker; clipboard stays for text |
| AF-14 | PROG | Animated progress sparkline / throughput chart | "Pretty visualisation of throughput over time" | Aesthetic only; doesn't help the daily-driver decide anything; runs the canvas every frame for marginal signal | Throughput number (TS-9) is enough |
| AF-15 | SET | "Theme" for the SLIDE chip independent from terminal theme | "I want the chip in a different colour" | Adds a setting nobody asks for; chip should adopt whichever theme is active so the experience feels coherent (Phase 6 chip already does this) | Single chip style that picks up theme tokens |

## Feature Dependencies

```
TS-5  ESC ^ wakeup detection
   └──requires──> Rust core SLIDE state machine
   └──requires──> Phase 5 read-loop hook point (after term.feed, before session-log)

TS-6  Per-file Chrome download
   └──reuses─────> Phase 6 D-31 Blob + synthetic anchor pattern (session-log download)

TS-8  Floating chip
   └──reuses─────> Phase 6 D-03 floating chip (↓ N new lines)
   └──reuses─────> Phase 6 theme tokens (CRT phosphor / clean ink)

TS-10 [data-slide-active] border tint
   └──mirrors────> Phase 6 [data-scrolled-back] attribute pattern

TS-11 CAN cancel
   └──requires──> SLIDE session API exposing cancel(): Promise<void>
   └──requires──> Wire-drain helper (skip ~250 ms of in-flight bytes after CAN)

TS-12 Esc cancel
   └──extends────> Phase 5 D-18 Esc-intercept gate (already cancels paste-pump)

TS-15 Drop zone on #terminal-wrapper
   └──coexists───> Phase 6 D-16 drag-select (different event types: pointerdown vs dragstart)
   └──requires──> dataTransfer.types.includes('Files') filter (TS-18)

TS-20 Auto-send command pref
   └──extends────> Phase 6 D-32 bestialitty.prefs schema (bumps version; field
                   bestialitty.prefs.slide = { autoSendCommand, showSummary,
                   debug?, frameTimeoutMs? })
   └──requires──> Pref-version migration handler

DI-1  ETA
   └──requires──> TS-9 throughput (rate)

DI-3  Per-file batch list in chip
   └──extends────> TS-8 chip (adds expand-on-click affordance)

DI-4  Multi-file aggregate progress
   └──requires──> Total-bytes-across-batch (SEND only — known up front)

DI-5  Files-received summary chip
   └──reuses─────> DI-3 batch list rendering
   └──gated by──> TS-21 showSummary pref

DI-7  Pre-send confirm chip
   └──reuses─────> Phase 6 D-25 inline-confirm pattern (large-paste warn)

DI-9  Frame trace
   └──gated by──> Settings checkbox (DI-9 itself)

DI-12 Per-file failure isolation
   └──conflicts──> v1.1 simplest-path "abort whole session on first error"
                   (slide-rs current behaviour) — pick one for v1.1, document
                   the other as v1.2 candidate

TS-25 Auto-uppercase + 8.3 truncate
   └──enables───> DI-11 collision warning
```

### Dependency Notes

- **TS-5 (`ESC ^` detect) is the gate for everything RECV.** If this isn't
  wired before any RECV feature, RECV doesn't exist. Ordering: Rust state
  machine + JS wakeup detection first; per-file download (TS-6) and chip
  (TS-8) follow trivially.
- **TS-8 (chip) is the gate for all PROG/CANCEL features.** TS-3, TS-4, TS-7,
  TS-9, TS-11, TS-13, DI-1..DI-5, DI-13 all hang off the chip element. Build
  the chip wrapper + theme + show/hide first, then incrementally fill its
  slots.
- **TS-15/TS-16 (drop zone) coexists with Phase 6 D-16 drag-select** because
  drag-select uses pointer events (capturing pointerdown) while file-drop
  uses HTML5 drag events (`dragenter`/`dragover`/`drop`). The two event
  systems don't share state. Verify in implementation that
  `dragstart` from the canvas itself is suppressed (otherwise the user might
  start "dragging" terminal text into another app).
- **DI-12 (per-file failure isolation) conflicts with the simple-path
  approach** of aborting the whole session. v1.1 should pick the simpler
  approach (abort) and document DI-12 as a v1.2 candidate, unless the
  protocol-state-machine design naturally accommodates both with low
  marginal cost.
- **Auto-send command pref (TS-20) bumps the prefs schema version** and
  needs a migration shim per Phase 6 D-32. This is a one-line addition
  ("if version === 1, set `slide` to defaults, bump to 2") — flag it for
  the planner not to forget.

## MVP Definition (Within v1.1 Scope)

The locked milestone scope **is** the MVP. Don't carve a smaller slice.
Within that scope:

### Build First (must ship in initial v1.1)

All Table Stakes (TS-1..TS-26). These are the milestone definition expressed
in feature form.

### Build If Time Permits (still v1.1, low marginal cost)

In rough priority order:

1. **DI-1 ETA** — single line of math; high user-value during 50-second transfers.
2. **DI-2 NAK / retransmit count in chip** — single counter; surfaces real wire
   problems users want to know about.
3. **DI-15 Auto-send command preset dropdown** — minor polish on TS-20.
4. **DI-7 Pre-send confirm chip** — reuses existing inline-confirm pattern.
5. **DI-13 Open-downloads-folder link** — one anchor.
6. **DI-14 Backgrounded-tab redraw skip** — small CPU win, aligns with Phase 5
   D-39.

### Defer to v1.2+ (out of scope for v1.1, document the decision)

- DI-3 / DI-4 / DI-5 batch list + aggregate progress + post-session summary
  with file list — all valuable, all add chip complexity, want real
  daily-driver feedback before designing the expand-on-click UX.
- DI-9 frame trace settings — add when a user reports a transfer-misbehaviour
  bug worth diagnosing.
- DI-10 frame timeout slider — add when a real Z80 workload triggers a
  timeout default mismatch.
- DI-11 filename collision warning — defer until DI-3 batch list exists,
  since the warning belongs in the same UI surface.
- DI-12 per-file failure isolation — defer until v1.1 ships and a user with
  a 20-file batch hits a single-file failure.
- DI-6 file-count-in-overlay — verify dataTransfer access during dragover
  before promising; defer if Chrome doesn't expose enough.

### Defer to v2 (too far past v1.1 daily-driver bar)

- Folder drag (AF-5).
- Save-all-zip (AF-1).
- Virtual file panel / IndexedDB (AF-2).
- Resume / partial-file recovery (AF-12).
- Long-filename preservation (AF-7).

## Feature Prioritization Matrix

| Feature | User Value | Implementation Cost | Priority |
|---------|------------|---------------------|----------|
| TS-1..TS-9 (core SEND/RECV/PROG path) | HIGH | LOW–MEDIUM | P1 |
| TS-10 [data-slide-active] tint | HIGH | LOW | P1 |
| TS-11..TS-14 (cancel / abort recovery) | HIGH | MEDIUM | P1 |
| TS-15..TS-19 (drop zone visuals + filters) | HIGH | LOW | P1 |
| TS-20..TS-21 (Settings rows) | MEDIUM | LOW | P1 |
| TS-22..TS-26 (edge cases) | HIGH (when they hit) | LOW | P1 |
| DI-1 ETA | HIGH | LOW | P2 |
| DI-2 NAK counter | MEDIUM | LOW | P2 |
| DI-7 pre-send confirm | MEDIUM | LOW | P2 |
| DI-13 open-downloads link | MEDIUM | LOW | P2 |
| DI-14 backgrounded-tab redraw skip | LOW (CPU) | LOW | P2 |
| DI-15 auto-send command dropdown | MEDIUM | LOW | P2 |
| DI-3 / DI-4 / DI-5 batch list / aggregate / summary | HIGH | MEDIUM | P3 |
| DI-9 frame trace | LOW | LOW | P3 |
| DI-10 frame timeout slider | LOW | LOW | P3 |
| DI-11 collision warn | MEDIUM | MEDIUM (needs DI-3) | P3 |
| DI-12 per-file failure isolation | HIGH (when it hits) | MEDIUM | P3 |
| DI-6 file count in overlay | LOW | LOW (if Chrome exposes) | P3 |

**Priority key:**

- **P1** — Must ship in v1.1 (matches the locked milestone scope)
- **P2** — Should ship in v1.1 if implementation goes smoothly
- **P3** — Defer to v1.2+ unless trivially picked up

## Competitor / Reference Comparison

| Feature | trzsz / xterm.js | zmodem.js | slide-rs CLI | BestialiTTY v1.1 plan |
|---------|------------------|-----------|--------------|------------------------|
| Drag-drop to send | Yes (terminal canvas) | No (built-in app concern) | N/A (CLI) | TS-15..TS-19 — full-canvas dashed overlay |
| Auto-type receive command | No (user types `trz`) | No | N/A (CLI sender doesn't need it) | TS-2 — configurable, default `B:SLIDE R` |
| Per-file Chrome download | Via host filesystem (xterm.js side handles save) | `Zmodem.Browser.save_to_disk(payloads, name)` per file | N/A (writes to FS via stdlib) | TS-6 — one Chrome download per completed file |
| Progress: % + bytes | Yes (CLI-style bar) | App-defined; events exposed | Yes (indicatif bar) | TS-3 / TS-7 — chip with bytes + % + frame N/M |
| Progress: speed | Yes (noted as imprecise) | App-defined | Yes (B/s + efficiency %) | TS-9 — 2 s sliding-window B/s |
| Progress: ETA | Not by default | App-defined | No | DI-1 — opt-in / P2 |
| Multi-file batch progress | Sequential per-file | `files_remaining` / `bytes_remaining` exposed | Per-file | TS-4 (header) + DI-4 (aggregate) |
| Cancel | `Ctrl+C` kills server-side process | `offer.skip()` per offer (receiver decline only) | `Ctrl+C` (host signal) | TS-11 button + TS-12 Esc — both send `CTRL_CAN` |
| Confirm before send | No (drop = send) | App-defined | No | DI-7 (P2) — 3 s auto-proceed inline confirm |
| Modal vs chip | xterm.js area inline | App choice | CLI block | Chip (TS-8) |
| Failure recovery | Per-protocol (TX retries) | Skip / abort offer | 15 retries then bail per file | TS-14 — drain wire + restore parser + chip error |
| File-name handling | OS filesystem-native | Browser download with name | `.to_uppercase()` + filename only | TS-25 — uppercase + 8.3 truncate, show rewrite in chip |

## Industry References

- [FGasper/zmodemjs — README and source](https://github.com/FGasper/zmodemjs) — `Offer.get_details()` shape, `Browser.save_to_disk` per-file pattern, "browsers can't save partial files" limitation that drives the buffer-then-download choice.
- [trzsz documentation](https://trzsz.github.io/) and [trzsz-go](https://github.com/trzsz/trzsz-go) — drag-drop terminal upload, progress with name + size + speed + remaining time, "transferred and speed are not precise" honesty bar, `Ctrl+C` cancel via host process kill.
- [trzsz.js webshell integration](https://trzsz.github.io/js.html) — `TrzszFilter` rendering progress when terminal columns known.
- [tsl0922/ttyd file-transfer](https://deepwiki.com/tsl0922/ttyd/3.2-file-transfer-system) — embedded ZMODEM in a webshell for canvas-side drag-drop.
- [Tera Term ZMODEM menu](https://teratermproject.github.io/manual/4/en/menu/file-transfer-zmodem.html) and [tips](https://teratermproject.github.io/manual/4/en/usage/tips/zmodem.html) — modal "Transferring…" UI to **avoid**; configurable `ZmodemDataLen` / `ZmodemWinSize` settings to **not expose** in v1.1.
- [Filestack: Building a Modern Drag-and-Drop Upload UI in 2025](https://blog.filestack.com/building-modern-drag-and-drop-upload-ui/) — large drop zone, dashed border, active-state colour swap, drop-confirmation flash (TS-15..TS-17 directly cite).
- [LogRocket: Designing drag-and-drop UIs](https://blog.logrocket.com/ux-design/drag-and-drop-ui-examples/) — drop-target colour change + accessibility fallbacks.
- [Smashing: Drag-and-Drop UX Best Practices](https://smart-interface-design-patterns.com/articles/drag-and-drop-ux/) — visual lift, animation cues, microanimation on drop.
- [MDN: File drag and drop](https://developer.mozilla.org/en-US/docs/Web/API/HTML_Drag_and_Drop_API/File_drag_and_drop) — `dataTransfer.types.includes('Files')` filter (TS-18) and the basic `dragenter`/`dragover`/`drop` event flow.
- [MDN: File System Access API](https://developer.mozilla.org/en-US/docs/Web/API/File_System_API) — alternative to per-file `<a download>` for users with `showSaveFilePicker`-grant; v1.1 sticks to `<a download>` for parity with session-log (Phase 6 D-31).
- [Wikipedia: 8.3 filename](https://en.wikipedia.org/wiki/8.3_filename) — confirms uppercase + restricted-char set CP/M assumes (TS-25 / TS-26).
- [Wikipedia: ZMODEM](https://en.wikipedia.org/wiki/ZMODEM) and [YMODEM](https://en.wikipedia.org/wiki/YMODEM) — historical context: vintage-computing community has used "header-then-data-frames-then-EOF" semantics since the 1980s; SLIDE follows this convention exactly so the UX expectations transfer.
- [Chrome on Windows clipboard / large-paste limits](https://www.digitalcitizen.life/chrome-on-windows-now-blocks-huge-clipboard-pastes-to-prevent-crashes/) and [Browser memory limits](https://textslashplain.com/2020/09/15/browser-memory-limits/) — relevant background for the "tab crash on huge file" edge: at 19200 baud a single transfer is bounded by patience long before browser memory; CP/M floppy capacity (~720 KB) caps the practical max well below tab-crash thresholds.

## Sources Confidence

| Claim | Confidence | Verification |
|-------|------------|--------------|
| Locked milestone scope | HIGH | `PROJECT.md` §Current Milestone reviewed |
| SLIDE protocol semantics (CRC, frame format, FIN/CAN/RDY/NAK) | HIGH | `slide-rs/src/protocol.rs` + `SPEC-v0.2.md` source-of-truth read |
| `slide-rs` UX (indicatif progress bar, ANSI separators, error messages) | HIGH | `slide-rs/src/{send,recv}.rs` source read |
| `slide-py` UX (text bar, sleep-after-header) | HIGH | `slide-py/slide/{send,recv,common}.py` source read |
| Phase 6 chip pattern + theme tokens + Settings/Connection pane structure | HIGH | `06-CONTEXT.md` D-03/D-31/D-32 etc. read |
| zmodem.js `save_to_disk` pattern + "browsers can't save partial files" | HIGH | Confirmed in upstream README via WebFetch |
| trzsz drag-drop + progress bar fields + "imprecise speed" disclaimer | HIGH | trzsz.github.io documentation read |
| Drag-drop UX best practices (dashed border, large zone, drop-flash) | HIGH | Three independent 2025 sources agree (Filestack, LogRocket, Smashing) |
| CP/M 8.3 filename + uppercase + restricted chars | HIGH | Wikipedia + ciderpress2.com cross-confirmed |
| File System Access API as alternative to `<a download>` | MEDIUM | MDN documents both; v1.1 sticks with anchor for parity with Phase 6 D-31, not investigated whether `showSaveFilePicker` would be a better fit for the per-file flow — flag for the planner |
| "Browsers don't reveal filenames during dragover" (security) | MEDIUM | Verify with a console.log during planning before promising file names in DI-6 |
| `dataTransfer.types.includes('Files')` reliable in Chromium | HIGH | MDN documented + standard Chromium behaviour |

## Open Questions for the Planner

These don't block the roadmap, but the Phase planner / executor must resolve:

1. **Wakeup-byte semantics during normal output:** what if the Z80 emits
   `ESC ^` legitimately during a shell session (e.g., a misbehaving program)?
   Decision needed: is `ESC ^` truly reserved by SLIDE-on-MicroBeast, or do we
   need a longer / multi-byte wakeup magic? Existing `slide.asm` is being
   modified to emit it; check whether VT52 or any common CP/M tool also
   emits the sequence. The PROJECT.md note says "stray bytes abort the
   session" so a false-positive wakeup would just abort and restore — but
   confirm.
2. **`<a download>` vs `showSaveFilePicker` for per-file save:** Phase 6
   D-31 used `<a download>` for the session log; does the file-per-transfer
   case warrant the more capable `showSaveFilePicker` (with the user-grant
   prompt the first time only)? Trade-off: extra prompts vs full control of
   the destination.
3. **Confirmation timing on drop:** is DI-7's 3-second auto-proceed the
   right default, or should drop-to-send be immediate (with cancel always
   available on the chip)? Real-world testing required.
4. **Cancel behaviour on RECV:** when user cancels mid-Z80→PC transfer, do
   we save the partial file (with a `.partial` extension), discard, or ask?
   slide-rs discards via `RecvResult::Error` path. v1.1 should match unless
   real-world feedback says otherwise.
5. **DevTools frame trace verbosity:** if DI-9 ships, does it log per-frame
   or per-event? Per-frame at 1024-byte payloads is ~32 KB of logs for a
   32 KB file — fine, but noisy. Per-event (NAK / timeout / window-rollover)
   may be the better default.

---
*Feature research for: v1.1 SLIDE FileTransfer milestone in BestialiTTY*
*Researched: 2026-04-25*
