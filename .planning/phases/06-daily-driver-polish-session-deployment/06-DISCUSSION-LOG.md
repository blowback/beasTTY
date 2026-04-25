# Phase 6: Daily-Driver Polish, Session & Deployment - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-04-25
**Phase:** 06-daily-driver-polish-session-deployment
**Areas discussed:** Scrollback UI & navigation, Copy / paste / clear-screen on canvas, Session log format & lifecycle, Preferences, defaults & deployment

---

## Scrollback UI & navigation

### Round 1 — navigation primitives

| Question | Option | Description | Selected |
|----------|--------|-------------|----------|
| How should the user scroll back through history? | Wheel + Shift+PgUp/PgDn | Mouse wheel + Shift+PgUp/PgDn keyboard. Bare PgUp/PgDn pass to remote. | ✓ |
| | Wheel only, no keyboard | Mouse wheel only. | |
| | Wheel + visible scrollbar widget | Adds custom scrollbar gutter. | |
| When new output arrives while user is scrolled up, what should happen? | Stay where user is + 'New output' indicator | Viewport stays put; floating indicator. | ✓ |
| | Always auto-snap to bottom | Pulls viewport back. | |
| | Stay where user is, no indicator | Silent. | |
| How should JS read historical rows for rendering? | New Rust accessor `snapshot_grid_at(row_offset)` | Reuses pack_buf. JS-side row math. | ✓ |
| | Expose entire scrollback as flat slice | JS does row math. Couples JS to Rust internals. | |
| | Render historical rows in a separate offscreen canvas | Two render code paths. | |
| Where does the 10,000-line scrollback cap live, and is it user-tunable? | Hardcoded 10K, not exposed | Ship the success-criterion floor. | ✓ |
| | 10K default, expose 'Scrollback lines' setting | 1K–100K range in Settings. | |
| | Use 10K but expose 'Clear scrollback now' button only | No cap setting. | |

### Round 2 — interaction details

| Question | Option | Selected |
|----------|--------|----------|
| Clicking the 'N new lines' indicator should... | Snap viewport to bottom | ✓ |
| | Just dismiss the indicator, leave viewport | |
| | No click target — indicator is decorative | |
| If the user types while scrolled up, what happens? | Snap to bottom on first keypress | ✓ |
| | Stay scrolled up, type-bytes still go to remote | |
| | Block typing until snapped to bottom | |
| How much should one wheel notch scroll? | 3 lines per notch | ✓ |
| | 1 line per notch | |
| | Page (24 lines) per notch | |
| Should bare End snap to bottom, or only Shift+End? | Shift+End snaps; bare End passes through to remote | ✓ |
| | Bare End snaps (intercept) | |
| | No End binding | |

### Round 3 — visual + lifecycle

| Question | Option | Selected |
|----------|--------|----------|
| Where should the indicator render? | Floating chip near bottom-right of canvas | ✓ |
| | Bottom-edge banner full canvas width | |
| | Top-bar status text | |
| Theme/phosphor/zoom toggle while scrolled up: viewport should... | Stay at the same row offset | ✓ |
| | Snap to bottom | |
| | Inconsistent (snap on theme/phosphor; keep on zoom) | |
| Disconnect/reconnect: scrollback view should... | Keep all scrollback, snap viewport to bottom on reconnect | ✓ |
| | Clear scrollback on disconnect | |
| | Keep scrollback, keep viewport position | |
| How does the user clear scrollback? | Settings pane button 'Clear scrollback' | ✓ |
| | Combined with clear-screen via Shift modifier | |
| | No dedicated control; reload to clear | |

### Round 4 — edge cases

| Question | Option | Selected |
|----------|--------|----------|
| Wheel over chrome panes: should it... | Wheel scrolls pane content, never scrollback | ✓ |
| | Wheel always scrolls scrollback regardless | |
| | Stateful: scrolls scrollback unless pane focused | |
| Cursor while scrolled up: | Hide entirely | ✓ |
| | Pin a cursor outline at the row where it would be | |
| | Always show cursor on bottom row regardless | |
| Paste while scrolled up: | Snap to bottom + start paste | ✓ |
| | Stay scrolled up; indicator counts new lines | |
| | Block paste until snapped | |
| Search-in-scrollback (Ctrl+F): in v1? | Out of scope — v2 | ✓ |
| | Minimal Ctrl+F substring search | |
| | Browser-native Ctrl+F via shadow DOM | |

### Round 5 — visual hint + bell + jump-to-top + scroll feel

| Question | Option | Selected |
|----------|--------|----------|
| Should the canvas itself signal 'you are scrolled up'? | Subtle border tint via `[data-scrolled-back]` | ✓ |
| | No additional canvas chrome | |
| | Dim/desaturate the canvas | |
| BEL while scrolled up: | Title prefix only; no viewport flash | ✓ |
| | Flash the whole viewport even when scrolled up | |
| | Add audible-bell indicator to chip | |
| 'Jump to top of scrollback' shortcut? | Shift+Home (mirrors Shift+End) | ✓ |
| | Ctrl+Home | |
| | No jump-to-top shortcut | |
| Wheel scroll feel: | Instant per tick | ✓ |
| | Smooth animated scroll over ~80–120ms | |

### Round 6 — finer details

| Question | Option | Selected |
|----------|--------|----------|
| When does the 'N new lines' indicator first appear? | Instantly on the 1st new line | ✓ |
| | After 3 new lines or 500ms, whichever first | |
| | After 100ms grace period | |
| Clear scrollback while scrolled up: | Snap to bottom + clear in one action | ✓ |
| | Stay scrolled up at row 0 of empty history | |
| | Refuse to clear while scrolled up | |
| Should scroll-up position survive a page reload? | No — reload always resumes at live tail with empty scrollback | ✓ |
| | Persist scrollback to localStorage | |
| | Persist only the offset (not contents) | |
| How often should the scrollback viewport be re-snapshotted from Rust? | On scroll-state change + on every term.feed while scrolled up | ✓ |
| | Only on scroll-state change | |
| | Every rAF tick | |

### Round 7 — trackpad + paste + selection + repaint

| Question | Option | Selected |
|----------|--------|----------|
| Trackpad fractional-deltaY normalization? | Accumulate deltaY; emit a 3-line tick when threshold crossed | ✓ |
| | Pass each wheel event straight through as a 3-line tick | |
| | Differentiate by deltaMode: line=3 lines, pixel=floor(deltaY/30)*3 | |
| Wheel-scroll up while paste-pump in flight? | Scroll viewport, paste continues uninterrupted | ✓ |
| | Scrolling cancels the paste | |
| | Wheel ignored during paste-pump | |
| Selected text + scroll: | Selection clears on any scroll | ✓ |
| | Selection stays anchored to scrollback rows | |
| | Hybrid: stays on live, clears on entering history | |
| Should renderer skip dirty-row pipeline while scrolled up? | Paint all 24 rows once on scroll-state-change, then idle | ✓ |
| | Continue running dirty-row pipeline | |
| | Stop the rAF loop entirely while scrolled up | |

---

## Copy / paste / clear-screen on canvas

### Round 1 — selection model + keyboard policy + clear-screen

| Question | Option | Selected |
|----------|--------|----------|
| How should mouse selection work on the canvas? | Drag-select line-wrapped + double-click word + triple-click line | ✓ |
| | Drag-select rectangular block | |
| | Drag for line-wrapped, Alt+drag for rectangular | |
| Ctrl+C maps to 0x03; copy shortcut? | Ctrl+Shift+C copies; Ctrl+C always sends 0x03 | ✓ |
| | If selection exists, Ctrl+C copies; else 0x03 | |
| | Ctrl+Insert copies (xterm classic) | |
| Ctrl+V maps to 0x16; paste shortcut? | Ctrl+Shift+V pastes; Ctrl+V always sends 0x16 | ✓ |
| | Right-click context menu paste only | |
| | Ctrl+Shift+V + right-click + dedicated 'Paste' button | |
| Local clear-screen UX? | Top-bar 'Clear' button, Shift+click also clears scrollback | ✓ |
| | Two separate top-bar buttons | |
| | Settings pane only | |

### Round 2 — selection visual + copy format + scrollback selection + paste prep

| Question | Option | Selected |
|----------|--------|----------|
| Selection visual on canvas? | Inverted glyphs (swap fg/bg per cell) — reuse Phase 3 atlas.getInverted | ✓ |
| | Translucent colored overlay above the glyphs | |
| | Solid border-box around selection, glyphs unchanged | |
| Copy format on clipboard? | Plain text, trailing whitespace trimmed per line, '\n' line endings | ✓ |
| | Plain text, all whitespace preserved, '\r\n' on Windows | |
| | Plain + custom MIME with raw cell array | |
| Selection across live grid + scrollback? | Yes — selection works across the live/history boundary | ✓ |
| | Limited to currently-visible rows | |
| | Live 80×24 only; scrollback read-only | |
| Paste preprocessing? | CR/LF rewrite per Phase 4 mode + strip non-printable except CR/LF/Tab | ✓ |
| | Pass clipboard text through unchanged | |
| | Encode UTF-8, strip combining marks | |

### Round 3 — large-paste warn + drag-edge + empty-copy + word-def

| Question | Option | Selected |
|----------|--------|----------|
| Large-paste warn? | Warn at 4KB+: 'About to paste N bytes (~M sec).' Cancel? | ✓ |
| | No warning — Phase 5 progress UI is enough | |
| | Warn at 16KB+ only | |
| Drag past canvas edge? | Auto-scroll viewport (top → up into history; bottom no-op at live tail) | ✓ |
| | Selection clamps to visible viewport | |
| | Auto-scroll only with modifier held | |
| Ctrl+Shift+C with empty selection? | No-op | ✓ |
| | Copy entire visible 80×24 grid | |
| | Show brief error/help toast | |
| Double-click word definition? | Whitespace-bounded run of non-space chars | ✓ |
| | [a-zA-Z0-9_] only; punctuation breaks word | |
| | Configurable in Settings | |

---

## Session log format & lifecycle

### Round 1 — format + direction + lifecycle + download

| Question | Option | Selected |
|----------|--------|----------|
| Log file format? | Raw bytes only, .bin extension | ✓ |
| | asciinema .cast (JSON-lines with timestamps) | |
| | Both: .bin + .cast on demand | |
| Directions logged? | RX only | ✓ |
| | RX + TX both interleaved | |
| | RX + TX with ⟪TX:hex⟫ markers | |
| Per-connection or per-tab? | Per-connection: new log on each Connect, prior discarded | ✓ |
| | Per-tab: spans connect/disconnect cycles | |
| | User picks at app load | |
| Download UX (button + filename)? | Connection pane button 'Download log' — `bestialitty-{YYYYMMDD-HHMMSS}.bin` | ✓ |
| | Top-bar 'Download' button | |
| | Settings pane button only | |

---

## Preferences, defaults & deployment

### Round 1 — schema + auto-connect + reset + deploy/license

| Question | Option | Selected |
|----------|--------|----------|
| localStorage schema? | Single key `bestialitty.prefs` with versioned JSON blob | ✓ |
| | One key per preference (`bestialitty.theme`, etc.) | |
| | Single key INCLUDING port preset | |
| 'Auto-connect on load' preference? | Yes, off by default; toggle in Settings | ✓ |
| | No — always require explicit Connect click | |
| | Yes, on by default | |
| 'Reset preferences to defaults' UX? | Settings pane button 'Reset all preferences' with inline 2-click confirm | ✓ |
| | Two buttons: 'Reset prefs' + 'Forget port' separately | |
| | Modal confirmation dialog | |
| Static deploy target + license? | GitHub Pages + MIT license | ✓ |
| | Cloudflare Pages + MIT | |
| | Own domain (self-hosted) + Apache-2.0 | |
| | GitHub Pages + Apache-2.0 | |

---

## Claude's Discretion

Areas where the user said "you decide" or that are explicitly left to planner judgment per CONTEXT.md `### Claude's Discretion`:

- Floating-chip CSS specifics (border-radius, drop-shadow, animation)
- Trackpad deltaY accumulator threshold (~30 px ballpark)
- Wheel-listener attachment point (`#terminal-wrapper` vs `<canvas>`)
- Word-boundary regex (`/\S+/` is the obvious call)
- Settings-pane DOM order for new rows (Reset / Clear scrollback / Auto connect)
- Download filename timestamp format (`YYYYMMDD-HHMMSS` vs `YYYY-MM-DDTHH-MM-SS`)
- gh-pages branch vs `/docs` folder for GitHub Pages deploy
- Soak script content on the MicroBeast

## Deferred Ideas

- Search-in-scrollback (Ctrl+F find substring) — defer to v2
- Asciinema `.cast` log export — defer
- TX logging — RX-only is the v1 contract
- Cross-tab `BroadcastChannel` log sharing — out of scope
- Settings export/import (JSON) — v2-SESS-01
- Audible bell — v2-AUDIO-01
- Right-click context menu paste — Ctrl+Shift+V suffices
- Multi-session log retention — user downloads or it's gone
- DTR/RTS user toggles — deferred from Phase 5; remains deferred
- Send Break button — v2-XPORT-01
- Configurable keymap remap — out of scope per PROJECT.md
- User-tunable scrollback cap UI — 10K hardcoded
- Toast/banner notification primitive — inline confirms suffice
- Word-boundary regex in Settings — `\S+` ships hardcoded
- Custom CSP / Permissions-Policy in app code — defer to hosting config
