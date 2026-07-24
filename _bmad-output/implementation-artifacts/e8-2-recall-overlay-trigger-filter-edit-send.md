---
baseline_commit: d5d66c7eaa888c8b424ccfd32a61ac0bc48176b2
---

# Story E8.2: Recall overlay — trigger, filter, edit & send

Status: done

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As a MicroBeast operator,
I want an arrows-triggered floating overlay to recall, filter, edit, and resend a past command,
so that I can rerun or tweak commands without retyping, and without fighting the MicroBeast for the current line.

**Covers:** FR-7…FR-18 — the **visible recall surface** on top of E8.1's capture engine. NFR-2 (no wire mutation while editing), NFR-5 (consistency + a11y), NFR-6 (Chromium/static).
**Epic:** E8 · Command History. This is the **second story of Epic E8** (`epic-e8` already `in-progress`). E8.1 (capture engine) is **done**; E8.3 (Settings surfaces) is still backlog. Retrospective is `optional`.
**Depends on:** E8.1's `wireCommandHistory` engine API (`isLineEmpty` / `getHistory` / `commit`) — all injected via opts (AD-3), never re-imported; plus the finished E0–E7 chrome (`renderer/focus.js` `retainFocus`, `input/tx-sink.js` `pushTxBytes`, `input/keyboard.js` `getCrlfMode`/`CRLF_MODES`, the `--chrome-*` design tokens, and the `#terminal-wrapper` keydown-interception precedent set by `renderer/menu-bar.js`).

**Premise.** E8.1 built the invisible half: a line mirror that answers "is the operator mid-line?" (`isLineEmpty()`) and a persisted, dedup'd, newest-first history store (`getHistory()`), plus the shared `commit()` re-sort path. This story builds the **visible half**: a floating overlay that, at an empty prompt, opens on ↑/↓, lets the operator filter (multi-term AND) → highlight → Tab-copy → edit locally → Enter-send, and **is the only place in E8 that emits bytes to the wire** (on Enter, via injected `pushTxBytes`, reusing `commit()`). Everything else stays observation-only.

**The interception model (this is the crux — read the Dev Notes before coding).** Beastty keeps focus on `#terminal-wrapper` at all times; every keydown fires there. The overlay is a **passive visual layer with a fake caret** (a `<div>` + `.cur` span — NOT a real `<input>`), exactly like the mockup. It registers **one keydown listener on `#terminal-wrapper`, wired in `main.js` in the AD-12 slot AFTER the E8.1 engine and BEFORE `wireKeyboard`** — mirroring how `renderer/menu-bar.js` intercepts keys while a menu is open (`menu-bar.js:425`). When the overlay decides to act it calls `e.preventDefault()`; `keyboard.js`'s handler then short-circuits on `e.defaultPrevented` (`keyboard.js:213`) so the same keystroke never reaches the encode/forward path. This is why "nothing is transmitted while editing" (NFR-2) is **structural**, not a runtime check: while the overlay is open it `preventDefault`s every key, so `keyboard.js` never encodes a byte.

## Acceptance Criteria

**AC-1 — Trigger: ↑/↓ open the overlay only at an empty prompt with enabled, non-empty history (FR-7, FR-11; UX-DR1, AD-9, AD-10, AD-12).**
**Given** command history is **enabled** (`getPrefs().commandHistoryEnabled !== false`), the store is **non-empty** (`getHistory().length > 0`), and the prompt is empty (`isLineEmpty() === true`), and no menu already claimed the event (`!e.defaultPrevented`)
**When** the operator presses **↑ or ↓** (no Ctrl/Alt/Meta) with the overlay closed
**Then** the overlay `e.preventDefault()`s the key and opens — a floating panel anchored **above the input prompt over the live, undimmed canvas** (no scrim), with the **newest** entry highlighted, terminal focus retained (`retainFocus` — `#terminal-wrapper` never blurs), rendered with `--chrome-*` tokens only (no `[data-theme]` branch, no phosphor vars).

**AC-2 — Trigger is inert otherwise: ↑/↓ pass through as VT52 bytes (FR-8, FR-9, FR-10).**
**Given** the overlay is closed and **any** of: the mirror is **non-empty** (`isLineEmpty() === false` — operator has typed on the line) **OR** the feature is **disabled** **OR** history is **empty** (`getHistory().length === 0`)
**When** the operator presses ↑ or ↓
**Then** the overlay does **not** open and does **not** call `preventDefault` — so `keyboard.js`'s encode path forwards the arrow to the MicroBeast as its normal VT52 cursor bytes (`ESC A` / `ESC B`), byte-for-byte as today.

**AC-3 — Filter: whitespace-split AND substring narrows the list; caption + no-match copy (FR-12; UX-DR3, UX-DR4).**
**Given** the overlay is open
**When** the operator types (e.g. `print 10`) into the edit line
**Then** the edit text is split on whitespace into terms and the list narrows to commands that contain **every** term (case-insensitive substring, order-independent), newest-first; the caption reads **`"{n} of {total} match"`** (single "match") via `aria-live="polite"`; the highlight moves to the first (newest) filtered row
**And** if nothing matches, the list band shows **`"No matching commands"`** and the typed text is **retained** (it is still a valid thing to send with Enter).

**AC-4 — Navigate: ↑/↓ move the highlight within the filtered list (FR-13).**
**Given** the overlay is open with a (possibly filtered) list
**When** the operator presses ↑/↓
**Then** the highlight moves within the **currently filtered** list (clamped at both ends — no wrap required), and `aria-activedescendant` on the combobox tracks the highlighted `option`.

**AC-5 — Tab copies the highlight into the edit line (FR-14; UX-DR4 "entry-copied").**
**Given** a highlighted entry
**When** the operator presses **Tab**
**Then** that command **replaces** the edit-line contents (caret at end), ready to edit; the list stays visible below; Tab is `preventDefault`ed so browser focus traversal never fires. **Tab on an empty / no-match list is a no-op** (nothing highlighted to copy).

**AC-6 — Local edit only: ←/→, Backspace, typing change the edit line; nothing hits the wire (FR-15; NFR-2).**
**Given** text in the edit line
**When** the operator presses **←/→** (move caret), **Backspace** (delete char before caret), or types printable chars (insert at caret)
**Then** the edit line and its rendered caret update locally, the list re-filters live, and **zero bytes** are transmitted — the overlay `preventDefault`s each key so `keyboard.js` never encodes it.

**AC-7 — Enter sends the edit line + terminator, closes, commits as newest (FR-16; reuses E8.1 `commit`, injected `pushTxBytes`/`getCrlfMode` per AD-3).**
**Given** the edit line holds the command the operator wants (typed, or Tab-copied then edited)
**When** they press **Enter**
**Then** the overlay transmits the edit line's **exact** contents as ASCII bytes **followed by the configured terminator** (`getCrlfMode()` → CR / LF / CRLF, the same table `keyboard.js` uses), via the injected `pushTxBytes`; then closes; then calls the injected `commit(text)` so the sent string re-sorts to **newest** in history (dedup/cap identical to typed commits) — **Enter always sends the edit line, never an un-copied highlighted row.** An empty edit line sends just the terminator (a bare Enter to the Z80) and commits nothing (empty-string guard in `commit`).

**AC-8 — Esc closes, sends nothing, leaves the prompt empty (FR-17).**
**Given** the overlay is open
**When** the operator presses **Esc**
**Then** the overlay closes (`e.preventDefault()` so the 0x1B never reaches the MicroBeast), nothing is transmitted, the mirror is untouched (still empty), and focus stays on `#terminal-wrapper`.

**AC-9 — Always-visible key-hint legend (FR-18; UX-DR3 verbatim).**
**Given** the overlay in any open state
**Then** a compact, always-visible (not hover-only) legend along the bottom reads, verbatim with each key bolded:
**`Tab select · ↑↓ move · ←→ edit · Enter send · Esc cancel`**.

**AC-10 — Accessibility: combobox/listbox/option, aria-activedescendant, aria-live, focus retention, neutral tokens (UX-DR5, NFR-5, AD-9, AD-10).**
**Given** the open overlay
**Then** it is fully keyboard-driven: the edit line carries `role="combobox"` driving `aria-activedescendant` over a `role="listbox"` whose rows are `role="option"` (stable ids); the caption is `aria-live="polite"` so match counts announce; **focus is retained on `#terminal-wrapper` throughout and returns to the terminal on close** (the overlay never takes real focus — fake caret, per the mockup); and it renders with `--chrome-*` tokens only. (Honest scope note in Dev Notes: because focus stays on the terminal wrapper rather than a real focused combobox, screen-reader activedescendant tracking is best-effort; the `aria-live` caption is the primary AT signal.)

**AC-11 — Flow 6 end-to-end (EXPERIENCE.md Flow 6, protagonist Reza; UX-DR7, NFR-2).**
**Given** history containing `10 PRINT "HELLO FROM Z80"`, `RUN`, `LIST`, … at an empty prompt
**When** the operator: ↑ (open) → types `print` → adds ` 10` (AND-narrows to one) → **Tab** (copies `10 PRINT "HELLO FROM Z80"` into the edit line) → edits the string → **Enter**
**Then** the finished line is sent onto the clean prompt **exactly as if keyed** (ASCII bytes + terminator), the overlay closes, the Z80 echoes and runs it, it is the **newest** history entry — and **no stray keystrokes touched the wire** during filtering/editing (NFR-2).

**AC-12 — Suite stays green on `retries:1`; new overlay spec added (mirrors E8.1 AC-8).**
**Given** the accepted flake policy (`playwright.config.js:20-27` — chromium-transport + `retries:1`, no per-story `--workers=1`)
**Then** the full suite stays green and a new `www/tests/**/command-history-overlay.spec.js` drives `window.__commandHistoryOverlay.__getStateForTests()` plus real ↑/↓/typing/Tab/Enter/Esc keydowns to cover AC-1…AC-11: trigger open/inert (empty-prompt vs mid-line vs disabled vs empty-history), AND-filter + no-match, navigate, Tab-copy, local edit no-wire, Enter-send (assert the exact TX bytes reach the wire and the string is committed newest), Esc-cancel. Reuse the transport/TX assertion helpers the paste/keyboard specs already use to prove the wire bytes.

## Tasks / Subtasks

- [x] **Task 1 — Overlay markup + CSS skeleton in `www/index.html` (AC-1, AC-9, AC-10).**
  - [x] Add a hidden container `#command-history-overlay` inside `#terminal-wrapper`, **beside** `#paste-toast` / `#slide-chip` (the transient-overlay cluster, `index.html:1534-1576`). Static skeleton = the four bands from the mockup: `.ch-cap` (caption `<span>` + `.count` `<span>`), `.ch-list` (rows injected per render), `.ch-entry` (`.pr` mint `>` + `.txt` + `.cur` caret), `.ch-legend` (static, verbatim copy). Root class `.ch-panel`.
  - [x] Add the CSS to the same `<style>` block that holds `#paste-toast` / `#slide-chip` (`index.html` §"Terminal wrapper + overlays"). Use the mockup's rules **but with the two corrections below**. `--chrome-*` / `--field-bg` / `--ui-font` tokens only; **no `[data-theme="crt"]` branch** (AD-9).
  - [x] **CORRECTION 1 (mockup vs DESIGN.md conflict — DESIGN.md wins).** The mockup's `.ch-row.sel { background: rgba(127,219,202,.14) }` (subtle tint) **contradicts** UX-DR1 / DESIGN.md `selectedRow: {components.menu-item.hoverBackground}`. The real menu-item selection treatment is **solid mint** (`index.html:214-217`: `background: var(--chrome-accent); color: var(--chrome-bg)`). **Match the real menu items**: selected row = solid `var(--chrome-accent)` bg + `var(--chrome-bg)` text, and flip the `.mark ›` marker to `var(--chrome-bg)` when selected (as `.menu-item .check` does). Do **not** ship the mockup's `.14` tint.
  - [x] **CORRECTION 2 (mockup vs DESIGN.md conflict — DESIGN.md wins).** The mockup's `.ch-panel { box-shadow: 0 12px 40px rgba(0,0,0,.6) }` **contradicts** DESIGN.md "depth via hairline+tone only — NO drop shadow" (and matches the `#paste-toast` no-shadow rule). **Drop the box-shadow.**
  - [x] Positioning: floating, anchored above the input prompt over the live canvas (`position: absolute`, low-left, `z-index` above `#scrollback-indicator` (z:5) and consistent with the `#paste-toast` cluster; the mockup used `z-index:40`). Confirm against the real prompt location; the mockup's `left:198px; bottom:64px` are illustrative, not literal.
- [x] **Task 2 — Build `www/renderer/command-history.js` (the overlay) (AC-1…AC-11).**
  - [x] NEW transient-renderer module, **named exports only**, cloning the `renderer/paste-toast.js` transient-renderer pattern: module-scope lifecycle (`open`/`closed`) + per-open state (edit string, caret index, filtered list, highlight index) + injected deps via `wireCommandHistoryOverlay(opts)` + `[hidden]`-attribute toggle + returned API object. Direct imports allowed: `renderer/focus.js` `retainFocus` (AD-10, sibling — the paste-toast precedent) and `state/prefs.js` `getPrefs` (AD-3/AD-4, for the `commandHistoryEnabled` read). **No** import of `command-history.js` (engine) / `tx-sink.js` / `keyboard.js` — those arrive via opts (AD-3).
  - [x] `export function wireCommandHistoryOverlay(opts)` — destructure `{ overlayEl, terminalWrapper, isLineEmpty, getHistory, commit, pushTxBytes, getCrlfMode }`. `retainFocus(overlayEl)` so a mouse-down on the panel never blurs the terminal (AD-10). Register **one** `keydown` listener on `terminalWrapper` here (the AD-12 interception; see Task 4 for the boot slot). Return `{ open, close, isOpen, dispose, __getStateForTests, __resetForTests }`.
  - [x] **Keydown handler — closed branch (AC-1, AC-2).** First `if (e.defaultPrevented) return;` (a menu already claimed it). Then: only `ArrowUp`/`ArrowDown` with no Ctrl/Alt/Meta matter. Open **iff** `getPrefs().commandHistoryEnabled !== false && isLineEmpty() && getHistory().length > 0`. If opening → `e.preventDefault()` + `open()`. **Otherwise return WITHOUT preventDefault** so `keyboard.js` forwards the arrow as VT52 bytes (FR-8/9/10). Every other key while closed → return untouched.
  - [x] **Keydown handler — open branch (AC-3…AC-8).** `e.preventDefault()` on **every** handled key (structural NFR-2). Route: `ArrowUp`/`ArrowDown` → move highlight (clamped); `ArrowLeft`/`ArrowRight` → move caret; `Backspace` → delete char before caret + re-filter; `Tab` → copy highlighted row into edit line (caret to end); `Enter` → send + close + commit (Task 3); `Escape` → close, send nothing; a printable single char (guard like the engine: single-char `e.key`, no Ctrl/Alt/Meta) → insert at caret + re-filter. Ignore arrows-with-modifiers / function keys (leave closed-state passthrough semantics only; while open, non-handled keys should still be swallowed to avoid leaking to the wire — prefer `preventDefault` + no-op for stray keys while open).
  - [x] **Filter (AC-3).** `terms = editText.trim().split(/\s+/).filter(Boolean)`; a command matches iff every term is a case-insensitive substring (`cmd.toLowerCase().includes(term.toLowerCase())`). Empty edit text → full history. Recompute filtered list + reset highlight to 0 on every edit; re-render.
  - [x] **Render.** Rebuild `.ch-list` innerHTML per render (rows are dynamic — unlike paste-toast's persistent buttons, there are no mid-click detach concerns because the overlay is keyboard-only). Each row: `role="option"` + stable id (e.g. `ch-opt-{index}`), `.sel` on the highlight, `.mark ›`. Empty filtered list → `.ch-empty` with `"No matching commands"` (or `"No history yet — commands you send will appear here"` only if somehow opened on empty history — normally AC-1 prevents that). Caption: `"{n} of {total} match"` when filtering, `"{total} commands"` when unfiltered. Edit-line `.txt` renders the string with the `.cur` caret at `caretIndex`. Update `aria-activedescendant` to the selected option id.
- [x] **Task 3 — Enter-send path (AC-7, AC-11).**
  - [x] Build bytes: `text` → ASCII `Uint8Array` (`text.charCodeAt(i)` — the edit line is printable ASCII, same domain the engine appends), then append the terminator from a small CR/LF/CRLF map keyed by `getCrlfMode()` (`cr → [0x0D]`, `lf → [0x0A]`, `crlf → [0x0D,0x0A]` — the exact `keyboard.js` `CRLF_MODES` semantics). Call injected `pushTxBytes(bytes)` **once**.
  - [x] Then `close()` the overlay, then `commit(text)` (E8.1's shared dedup+cap+persist path) so the sent string is newest. Order: send → close → commit. `commit('')` is a safe no-op (engine guards empty), so a bare-Enter empty edit line sends only the terminator and stores nothing.
  - [x] **Do NOT** route the send through `keyboard.js` — that would double-encode and re-enter the capture hook. The overlay is the sole emitter here (AD-3 injected `pushTxBytes`).
- [x] **Task 4 — Wire it in `main.js` (AC-1, AC-7, AC-12).**
  - [x] Import `wireCommandHistoryOverlay` from `./renderer/command-history.js`. `getElementById('command-history-overlay')` near the other overlay-element lookups (`main.js:376-377`).
  - [x] Call it in the **AD-12 slot**: AFTER `wireCommandHistory` (the engine, `main.js:588`) and **BEFORE `wireKeyboard`** (`main.js:807`) so its `#terminal-wrapper` keydown listener registers before `keyboard.js`'s and the `defaultPrevented` short-circuit wins (same reason `wireMenuBar` at `:441` precedes `wireKeyboard`). Inject: `overlayEl`, `terminalWrapper`, `isLineEmpty: commandHistory.isLineEmpty`, `getHistory: commandHistory.getHistory`, `commit: commandHistory.commit`, `pushTxBytes`, `getCrlfMode` (already imported at `main.js:78`).
  - [x] **`pushTxBytes` is NOT yet imported in `main.js`** — the current `./input/tx-sink.js` import block (`main.js:80-89`) pulls `getWireOwner`/`setWireOwner`/… but **not** `pushTxBytes`. Add `pushTxBytes` to that existing import list (it is exported by `tx-sink.js`, used today by `keyboard.js:22` and `paste-pump.js`). Don't assume it's already in scope.
  - [x] `window.__commandHistoryOverlay = overlay;` (Playwright hook, mirrors `window.__commandHistory` / `window.__pasteToast`).
- [x] **Task 5 — Tests (AC-12).**
  - [x] New `www/tests/**/command-history-overlay.spec.js`. Seed history via `localStorage['beastty.prefs']` or `window.__commandHistory.commit(...)`, then drive **real keydowns** on `#terminal-wrapper` (the interception must be exercised end-to-end, like E8.1's one real-keyboard test). Assert: trigger open only at empty prompt + enabled + non-empty; ↑/↓ pass-through (assert VT52 bytes on the wire) when mid-line/disabled/empty-history; AND-filter + `"No matching commands"`; navigate; Tab-copy; **no wire bytes during typing/editing** (assert the TX ring is unchanged); Enter sends exact bytes + terminator (assert on the transport/TX sink) and commits newest; Esc sends nothing. Keep the full suite green on `retries:1` (no `--workers=1`).

## Dev Notes

### Why the overlay is a passive layer with a fake caret (the interception model)
Beastty is a passthrough terminal; `#terminal-wrapper` holds focus and **every** keydown fires there (`keyboard.js:211`). The overlay must not take real focus — if it did, `keyboard.js`'s wrapper-scoped listener would stop firing and the trigger (↑ at empty prompt, which happens *before* the overlay exists) would have nowhere to live. So the overlay follows the **menu-bar model**: keep terminal focus, register a keydown listener on `#terminal-wrapper` *before* `wireKeyboard`, and `preventDefault` to short-circuit `keyboard.js` (`keyboard.js:213` `if (e.defaultPrevented) return;`). The "edit line" is a `<div>`+`.cur` span (the mockup's structure), not an `<input>`. Consequence for NFR-2: while open the overlay `preventDefault`s every key → `keyboard.js` never reaches `encode_key_raw`/`forwardBytes` → **structurally impossible** to leak a byte while editing. [Source: www/input/keyboard.js:211-314; www/renderer/menu-bar.js:422-536]

### Listener ordering — exact facts (main.js boot order)
Registration order on `#terminal-wrapper`: `wireChrome` (~410, chrome.js keydown) → `wireMenuBar` (`:441`, menu keydown `:425`) → `wireStatusBar` (`:555`, no keydown) → `wireCommandHistory` engine (`:588`, no keydown) → **[overlay wires here]** → `wireKeyboard` (`:807`). Because the overlay registers **after** menu-bar, menu-bar's handler runs first: with a menu open it `preventDefault`s (`menu-bar.js:536,550-573`) → the overlay's `if (e.defaultPrevented) return;` bails (correct — ↑/↓ belong to the open menu). With no menu open, menu-bar early-returns with **no** preventDefault (`menu-bar.js:525`) → the overlay handler runs. And because the overlay registers **before** `wireKeyboard`, its `preventDefault` reaches `keyboard.js` as `e.defaultPrevented`. This ordering is critical (both neighbours depend on it) — keep the wire call in the `:588`→`:807` gap. [Source: www/main.js:410-814; www/renderer/menu-bar.js:516-573]

### E8.1 engine API this story consumes (all injected — AD-3)
`wireCommandHistory` returns `{ capture, isLineEmpty, getHistory, commit, clear, dispose, __getStateForTests, __resetForTests }` (`www/input/command-history.js:70-79`). This story uses three, injected via opts (never re-imported):
- `isLineEmpty()` → `mirror.length === 0` — the **empty-prompt gate** for the trigger (FR-5/FR-8). [command-history.js:165]
- `getHistory()` → **fresh copy** of the newest-first store (`[...prefs.commandHistory]`, `[]` on absent/corrupt) — the list source. Safe to read every open/filter; returns a copy so overlay filtering can never corrupt the cached prefs array. [command-history.js:170-173]
- `commit(str)` → shared dedup (exact/case-sensitive, moves existing to newest) + size-cap + `savePrefs` path; **guards empty string** (via `commitMirror`'s caller contract — call `commit(text)` and rely on it; note `commit('')` itself does not early-return on empty, but stores `''` — SEE WARNING). [command-history.js:144-159]
  - **WARNING (edge case):** `commit(str)` does **not** itself reject an empty string (only `commitMirror()` guards empty, `:133-137`). If the overlay calls `commit('')` on a bare-Enter empty edit line, it would store `''` as a history entry. **The overlay must guard: only call `commit(text)` when `text.length > 0`.** (Still send the terminator for the bare Enter, just don't commit an empty entry.) This preserves AC-3's "empty lines never stored" invariant from E8.1.

### Sending on Enter — terminator source (AC-7)
`keyboard.js` exports both `getCrlfMode()` (`:106`) and the `CRLF_MODES` table (`:70-74`: `cr→[0x0D]`, `lf→[0x0A]`, `crlf→[0x0D,0x0A]`). Per AD-3 the renderer must not import `keyboard.js`; inject `getCrlfMode` via opts (already imported in `main.js:78`) and keep a 3-entry terminator map inside the overlay (or inject `CRLF_MODES` too — dev discretion; the inline map is smaller and self-contained). Sending `text` as raw `charCodeAt` bytes + terminator exactly reproduces typing the line then Enter, because printable-ASCII `encode_key_raw` is identity for `0x20–0x7E` and `forwardBytes` rewrites the Enter CR to the same `CRLF_MODES[crlfMode]`. [Source: www/input/keyboard.js:70-74,106,319-327]

### Known minor limitation (document in-code, acceptable)
The Enter-send uses `pushTxBytes` directly and does **not** run the `keyboard.js` **local-echo** path (`keyboard.js:332-334`). With `localEcho` **off** (the default) this is invisible — the MicroBeast remote-echoes the sent line (Flow 6's "the Z80 echoes it"). With `localEcho` **on**, a recalled-and-sent line would not be *locally* echoed (the remote still echoes). This mirrors how other direct `pushTxBytes` emitters behave and is never a wire-correctness issue. If it ever matters, inject the same `term.feed`/`sampleBell`/`drainHostReply`/`requestFrame` quartet `wirePastePump` uses (`main.js:819`) — out of scope here.

### Mockup vs canonical spec — two conflicts to resolve DESIGN.md's way
The visual mockup (`command-history-overlay.html`) is the reference, but **DESIGN.md / EXPERIENCE.md win on conflict** (per the UX design contract). Two concrete divergences the dev must NOT copy from the mockup (see Task 1 corrections):
1. **Selected-row highlight.** Mockup: `rgba(127,219,202,.14)` subtle tint (keeps fg text). Canonical (UX-DR1: "highlight = the menu-item selection treatment"): the **real** `.menu-item` selection is **solid mint** `var(--chrome-accent)` bg + `var(--chrome-bg)` text (`index.html:214-217`). Ship the solid treatment and flip the `.mark` to `var(--chrome-bg)` when selected.
2. **Drop shadow.** Mockup: `box-shadow: 0 12px 40px rgba(0,0,0,.6)`. Canonical (DESIGN.md UX-DR1): "depth via hairline+tone only (no drop shadow)" — matches `#paste-toast`. Drop the shadow.

### UX design contract (verbatim — the surface to match)
- **Panel (`.ch-panel`):** `width:412px`, `background:var(--chrome-bg)` (#1e242c), `border:1px solid var(--chrome-border)` (rgba(255,255,255,.08)), `border-radius:6px`, `overflow:hidden`, `font:13px/1.4 var(--ui-font)`, **no** box-shadow. Floating above the input prompt over the **live, undimmed** canvas — chip-like, not a scrimmed modal.
- **Three hairline-divided bands + legend:**
  - `.ch-cap` — `padding:7px 11px`, `border-bottom:1px solid var(--chrome-border)`, `color:var(--chrome-muted)`, `font-size:12px`, flex space-between: left `<span>Command history</span>`, right `.count`.
  - `.ch-list` — `padding:5px`, `max-height:196px`, `overflow:auto`, column flex. Rows `.ch-row` (`padding:5px 10px`, `border-radius:4px`, `color:var(--chrome-fg)`, ellipsis), `.ch-row.sel` = **solid mint** (see correction 1), `.mark ›` = `var(--chrome-accent)` (→ `var(--chrome-bg)` when `.sel`), unselected rows hide the mark (`visibility:hidden`). Empty band `.ch-empty` (`padding:14px 12px`, muted, centered).
  - `.ch-entry` — `padding:9px 11px`, `background:var(--field-bg)` (#0f1419), `border-top:1px solid var(--chrome-border)`; `.pr` mint `>` (`var(--chrome-accent)`), `.txt` (`flex:1; color:var(--chrome-fg)`), `.cur` caret (`width:8px; height:1.05em; background:var(--chrome-fg)`; muted when it's the placeholder).
  - `.ch-legend` — `padding:7px 11px`, `border-top:1px solid var(--chrome-border)`, `color:var(--chrome-muted)`, `font-size:11.5px`, flex `gap:14px`; each `<span><b>Key</b> label</span>` with `<b>` = `var(--chrome-fg)`.
- **Verbatim microcopy:** caption unfiltered `"{total} commands"`; caption filtered `"{n} of {total} match"` (single "match"); no-match list `"No matching commands"`; empty-history list `"No history yet — commands you send will appear here"`; edit-line placeholder `"type to filter…"` (muted); legend `Tab select · ↑↓ move · ←→ edit · Enter send · Esc cancel` (each key bolded).
- **Six states (EXPERIENCE.md State Patterns):** closed · open-empty-filter (full history, newest highlighted, `"{total} commands"`, placeholder) · open-filtered (`"{n} of {total} match"`, highlight on first match) · no-match (`"No matching commands"`, typed text retained) · entry-copied (Tab-copied command in edit line, caret live) · empty-history (trigger is a no-op — overlay never opens).
[Source: DESIGN.md#command-history-overlay (lines 110-121); EXPERIENCE.md State Patterns (183-193), microcopy (112-127), Flow 6 (276-284), a11y (222-231), Interaction Primitives (200-220); mockups/command-history-overlay.html]

### Accessibility honesty (AC-10)
Wire `role="combobox"` (edit line) + `aria-controls`/`aria-activedescendant`, `role="listbox"` (list) + `role="option"` (rows, stable ids), and `aria-live="polite"` on the caption. But focus **stays on `#terminal-wrapper`** (fake caret) — it is not inside a focused combobox — so activedescendant tracking is best-effort; the live-region caption is the dependable AT signal. This is the pragmatic bar for a Chromium-only retro terminal and matches the passive-layer model; do not add a real focusable input to "fix" ARIA, as that breaks the interception model above.

### Project Structure Notes
- **NEW:** `www/renderer/command-history.js` — the overlay (transient-renderer, `paste-toast.js` precedent). NOTE the deliberate split: the **engine** is `www/input/command-history.js` (E8.1, input-layer state); the **overlay** is `www/renderer/command-history.js` (E8.2, renderer). Same basename, different directory — exactly as E8.1's Project Structure Notes anticipated ("The E8.2 overlay will be a separate `www/renderer/command-history.js`"). Do not merge them; do not import one from the other (engine API arrives via opts).
- **UPDATE:** `www/index.html` (overlay markup + CSS in the existing overlay `<style>` block), `www/main.js` (import + `getElementById` + `wireCommandHistoryOverlay` in the AD-12 slot + `window.__commandHistoryOverlay`).
- **NEW:** `www/tests/**/command-history-overlay.spec.js`.
- **Naming:** window hook `window.__commandHistoryOverlay` (mirrors `window.__commandHistory` / `window.__pasteToast`); wire fn `wireCommandHistoryOverlay`.
- **No build step, no new dependency, no Rust/wasm change** (NFR-1, NFR-6). The wasm core is not touched — parser/terminal/key-encoding stay out of scope (NFR-1).

### References
- [Source: _bmad-output/planning-artifacts/epics-command-history.md#Story E8.2] — ACs, FR-7…18 coverage
- [Source: _bmad-output/implementation-artifacts/e8-1-command-capture-engine-line-mirror-history-store.md] — the engine this builds on; API, invariants, structure split
- [Source: _bmad-output/planning-artifacts/prds/prd-beastty-2026-07-22/prd.md] — FR-7…18; NFR-2/5/6
- [Source: _bmad-output/planning-artifacts/architecture/.../ARCHITECTURE-SPINE.md] — AD-3 (import allowlist), AD-9 (neutral shell), AD-10 (retainFocus), AD-12 (boot-order interception), AD-16 (transient-renderer precedent)
- [Source: _bmad-output/planning-artifacts/ux-designs/ux-beastty-2026-07-01/DESIGN.md] — command-history-overlay component + tokens
- [Source: _bmad-output/planning-artifacts/ux-designs/ux-beastty-2026-07-01/EXPERIENCE.md] — State Patterns, microcopy, Flow 6, a11y, Interaction Primitives
- [Source: _bmad-output/planning-artifacts/ux-designs/ux-beastty-2026-07-01/mockups/command-history-overlay.html] — visual reference (superseded by DESIGN.md on the two conflicts above)
- [Source: www/input/command-history.js:70-200] — engine API (isLineEmpty/getHistory/commit) + empty-string caveat
- [Source: www/input/keyboard.js:70-74,106,211-314,319-334] — CRLF_MODES/getCrlfMode, keydown interception, defaultPrevented short-circuit, forwardBytes/local-echo
- [Source: www/renderer/menu-bar.js:422-573] — the `#terminal-wrapper` keydown-interception precedent (open-vs-closed preventDefault discipline)
- [Source: www/renderer/paste-toast.js] — transient-renderer pattern (lifecycle + injected deps + [hidden] toggle + retainFocus + window hook)
- [Source: www/renderer/focus.js:60-72] — retainFocus (mousedown→preventDefault; throws on real focusable controls without restoreTarget — another reason for the fake caret)
- [Source: www/main.js:376-377,441,555,588,807-814] — overlay-element lookups, wire order, AD-12 slot, wireKeyboard opts
- [Source: www/index.html:200-230,385-419,1534-1576] — menu-item selection tokens, #paste-toast CSS/markup precedent, overlay cluster

## Dev Agent Record

### Agent Model Used

claude-opus-4-8 (Claude Code, bmad-dev-story workflow)

### Debug Log References

- Initial overlay spec run flaked 3/18 on the boot `waitForFunction` (the shared single-threaded static server serialising 18 parallel wasm fetches). Fixed by lightening `ready()`: only the AC-2 passthrough tests (which encode a real ↑ into `ESC A` via the wasm encoder) wait on the canvas via `waitForEncoder`; everything else the overlay `preventDefault`s before wasm, so it needs only the window hooks. Spec dropped from 33 s to ~5 s, 18/18 green with zero flake across repeated runs.
- Full suite (582 tests, all projects): run 1 had one stochastic contention failure in `slide-recv.spec.js` (SLIDE-22) that passed in isolation and green on re-run; runs 2 and 3 fully green (573 / 561 passed, 0 failed on `retries:1`). The overlay spec passed clean in every run — the residual flake set is the pre-existing wasm-boot-under-load pattern the `retries:1` policy self-heals, not this story's code.

### Completion Notes List

- **Interception model (AD-12) as specified.** `renderer/command-history.js` registers ONE keydown listener on `#terminal-wrapper`, wired in `main.js` in the gap AFTER the E8.1 engine (`wireCommandHistory`) and BEFORE `wireKeyboard`. Closed branch opens only on bare ↑/↓ at an empty prompt with enabled + non-empty history and `preventDefault`s; every other case returns WITHOUT `preventDefault` so `keyboard.js` forwards the arrow as its VT52 bytes. Open branch `preventDefault`s every key it routes — NFR-2 ("nothing transmitted while editing") is therefore structural, proven by the AC-6 spec asserting the TX ring stays empty through a full edit sequence.
- **Passive fake-caret layer (AD-10).** The edit line is a `.ch-txt` `<div>` + `.cur` span, never a real `<input>`; `retainFocus` on the panel keeps `#terminal-wrapper` focused (AC-10 asserts `document.activeElement.id === 'terminal-wrapper'` while open). ARIA roles (combobox/listbox/option), `aria-activedescendant`, and the `aria-live="polite"` caption are wired; per the story's honesty note, activedescendant tracking is best-effort and the live caption is the dependable AT signal.
- **Sole wire emitter (AC-7).** Enter builds ASCII bytes via `charCodeAt` + a 3-entry CR/LF/CRLF terminator map keyed off the injected `getCrlfMode()` (mirrors `keyboard.js` `CRLF_MODES`; not imported, per AD-3), emits ONCE via injected `pushTxBytes`, then closes, then `commit(text)` — guarded to skip `commit('')` so a bare Enter sends just the terminator and stores nothing (preserves E8.1's "empty lines never stored"). Spec asserts the exact hex strip (e.g. `52 55 4E 0D` for `RUN`+CR, `…0A` under a seeded `lf` blob) reaches the sink and the string re-sorts to newest.
- **DESIGN.md corrections applied (not the mockup).** Selected row = SOLID `var(--chrome-accent)` bg + `var(--chrome-bg)` text (matching the real `.menu-item` selection), with the `›` marker flipped to `var(--chrome-bg)` — NOT the mockup's `.14` tint. NO drop shadow (mockup shipped `0 12px 40px`). Neutral `--chrome-*`/`--field-bg`/`--ui-font` tokens only; no `[data-theme="crt"]` branch (AD-9).
- **Tab re-filters (design decision).** Tab copies the highlighted row into the edit line (caret to end) and re-runs the live filter against the new edit text — the "edit text always drives the filter" model. The list stays visible (AC-5); Enter always sends the edit line, never an un-copied highlighted row, so the post-Tab highlight position is immaterial to the send.
- **Test-hook additions.** `window.__commandHistoryOverlay` exposes `open/close/isOpen/dispose/__getStateForTests/__resetForTests`. `window.__txSink` gained `formatHexStrip` + `resetTx` so the parallel render spec asserts the exact wire bytes (and the untouched ring during editing) by reading the sink directly — no wasm-heavy serial connect, avoiding the transport project's boot-contention flake.

### File List

- `www/renderer/command-history.js` — **NEW.** The recall overlay (transient-renderer, `paste-toast.js` pattern; distinct from the E8.1 engine at `www/input/command-history.js`).
- `www/index.html` — **UPDATED.** `#command-history-overlay` markup inside `#terminal-wrapper` (beside the `#paste-toast`/`#slide-chip` cluster) + the `.ch-panel` CSS in the overlay `<style>` block.
- `www/main.js` — **UPDATED.** Import `wireCommandHistoryOverlay`; add `pushTxBytes` to the `tx-sink.js` import; `getElementById('command-history-overlay')`; wire in the AD-12 slot with injected deps; `window.__commandHistoryOverlay`; expose `formatHexStrip`/`resetTx` on `window.__txSink`.
- `www/tests/render/command-history-overlay.spec.js` — **NEW.** 18 tests covering AC-1…AC-11 via real keydowns + TX-ring assertions.

## Change Log

- 2026-07-23 — Story drafted (create-story workflow). Ultimate context engine analysis completed — comprehensive developer guide created. Status → ready-for-dev.
- 2026-07-23 — Implemented E8.2 recall overlay (dev-story). New `renderer/command-history.js` overlay + markup/CSS + `main.js` wiring in the AD-12 slot + 18-test spec. Full suite green on `retries:1`. Status → review.
- 2026-07-23 — Code review run; 5 fixes + a regression test folded into the implementation commit `474cf65`. Status → done. (Section below backfilled 2026-07-24 from the commit record — E8 retro action #1.)

### Code Review

**Outcome:** review of the overlay + its E8.1 engine touchpoints; **5 findings,
all fixed** + 1 regression test — folded into the implementation commit
`474cf65` before recording, per this project's convention. All five sit in
input classification (the epic's novel edge logic). Full suite green on
`retries:1` after fixes (582 tests; repeat runs fully green).

- **Numeric-keypad digits desynced the E8.1 mirror** (user-facing). The engine
  captured `e.key`, but keypad digits carry a `Keypad*` tag and read
  `'End'`/`'Insert'` etc. under NumLock-off — a command typed on the keypad
  stored garbled. **Fixed:** capture the encoded wire byte, not `e.key`.
  Keypad-digit regression test added to `command-history.spec.js`.
- **Bare Shift+Arrow was eaten by the trigger.** **Fixed:** Shift excluded from
  the ↑/↓ open chord so Shift+Arrow still reaches the wire (menu-bar precedent).
- **Trigger active during a SLIDE transfer.** The overlay could open mid-transfer
  and Enter-"send" a command whose bytes tx-sink silently drops (owner ===
  `'slide'`) while `commit()` still recorded it — a phantom history entry for a
  send that never left the machine. **Fixed:** trigger suspended while SLIDE
  owns the wire, mirroring the E8.1 engine's suspend.
- **Modified chords misread while open.** Ctrl+Enter / Ctrl+ArrowLeft etc. were
  routed as their plain forms. **Fixed:** Ctrl/Alt/Meta chords swallowed while
  open (preventDefault + no-op; keeps NFR-2 structural).
- **Missing IME-composition guard.** **Fixed:** `e.isComposing` bail added,
  matching the sibling keyboard.js / menu-bar.js handlers.

*(Backfilled 2026-07-24. The review ran between "Status → review" and the story
commit on 2026-07-23; its outcome lived only in the `474cf65` commit message
until the E8 retro flagged the missing section. Superseded in part by the
post-retro hardware tweaks of 2026-07-24 — see commit `c8822e2`.)*
