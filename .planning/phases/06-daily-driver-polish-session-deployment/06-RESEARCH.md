# Phase 6: Daily-Driver Polish, Session & Deployment - Research

**Researched:** 2026-04-25
**Domain:** Browser daily-driver UX (scrollback navigation, canvas drag-select,
clipboard copy/paste, persistent prefs in localStorage, session-log Blob
download) + static-site deployment (GitHub Pages + MIT license + 24-hour soak).
**Confidence:** HIGH for browser APIs (Clipboard, WheelEvent, PointerEvent,
localStorage, Blob/URL, Permissions-Policy) — verified against MDN + Chromium
docs. HIGH for the GitHub Pages deploy shape (`actions/deploy-pages` v5 +
`upload-pages-artifact`, .nojekyll, no-custom-headers limitation).
HIGH for the Phase 1–5 integration surface (Rust scrollback ring, wasm
boundary façade, paste-pump, atlas.getInverted, [data-focused] CSS pattern).
MEDIUM for the soak-protocol memory measurement strategy
(`performance.memory` is non-standard but Chromium-supported; the new
`performance.measureUserAgentSpecificMemory` is the standards-track replacement
but requires cross-origin isolation that GitHub Pages cannot provide — soak
falls back to `performance.memory` as documented).

---

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

The 06-CONTEXT.md file locks **48 decisions** across four areas. They MUST
NOT be re-litigated by the planner. Excerpts of the binding ones (each marked
with the CONTEXT D-NN identifier):

**Scrollback navigation (D-01..D-15):**
- **D-01:** Scroll input model = wheel + Shift+PgUp/Shift+PgDn. Plain
  PgUp/PgDn pass through to remote.
- **D-02:** Mouse wheel = 3 lines/notch (`DOM_DELTA_LINE`); Shift+wheel =
  one page (24 lines); trackpad (`DOM_DELTA_PIXEL`) accumulates raw `deltaY`
  and emits a 3-line tick when the accumulator crosses ~30 px.
- **D-03:** Stick-to-bottom: viewport stays put while scrolled up; floating
  chip "↓ N new lines" near bottom-right; instant on first new line.
- **D-04:** Snap-to-bottom triggers (any of): chip click, Shift+End, any TX
  keypress, paste, MicroBeast reconnect, Settings 'Clear scrollback' click.
- **D-05:** Shift+Home jumps to top of scrollback.
- **D-06:** New Rust API `Terminal::snapshot_grid_at(row_offset: usize)` +
  thin wasm-bindgen wrapper, reusing `pack_buf` machinery; out-of-range
  clamps to `min(row_offset, scrollback_len)`.
- **D-07:** Snapshot cadence while scrolled up = on scroll-state change +
  on every `term.feed`.
- **D-08:** Repaint while scrolled up = paint all 24 rows ONCE on scroll-
  state change, then idle (skip dirty-row pipeline; rows are immutable).
- **D-09:** Cursor hidden entirely while scrolled up (re-shows on snap-to-
  bottom; blink state paused, not destroyed).
- **D-10:** BEL while scrolled up = title prefix only, no viewport flash.
- **D-11:** Wheel-while-paste = wheel scrolls viewport; paste continues
  uninterrupted; Esc still cancels paste, wheel does not.
- **D-12:** Wheel over chrome panes (#settings, #debug, #connection) =
  scrolls pane content, never scrollback (listener attached to
  `#terminal-wrapper`, not document).
- **D-13:** Theme/phosphor/font-zoom toggles while scrolled up keep the row
  offset; re-paint with new style; uses existing `markAllRowsDirty()`.
- **D-14:** No scrollback persistence across reload.
- **D-15:** Settings 'Clear scrollback' button calls
  `term.resize_scrollback(0)` then back to `10_000`. No keyboard shortcut.

**Selection / copy / paste / clear-screen (D-16..D-26):**
- **D-16:** Selection model = drag-select line-wrapped + double-click word
  + triple-click line.
- **D-17:** Selection works across live grid + scrollback; endpoints stored
  as `(scrollback_row_offset_from_live_tail, col)` pairs (stable identifiers).
- **D-18:** Drag past top edge auto-scrolls viewport up at ~3 lines/sec;
  drag past bottom while at live tail = no-op; drag past bottom while
  scrolled up scrolls forward.
- **D-19:** Selection clears on any post-drag scroll, theme/phosphor/zoom
  toggle, focus loss, successful copy. Esc cancels in-flight drag.
- **D-20:** Selection rendering = inverted glyphs via Phase 3
  `atlas.getInverted()`. Zero new render code.
- **D-21:** Copy = **Ctrl+Shift+C**; **Ctrl+C always sends 0x03**.
- **D-22:** Paste = **Ctrl+Shift+V**; **Ctrl+V always sends 0x16 (SYN)**.
- **D-23:** Copy format = plain text, trailing whitespace trimmed per line,
  `\n` line endings; no trailing `\n` on single-line selection.
- **D-24:** Paste preprocessing = clipboard text → bytes → strip 0x00..0x1F
  except 0x09 / 0x0A / 0x0D → apply Phase 4 CR/LF rewrite (`crlfMode`) →
  enqueue. Reuses `CRLF_MODES` already exported by `keyboard.js` / re-exported
  by `paste-pump.js`.
- **D-25:** Large-paste warn at `bytes >= 4096` — inline confirm chip in
  the paste-progress region: `About to paste 100,234 B (~52 s at 19200
  baud). [Cancel] [Paste]`.
- **D-26:** Top-bar 'Clear' button calls a NEW Rust API
  `Terminal::clear_visible()` (NOT feeding a fake `\x1b\x4a` — the parser
  state machine never sees a synthetic escape). Shift+click also clears
  scrollback (`resize_scrollback(0)` + back to 10000).

**Session log (D-27..D-31):**
- **D-27:** Raw bytes only, `.bin` extension; no timestamps, no framing.
- **D-28:** RX only; TX is NOT logged.
- **D-29:** Per-connection: new buffer on each Connect; prior log discarded
  (after the user has had the chance to download it).
- **D-30:** Buffer = growable JS-side `Uint8Array[]` chunks pushed by
  reference (no copy), plus total-bytes counter; Blob assembled at
  download time.
- **D-31:** Connection-pane button 'Download log'; filename
  `bestialitty-{YYYYMMDD-HHMMSS}.bin` where the timestamp is the
  connect-time UTC stamp.

**Preferences & first-open (D-32..D-36):**
- **D-32:** Single key `bestialitty.prefs` with versioned JSON blob
  (schema in CONTEXT — `version: 1`, `theme`, `phosphor`, `fontZoom`,
  `serial { baud, dataBits, stopBits, parity, flowControl }`,
  `localEcho`, `crlfMode`, `autoConnect`). `bestialitty.port.preset`
  (Phase 5 D-31) stays separate.
- **D-33:** `savePrefs` debounced 250 ms; flush immediately on
  `beforeunload`.
- **D-34:** Auto-connect-on-load: off by default; toggle in Settings;
  silent `port.open()` if `prefs.autoConnect && getPorts() finds match`.
- **D-35:** Reset prefs UX = Settings button + inline 2-click confirm
  ("Click again to confirm (3 s)") with timeout. No page reload —
  defaults re-applied in-place.
- **D-36:** First-open defaults = theme=crt, phosphor=green, fontZoom=1,
  serial=MicroBeast preset (19200 8N1 none none), localEcho=false,
  crlfMode=cr, autoConnect=false.

**Deployment & license (D-37..D-39):**
- **D-37:** Deploy target = GitHub Pages via
  `.github/workflows/pages.yml`. On push to main: run
  `scripts/build.sh`, publish `www/`. gh-pages branch vs `/docs`
  folder is planner's call.
- **D-38:** License = MIT. Single `LICENSE` at repo root.
- **D-39:** CSP / Permissions-Policy = deferred to deployment config,
  NOT app code. `www/_headers` written for hosting platforms that
  honor it (Cloudflare Pages, Netlify); GitHub Pages does NOT support
  custom headers — fallback documented in README.

**Soak protocol (D-40):**
- **D-40:** 24-hour soak on real MicroBeast emitting ~1 line/sec; sample
  `performance.memory` + `wasm.memory.buffer.byteLength` every 60 s; pass
  = byteLength stable within ±10% of initial after first 10 minutes.

### Claude's Discretion

Verbatim from CONTEXT.md (planner makes these calls):

- Exact CSS of the floating "N new lines" chip (border-radius,
  drop-shadow vs phosphor-glow, animation on appear/disappear).
- Exact pixel threshold for trackpad deltaY accumulator (~30 px is
  ballpark; planner picks final value based on testing on a real trackpad).
- Whether the floating chip uses `pointer-events: none` while invisible
  (probably yes).
- Wheel listener attachment point (`#terminal-wrapper` vs `<canvas>` vs
  `document` with target check).
- Exact word-boundary regex for double-click (`/\S+/` is the obvious call).
- Whether to pre-allocate `chunks: Uint8Array[]` array in session-log
  (probably no — push-on-demand is fine for v1 chunk volume).
- Settings-pane DOM order for new rows (Reset prefs / Clear scrollback /
  Auto connect).
- Exact timestamp format in download filename
  (`YYYYMMDD-HHMMSS` vs `YYYY-MM-DDTHH-MM-SS`).
- gh-pages branch vs `/docs` folder for GitHub Pages deploy.
- Soak script content on the MicroBeast (BASIC `for i = 0 to 1e9 :
  print i : next` is acceptable).

### Deferred Ideas (OUT OF SCOPE)

Verbatim from CONTEXT.md:

- Search-in-scrollback (Ctrl+F) — defer to v2.
- Asciinema `.cast` log export — `.bin` only in v1.
- TX (typed bytes / paste bytes) logging — RX only in v1.
- Cross-tab `BroadcastChannel` log sharing.
- Settings export/import (JSON) — `v2-SESS-01`.
- Audible bell — `v2-AUDIO-01`.
- Right-click context menu paste — Ctrl+Shift+V suffices.
- Per-connection log retention beyond current connection.
- DTR/RTS user toggles — still deferred (Phase 5 already deferred).
- Send Break button — `v2-XPORT-01`.
- Configurable keymap remap.
- User-tunable scrollback cap UI (10K hardcoded).
- Toast / banner notification primitive — inline confirms suffice.
- Word-boundary regex in Settings (`\S+` ships hardcoded).
- Custom CSP / Permissions-Policy in app code — D-39 defers to hosting.

</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| SESS-01 | Scrollback retains N lines for review | Phase 1 already ships 10_000-line `Scrollback` ring — Phase 6 only adds offset accessor (`snapshot_grid_at(row_offset)`) + JS scroll-state module + chip UI. Memory math: 10_000 × 80 × 8 bytes = 6.4 MB (well within budget). |
| SESS-02 | Select & copy text from screen to clipboard | Pointer-event drag-select + `atlas.getInverted` reuse + `navigator.clipboard.writeText` (no user-gesture friction in Chromium). See §"Standard Stack" Clipboard API row + §"Pattern 2 (Selection)". |
| SESS-03 | Paste clipboard into serial stream (rate-limited) | `navigator.clipboard.readText` → CR/LF rewrite → strip non-printable → `pastePump.enqueuePaste(bytes)`. Phase 5 paste-pump already implements rate limiting (D-13 90% baud). |
| SESS-04 | Session logging captures stream to file | Append `Uint8Array` chunks by reference into JS-side array; at download time `new Blob(chunks, { type: 'application/octet-stream' })` + synthetic anchor click. Memory cost = RX volume (no copying). |
| SESS-05 | Mid-session "download current log" without disconnect | Same Blob assembly; the read loop continues appending; no connection-state mutation. Validated by Playwright: simulate 5 chunks, click download, simulate 3 more chunks, click download again — second blob includes the first 5 (all chunks). |
| SESS-06 | Local Clear-screen button (distinct from remote ESC J) | New Rust `Terminal::clear_visible()` API — clears every visible cell + marks all rows dirty + does NOT touch scrollback or parser state. Shift+click extends to scrollback via existing `resize_scrollback(0)`. |
| PREF-01 | Theme/phosphor/font/serial config persist | `loadPrefs()` reads `bestialitty.prefs` JSON on boot; `savePrefs()` debounced 250 ms; subscribers wire each pref onto its respective Phase 3/5 setter. Schema: see §Pattern 5 (Prefs). |
| PREF-02 | Local echo + CR/LF override persist | Same prefs blob; `localEcho` + `crlfMode` keys; setter is the existing Phase 4 `setLocalEcho` / `setCrlfMode`. |
| PLAT-03 | Static site self-hosted (GitHub Pages / Cloudflare / own domain) | `actions/deploy-pages@v5` + `actions/upload-pages-artifact@v3` workflow on push-to-main; `scripts/build.sh` produces `www/pkg/`; `.nojekyll` disables Jekyll; wasm MIME type is auto-set to `application/wasm` by GitHub Pages (verified — see §Sources). |
| PLAT-04 | Public repo under MIT or Apache-2.0 | MIT chosen (D-38). Single `LICENSE` at repo root; `2026 © <author>` line; SPDX identifier `MIT`. No NOTICE file required (Apache-2.0 convention only). |
| PLAT-05 | First-open sane defaults — MicroBeast preset, one-click connect | First-load with no `bestialitty.prefs` key applies D-36 defaults; Phase 5 already pre-fills Connection-pane form with MicroBeast preset (D-08); user clicks Connect once. Subsequent visits restore via `getPorts()` + identity match (Phase 5 D-05). |

</phase_requirements>

## Project Constraints (from CLAUDE.md)

The CLAUDE.md file at repo root locks these directives. The planner MUST
verify compliance for every Phase 6 task:

- **Rust core stays pure logic.** New `Terminal::snapshot_grid_at(row_offset)`
  and `Terminal::clear_visible()` MUST live in `crates/bestialitty-core/src/`
  with **zero** `web-sys` / `js-sys::Serial*` / DOM / I/O dependencies. The
  existing `tests/core_02_no_browser_deps.rs` `FORBIDDEN_TOKENS_WITH_EXEMPTIONS`
  audit will fail the build if the rule slips.
- **JS shell owns everything browser-facing.** Selection state, clipboard
  calls, localStorage I/O, Blob assembly, Permissions-Policy meta-tag
  emission — all JS-side. No Rust code touches these.
- **Rust↔JS interop continues to use `wasm-bindgen` + `wasm-pack` (target
  `web`).** New façade methods follow the one-line forwarder pattern
  established in Phase 2 D-06/D-20 (every wasm_bindgen attribute lives in
  `crates/bestialitty-core/src/lib.rs` ONLY).
- **Web Serial driven from JS, not Rust.** Phase 6 does not touch this rule;
  the auto-connect path in `prefs.js` calls Phase 5 `connectMicroBeast()`.
- **Chromium-only.** Polite-fail check (Phase 5) stays at the top of
  `main.js`; Phase 6 does not need to add browser checks beyond what's there.
- **Static site deploy only.** GitHub Pages workflow runs on push to main;
  no server runtime in v1. `_headers` file is best-effort
  (Cloudflare/Netlify honor it; GitHub Pages does not — fallback is a CSP
  meta-tag and documented limitation in README).
- **VT52 pragmatic subset.** Phase 6 does not extend the parser. The
  `clear_visible()` API mutates terminal state directly without reaching
  the parser, by design (D-26 — "remote state machine never sees a fake escape").
- **GSD per-phase loop:** discuss → plan → execute → verify. This research
  feeds the plan-phase agent.
- **Memory rule (from MEMORY.md):** No AI attribution in commit messages —
  never add `Co-Authored-By: Claude` or mention Anthropic.

## Summary

Phase 6 turns the working terminal (Phases 1–5) into a daily driver. The
work decomposes into **five tightly-scoped subsystems** — each grounded in
existing Phase 1–5 patterns and each verifiable end-to-end with a small
test surface:

1. **Scrollback UI** on top of the existing 10K-line Rust ring. New
   accessor `snapshot_grid_at(row_offset)` reuses `pack_buf`. JS-side
   `scroll-state.js` owns offset + wheel/key listeners. Canvas branches
   on `isScrolledBack`. The "stay where the user is + floating chip"
   posture is the daily-driver crux — pulling the viewport back when new
   lines arrive defeats scrollback's purpose.
2. **Selection + clipboard** with pointer-event drag-select rendering as
   inverted glyphs through the existing `atlas.getInverted` path.
   Ctrl+Shift+C / Ctrl+Shift+V keep Phase 4's plain Ctrl+C / Ctrl+V
   semantics intact (sacred for terminal use). Paste preprocesses CR/LF
   per Phase 4 mode + strips non-printable, then feeds Phase 5
   `paste-pump.enqueuePaste(bytes)`.
3. **Session log** as a JS-side array of `Uint8Array` chunks pushed by
   reference from the read loop's post-feed point. Download via
   `new Blob(chunks, { type: 'application/octet-stream' })` + synthetic
   anchor click. RX-only, per-connection.
4. **Preferences** as a single versioned JSON blob in
   `localStorage['bestialitty.prefs']` with debounced `savePrefs` (250
   ms) + `beforeunload` flush. Distinct from Phase 5's
   `bestialitty.port.preset` (identity vs config separation). Auto-
   connect path uses Phase 5's `getPorts()` match + silent `port.open()`.
5. **Deployment** via `actions/deploy-pages@v5` + `actions/upload-pages-
   artifact@v3` on push-to-main, MIT license, `.nojekyll`, `www/_headers`
   for hosts that honor it (GitHub Pages does NOT — fallback is a CSP
   meta-tag and documented in README). 24-hour soak on real MicroBeast
   validates daily-driver endurance.

**Primary recommendation:** Build the **scroll-state module first**
(touches Rust core + canvas branching) — it's the highest-risk
cross-layer surface, and getting it wrong forces a rewrite. Then layer
selection + clipboard on top (pointer events + clipboard API are
well-understood, Phase 3 atlas already provides the rendering primitive).
Session log + prefs are independent leaf modules. Deploy + license land
last (cosmetic, no architecture risk).

## Architectural Responsibility Map

Each Phase 6 capability sits in exactly one architectural tier owner.
Boundary violations from previous phases are forbidden by CLAUDE.md and
the existing `core_02_no_browser_deps.rs` audit.

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|--------------|----------------|-----------|
| Scrollback offset window | Rust core | JS shell (call site) | Pure-logic accessor reusing `pack_buf` machinery; offset math is data, not I/O. |
| `clear_visible()` | Rust core | JS shell (call site) | Mutates grid + dirty bitmap without parser; pure-logic in scope. |
| Scroll-state machine (`offset`, `isScrolledBack`, indicator counter) | JS shell | — | DOM events (wheel, keydown), DOM mutation (`[data-scrolled-back]` attr, chip visibility). Browser-only. |
| Wheel-event normalization (line vs pixel) | JS shell | — | Browser-/platform-specific behavior; no terminal logic involved. |
| Selection state (anchor/focus pairs in `(row_offset, col)` space) | JS shell | — | Pure-JS state machine; reads grid via existing `snapshot_grid_at` accessor. |
| Selection rendering (inverted overlay) | JS shell | Atlas (helper) | Reuses Phase 3 `atlas.getInverted()` zero new render code. |
| Clipboard reads/writes | JS shell | — | `navigator.clipboard.*` is browser-side; no Rust surface. |
| Paste preprocessing (CR/LF rewrite + strip) | JS shell | Rust core (CRLF table is JS-side already, exported from `keyboard.js`) | TX-side rewrite stays JS per Phase 4 D-13. |
| Session log buffer (chunks) | JS shell | — | Holding RX bytes; not parser state. JS owns growing memory. |
| Blob + download | JS shell | — | DOM + URL + anchor click; pure browser. |
| `bestialitty.prefs` localStorage | JS shell | — | localStorage is a browser API. Migration handler runs in JS. |
| Auto-connect path | JS shell | Phase 5 transport (call site) | `getPorts()` match + silent `port.open()` is Phase 5's `connectMicroBeast()` invoked silently. |
| GitHub Pages workflow | CI / Build | — | Outside both tiers; YAML in `.github/workflows/`. |
| MIT LICENSE file | Repo metadata | — | Filesystem artifact; no code. |
| 24-hour soak measurement | JS shell (sampler) + Human (review) | — | `performance.memory` + `wasm.memory.buffer.byteLength` sampling is browser-side; pass/fail review is human. |

## Standard Stack

### Core (already present in repo — no new dependencies)

| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| `wasm-bindgen` (existing) | 0.2.x | Façade for `snapshot_grid_at` + `clear_visible` | Existing toolchain. New methods follow the same one-line forwarder pattern from Phase 2. |
| `wasm-pack` (existing) | 0.12.1 | Build wasm module | Existing; pinned by `scripts/smoke-wasm-build.sh`. |
| `@playwright/test` (existing) | ^1.51 (1.59.1 latest verified via `npm view`) | Phase 6 test suite under `www/tests/session/` | Existing infrastructure; new directory mirrors `www/tests/transport/`. |

**Key insight:** Phase 6 is a **zero-new-dependency** phase on the
runtime side. Every browser API used (Clipboard, WheelEvent, PointerEvent,
localStorage, Blob, URL.createObjectURL) is native to Chromium 89+
[VERIFIED: MDN compatibility tables]. The CI side adds two GitHub Actions:
`actions/deploy-pages@v5` and `actions/upload-pages-artifact@v3`.

### Supporting (browser APIs — built-in, no install)

| API | Use | When |
|-----|-----|------|
| `navigator.clipboard.writeText(text)` | Copy | Ctrl+Shift+C — no user-gesture friction in Chromium [VERIFIED: web.dev async-clipboard, MDN]. |
| `navigator.clipboard.readText()` | Paste | Ctrl+Shift+V — Chromium requires either a user gesture (transient activation, which a keydown event provides) OR persistent `clipboard-read` permission. The keydown counts as transient activation; no permission prompt expected. |
| `WheelEvent` | Scroll input | Detect `deltaMode` to disambiguate mouse line-scroll vs trackpad pixel-scroll [VERIFIED: MDN, Bugzilla 970141]. |
| `PointerEvent` + `setPointerCapture` | Drag-select | Continues receiving pointer events even when pointer leaves the canvas, which is the auto-scroll trigger D-18 needs [VERIFIED: MDN]. |
| `localStorage` | Prefs persistence | ~5 MB quota in Chromium per origin [VERIFIED: MDN Storage_quotas; quota varies but 5 MiB is the documented floor]. |
| `Blob` + `URL.createObjectURL` | Log download | Standard download trick: `<a href={blobURL} download={filename}>`.click() [VERIFIED: MDN]. |
| `performance.memory` | Soak measurement | Non-standard, Chromium-only, returns `{ jsHeapSizeLimit, totalJSHeapSize, usedJSHeapSize }` [VERIFIED: MDN — explicitly marked deprecated/non-standard but Chromium continues to ship it]. |
| `wasm.memory.buffer.byteLength` | Soak measurement | Standard `WebAssembly.Memory` accessor — primary signal because the JS heap can grow for unrelated reasons. |
| `document.execCommand('copy')` | NOT used | Deprecated; the async Clipboard API is the v1 path. |

### Alternatives Considered

| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| `actions/deploy-pages@v5` | `peaceiris/actions-gh-pages@v3` | `peaceiris` predates GitHub's official Pages Action; works fine but is a third-party dep, requires `GITHUB_TOKEN` push to gh-pages branch (artifact workflow is cleaner). Stick with official. |
| Single localStorage blob | Multiple localStorage keys | Multiple keys = multiple `setItem` calls, harder to migrate atomically. CONTEXT D-32 locks single blob. |
| `IndexedDB` for log buffer | In-memory `Uint8Array[]` | IndexedDB is overkill — log is per-connection, dies on disconnect. CONTEXT D-30 locks in-memory chunks. |
| `performance.measureUserAgentSpecificMemory()` | `performance.memory` | The standards-track replacement requires cross-origin isolation (`Cross-Origin-Opener-Policy: same-origin` + `Cross-Origin-Embedder-Policy: require-corp` headers). GitHub Pages does NOT support custom headers — so the replacement API is unusable on the deploy target. Fallback to `performance.memory` (Chromium-only, non-standard, but works). |
| `BroadcastChannel` cross-tab log | Single-tab ownership | CONTEXT bans cross-tab; out of scope. |

**Installation (CI side):**

```yaml
# .github/workflows/pages.yml — uses official actions, no install step
uses: actions/checkout@v4
uses: actions/configure-pages@v5
uses: actions/upload-pages-artifact@v3
uses: actions/deploy-pages@v5
```

**Version verification (2026-04-25):**
- `actions/deploy-pages` v5.0.0 (released 2026-03-25) [VERIFIED: github.com/actions/deploy-pages]
- `actions/upload-pages-artifact` v3 (active) [VERIFIED: github.com/actions/upload-pages-artifact]
- `actions/configure-pages` v5 (latest) [CITED: github.com/actions/configure-pages]
- `@playwright/test` 1.59.1 latest npm; project pins `^1.51.0` which is acceptable [VERIFIED: `npm view @playwright/test version`]

## Architecture Patterns

### System Architecture Diagram

```
                            ┌──────────────────────────┐
                            │  Real MicroBeast (USB)   │
                            └────────────┬─────────────┘
                                         │ RX bytes
                                         ▼
              ┌────────────────────────────────────────────────────┐
              │  www/transport/serial.js (Phase 5 — UNCHANGED API) │
              │  Read loop:                                         │
              │    term.feed(value)                                 │
              │    sampleBell()                                     │
              │    drainHostReply('serial')                         │
              │    requestFrame()                                   │
              │    sessionLog.append(value)   ← NEW Phase 6         │
              └─────────────────┬──────────────────────────────────┘
                                │
                  ┌─────────────┴─────────────────────────────┐
                  ▼                                            ▼
   ┌──────────────────────────────┐         ┌─────────────────────────────┐
   │ Rust core (Phase 1–2)         │        │ www/transport/session-log.js │
   │ - Terminal::feed_silent       │        │ (NEW Phase 6 — D-30/31)       │
   │ - Terminal::snapshot_grid     │        │ chunks: Uint8Array[]          │
   │ - Terminal::snapshot_grid_at  │ NEW    │ totalBytes: number            │
   │ - Terminal::clear_visible     │ NEW    │ append(value), download(),    │
   │ - Scrollback ring (10K lines) │        │ reset() on Connect            │
   └─────────────┬─────────────────┘        └────────────┬──────────────────┘
                 │                                       │
                 ▼                                       ▼
                 │                            User clicks "Download log"
                 │                            → Blob([chunks]) + anchor click
                 │
                 ▼
   ┌────────────────────────────────────────────────────────┐
   │ www/renderer/canvas.js (extended — D-07/08/09/13)       │
   │ tick():                                                  │
   │   if (scrollState.isScrolledBack) {                      │
   │     term.snapshot_grid_at(scrollState.offset)            │
   │     paint 24 rows once (skip dirty pipeline)             │
   │     skip cursor paint (D-09)                             │
   │     selection overlay via atlas.getInverted (D-20)       │
   │   } else {                                               │
   │     term.snapshot_grid()  ← Phase 3 path unchanged       │
   │     dirty-row repaint (Phase 3)                          │
   │     cursor paint (Phase 3)                               │
   │   }                                                      │
   └────────────────────────────────────────────────────────┘
                 ▲                                       ▲
                 │ scrollState.offset                    │ selection range
                 │                                       │
   ┌─────────────┴───────────────┐         ┌─────────────┴───────────────────┐
   │ www/renderer/scroll-state.js │        │ www/input/selection.js (NEW)     │
   │ (NEW Phase 6)                │        │ pointerdown/move/up state machine│
   │ wheel + key listeners        │        │ word/line double/triple-click    │
   │ trackpad accumulator         │        │ drag-past-edge → scrollState     │
   │ snap-to-bottom triggers      │        │ Esc cancels, focus-loss clears   │
   │ "↓ N new lines" chip         │        │ store as (row_offset, col) pairs │
   └──────────────────────────────┘        └─────────────────────────────────┘
                                                       ▲
                                                       │
                                          ┌────────────┴──────────────────┐
                                          │ www/input/clipboard.js (NEW)  │
                                          │ copySelection() →             │
                                          │   navigator.clipboard.writeText│
                                          │ pasteFromClipboard() →        │
                                          │   navigator.clipboard.readText│
                                          │   → CR/LF rewrite             │
                                          │   → strip non-printable       │
                                          │   → enqueuePaste(bytes)       │
                                          │ large-paste confirm chip ≥4096│
                                          └────────────┬──────────────────┘
                                                       │
                                                       ▼
                                  ┌────────────────────────────────────┐
                                  │ www/input/paste-pump.js (Phase 5)  │
                                  │ enqueuePaste / cancelPaste         │
                                  │ (UNCHANGED API — Phase 6 calls it) │
                                  └────────────────────────────────────┘

                  ┌────────────────────────────────────────────────────┐
                  │ www/input/keyboard.js (Phase 4) — NEW INTERCEPTS:  │
                  │ Ctrl+Shift+C → clipboard.copySelection()           │
                  │ Ctrl+Shift+V → clipboard.pasteFromClipboard()       │
                  │ Shift+End/Home/PgUp/PgDn → scrollState methods      │
                  │ Plain Ctrl+C / Ctrl+V / End / Home / PgUp / PgDn    │
                  │   UNCHANGED — pass through to encoder (Phase 4 D-21)│
                  └────────────────────────────────────────────────────┘

                                                       ▲
   ┌──────────────────────────────────────────────────┴─────┐
   │ www/state/prefs.js (NEW Phase 6 — D-32..D-36)            │
   │ loadPrefs() → JSON parse + version migration             │
   │ savePrefs(partial) → debounced 250 ms merge + persist    │
   │ resetPrefs() → clear + reload defaults in-place          │
   │ subscribe(fn) → notify on change                          │
   │ schema: { version, theme, phosphor, fontZoom, serial,    │
   │           localEcho, crlfMode, autoConnect }              │
   │ key: 'bestialitty.prefs'                                 │
   │ DISTINCT FROM 'bestialitty.port.preset' (Phase 5 D-31)   │
   └──────────────────────────────────────────────────────────┘

                                                                ▲
   ┌──────────────────────────────────────────────────────────┴───┐
   │ www/main.js (boot order — extended Phase 6)                  │
   │ 1. polite-fail check (Phase 5 — UNCHANGED)                    │
   │ 2. loadPrefs()    ← NEW: must precede chrome/keyboard/serial  │
   │ 3. wasm init() + new Terminal(...)                            │
   │ 4. wireChrome({ prefs, ... })                                 │
   │ 5. wireKeyboard({ prefs, ... })                               │
   │ 6. wireScrollState({ term, canvas, prefs, ... })  ← NEW       │
   │ 7. wireSelection({ canvas, scrollState, ... })    ← NEW       │
   │ 8. wireSessionLog({ ... })                        ← NEW       │
   │ 9. wireSerial({ term, prefs, sessionLog, ... })               │
   │ 10. wirePrefs({ savePrefs })  ← installs subscribers          │
   │ 11. if prefs.autoConnect && getPorts() match →                │
   │      silent connectMicroBeast()                               │
   └──────────────────────────────────────────────────────────────┘

           Repo metadata (Phase 6 deploy)
           ┌────────────────────────────┐
           │ LICENSE              MIT    │
           │ .nojekyll            (empty)│
           │ www/_headers         (CDN)  │  ← Cloudflare/Netlify only;
           │ .github/workflows/   pages  │     GitHub Pages ignores.
           │   pages.yml                 │
           └─────────────┬───────────────┘
                         │ on push to main
                         ▼
           ┌─────────────────────────────────────────────┐
           │ scripts/build.sh (Phase 2 — UNCHANGED)      │
           │ wasm-pack build crates/bestialitty-core      │
           │   --target web --out-dir ../../www/pkg       │
           └────────┬────────────────────────────────────┘
                    │
                    ▼
           ┌─────────────────────────────────────────────┐
           │ actions/upload-pages-artifact@v3            │
           │   path: ./www                                │
           │ actions/deploy-pages@v5                     │
           │ → https://<user>.github.io/bestialitty/      │
           └─────────────────────────────────────────────┘
```

### Recommended Project Structure

```
crates/bestialitty-core/src/
├── scrollback.rs       # Phase 1 ring — Phase 6 adds row_at(offset) accessor
├── terminal.rs         # Phase 1/2 — Phase 6 adds snapshot_grid_at + clear_visible
├── lib.rs              # Phase 2 façade — Phase 6 adds 2 new wasm forwards
└── (other modules unchanged)

www/
├── main.js                  # boot — adds loadPrefs, wireScrollState/Selection/SessionLog/Prefs
├── index.html               # adds Clear button, Settings rows, Connection 'Download log', chip element
├── input/
│   ├── keyboard.js          # adds Ctrl+Shift+C/V + Shift+End/Home/PgUp/PgDn intercepts
│   ├── selection.js         # NEW — pointer drag-select state machine
│   ├── clipboard.js         # NEW — copy/paste adapter
│   ├── paste-pump.js        # Phase 5 — Phase 6 calls API unchanged
│   └── tx-sink.js           # Phase 4 — UNCHANGED
├── renderer/
│   ├── canvas.js            # branches on scrollState.isScrolledBack
│   ├── chrome.js            # adds Settings rows + Clear top-bar button + visibilitychange catch-up exists
│   ├── atlas.js             # UNCHANGED (selection reuses getInverted)
│   ├── scroll-state.js      # NEW — offset + wheel/key + chip controller
│   ├── themes.js            # UNCHANGED (prefs read theme tokens)
│   └── bitmap-font.js       # UNCHANGED
├── transport/
│   ├── serial.js            # Phase 5 — Phase 6 adds 1 line: sessionLog.append(value)
│   └── session-log.js       # NEW — chunks + Blob download
├── state/
│   └── prefs.js             # NEW — bestialitty.prefs versioned blob
└── tests/
    ├── render/              # Phase 3 — unchanged
    ├── input/               # Phase 4 — unchanged
    ├── transport/           # Phase 5 — unchanged
    └── session/             # NEW — Phase 6 spec suite
        ├── scrollback-nav.spec.js
        ├── selection-copy.spec.js
        ├── paste-from-clipboard.spec.js
        ├── clear-screen.spec.js
        ├── session-log.spec.js
        ├── prefs-persistence.spec.js
        └── soak-sampler.spec.js  # smoke; full 24h is human UAT

# Repo metadata
LICENSE                       # NEW — MIT 2026
.nojekyll                     # NEW — empty file, prevents Jekyll
.github/workflows/pages.yml   # NEW — GitHub Action
www/_headers                  # NEW — best-effort for Cloudflare/Netlify
06-SOAK.md                    # NEW — 24h protocol document
06-HUMAN-UAT.md               # NEW — daily-driver checklist
```

### Pattern 1: Scroll-State Module (D-01..D-15)

**What:** Owns the scrollback offset and notifies the renderer + indicator
chip. Decouples wheel/key event handling from the canvas + the Rust core.

**When to use:** Single shared instance per page. All scroll input flows
through it; canvas reads its `offset` + `isScrolledBack` flags every tick.

**Module surface:**

```js
// www/renderer/scroll-state.js — NEW (Phase 6)
//
// State:
//   offset: 0 = live tail; > 0 = N rows back from live
//   isScrolledBack: offset > 0
//   newLinesSinceUserScrolled: ticks per term.feed-with-newlines while back
//   trackpadAccumulator: fractional deltaY
//
// Public API (mirrors wireX(opts) pattern from Phase 3/4/5):
export function wireScrollState(opts) {
  const { term, canvasWrapper, requestFrame, indicatorEl } = opts;
  // wheel listener on canvasWrapper (NOT document — D-12)
  // keydown listener on canvasWrapper for Shift+PgUp/PgDn/Home/End
  // ...
  return { offset, isScrolledBack, snapToBottom, jumpToTop, notifyFeed, dispose };
}

// Internal — wheel handler (D-02):
function onWheel(ev) {
  if (ev.deltaMode === WheelEvent.DOM_DELTA_LINE) {
    // Mouse — 3 lines per notch; Shift = 24 (one page)
    const lines = ev.shiftKey ? 24 * Math.sign(ev.deltaY) : 3 * Math.sign(ev.deltaY);
    scrollBy(-lines);   // up = +offset; down = -offset
  } else if (ev.deltaMode === WheelEvent.DOM_DELTA_PIXEL) {
    // Trackpad / hi-res mouse — accumulate raw deltaY
    trackpadAccumulator += ev.deltaY;
    while (Math.abs(trackpadAccumulator) >= 30) {
      const tickDir = Math.sign(trackpadAccumulator) > 0 ? -3 : 3;
      scrollBy(tickDir);
      trackpadAccumulator -= Math.sign(trackpadAccumulator) * 30;
    }
  }
  ev.preventDefault();   // claim the wheel; D-12 — chrome panes never see it
}
```

**Critical:** `deltaMode` discrimination is the daily-driver crux —
mouse-wheel events fire DOM_DELTA_LINE on Linux/Windows-default-settings,
DOM_DELTA_PIXEL on macOS-with-high-res-mouse and on most trackpads. The
accumulator handles trackpad smooth scroll without locking out smooth
feel; the line-mode branch is for old-school mouse wheels [VERIFIED:
Bugzilla 970141, MDN deltaMode].

### Pattern 2: Selection State Machine (D-16..D-19)

**What:** Pointer-event-driven drag-select with cell-coordinate math.

**When to use:** Single instance attached to the canvas/wrapper; lives
inside `www/input/selection.js`.

**Skeleton:**

```js
// www/input/selection.js — NEW (Phase 6)
import { setPointerCapture } from /* DOM */;

let anchor = null;   // { rowOffset, col }   — endpoint stored in scroll-tail-relative coords (D-17)
let focus  = null;   // { rowOffset, col }
let dragging = false;
let clickCount = 0;  // for double/triple-click (D-16)

function onPointerDown(ev) {
  if (ev.button !== 0) return;   // left button only
  ev.preventDefault();           // suppress text-selection
  canvas.setPointerCapture(ev.pointerId);
  dragging = true;
  // Convert (clientX, clientY) → (cellRow, cellCol) using cellW/cellH from canvas.js
  // Convert visible cellRow → scrollback-tail-relative rowOffset using scrollState.offset
  anchor = focus = pxToCell(ev.clientX, ev.clientY);
  // Triple-click = entire row; double-click = whitespace-bounded word
  if (clickCount === 2) selectLine(anchor.rowOffset);
  else if (clickCount === 1) selectWord(anchor);
}

function onPointerMove(ev) {
  if (!dragging) return;
  focus = pxToCell(ev.clientX, ev.clientY);
  // D-18 — drag-past-edge auto-scroll
  if (ev.clientY < canvasRect.top) scrollState.scrollBy(+1, /* lines */);
  if (ev.clientY > canvasRect.bottom && scrollState.isScrolledBack) scrollState.scrollBy(-1);
  notifySelectionChange();
  requestFrame();
}

function onPointerUp(ev) {
  dragging = false;
  // selection persists until next D-19 trigger
}
```

**Why setPointerCapture:** Without it, drag past the canvas edge sends
events to whatever is under the cursor (not the canvas) — breaks D-18
auto-scroll [VERIFIED: MDN setPointerCapture, blog.r0b.io drag pattern].

### Pattern 3: Clipboard Adapter (D-21..D-24)

**What:** Thin module turning selection → clipboard text and clipboard text
→ pump bytes.

**When to use:** Called from keyboard.js's Ctrl+Shift+C / Ctrl+Shift+V
intercepts.

**Code:**

```js
// www/input/clipboard.js — NEW (Phase 6)
import { enqueuePaste } from './paste-pump.js';
import { getCrlfMode, CRLF_MODES } from './keyboard.js';
import { getSelection } from './selection.js';

// D-21 / D-23 — Copy
export async function copySelection() {
  const sel = getSelection();   // returns null OR { rows: string[] } — already trimmed per line
  if (!sel || sel.rows.length === 0) return;   // empty-selection no-op (no clipboard write)
  const text = sel.rows.join('\n');             // \n line endings; no trailing \n on single line
  try {
    await navigator.clipboard.writeText(text);
    // D-19 — successful copy clears selection
    clearSelection();
  } catch (err) {
    // Permissions-Policy may block; rare in same-origin static site context
    console.warn('[clipboard] copy failed:', err);
  }
}

// D-22 / D-24 — Paste
export async function pasteFromClipboard() {
  let text;
  try {
    text = await navigator.clipboard.readText();   // keydown counts as transient activation
  } catch (err) {
    console.warn('[clipboard] read failed:', err);
    return;
  }
  // D-24 — encode as bytes (ASCII; high-bit kept as-is, user's responsibility)
  let bytes = new Uint8Array(text.length);
  let w = 0;
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i);
    // Strip 0x00-0x1F except CR (0x0D), LF (0x0A), Tab (0x09)
    if (c < 0x20 && c !== 0x0D && c !== 0x0A && c !== 0x09) continue;
    if (c > 0xFF) continue;   // Outside Latin-1; drop
    bytes[w++] = c;
  }
  bytes = bytes.subarray(0, w);
  // D-25 — large-paste confirm chip
  if (bytes.length >= 4096) {
    const ok = await showLargePasteConfirm(bytes.length);
    if (!ok) return;
  }
  // CR/LF rewrite happens INSIDE paste-pump.enqueuePaste (Phase 5 D-23) —
  // do NOT double-rewrite here.
  enqueuePaste(bytes);
}
```

**User-gesture note:** Chromium fires Clipboard.readText() in response to
a keydown event without a permission prompt — the keydown counts as
transient activation [VERIFIED: web.dev async-clipboard, MDN
Clipboard.readText]. The `clipboard-read` Permissions-Policy is allowed
by default for same-origin top-level frames; only iframes need explicit
allowlisting.

### Pattern 4: Session Log + Blob Download (D-27..D-31)

**What:** RX-only buffer + on-demand Blob assembly.

**Code:**

```js
// www/transport/session-log.js — NEW (Phase 6)
let chunks = [];
let totalBytes = 0;
let connectStartIso = null;

// D-29 — reset on each Connect
export function reset() {
  chunks = [];
  totalBytes = 0;
  connectStartIso = new Date().toISOString();
}

// D-30 — append by reference; no copy
export function append(uint8) {
  chunks.push(uint8);
  totalBytes += uint8.byteLength;
}

// D-31 — synthetic anchor click
export function download() {
  if (totalBytes === 0) return;
  // Blob constructor accepts Uint8Array[]; the Blob does an internal copy at
  // construction time. This is the single allocation the log incurs.
  const blob = new Blob(chunks, { type: 'application/octet-stream' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filenameFromConnectStart(connectStartIso);
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  // Defer revocation so the download has time to start (browser-specific)
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}

function filenameFromConnectStart(iso) {
  // D-31 — bestialitty-{YYYYMMDD-HHMMSS}.bin (UTC stamp from connect time)
  const d = new Date(iso);
  const pad = (n) => String(n).padStart(2, '0');
  const stamp = `${d.getUTCFullYear()}${pad(d.getUTCMonth()+1)}${pad(d.getUTCDate())}` +
                `-${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}${pad(d.getUTCSeconds())}`;
  return `bestialitty-${stamp}.bin`;
}
```

**Memory note:** A 24-h session at MicroBeast cadence (~1 line/sec ×
~60 bytes/line) generates ~5 MB raw — trivial. The Blob constructor
copies at assembly time, so peak memory during download = 2× raw size
briefly [VERIFIED: MDN Blob constructor; chunks array stays alive during
Blob construction]. Memory recovers when the URL is revoked + the Blob
is GC'd.

**revokeObjectURL pitfall:** Firefox bug 939510 documents that
`revokeObjectURL` after a download triggers does not always free memory
[CITED: Bugzilla 939510]. Chromium handles it correctly. The 5-second
delay before revocation is defensive across browsers — but since
BestialiTTY is Chromium-only (D-32), this is academic; the revoke is a
hygiene step only.

### Pattern 5: Versioned Prefs Blob (D-32..D-36)

**What:** Single localStorage key with JSON blob + migration handler.

**Code:**

```js
// www/state/prefs.js — NEW (Phase 6)
const STORAGE_KEY = 'bestialitty.prefs';
const CURRENT_VERSION = 1;

const DEFAULTS = Object.freeze({
  version: CURRENT_VERSION,
  theme: 'crt', phosphor: 'green', fontZoom: 1,
  serial: { baud: 19200, dataBits: 8, stopBits: 1, parity: 'none', flowControl: 'none' },
  localEcho: false, crlfMode: 'cr', autoConnect: false,
});

let cached = null;
let saveTimer = null;
const subscribers = [];

export function loadPrefs() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) { cached = structuredClone(DEFAULTS); return cached; }
    let parsed = JSON.parse(raw);
    // Migration — v1 is current; future versions add steps here
    if (typeof parsed.version !== 'number' || parsed.version > CURRENT_VERSION) {
      parsed = structuredClone(DEFAULTS);
    } else if (parsed.version < CURRENT_VERSION) {
      // Field-by-field upgrade — placeholder for future migrations
      parsed = { ...DEFAULTS, ...parsed, version: CURRENT_VERSION };
    }
    // Defensive merge — covers a missing key from a hand-edited blob
    cached = { ...DEFAULTS, ...parsed, serial: { ...DEFAULTS.serial, ...(parsed.serial || {}) } };
    return cached;
  } catch (err) {
    console.warn('[prefs] load failed; falling back to defaults', err);
    cached = structuredClone(DEFAULTS);
    return cached;
  }
}

export function savePrefs(partial) {
  cached = { ...cached, ...partial };
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(flushPrefs, 250);   // D-33 debounce
}

function flushPrefs() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(cached));
  } catch (err) {
    // QuotaExceededError handling [VERIFIED: MDN Storage_quotas]
    if (err.name === 'QuotaExceededError') {
      console.warn('[prefs] quota exceeded; cannot persist');
      // Best-effort: prefs work in-memory for the rest of the session
    }
  }
  saveTimer = null;
  for (const fn of subscribers) fn(cached);
}

// D-33 — flush immediately on beforeunload
window.addEventListener('beforeunload', () => {
  if (saveTimer) { clearTimeout(saveTimer); flushPrefs(); }
});

// D-35 — reset
export function resetPrefs() {
  cached = structuredClone(DEFAULTS);
  try { localStorage.removeItem(STORAGE_KEY); } catch {}
  for (const fn of subscribers) fn(cached);
}

export function subscribe(fn) {
  subscribers.push(fn);
  return () => {
    const i = subscribers.indexOf(fn);
    if (i >= 0) subscribers.splice(i, 1);
  };
}
```

**Why one blob:** atomic read on boot, atomic write on debounce flush, easy
versioning, no race between concurrent setItem calls. The Phase 5
`bestialitty.port.preset` key intentionally stays separate (CONTEXT D-32) —
identity vs config separation.

### Pattern 6: GitHub Pages Workflow (D-37)

**File:** `.github/workflows/pages.yml`

```yaml
name: Deploy to GitHub Pages

on:
  push:
    branches: [main]
  workflow_dispatch:

permissions:
  contents: read
  pages: write
  id-token: write

# Allow only one concurrent deployment
concurrency:
  group: pages
  cancel-in-progress: true

jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - uses: actions/configure-pages@v5

      - name: Install Rust toolchain
        uses: dtolnay/rust-toolchain@stable
        with:
          targets: wasm32-unknown-unknown

      - name: Install wasm-pack
        run: curl https://rustwasm.github.io/wasm-pack/installer/init.sh -sSf | sh

      - name: Build wasm
        run: ./scripts/build.sh

      - name: Add .nojekyll
        run: touch www/.nojekyll

      - uses: actions/upload-pages-artifact@v3
        with:
          path: ./www

  deploy:
    needs: build
    runs-on: ubuntu-latest
    environment:
      name: github-pages
      url: ${{ steps.deployment.outputs.page_url }}
    steps:
      - id: deployment
        uses: actions/deploy-pages@v5
```

**Why this shape:**
- `actions/configure-pages@v5` reads the repo's Pages settings + sets
  `PAGES_BASE_PATH` env var for downstream steps [CITED: github.com/actions/configure-pages]
- `actions/upload-pages-artifact@v3` packages the directory as a deploy
  artifact (this is the v3-or-later contract that the deprecation notice
  required as of January 2025) [VERIFIED: github.blog/changelog 2024-12-05]
- `actions/deploy-pages@v5` consumes the artifact + activates the deploy
- `.nojekyll` disables Jekyll processing — without this, Pages would
  attempt to build the site as a Jekyll site and would refuse to serve
  files starting with `_` (which `_headers` would be, if it existed)
  [VERIFIED: docs.github.com configuring-publishing-source]
- WASM MIME type: GitHub Pages serves `.wasm` files with
  `Content-Type: application/wasm` automatically — no configuration needed
  [CITED: latenode community thread on WASM serving on GH Pages; the
  modern expectation is that this works out of the box, with older
  reports of `text/html` MIME being the historical incorrect default]

### Anti-Patterns to Avoid

- **Don't auto-rerender the canvas every frame while scrolled up.** D-08
  is the explicit guard: paint 24 rows ONCE on scroll-state change, then
  idle. Otherwise CPU sits at full rAF rate painting unchanging history.
- **Don't allocate per-byte in the session log.** Push `Uint8Array`
  references; let the Blob constructor do the single copy at download time.
- **Don't pull the viewport back to live tail when new bytes arrive.**
  D-03 — stay where the user is; the floating chip is the only signal.
- **Don't re-emit the BEL flash overlay while scrolled up.** D-10 — title
  prefix only; the rows that triggered the bell aren't visible, so the
  flash would be misleading.
- **Don't feed `\x1B\x4A` (ESC J) to the parser to clear the screen
  locally** (D-26). Feeding fake bytes would put state in the parser
  ground state with side effects (cursor move). Use the new
  `Terminal::clear_visible()` API which mutates state directly.
- **Don't use `document.execCommand('copy')`.** Deprecated; the async
  Clipboard API is the v1 path (and the only path that works in
  pre-released Chromium versions reliably).
- **Don't poll `localStorage` to detect remote changes.** localStorage
  fires a `storage` event in OTHER tabs — and BestialiTTY is single-tab.
  Subscribers update from `savePrefs` directly.
- **Don't depend on `_headers` working on GitHub Pages.** It's a
  Cloudflare/Netlify convention; GitHub Pages ignores it. The fallback
  is a CSP `<meta http-equiv>` element + documented limitation.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Drag tracking that survives the cursor leaving the canvas | Manual `document.addEventListener('pointermove', ...)` + manual cleanup | `canvas.setPointerCapture(ev.pointerId)` + `setPointerCapture` | Captured pointer events fire on the captured element regardless of cursor position; auto-cleans on `pointerup` and on `lostpointercapture` (alt-tab). Manual capture races with focus loss [VERIFIED: MDN setPointerCapture]. |
| Wheel normalization across mouse + trackpad | Multi-platform deltaMode shim | `if (ev.deltaMode === DOM_DELTA_PIXEL) accumulator else line-step` (CONTEXT D-02) | Browser already normalizes per platform; trying to "normalize all platforms" leads to bugs on macOS Magic Mouse + Linux mouse + Windows scroll-line-default. CONTEXT D-02 is the spec. |
| Versioned localStorage migrations | Custom serializer with header bytes | Plain JSON with a `version` field + branch on read (CONTEXT D-32) | localStorage stores strings; JSON is the obvious encoding. Versioning is read-time logic, no library needed. |
| Blob/file download with retry + progress | A library | `new Blob([chunks], { type: 'application/octet-stream' })` + anchor click + `URL.revokeObjectURL` | The native pattern is well-supported and ships in every browser. No retry needed (it's a synchronous DOM action). |
| Memory measurement for the soak test | Manual heap tracking via `console.profile` | `performance.memory.usedJSHeapSize` + `wasm.memory.buffer.byteLength` (CONTEXT D-40) | Chromium ships `performance.memory` despite its non-standard status. Standards-track replacement (`measureUserAgentSpecificMemory`) requires cross-origin isolation that GitHub Pages can't provide. Use what works. |
| Scroll-state pixel math from scratch | "What's the visible row at this clientY?" math each frame | Shared `pxToCell(clientX, clientY)` helper that uses canvas's `cellW`/`cellH` (already module-scope in `canvas.js`) | One conversion function reused by selection.js, scroll-state.js, and any future feature. |
| Clipboard format detection | "Try writeText, fallback to execCommand" | `navigator.clipboard.writeText` (Chromium-only project) | execCommand is deprecated. The project is Chromium-only by CLAUDE.md; the async API is sufficient. |
| Custom CSP header serving | A reverse proxy + custom MIME server | A `<meta http-equiv="Content-Security-Policy">` element in `index.html` + `_headers` for hosts that honor it + documented limitation | GitHub Pages does NOT support custom HTTP headers [VERIFIED: github community discussion 54257]. The meta tag is the official workaround per GitHub staff. |
| `setInterval`-based pump (relevant to paste-pump pattern) | `setInterval(writeChunk, gapMs)` | self-scheduling `setTimeout` chain (Phase 5 D-14, already shipped) | Same Pitfall 6 reasoning as Phase 5: setInterval drifts under load + when the tab is throttled. |

**Key insight:** Phase 6 has a strong "use what's there" posture. Every
heavy lift (selection rendering, scrollback ring, paste pacing, BEL
title prefix, focus retention, polite-fail check) is **already shipped
in Phases 1–5**. Phase 6 is a connective-tissue phase: new modules glue
existing primitives into daily-driver UX.

## Runtime State Inventory

> Phase 6 is **not** a rename/refactor/migration phase — it is a feature
> phase that ADDS new modules and APIs without changing existing ones.
> The only semi-migration concern is the new `bestialitty.prefs`
> localStorage key; existing `bestialitty.port.preset` (Phase 5) stays
> untouched. There is no prior `bestialitty.prefs` data to migrate
> because Phase 5 deliberately did not introduce one (see Phase 5 D-31
> rationale — "full serial config persistence is a Phase 6 feature").

| Category | Items Found | Action Required |
|----------|-------------|------------------|
| Stored data | localStorage `bestialitty.port.preset` (Phase 5) — STAYS UNCHANGED. New key `bestialitty.prefs` introduced fresh; no prior data to migrate. | None — schema is greenfield with `version: 1` + migration handler ready for v2. |
| Live service config | None. There is no n8n/Datadog/Tailscale dependency. | None — verified by repo grep for "n8n" / "datadog" / "tailscale" producing zero hits. |
| OS-registered state | None. No Windows Task Scheduler, pm2, launchd, systemd unit. | None — verified; project is a static site with no host-OS registrations. |
| Secrets/env vars | None. No `.env`, no SOPS keys, no API tokens. | None — repo has no secret-handling surface; static-site-only by CLAUDE.md. |
| Build artifacts | `www/pkg/` (gitignored, regenerated by `scripts/build.sh`); `target/` (Cargo build dir, gitignored). | None — neither carries a renamed string; CI rebuilds from source. |

**Nothing found in any category requires a runtime migration step.** The
only state mutation Phase 6 introduces is creating the new prefs blob
on first save; older browsers/sessions without it apply DEFAULTS, and
the migration handler covers any future schema bumps.

## Common Pitfalls

### Pitfall 1: Shift+End / Shift+Home Browser Default-Action Conflict
**What goes wrong:** `Shift+End` is the standard browser shortcut for
"select to end of line" in input fields and contenteditable. If a focus
escape (e.g., user clicks a button, then types Shift+End) lands on
something other than `#terminal-wrapper`, the browser may select chrome
text instead of jumping the scrollback to bottom.
**Why it happens:** Chromium dispatches Shift+End to the focused element
first; only if the focused element doesn't preventDefault does the
browser handle text selection. The Phase 4 keyboard listener attaches
to `#terminal-wrapper`, not document.
**How to avoid:** Phase 4 already established the `mousedown
preventDefault` pattern on every chrome control; preserve focus on
`#terminal-wrapper`. The new keyboard intercepts call `e.preventDefault()`
synchronously in the keydown branch (mirror Phase 4 D-02 pattern).
**Warning signs:** Manual UAT — click a Settings button, type Shift+End,
expect scrollback jump-to-bottom. If browser highlights "Settings" text
instead, the focus retention failed.

### Pitfall 2: Trackpad Inertia Scrolling Triggers Spurious Scroll-Up
**What goes wrong:** macOS trackpad emits a flurry of small `deltaY`
events after the user lifts fingers (momentum scrolling). Naive
implementation drains the queue too aggressively, scrolling backwards
through history when the user only meant to scroll a few lines.
**Why it happens:** macOS `WheelEvent.deltaY` events continue arriving
for ~500 ms post-gesture as inertia decays. Each is small (1-5 px) but
cumulatively significant.
**How to avoid:** CONTEXT D-02 sets accumulator threshold ~30 px per
3-line tick — already absorbs sub-tick inertia. If real-trackpad UAT
shows the threshold is too low, raise to 50 px. The threshold IS the
mitigation; don't add separate inertia detection.
**Warning signs:** Real-MicroBeast UAT — scroll up 3 lines on a Mac
trackpad, observe whether the viewport overscrolls past the intended
position.

### Pitfall 3: Auto-Connect Race With User-Initiated Connect
**What goes wrong:** Page loads, `prefs.autoConnect=true`, `getPorts()`
returns a match, the silent `connectMicroBeast()` fires. User
simultaneously clicks the Connect button. Two `requestPort()` calls
race; one hits an InvalidStateError ("port already open").
**Why it happens:** Auto-connect runs in a microtask after wasm boot;
the user can click before that microtask resolves.
**How to avoid:** Gate the auto-connect path on `state === 'disconnected'`
at the moment of invocation; Phase 5's `setState('connecting')` is the
single-writer guard. The auto-connect call site reads
`getState()` first; if not 'disconnected', no-op.
**Warning signs:** Test by Playwright simulating a "user clicks Connect
within 50 ms of boot" race; should not produce two open() calls.

### Pitfall 4: Selection Coordinates Drift When Scrollback Grows Mid-Drag
**What goes wrong:** User drags from row 5 to row 10. While dragging, a
new line arrives → scrollback push → visible-row-5 is now off-screen.
Selection endpoint stored as visible-grid coordinates is now wrong.
**Why it happens:** Visible-grid coordinates are NOT stable across
`push_line`. The "live tail" moves by 1 row when scrollback grows.
**How to avoid:** CONTEXT D-17 mandates storing endpoints as
`(scrollback_row_offset_from_live_tail, col)` pairs. Offset 0 = current
live tail row; offset 1 = one row behind tail; etc. New pushes don't
move existing offset values — they just decrement what counts as
"live tail." Compute visible-row at paint time from the stored offset +
current scroll-state offset.
**Warning signs:** Playwright test — drag-select, programmatically
trigger 5 `term.feed()` calls during the drag, verify selection
end-points still highlight the same characters.

### Pitfall 5: localStorage SecurityError in Private/Incognito
**What goes wrong:** Some Chromium-derivatives or strict privacy
extensions disable localStorage in private mode, throwing `SecurityError`
on `setItem`/`getItem`.
**Why it happens:** `Storage` interface returns null/throws when
disabled; not the same as a quota error.
**How to avoid:** Wrap every localStorage call in try/catch; on failure,
keep prefs in memory + log a warning. Same posture as Phase 5
`persistVidPid` (already does this for the port preset).
**Warning signs:** Test in Chromium incognito with the relevant flag;
boot should succeed with default prefs in-memory.

### Pitfall 6: Blob Constructor Memory Spike on Large Logs
**What goes wrong:** A 2-hour MicroBeast session generates ~10 MB of RX
bytes. User clicks Download log → `new Blob(chunks)` allocates 10 MB
contiguous. Then `URL.createObjectURL` holds another reference. Peak
memory = 2× raw size briefly. On a memory-constrained tab, this can
trigger eviction.
**Why it happens:** `Blob` doesn't share memory with input arrays — it
copies internally. The `chunks` array stays alive during construction.
**How to avoid:** Accept the 2× peak; for v1's expected sessions
(< 100 MB), it's fine. Document the boundary in `06-SOAK.md`. Future
mitigation if needed: stream-write to `showSaveFilePicker` (deferred).
**Warning signs:** Soak test reaches >50 MB log → click download →
DevTools memory shows 2× spike → spike resolves after revoke.

### Pitfall 7: Selection-Across-History-Boundary Coordinate Coercion
**What goes wrong:** Selection starts on a visible row, drag pulls past
viewport top, scroll-state increments offset, the original anchor is
now in scrollback. Naive impl converts coordinates to "visible-row"
when the row is no longer visible; underflow → endpoint at row 0 (wrong).
**Why it happens:** Same as Pitfall 4 but the inverse direction —
crossing INTO scrollback during drag.
**How to avoid:** Anchor coords are scrollback-tail-relative from the
moment of pointerdown — never visible-grid. The renderer converts
back to visible coords AT PAINT TIME using the current scroll offset.
**Warning signs:** Drag-from-visible-row-23 to-row-1 with auto-scroll —
the anchor should end up at the original line of text, not at the top
of the new viewport.

### Pitfall 8: GitHub Pages Cache Hold Time
**What goes wrong:** Push to main → workflow runs → URL still serves
the old artifact for ~5–15 minutes due to CDN caching.
**Why it happens:** GitHub Pages uses a Fastly-backed CDN with
minute-grained TTL.
**How to avoid:** Document the propagation delay in README. Hard-refresh
(Ctrl+Shift+R) is the user-side workaround. For phase-verification: do
NOT depend on "deploy succeeds → visit URL" same-minute; UAT step
explicitly waits.
**Warning signs:** "Just deployed but the page is wrong" — 99% of the
time it's CDN cache, not a build failure. Check `https://<user>.github.io
/<repo>/?_=$(date +%s)` (cache-buster query string) to confirm.

### Pitfall 9: 24-Hour Soak Tab Throttling
**What goes wrong:** User leaves the soak running, switches to another
tab. Phase 5's read loop continues (decoupled from rAF per Pitfall 6),
but Phase 6's session-log append still runs. Scrollback grows. Eventually
the user comes back to a tab with 24 h of data and the catch-up render
is huge.
**Why it happens:** Phase 5 D-39 catch-up render exists, but if the
sample interval is rAF-driven, the soak measurements stop while hidden.
**How to avoid:** D-40 sampling cadence is `setInterval(60_000)` — NOT
rAF. setInterval continues firing even on a hidden tab, just at the
1-Hz throttled cadence Chromium imposes (still close to 60 s). The
samples still land.
**Warning signs:** SOAK.md must explicitly mandate
`setInterval`/setTimeout-based sampling, never rAF.

### Pitfall 10: Settings 2-Click Reset Confirm Race
**What goes wrong:** User clicks Reset prefs → 3-second timer arms. User
keyboard-tabs to next button → mousedown-preventDefault on that button
restores focus to canvas → user types Space (intending to activate the
button they tabbed to) → space goes to terminal as 0x20 → Reset prefs
timer expires harmlessly. UX confusion: user thought they confirmed
reset.
**Why it happens:** The 3-second window can outlast the user's intended
click sequence. Phase 4's mousedown-preventDefault pattern means focus
returns to the canvas after every chrome click.
**How to avoid:** The reset button's "Click again to confirm" state
shows the timer countdown clearly (CSS animation) so the user knows
when it expires. CONTEXT D-35 lock 3-second window.
**Warning signs:** Manual UAT — click Reset, tab away, observe
button-text reverts after 3 s.

## Code Examples

Verified patterns from official sources:

### Snapshot a scrollback offset (Rust + JS)

```rust
// crates/bestialitty-core/src/terminal.rs — NEW Phase 6 method
//
// Snapshot the visible_rows-tall window starting `row_offset` rows BACK from
// the live tail. Out-of-range clamps to total - visible_rows (CONTEXT D-06).
// Reuses pack_buf — no new memory layout. Pointer remains stable across this
// call (matches snapshot_grid contract from D-03).
pub fn snapshot_grid_at(&mut self, row_offset: usize) {
    let cols = self.scrollback.cols();
    let visible_rows = self.scrollback.visible_rows();
    let total = self.scrollback.total_len();
    // Live tail viewport starts at total - visible_rows. Offset N moves it
    // back by N rows (capped so we never read before row 0).
    let tail_start = total.saturating_sub(visible_rows);
    let start = tail_start.saturating_sub(row_offset);
    // Resize pack_buf if needed (no-op in steady state).
    let needed = visible_rows * cols;
    if self.pack_buf.len() != needed {
        self.pack_buf.resize(needed, Cell::BLANK);
    }
    // NEW accessor in scrollback.rs:
    //   pub fn row_at_absolute(&self, idx: usize) -> &Row
    // returns rows[idx]; idx must be < total_len.
    for r in 0..visible_rows {
        let src = self.scrollback.row_at_absolute(start + r).as_slice();
        let dst_start = r * cols;
        self.pack_buf[dst_start..dst_start + cols].copy_from_slice(src);
    }
}
```

```rust
// crates/bestialitty-core/src/lib.rs — wasm boundary (Phase 6 addition)
//
// One-line forwarder following Phase 2 D-06/D-20 pattern.
pub fn snapshot_grid_at(&mut self, row_offset: u32) {
    self.inner.snapshot_grid_at(row_offset as usize);
}

// CONTEXT D-26 — clear_visible direct mutation, NOT feeding ESC J.
pub fn clear_visible(&mut self) {
    self.inner.clear_visible();
}
```

```rust
// crates/bestialitty-core/src/terminal.rs — clear_visible
//
// Wipes every visible-region cell to BLANK + marks all rows dirty.
// Cursor goes home (0,0). Parser state untouched — D-26 explicitly
// says "remote state machine never sees a fake escape."
pub fn clear_visible(&mut self) {
    let cols = self.scrollback.cols();
    for row in self.scrollback.visible_mut() {
        for cell in row.0.iter_mut() {
            *cell = Cell::BLANK;
        }
    }
    self.dirty.mark_all();
    self.cursor_row = 0;
    self.cursor_col = 0;
}
```

### Wheel listener with deltaMode dispatch (JS)

```js
// www/renderer/scroll-state.js — wheel handler
// [VERIFIED: MDN WheelEvent.deltaMode + Bugzilla 970141]
canvasWrapper.addEventListener('wheel', (ev) => {
  ev.preventDefault();   // claim — D-12 chrome panes never see it
  let lines;
  if (ev.deltaMode === WheelEvent.DOM_DELTA_LINE) {
    // Mouse — Linux & Windows-default deliver line deltas
    lines = (ev.shiftKey ? 24 : 3) * Math.sign(ev.deltaY);
  } else {
    // Trackpad / hi-res mouse — accumulate raw pixels
    trackpadAccumulator += ev.deltaY;
    lines = 0;
    while (Math.abs(trackpadAccumulator) >= 30) {
      lines += 3 * Math.sign(trackpadAccumulator);
      trackpadAccumulator -= 30 * Math.sign(trackpadAccumulator);
    }
  }
  if (lines !== 0) scrollBy(-lines);   // up-wheel = +offset
}, { passive: false });   // we preventDefault; cannot be passive
```

### Pointer drag-select with capture (JS)

```js
// www/input/selection.js
// [VERIFIED: MDN Element.setPointerCapture, blog.r0b.io drag pattern]
canvas.addEventListener('pointerdown', (ev) => {
  if (ev.button !== 0) return;
  ev.preventDefault();
  canvas.setPointerCapture(ev.pointerId);
  dragging = true;
  anchor = focus = pxToCellWithScrollOffset(ev);
  notifySelectionChange();
});

canvas.addEventListener('pointermove', (ev) => {
  if (!dragging) return;
  focus = pxToCellWithScrollOffset(ev);
  // D-18 — drag-past-edge auto-scroll
  const r = canvas.getBoundingClientRect();
  if (ev.clientY < r.top) scrollState.scrollByLines(+1);
  else if (ev.clientY > r.bottom && scrollState.isScrolledBack()) scrollState.scrollByLines(-1);
  notifySelectionChange();
  requestFrame();
});

canvas.addEventListener('pointerup', (ev) => {
  dragging = false;
  // canvas.releasePointerCapture(ev.pointerId);   // automatic on pointerup
});

canvas.addEventListener('lostpointercapture', () => {
  // alt-tab away mid-drag — abort
  dragging = false;
  // selection persists; D-19 will clear it on focus loss
});
```

### Clipboard write + read (JS)

```js
// [VERIFIED: MDN Clipboard.writeText / readText, web.dev async-clipboard]
async function copySelection() {
  const text = serializeSelection();
  if (!text) return;
  try {
    await navigator.clipboard.writeText(text);
  } catch (err) {
    // Permissions-Policy `clipboard-write` should be allowed by default for
    // top-level same-origin documents; this branch is defensive.
    console.warn('[clipboard] write failed:', err);
  }
}

async function pasteFromClipboard() {
  try {
    const text = await navigator.clipboard.readText();
    return preprocess(text);
  } catch (err) {
    // readText requires transient activation OR clipboard-read permission.
    // The keydown event that triggered this is transient activation.
    console.warn('[clipboard] read failed:', err);
    return null;
  }
}
```

### Blob download trigger (JS)

```js
// [VERIFIED: MDN URL.createObjectURL, Blob, anchor download attribute]
function triggerDownload(chunks, filename) {
  const blob = new Blob(chunks, { type: 'application/octet-stream' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.style.display = 'none';
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  // Defer revocation; some browsers stall the download if revoked too soon.
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}
```

### CSP meta-tag fallback (HTML)

```html
<!-- www/index.html <head> — meta-tag fallback because GH Pages can't set headers
     [VERIFIED: github community discussion 54257; staff says meta is the only way]
     wasm-unsafe-eval avoids the broader unsafe-eval which is needed for general
     eval(). [VERIFIED: WebAssembly/content-security-policy CSP.md] -->
<meta http-equiv="Content-Security-Policy"
      content="default-src 'self';
               script-src 'self' 'wasm-unsafe-eval';
               style-src 'self' 'unsafe-inline';
               img-src 'self' data:;
               font-src 'self';
               connect-src 'self';
               base-uri 'self';
               form-action 'none';
               frame-ancestors 'none'">
```

**Note:** `frame-ancestors` is one of the directives that meta-tag CSP
ignores [VERIFIED: MDN CSP — frame-ancestors must be in HTTP header to
take effect]. The `_headers` file is the right place for it on hosts
that honor the file.

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| `document.execCommand('copy')` | `navigator.clipboard.writeText()` | Async Clipboard API stable in Chromium 76+ (2019); execCommand deprecated by spec | Phase 6 uses async API exclusively. |
| `MouseEvent` for drag tracking | `PointerEvent` + `setPointerCapture` | Pointer Events Level 2 stable in Chromium 55+ | Single API for mouse + touch + stylus; capture handles edge-leave cleanly. |
| `peaceiris/actions-gh-pages@v3` | `actions/deploy-pages@v5` + `actions/upload-pages-artifact@v3` | GitHub introduced official Pages Actions in 2022; v3 artifact requirement landed January 2025 [VERIFIED: github.blog/changelog 2024-12-05] | Phase 6 uses official action pair; older `peaceiris` flow no longer recommended. |
| `performance.memory` only | `performance.measureUserAgentSpecificMemory()` (standards-track) | Replacement API requires cross-origin isolation | Phase 6 falls back to `performance.memory` because GitHub Pages cannot supply COOP/COEP headers. Documented in 06-SOAK.md. |
| Persisting prefs in multiple `localStorage` keys | Single versioned JSON blob | Increasingly preferred for atomic-write semantics + easier migrations | CONTEXT D-32 locks single blob. |
| Wheel handling with passive: true (default) | Explicit passive: false when preventDefault needed | Chromium 73+ defaults wheel listeners to passive on document/body but NOT on element targets [VERIFIED: MDN] | Phase 6 wheel listener attaches to `#terminal-wrapper` (element) so default-non-passive applies; explicit `{ passive: false }` is documentation-only. |

**Deprecated/outdated:**
- `KeyboardEvent.keyCode` — use `event.code` (physical key) for shortcuts.
  Phase 4 already follows this.
- `webkitCreateObjectURL` / `webkitRequestFileSystem` — never needed in
  Chromium-only project; the standard `URL.createObjectURL` is stable.
- Jekyll-served Pages sites — Phase 6 uses the artifact-based deploy
  workflow; Jekyll is disabled via `.nojekyll`.

## Assumptions Log

> All claims tagged `[ASSUMED]` need user confirmation before becoming
> locked decisions. The planner MUST surface these in the planning step.

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | The author's GitHub repo URL will be of form `<user>/bestialitty` (used in workflow + LICENSE attribution + footer text). | Pattern 6 + LICENSE template | Low — user provides exact URL/handle in plan-phase; placeholder in research is fine. |
| A2 | The MIT copyright line author is the project author per CLAUDE.md (no organization or multi-author claim). | LICENSE | Low — user can name themselves; SPDX format is unambiguous. |
| A3 | GitHub Pages defaults at the repo level will be set to "Deploy from a GitHub Action" (not "Deploy from a branch"). | Pattern 6 workflow | Medium — if the user has the repo configured for branch-deploy, the action will fail at the configure-pages step. The plan-phase should call out this manual repo-settings step. |
| A4 | The trackpad accumulator threshold of ~30 px (CONTEXT D-02) gives an acceptable feel on a real Mac trackpad — no real-hardware UAT yet. | Pattern 1 wheel handler | Low — easy one-line tuning constant; "Claude's Discretion" already says planner picks the final value. |
| A5 | Selection word-boundary regex `/\S+/` matches user expectations on real CP/M / BASIC outputs (CONTEXT D-16, "Claude's Discretion"). | Pattern 2 selection | Low — easy to tweak post-UAT; daily-driver workflow will surface anomalies. |
| A6 | GitHub Pages CDN cache TTL is in the 5–15 minute range as of 2026 — exact number not verified against GitHub status docs. | Pitfall 8 | Low — it's a UAT note, not a code path. |
| A7 | `performance.memory` will continue to ship in Chromium for the foreseeable future despite being marked deprecated/non-standard on MDN. | Pattern (soak) + Don't Hand-Roll | Medium — if Chromium removes it, the soak-protocol falls back to `wasm.memory.buffer.byteLength` only (which remains valid as the primary signal). 06-SOAK.md should document the contingency. |

**Empty assumptions table → all claims verified.** This table is small
because the project is mature; the verified surface dominates.

## Open Questions

1. **Where does the floating "↓ N new lines" chip live in DOM?**
   - What we know: CONTEXT D-03 says "near bottom-right of canvas." That's
     positioning, not DOM placement.
   - What's unclear: Does it sit inside `#terminal-wrapper` (positioned
     absolutely against the canvas) or as a separate element with a
     coordinate transform?
   - Recommendation: Inside `#terminal-wrapper` with `position: absolute;
     bottom: 8px; right: 8px;`. Naturally clipped to the wrapper bounds;
     no JS coordinate math.

2. **Should `selection.js` re-export atlas tiles or compute its own
   inversion?**
   - What we know: D-20 says reuse `atlas.getInverted(ch, fg, ...)`.
   - What's unclear: The current `getInverted` signature takes a
     `invRasteriser` closure; selection.js needs the same closure. Should
     canvas.js export the `makeInvRasteriserForTheme` helper, or should
     selection ask canvas to render selection rows by passing the
     selection range?
   - Recommendation: canvas.js exports a new `paintSelectionOverlay(range)`
     helper that owns the closure construction. Selection module calls it
     with the range; canvas does the paint. Same pattern as Phase 3
     `triggerBellFlash`.

3. **CSS for `[data-scrolled-back]` border tint — what color?**
   - What we know: CONTEXT mentions "subtle border tint" — left to
     "Claude's Discretion."
   - What's unclear: Use phosphor color in CRT (already-glowing) or
     contrast accent? Same in clean theme?
   - Recommendation: 1 px border in the existing `--chrome-accent`
     token, 50% opacity. Both themes already define `--chrome-accent`;
     no new CSS variables needed.

4. **`bestialitty-{stamp}.bin` filename — UTC or local time?**
   - What we know: CONTEXT D-31 says "connect-time UTC stamp."
   - Recommendation: ISO-style `bestialitty-20260425-143052.bin` (UTC,
     no separators between date and time chunks). Aligns with grep-
     friendly + sort-friendly file ordering. The "Claude's Discretion"
     comment notes both forms work.

5. **Can the Settings "Auto connect on load" be toggled while a connect
   is in flight?**
   - What we know: D-34 says off by default; toggle in Settings.
   - What's unclear: If user toggles ON during a port-lost state, does
     the silent-open path fire immediately?
   - Recommendation: Toggle changes the saved pref but does NOT
     immediately attempt to connect. Reload of the page is the trigger.
     This avoids a "click toggle → mysterious connect attempt" UX.

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| Rust toolchain (existing) | Building wasm | ✓ | stable per `rust-toolchain.toml` | — |
| `wasm-pack` (existing) | Building wasm | ✓ | 0.12.1 | — |
| `python3 -m http.server` | Local dev server | ✓ (pre-installed Linux/macOS) | any | `basic-http-server www` |
| `@playwright/test` (existing) | Phase 6 spec suite | ✓ | ^1.51.0 (1.59.1 latest) | — |
| Chromium browser | All UAT + Playwright | ✓ | 89+ baseline | — (project is Chromium-only by CLAUDE.md) |
| Real MicroBeast hardware | 24-hour soak (D-40) | (user-side) | — | Synthetic generator (acceptable per CONTEXT "Claude's Discretion" — BASIC `for i = 0 to 1e9 : print i : next`) |
| GitHub repo + Pages enabled | Deploy (D-37) | (user-side) | — | Cloudflare Pages or Netlify (D-37 mentions either) |
| Cloudflare account | If user prefers `_headers` to actually take effect | (user-side, optional) | — | Document in README that `_headers` is no-op on GitHub Pages; meta-tag CSP is the fallback |

**Missing dependencies with no fallback:**
- None. All Phase 6 tasks have either a tool-side fallback or a
  user-side action documented.

**Missing dependencies with fallback:**
- Real MicroBeast hardware for the 24-hour soak — synthetic generator
  in BASIC works for v1 verification.
- Cloudflare Pages — GitHub Pages with meta-tag CSP is the explicit
  documented fallback.

## Validation Architecture

### Test Framework

| Property | Value |
|----------|-------|
| Framework | `@playwright/test` 1.59.1 (project pins `^1.51.0`) |
| Config file | `www/playwright.config.js` |
| Quick run command | `cd www && npm run test:fast` |
| Full suite command | `cd www && npm test` |

### Phase Requirements → Test Map

| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|--------------|
| SESS-01 | Scrollback retains 10K lines | unit + Playwright | `npx playwright test session/scrollback-nav.spec.js` | ❌ Wave 0 |
| SESS-01 | Wheel up scrolls offset; floating chip appears | Playwright | `... session/scrollback-nav.spec.js -g "wheel"` | ❌ Wave 0 |
| SESS-01 | Shift+End / Shift+Home / Shift+PgUp / Shift+PgDn | Playwright | `... session/scrollback-nav.spec.js -g "key"` | ❌ Wave 0 |
| SESS-02 | Drag-select on canvas inverts selected glyphs | Playwright | `... session/selection-copy.spec.js -g "drag"` | ❌ Wave 0 |
| SESS-02 | Double-click selects word; triple-click selects line | Playwright | `... session/selection-copy.spec.js -g "click count"` | ❌ Wave 0 |
| SESS-02 | Ctrl+Shift+C copies plain text to clipboard | Playwright (clipboard mock) | `... session/selection-copy.spec.js -g "copy"` | ❌ Wave 0 |
| SESS-03 | Ctrl+Shift+V pastes clipboard via paste-pump | Playwright (clipboard mock) | `... session/paste-from-clipboard.spec.js` | ❌ Wave 0 |
| SESS-03 | Large-paste >= 4096 B confirm chip | Playwright | `... session/paste-from-clipboard.spec.js -g "large"` | ❌ Wave 0 |
| SESS-03 | Paste preprocessing (CR/LF rewrite + strip) | Playwright | `... session/paste-from-clipboard.spec.js -g "preprocess"` | ❌ Wave 0 |
| SESS-04 | Session log auto-starts per Connect; chunks accumulate | Playwright (mock-serial) | `... session/session-log.spec.js -g "auto-start"` | ❌ Wave 0 |
| SESS-04 | Download produces correct Blob with all bytes | Playwright | `... session/session-log.spec.js -g "download"` | ❌ Wave 0 |
| SESS-05 | Mid-session download captures so-far + appends continue | Playwright | `... session/session-log.spec.js -g "mid-session"` | ❌ Wave 0 |
| SESS-06 | Top-bar Clear wipes 80x24 grid (NOT scrollback) | Playwright | `... session/clear-screen.spec.js -g "visible only"` | ❌ Wave 0 |
| SESS-06 | Shift+click Clear also wipes scrollback | Playwright | `... session/clear-screen.spec.js -g "scrollback too"` | ❌ Wave 0 |
| SESS-06 | Clear does NOT feed ESC J (parser state untouched) | Rust unit test | `cargo test clear_visible_does_not_invoke_parser` | ❌ Wave 0 |
| PREF-01 | Theme/phosphor/zoom/serial config persist | Playwright | `... session/prefs-persistence.spec.js -g "render"` | ❌ Wave 0 |
| PREF-01 | First-load with no key applies D-36 defaults | Playwright | `... session/prefs-persistence.spec.js -g "defaults"` | ❌ Wave 0 |
| PREF-01 | Reset prefs button (2-click confirm) | Playwright | `... session/prefs-persistence.spec.js -g "reset"` | ❌ Wave 0 |
| PREF-01 | savePrefs debounced 250 ms | Playwright | `... session/prefs-persistence.spec.js -g "debounce"` | ❌ Wave 0 |
| PREF-02 | localEcho + crlfMode persist | Playwright | `... session/prefs-persistence.spec.js -g "input prefs"` | ❌ Wave 0 |
| PLAT-03 | GitHub Action workflow valid | Manual UAT | gh-actions linter / first push | ❌ Wave 0 |
| PLAT-03 | Deployed URL serves wasm with `Content-Type: application/wasm` | Manual UAT | `curl -I https://<user>.github.io/bestialitty/pkg/...wasm` | ❌ Wave 0 |
| PLAT-04 | LICENSE file present, MIT, includes year + author | grep | `grep -q 'MIT License' LICENSE && grep -q '2026' LICENSE` | ❌ Wave 0 |
| PLAT-05 | First-open shows MicroBeast preset pre-filled | Playwright | `... session/prefs-persistence.spec.js -g "first open"` | ❌ Wave 0 |
| D-40 | 24-hour soak — sampler stable within ±10% | Manual UAT | 06-SOAK.md protocol | ❌ Wave 0 |

### Sampling Rate

- **Per task commit:** `cd www && npm run test:fast` (subset tagged
  `@fast` — finishes <30 s; covers the most-likely-broken paths).
- **Per wave merge:** `cd www && npm test` (full suite — 2-5 minutes
  on local + CI).
- **Phase gate:** Full suite green + 06-SOAK.md UAT signed off before
  `/gsd-verify-work`.

### Wave 0 Gaps

- [ ] `www/tests/session/scrollback-nav.spec.js` — covers SESS-01
- [ ] `www/tests/session/selection-copy.spec.js` — covers SESS-02
- [ ] `www/tests/session/paste-from-clipboard.spec.js` — covers SESS-03
- [ ] `www/tests/session/clear-screen.spec.js` — covers SESS-06
- [ ] `www/tests/session/session-log.spec.js` — covers SESS-04 / SESS-05
- [ ] `www/tests/session/prefs-persistence.spec.js` — covers PREF-01 /
      PREF-02 / PLAT-05
- [ ] Update `www/playwright.config.js` `testMatch` glob to include
      `**/session/*.spec.js`
- [ ] `www/tests/session/clipboard-mock.js` — shared fixture stubbing
      `navigator.clipboard.{readText,writeText}` (mirrors `mock-serial.js`)
- [ ] Rust unit test: `crates/bestialitty-core/tests/clear_visible.rs`
      asserting `clear_visible()` does not transition parser state
- [ ] `06-HUMAN-UAT.md` — daily-driver checklist (paste 100 KB during a
      real CP/M session, scroll back through 8K lines of BASIC output,
      copy a command from history and paste it back, theme toggle while
      scrolled up, clear-screen before / during long output, full
      reload restores prefs + port preset, auto-connect on second visit)
- [ ] `06-SOAK.md` — 24-hour soak protocol document
- [ ] `LICENSE` — MIT text with `2026 © <author>` line
- [ ] `.nojekyll` — empty file at repo root (or under www/, the planner
      picks based on artifact-path choice)
- [ ] `www/_headers` — best-effort Permissions-Policy + CSP for hosts
      that honor it
- [ ] `.github/workflows/pages.yml` — deploy workflow

## Security Domain

> `security_enforcement` is implicitly enabled (no explicit `false` in
> `.planning/config.json`). The threat surface is small (Chromium-only
> static site, no auth, no PII, no network egress), but Phase 6 introduces
> three new trust boundaries: clipboard text → bytes (untrusted text from
> system clipboard), localStorage JSON (potentially mutated by a hostile
> browser extension), and the synthetic-anchor download (DOM injection
> potential).

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V2 Authentication | no | No login surface; project is single-user single-tab. |
| V3 Session Management | no | No server session; localStorage is per-origin. |
| V4 Access Control | no | No multi-user data. |
| V5 Input Validation | yes | Clipboard text → bytes pipeline strips 0x00–0x1F (except CR/LF/Tab) and high-bit per CONTEXT D-24; localStorage JSON parse wrapped in try/catch with default fallback. |
| V6 Cryptography | no | No crypto in scope. |
| V7 Errors and Logging | yes | Error log inline shown to user; messages escapeHtml'd before innerHTML insertion (Phase 5 already established this — extends to any new error-rendering path). |
| V11 Business Logic | no | No multi-step workflow. |
| V14 Configuration | yes | Permissions-Policy + CSP via `_headers` + meta-tag fallback; X-Content-Type-Options nosniff via `_headers`. |

### Known Threat Patterns for Browser-Side Daily Driver

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| Hostile clipboard payload (control bytes, escape sequences) | Tampering | D-24 strips 0x00–0x1F except CR/LF/Tab; high-bit dropped silently. The byte stream feeds Phase 1's parser which handles untrusted bytes by design. |
| localStorage tampering (browser extension, malicious page in same origin) | Tampering | Prefs JSON parse wrapped in try/catch; defensive merge with DEFAULTS so a missing key doesn't crash boot; version field gates migrations. |
| Iframe hijacking Web Serial | Elevation of Privilege | `Permissions-Policy: serial=(self)` in `_headers` (best-effort) + `meta http-equiv="Content-Security-Policy"` with `frame-ancestors 'none'` documented. CSP `frame-ancestors` requires HTTP header to take effect [VERIFIED: MDN], so pure-meta-tag fallback CANNOT block iframe embedding on GitHub Pages — limitation documented in README. |
| XSS via injected log message (escaped at render time) | Tampering | Phase 5 established `escapeHtml` for error log; Phase 6 follows the same pattern for any new innerHTML-based UI (none expected — most new UI uses textContent). |
| Memory exhaustion via paste/log abuse | Denial of Service | Phase 5 D-25 already added paste-pacing; Phase 6 D-25 adds large-paste confirm chip ≥4096 B; session log has no cap in v1 but the soak protocol validates it (D-40). |
| `<a download>` filename containing path-traversal | Tampering | Filename is constructed from `Date` formatting only (no user input); D-31 grammar is strict alphanumeric + dashes. |
| `Blob` URL leak across origins | Information Disclosure | URLs are origin-scoped and revoked after 5 s. |
| wasm `unsafe-eval` | Tampering | CSP uses `wasm-unsafe-eval` (NOT broader `unsafe-eval`) — narrow grant for the wasm compilation step only [VERIFIED: WebAssembly/content-security-policy CSP.md]. |

## Sources

### Primary (HIGH confidence)

- [MDN: Clipboard API](https://developer.mozilla.org/en-US/docs/Web/API/Clipboard_API) — async API surface
- [MDN: Clipboard.readText](https://developer.mozilla.org/en-US/docs/Web/API/Clipboard/readText) — user-gesture / Permissions-Policy semantics
- [MDN: Clipboard.writeText](https://developer.mozilla.org/en-US/docs/Web/API/Clipboard/writeText) — write semantics
- [web.dev: Unblocking clipboard access](https://web.dev/articles/async-clipboard) — Chromium-specific behavior of the async Clipboard API
- [MDN: WheelEvent.deltaMode](https://developer.mozilla.org/en-US/docs/Web/API/WheelEvent/deltaMode) — DOM_DELTA_LINE vs DOM_DELTA_PIXEL
- [Bugzilla 970141](https://bugzilla.mozilla.org/show_bug.cgi?id=970141) — cross-platform deltaMode behavior
- [MDN: PointerEvent](https://developer.mozilla.org/en-US/docs/Web/API/PointerEvent) — capture semantics
- [MDN: Element.setPointerCapture](https://developer.mozilla.org/en-US/docs/Web/API/Element/setPointerCapture) — drag-past-edge pattern
- [MDN: Window.localStorage](https://developer.mozilla.org/en-US/docs/Web/API/Window/localStorage) — quota + error handling
- [MDN: Storage quotas and eviction criteria](https://developer.mozilla.org/en-US/docs/Web/API/Storage_API/Storage_quotas_and_eviction_criteria) — ~5 MB Chromium limit
- [MDN: URL.createObjectURL](https://developer.mozilla.org/en-US/docs/Web/API/URL/createObjectURL_static) — Blob URL pattern
- [MDN: URL.revokeObjectURL](https://developer.mozilla.org/en-US/docs/Web/API/URL/revokeObjectURL_static) — cleanup
- [MDN: Blob](https://developer.mozilla.org/en-US/docs/Web/API/Blob) — constructor + memory model
- [MDN: Permissions-Policy: serial](https://developer.mozilla.org/en-US/docs/Web/HTTP/Headers/Permissions-Policy/serial) — `serial=(self)` semantics
- [MDN: Content-Security-Policy](https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Headers/Content-Security-Policy) — CSP directive reference
- [WebAssembly/content-security-policy CSP.md](https://github.com/WebAssembly/content-security-policy/blob/main/proposals/CSP.md) — `wasm-unsafe-eval` rationale
- [MDN: Performance: memory property](https://developer.mozilla.org/en-US/docs/Web/API/Performance/memory) — non-standard Chromium API used in 06-SOAK.md
- [SPDX: MIT License](https://spdx.org/licenses/MIT.html) — canonical MIT text
- [GitHub Actions: deploy-pages](https://github.com/actions/deploy-pages) — v5.0.0 workflow shape
- [GitHub Actions: upload-pages-artifact](https://github.com/actions/upload-pages-artifact) — v3 contract
- [GitHub Changelog: Pages action artifact v4 requirement](https://github.blog/changelog/2024-12-05-deprecation-notice-github-pages-actions-to-require-artifacts-actions-v4-on-github-com/) — January 2025 deadline
- [GitHub Docs: Configuring publishing source](https://docs.github.com/en/pages/getting-started-with-github-pages/configuring-a-publishing-source-for-your-github-pages-site) — `.nojekyll` requirement

### Secondary (MEDIUM confidence — official sources verified)

- [GitHub Community 54257](https://github.com/orgs/community/discussions/54257) — official position: GitHub Pages does NOT support custom HTTP headers; meta-tag is the only workaround (per GitHub staff yoannchaudet)
- [GitHub Pages permissions-policy interest-cohort changelog](https://github.blog/changelog/2021-04-27-github-pages-permissions-policy-interest-cohort-header-added-to-all-pages-sites/) — auto-applied default header
- [Cloudflare Pages: configuration headers](https://developers.cloudflare.com/pages/configuration/headers/) — `_headers` syntax for hosts that honor it
- [r0b.io: setPointerCapture drag interactions](https://blog.r0b.io/post/creating-drag-interactions-with-set-pointer-capture-in-java-script/) — pattern reference
- [Konva: scroll-by-edge-drag](https://konvajs.org/docs/sandbox/Scroll_By_Edge_Drag.html) — auto-scroll pattern reference

### Tertiary (LOW confidence — single-source, marked for validation)

- WASM MIME-type behavior on GitHub Pages: GitHub serves `.wasm` files
  with `Content-Type: application/wasm` automatically since the
  webassembly MIME type registration; the older [latenode community
  thread](https://community.latenode.com/t/wasm-file-serving-with-incorrect-content-type-on-github-pages/32127) reports historical incorrect MIME but
  current behavior is correct. **Validation:** UAT step `curl -I` after
  first deploy.
- `performance.measureUserAgentSpecificMemory` cross-origin isolation
  requirement — multiple sources concur but the exact COOP/COEP header
  combination is documented in [MDN Cross-Origin-Opener-Policy] and
  [MDN Cross-Origin-Embedder-Policy]; not directly retrieved in this
  research session. **Validation:** Verify when authoring 06-SOAK.md.

## Metadata

**Confidence breakdown:**

- **Standard stack:** HIGH — every dependency already exists in repo or
  ships with Chromium; one verified npm version + two verified GitHub
  Action versions.
- **Architecture:** HIGH — five subsystems each grounded in concrete
  Phase 1–5 code paths; integration points are line-numbered references
  to existing files.
- **Pitfalls:** HIGH — eight of ten pitfalls map to a Phase 1–5 pattern
  already shipped (mousedown-preventDefault, escapeHtml on innerHTML,
  rAF-decoupled loops, paste-pump pacing, polite-fail gate). Three new
  ones (selection coords across history boundary, GitHub Pages cache,
  Blob memory spike) are well-documented in vendor docs.
- **Validation Architecture:** HIGH — Phase 4/5 already built the
  Playwright + mock-fixture pattern; Phase 6 adds a parallel
  `tests/session/` directory with the same shape.
- **Security domain:** HIGH — most ASVS categories don't apply;
  the few that do have established mitigations (escapeHtml, strip-bytes,
  versioned JSON, defensive try/catch).

**Research date:** 2026-04-25
**Valid until:** 2026-05-25 (30 days — stable APIs; the `actions/deploy-
pages` v5 release is recent and may pick up minor v5.x updates, but the
deployment shape is stable).

---

*Phase: 06-daily-driver-polish-session-deployment*
*Researched: 2026-04-25*
