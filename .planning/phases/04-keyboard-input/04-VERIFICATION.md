---
phase: 04-keyboard-input
verified: 2026-04-22T23:00:00Z
status: human_needed
score: 10/10 must-haves verified (automated)
overrides_applied: 0
human_verification:
  - test: "Real IME composition (Japanese/Chinese/Korean hardware IME)"
    expected: "Zero double-emit; no bytes during intermediate composition; commit emits bytes once"
    why_human: "Playwright cannot drive a real OS IME; synthetic CompositionEvent covers only our listener logic. VALIDATION.md Manual-Only Verifications row 1."
  - test: "AltGraph on non-US keyboard layout"
    expected: "Correct ASCII byte for each AltGr-accessible char; no spurious Ctrl/Alt sequences"
    why_human: "Playwright defaults to en-US; AltGraph is layout-dependent. VALIDATION.md Manual-Only Verifications row 2."
  - test: "5-minute daily-driver feel"
    expected: "No dropped keys, focus sticky on chrome clicks, Ctrl+Alt+T flips theme, F5 reloads, no console errors"
    why_human: "Ergonomic cross-SC feel is not automatable. VALIDATION.md Manual-Only Verifications row 3."
---

# Phase 4: Keyboard Input Verification Report

**Phase Goal:** Map PC browser keydown events to correct VT52 byte sequences end-to-end, with local-echo and CR/LF override toggles for testing and edge-case MicroBeast software — all demonstrable without any serial hardware attached.

**Verified:** 2026-04-22T23:00:00Z
**Status:** human_needed
**Re-verification:** No — initial verification

## Goal Achievement

### Observable Truths

| #   | Truth                                                                                                                          | Status     | Evidence                                                                                                                                                                                                                                 |
| --- | ------------------------------------------------------------------------------------------------------------------------------ | ---------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | Arrow keys transmit exactly ESC A / ESC B / ESC C / ESC D, verifiable in TX hex strip                                          | VERIFIED   | `keydown-arrows.spec.js` all 5 tests pass; exact TX strings `1B 41`, `1B 42`, `1B 43`, `1B 44` asserted via `toHaveText`. Rendered in Debug pane `<pre id="tx-strip">` updated by the `registerTxObserver` callback in `main.js:220-223`. |
| 2   | Ctrl-letter combinations transmit 0x00–0x1F control bytes (Playwright verified)                                                | VERIFIED   | `keydown-ctrl-letters.spec.js` Ctrl+KeyA→`01`, Ctrl+KeyL→`0C`, Ctrl+KeyM→`0D`, Ctrl+KeyZ→`1A`, Ctrl+BracketLeft→`1B`. Encoder path via `encode_key_raw(code, ctrlMod)` in keyboard.js:179.                                                |
| 3   | `preventDefault` captures every FORWARDED key; NOT on unhandled keys (F5, F12, F11 stay functional)                            | VERIFIED   | keyboard.js:174 returns `-1` for F1-F12 / Home / End / PgUp / PgDn / Insert / Delete / Meta BEFORE `e.preventDefault()` on line 177. Synchronous preventDefault happens only when `packKeyCode` returns a non-negative tag. Ctrl+KeyL focus check proves preventDefault ran (otherwise browser chord would steal focus). |
| 4   | Local-echo toggle default OFF; flipping changes whether typed chars render on canvas                                           | VERIFIED   | `local-echo.spec.js` 3 tests: default `.not.toBeChecked`, grid byte unchanged on OFF, grid byte = 0x41 on ON via `window.__testGridView()[0]`. keyboard.js:53 `let localEcho = false`; forwardBytes:202-207 feeds bytes through Phase 3 sequence only when `localEcho && termRef`. |
| 5   | CR/LF 3-way toggle alters Enter byte sequence (CR=0x0D, LF=0x0A, CRLF=0x0D 0x0A)                                               | VERIFIED   | `crlf-override.spec.js` 4 tests: default CR→`0D`, LF→`0A`, CRLF→`0D 0A`, radio exclusivity. keyboard.js:189-195 post-encode rewrite when `wasEnter && bytes==[0x0D] && crlfMode !== 'cr'`. Radios wired in main.js:200-215.              |
| 6   | Canvas wrapper retains focus after clicking any top-bar OR Settings-pane control                                               | VERIFIED   | `focus-retention.spec.js` 5 tests (all passing): theme-toggle, 3 phosphor buttons, local-echo checkbox, 3 CR/LF radios, Reset TX. `mousedown` preventDefault in chrome.js:70-72 + 82-84 (top bar) and main.js:193-195 / 205-215 / 231-234 (Settings/Debug). |
| 7   | IME composition does not double-emit (synthetic CompositionEvent verified; manual UAT documented)                              | VERIFIED (automated) / NEEDS HUMAN (real IME)   | `ime-composition.spec.js` 3 tests pass: single-char, multi-char, keydown-during-composition-suppressed. Module-scope `isComposing` flag in keyboard.js:58 set/cleared by compositionstart/end handlers (142-162). Real-IME OS integration falls under human verification (Manual UAT row 1). |
| 8   | Zero Rust changes (no tasks modify `crates/**`)                                                                                | VERIFIED   | `git log cec37fc..HEAD -- crates/` returns empty. D-13 honoured.                                                                                                                                                                         |
| 9   | Existing Phase 3 tests still pass                                                                                              | VERIFIED   | `npx playwright test tests/render/` → 32 passed / 5.6s / 0 failures.                                                                                                                                                                     |
| 10  | Fast test suite runs in under 15s                                                                                              | VERIFIED   | `npm run test:fast` → 15 tests passed / 3.0s (well under 15s hard cap).                                                                                                                                                                  |

**Score:** 10/10 truths verified by automated checks.

### Required Artifacts

| Artifact                                        | Expected                                                                                  | Status     | Details                                                                                                                                                                                                                         |
| ----------------------------------------------- | ----------------------------------------------------------------------------------------- | ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `www/input/keyboard.js`                         | DOM keydown + composition handlers, packKeyCode/packModifiers, local-echo, CR/LF         | VERIFIED   | 209 lines. Exports wireKeyboard, setLocalEcho, getLocalEcho, setCrlfMode, getCrlfMode, packKeyCode, packModifiers (7 exports). KEY_TAG frozen table mirrors key.rs verbatim. CRLF_MODES post-encode rewrite at line 189-195.      |
| `www/input/tx-sink.js`                          | JS-owned Uint8Array(1024) ring + observer fan-out + hex formatter                        | VERIFIED   | 65 lines. 4 exports (pushTxBytes, formatHexStrip, registerTxObserver, resetTx). RING_CAP=1024, uppercase hex, newest-right.                                                                                                      |
| `www/main.js`                                   | wireKeyboard wiring after wireChrome (TDZ-safe); Settings controls; TX observer registration | VERIFIED | 269 lines. wireKeyboard called at line 169-175 after sampleBell/drainHostReply defined. Settings wiring lines 182-234. `window.__testGridView` harness at line 60-64.                                                             |
| `www/renderer/chrome.js`                        | mousedown preventDefault on theme button + 3 phosphor buttons                             | VERIFIED   | themeButton mousedown at line 70-72; phosphor button mousedown inside for-loop at line 82-84.                                                                                                                                   |
| `www/index.html`                                | Settings pane (#settings + checkbox + radios + reserved note); Debug TX strip + Reset TX | VERIFIED   | Settings pane at lines 242-262; Debug pane extended with TX strip + tx-reset at lines 279-281. CR radio has `checked` attr. CSS rules for `#settings` and `#tx-strip` at lines 167-220.                                         |
| `www/tests/input/keydown-arrows.spec.js`        | INPUT-02 — 5 arrow-key assertions                                                         | VERIFIED   | 5 tests: ArrowUp→1B 41, ArrowDown→1B 42, ArrowRight→1B 43, ArrowLeft→1B 44, concatenated-4-sequence. No fixme.                                                                                                                  |
| `www/tests/input/keydown-ctrl-letters.spec.js`  | INPUT-03 — Ctrl-letter + reserved-combo visibility                                        | VERIFIED   | 4 tests: Ctrl+KeyL, Ctrl+A/M/Z triple, Ctrl+[ → 0x1B, reserved-combos note contains "Ctrl+W, Ctrl+N, Ctrl+T are claimed by Chromium".                                                                                           |
| `www/tests/input/keydown-printable.spec.js`     | INPUT-01 — printable + shifted-digit                                                      | VERIFIED   | 4 tests: Shift+KeyA, KeyA, Shift+Digit1, Tab/BS/Esc triple.                                                                                                                                                                     |
| `www/tests/input/local-echo.spec.js`            | INPUT-04 — default OFF + toggle flip using `window.__testGridView`                        | VERIFIED   | 3 tests via grid-byte readback at cell (0,0).                                                                                                                                                                                   |
| `www/tests/input/crlf-override.spec.js`         | INPUT-05 — CR/LF/CRLF radio flip                                                          | VERIFIED   | 4 tests: CR default, LF, CRLF, radio exclusivity.                                                                                                                                                                               |
| `www/tests/input/focus-retention.spec.js`       | SC-5 focus half — every chrome control                                                    | VERIFIED   | 5 tests: theme, 3 phosphor, local-echo, 3 CR/LF radios, Reset TX. All assert `toBeFocused` after `.click()`.                                                                                                                   |
| `www/tests/input/tx-debug-strip.spec.js`        | SC-1 — placeholder + update + Reset TX                                                    | VERIFIED   | 3 tests: placeholder before keypress, arrow+reset cycle, 40-press stress ≤64 pairs newest-right.                                                                                                                                |
| `www/tests/input/ime-composition.spec.js`       | SC-5 IME half — synthetic CompositionEvent                                                | VERIFIED   | 3 tests via `dispatchEvent(new CompositionEvent(...))`. All passing; no fixme.                                                                                                                                                 |
| `crates/bestialitty-core/src/key.rs`            | Unchanged (D-13)                                                                          | VERIFIED   | `git log cec37fc..HEAD -- crates/` empty — no commits touched the core.                                                                                                                                                         |

### Key Link Verification

| From                                                | To                                                  | Via                                                     | Status | Details                                                                                                         |
| --------------------------------------------------- | --------------------------------------------------- | ------------------------------------------------------- | ------ | --------------------------------------------------------------------------------------------------------------- |
| keyboard.js                                         | encode_key_raw (pkg/bestialitty_core.js)            | `import { encode_key_raw }` + call in keydown & compositionend | WIRED  | keyboard.js:21 import; called at lines 156 (compositionend) and 179 (keydown).                                 |
| keyboard.js                                         | tx-sink.js                                          | `pushTxBytes(outBytes)` in forwardBytes                 | WIRED  | keyboard.js:22 import; called at line 197.                                                                      |
| keyboard.js                                         | term.feed (local-echo path)                         | `termRef.feed(outBytes)` when localEcho===true          | WIRED  | keyboard.js:203; followed by sampleBellFn + drainHostReplyFn + requestFrameFn (Phase 3 sequence, lines 204-206). |
| main.js                                             | keyboard.js                                         | `import { wireKeyboard, setLocalEcho, setCrlfMode }` + wireKeyboard call | WIRED | main.js:31 import; wireKeyboard call at line 169-175 (post sampleBell definition — TDZ-safe).              |
| main.js                                             | tx-sink.js                                          | `import { registerTxObserver, formatHexStrip, resetTx }` + observer registration | WIRED | main.js:32 import; registerTxObserver at line 220-223.                                                    |
| #local-echo checkbox                                | setLocalEcho                                        | change listener in main.js:182-184                      | WIRED  | change fires setLocalEcho(e.target.checked); mousedown preventDefault only (Rule 1 fix — no manual flip).      |
| input[name='crlf']                                  | setCrlfMode                                         | change listener in main.js:201-203                      | WIRED  | Plus mousedown handler with manual check + sibling clear + setCrlfMode (200-215).                               |
| pushTxBytes observer                                | #tx-strip                                           | `txStripEl.textContent = hex === '' ? PLACEHOLDER : hex` | WIRED  | Registered exactly once at main.js:220-223.                                                                      |
| #tx-reset                                           | resetTx                                             | click + mousedown listeners in main.js:228-234          | WIRED  | Both click (keyboard activation) and mousedown (mouse activation after preventDefault) call resetTx().         |
| chrome.js top-bar                                   | mousedown preventDefault                            | addEventListener('mousedown', e => e.preventDefault())  | WIRED  | themeButton (line 70-72), phosphor loop (line 82-84). 2 bindings + comment lines.                              |

### Data-Flow Trace (Level 4)

| Artifact                  | Data Variable      | Source                                                                     | Produces Real Data | Status    |
| ------------------------- | ------------------ | -------------------------------------------------------------------------- | ------------------ | --------- |
| #tx-strip (DOM)           | textContent        | `registerTxObserver` callback invoked on every `pushTxBytes` call          | Yes — real keys emit real hex | FLOWING   |
| #local-echo               | checked state      | Change listener propagates to keyboard.js module-scope `localEcho` flag    | Yes — toggles grid render behaviour via local-echo feed path | FLOWING   |
| CR/LF radios              | checked state      | Change listener propagates to keyboard.js `crlfMode` ('cr'/'lf'/'crlf')    | Yes — Enter byte sequence changes | FLOWING   |
| canvas grid (echo path)   | grid bytes         | `term.feed(outBytes)` in forwardBytes when localEcho===true                | Yes — `__testGridView` confirms 0x41 at cell 0,0 after Shift+KeyA when echo ON, unchanged when OFF | FLOWING   |
| TX ring                   | Uint8Array(1024)   | `pushTxBytes(bytes)` from keyboard.js after `encode_key_raw`               | Yes — arrow keys produce 2-byte ESC-letter pairs, Enter produces CR/LF per mode | FLOWING   |

### Behavioral Spot-Checks

| Behavior                                          | Command                                                                            | Result                                   | Status |
| ------------------------------------------------- | ---------------------------------------------------------------------------------- | ---------------------------------------- | ------ |
| Fast Playwright suite runs under 15s              | `cd www && npm run test:fast`                                                      | 15 passed / 3.0s                         | PASS   |
| Full input suite passes                           | `cd www && npx playwright test tests/input/ --project=chromium`                    | 31 passed / 3.7s / 0 failures            | PASS   |
| Phase 3 render suite still passes (no regression) | `cd www && npx playwright test tests/render/ --project=chromium`                   | 32 passed / 5.6s / 0 failures            | PASS   |
| No test.fixme remains in input/                   | `grep -c "test.fixme" www/tests/input/*.spec.js`                                   | 0 across all 8 files                     | PASS   |
| No Rust crate modifications since Phase 4 began  | `git log cec37fc..HEAD -- crates/`                                                 | empty output                             | PASS   |

### Requirements Coverage

| Requirement | Source Plan(s)                  | Description                                                                                                                  | Status     | Evidence                                                                                                           |
| ----------- | ------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- | ---------- | ------------------------------------------------------------------------------------------------------------------ |
| INPUT-01    | 04-01, 04-02, 04-04             | Standard PC keyboard maps to VT52 key codes (arrows, keypad, control keys)                                                   | SATISFIED  | `keydown-printable.spec.js` (4 tests) + keydown-arrows (5 tests). packKeyCode handles Arrow/Enter/Tab/BS/Esc/Numpad/Char. |
| INPUT-02    | 04-01, 04-02, 04-04             | Arrow keys transmit ESC A / ESC B / ESC C / ESC D                                                                            | SATISFIED  | `keydown-arrows.spec.js` all 5 tests green — exact byte assertions via `toHaveText('1B 41')` etc.                    |
| INPUT-03    | 04-01, 04-02, 04-03, 04-04      | Ctrl-key combinations transmit correct control bytes (0x00–0x1F); Ctrl-W/N/T browser-reserved note                           | SATISFIED  | `keydown-ctrl-letters.spec.js` 4 tests (A/L/M/Z + Ctrl+[) + reserved-note visibility. Note at index.html:260.       |
| INPUT-04    | 04-01, 04-02, 04-03, 04-04      | Local echo toggle, default off                                                                                               | SATISFIED  | `local-echo.spec.js` 3 tests verify default OFF + flip. DOM default unchecked (index.html:245); keyboard.js default false. |
| INPUT-05    | 04-01, 04-02, 04-03, 04-04      | CR / LF override toggle for edge-case MicroBeast software                                                                    | SATISFIED  | `crlf-override.spec.js` 4 tests covering CR/LF/CRLF + radio exclusivity.                                            |

No orphaned requirements — all Phase 4 requirement IDs declared in plan frontmatter are satisfied.

### Anti-Patterns Found

| File                                         | Line      | Pattern                                                                                                          | Severity | Impact                                                                                           |
| -------------------------------------------- | --------- | ---------------------------------------------------------------------------------------------------------------- | -------- | ------------------------------------------------------------------------------------------------ |
| www/tests/input/local-echo.spec.js           | 47, 61, 70, 78 | `page.waitForTimeout(50)` / `(80)` — wall-clock waits instead of conditional waits (REVIEW WR-04)               | Info     | Tests currently pass; CI-slowdown flakiness vector. REVIEW recommends `waitForFunction` instead. |
| www/input/keyboard.js                        | 45-49     | `CRLF_MODES` Uint8Array templates shared across ring + term.feed (REVIEW WR-01)                                  | Info     | No live bug today (wasm-bindgen copies on FFI). Defensive-coding concern only.                   |
| www/input/tx-sink.js                         | 63-65     | `notify()` has no try/catch — observer exception would propagate up through keydown handler (REVIEW WR-02)       | Info     | Latent; single observer today. Becomes more relevant when Phase 5 adds Web Serial observer.     |
| www/input/tx-sink.js                         | 25-34     | `pushTxBytes` calls `notify()` even when given empty Uint8Array (REVIEW WR-03)                                   | Info     | Defensive; current callers early-return on zero-length so no live impact.                       |
| www/main.js, index.html, 2 spec files        | multiple  | TX strip placeholder string duplicated across 4 files (REVIEW IN-01)                                             | Info     | Tests would catch copy drift; HTML↔JS could drift silently between reboot and first observer fire. |
| www/tests/input/tx-debug-strip.spec.js       | 40-42     | Last-64-bytes assertion uses `toBeLessThanOrEqual(64)` without lower bound (REVIEW IN-06)                        | Info     | Would pass if impl regressed to `formatHexStrip(1)`. Still PASS today.                          |
| www/tests/input/ime-composition.spec.js      | 70-71     | `.not.toContain('41')` is weaker than exact `.toBe(PLACEHOLDER)` (REVIEW IN-07)                                  | Info     | Tolerates unexpected bytes as long as 0x41 is absent. Still PASS today.                         |

No blockers. All 4 warnings and 7 infos from 04-REVIEW.md are non-blocking defensive-coding / test-quality concerns.

### Human Verification Required

Three items from VALIDATION.md §"Manual-Only Verifications" that Playwright cannot cover:

#### 1. Real IME composition (Japanese/Chinese/Korean hardware IME)

**Test:** Enable a Japanese IME (macOS Kotoeri / Linux fcitx5 / Windows Microsoft IME). Focus the terminal. Open the Debug pane. Click Reset TX. Type a short sequence, e.g. Japanese `konnichiha` → `こんにちは`, commit with Enter/Space.
**Expected:** (a) No bytes in the TX strip during intermediate composition. (b) After commit, TX strip shows bytes for the COMMITTED string exactly ONCE (for non-ASCII commits, the ASCII guard silently drops — strip stays unchanged). (c) For ASCII-only IMEs in passthrough: bytes appear once, correctly.
**Why human:** Playwright cannot drive a real OS-level IME; synthetic `CompositionEvent` dispatch in `ime-composition.spec.js` covers the listener logic but not OS-level IME integration. RESEARCH Open Question 1.

#### 2. AltGraph on non-US keyboard layout (INPUT-01 edge case)

**Test:** Switch to a non-US layout (German, French, Spanish, etc.). Focus the terminal. Clear TX. Type AltGraph-accessible characters (e.g. German `€` via AltGr+E, or French `@` via AltGr+à).
**Expected:** TX strip shows the correct ASCII bytes for the resulting characters (e.g. `@` → `40`). No spurious Ctrl- or Alt- sequences.
**Why human:** Playwright defaults to en-US locale; AltGraph is layout-dependent and requires a real locale switch. Record `n/a — US layout` if the author daily-drives US.

#### 3. Daily-driver feel (cross-SC, 5-minute session)

**Test:** Close Settings and Debug panes. Type freely for 5 minutes. Flip theme with `Ctrl+Alt+T` mid-session. Flip phosphor colour via top-bar buttons. Flip local-echo on mid-session, type, flip back off. Press F5 at some point. Never click outside the browser.
**Expected:** (a) No dropped keystrokes. (b) Focus never escapes the wrapper when you click top-bar/Settings controls. (c) `Ctrl+Alt+T` still flips theme. (d) `F5` still reloads the page (D-17 pass-through). (e) No console errors in DevTools.
**Why human:** Ergonomic cross-SC feel (key repeat latency, focus stickiness, no lag spikes) is not automatable.

### Gaps Summary

**No automated gaps.** Every must_have and every ROADMAP success criterion has at least one GREEN Playwright spec:

- SC-1 (TX debug view): `tx-debug-strip.spec.js` + every INPUT-* spec asserts exact bytes on `#tx-strip`.
- SC-2 (preventDefault + browser-reserved note): `keydown-ctrl-letters.spec.js` Ctrl+KeyL focus-retention check proves preventDefault ran; Settings-pane reserved-combo note visibility verified. Silent-drop on F1–F12 / Home / End / PgUp / PgDn / Del / Ins / Meta verified in keyboard.js:97-103 (D-17 switch cases return -1 before preventDefault).
- SC-3 (local-echo toggle): `local-echo.spec.js` 3 grid-readback tests.
- SC-4 (CR/LF override): `crlf-override.spec.js` 4 tests.
- SC-5 focus half: `focus-retention.spec.js` 5 tests covering every chrome control.
- SC-5 IME half: `ime-composition.spec.js` 3 synthetic-event tests + **human UAT** for real-IME OS integration (tracked above).

**Three human-verification items remain** — they were always intended to be manual-only per VALIDATION.md and are not gaps in the automated contract. Automated checks pass; goal achievement is contingent on the three manual UAT items landing before milestone close.

---

_Verified: 2026-04-22T23:00:00Z_
_Verifier: Claude (gsd-verifier)_
