---
baseline_commit: 969b3afc34855336bdc1871d378087ac2fefc0c6
---

# Story E4.1: Connection & device/baud readout

Status: done

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As a MicroBeast operator,
I want a bottom status bar that shows my connection state and port at a glance,
so that I always know the link state and framing without opening a menu or a modal.

## Context & framing (read first)

**E4 is the first non-relocation epic.** E0–E3 were "pure relocation, byte-identical to legacy, preserve
verbatim copy." E4.1 **builds a new surface** — a bottom status bar fed by subscription + imperative push
that **holds no independent truth** (AD-6). Acceptance is defined against the spec (FR-26 / UX-DR3 / UX-DR14
/ AD-6), **not** against a v1.1 incumbent. Do not look for an old bottom bar to match; there isn't one.

**This story owns only the connection field.** Build SHA + zoom readout are **E4.2**; the recent-errors
affordance is **E4.3**. Build the bar container so those slot in later, but do not implement them here.

**The one true source of connection state is `serial.js`'s state machine** (`disconnected | connecting |
connected | reconnecting | port-lost`). The status bar is a *projector* that subscribes to it — exactly
like `menu-bar.js` already does for `#menu-conn-dot`. Three connection projectors will coexist, each the
**single writer of its own DOM field** (AD-6 / NFR-4), all reading the same truth:

| Field | Writer | Notes |
|-------|--------|-------|
| `#menu-conn-dot` / `#menu-conn-label` (top menu bar) | `menu-bar.js` | Unchanged. |
| `#port-status` device/baud line (**new bottom bar**) | **`status-bar.js` (this story)** | Relocated here; becomes the canonical `aria-live` connection region. |
| Legacy `#port-status` in `<details id="connection">` | serial.js → **removed this story** | Ownership moves to the bar; serial.js stops writing it. |

## Acceptance Criteria

**AC-1 — New subscribing module, correct dependency edges (AD-1, AD-2, AD-3, AD-5).**
A new `www/renderer/status-bar.js` exports `wireStatusBar(opts)` (named export, no default), wired once at
the composition root. It **subscribes** to the connection state via `opts.onConnectionStateChange` (= `serial.onStateChange`)
and does an **initial paint** from `opts.getConnectionState` (= `serial.getState`). It imports **only**
`state/prefs.js` directly; every other dependency (`onConnectionStateChange`, `getConnectionState`) arrives
through `wireStatusBar` opts injected by `main.js` — it must **not** `import` `serial.js`, `menu-bar.js`, or
`slide-chip.js`. It exposes `window.__statusBar` with `__getStateForTests()` and `__resetForTests()`, and a
`dispose()` that unsubscribes.

**AC-2 — Discrete dot color, snap not animate, red reserved (FR-26, NFR-9, UX-DR3).**
`#status-conn-dot`’s color is driven by a `[data-state]` attribute that `status-bar.js` sets on every
transition. The four discrete colors are: **gray** `disconnected` (`--status-gray`), **amber**
`connecting` **and** `reconnecting` (`--status-amber`), **green** `connected` (`--status-green`), **red**
`port-lost` (`--status-red`). The dot has **no `transition`/`animation`** — it snaps. **Red never appears
for any state other than `port-lost`.** Colors come only from `--status-*`/`--chrome-*` tokens; the bar
renders **identically** under Console and CRT (no phosphor vars, no `[data-theme]` styling branch — AD-9).

**AC-3 — Device/baud line, verbatim copy, aria-live, single writer (FR-26, UX-DR10, UX-DR14).**
The connection readout element carries `id="port-status"` and `aria-live="polite"`. `status-bar.js` is its
**sole writer**. Its `textContent` per state:
- `connected` → exactly `MicroBeast (CP2102N 10c4:ea60) — 19200 8N1` (em-dash is U+2014). The baud + framing
  segment (`19200 8N1`) is **composed from `getPrefs().serial`** — `` `${baud} ${dataBits}${parity[0].toUpperCase()}${stopBits}` `` (defaults `19200/8/'none'/1` → `19200 8N1`) — so a changed baud reflects on the next `connected` transition. The device segment `MicroBeast (CP2102N 10c4:ea60)` is a frozen literal.
- `disconnected` → exactly `Not connected`.
- `connecting` → `Connecting…`, `reconnecting` → `Reconnecting…`, `port-lost` → `Connection lost`
  (U+2026 ellipsis; these strings match `menu-bar.js`’s `CONN_STATUS_LABELS` so the two surfaces never
  disagree — AD-6’s whole purpose).

All state→text mapping uses an `Object.freeze`d label map at module top (the `BUTTON_LABELS` pattern), with
`connected` composed dynamically. No inline string literals scattered across handlers.

**AC-4 — `#port-status` relocated; exactly one writer, one element (AD-6, NFR-4, AD-15 precedent).**
`#port-status` now lives inside the new `#status-bar`. The legacy `<p id="port-status">` inside
`<details id="connection">` is removed (the vestige keeps only `#download-log-button` + its hint). `main.js`
no longer passes `portStatusEl` into `wireSerial`, so `serial.js`’s `updatePortStatusConnected/Disconnected`
become inert null-guarded no-ops (the **state machine and `onStateChange` fan-out are untouched** — this is
the AD-15 "inject the DOM projection out of serial.js" move, already done for the Connect button in E2.1).
Exactly one `#port-status` exists in the DOM. *(Intentional simplification: the legacy boot-only variant
`MicroBeast (…) — click Connect` for a remembered-but-unconnected port is dropped — `disconnected` uniformly
reads `Not connected` per the E4 spec.)*

**AC-5 — Bar composition & visual spec (DESIGN.md, UX-DR4, UX-DR5, UX-DR6).**
A full-width sticky bottom `#status-bar` renders below the terminal: `background: var(--chrome-bg)`, a
**1px `var(--chrome-border)` top hairline** (no drop shadow), `var(--chrome-muted)` 12px monospace text
(the `hint` role). The connection group holds the 9px round `#status-conn-dot` + the `#port-status` text
(the device group text is `var(--chrome-fg)`, dot gap ~8px). The dot is a clean circle with **no glow**
(DESIGN.md’s no-shadow/snap rules override the mockup’s `box-shadow`). Matches the mockup composition
(`mockups/key-screen-chrome.html` `.statusbar`) minus the not-yet-built right group.

**AC-6 — Test coverage + repoint (AD-2, NFR-6).**
A new `www/tests/render/status-bar.spec.js` proves AC-2/AC-3/AC-4 across all five states using the serial
mock: dot `[data-state]`/computed color per state, `#port-status` text per state (connected line + `Not
connected` + the three transitional labels), the `aria-live="polite"` attribute, and that exactly one
`#port-status` exists (in `#status-bar`, not in `#connection`). The one existing assertion that reads
`#connection #port-status` (`tests/render/serial-config-modal.spec.js:208`) is repointed to the new home.

**Cross-cutting (from epics, stated once):** uses only `var(--chrome-*)`/`var(--status-*)` tokens (NFR-2);
no new dependencies / no build step (NFR-5); `window.__statusBar` + `__getStateForTests` (NFR-6). *(NFR-1
focus-retention is not triggered here — E4.1 adds no focusable controls; the errors affordance/buttons are
E4.3.)*

## Tasks / Subtasks

- [x] **Task 1 — Create the bottom status bar markup + CSS in `index.html`** (AC-2, AC-4, AC-5)
  - [x] Remove the `<p id="port-status" class="hint" aria-live="polite">Not connected</p>` line from
        `<details id="connection">` (~`index.html:1523`); leave `#download-log-button` + the persist hint.
        Update the vestige comment (~`index.html:1518`) — it now holds only `#download-log-button`; keep the
        E7 retirement note current (E1 retro action #5 / E3 retro action #4).
  - [x] Append a new `<footer id="status-bar">` as the **last** body child (after `#terminal-wrapper`).
        Inside: a connection group — `<span id="status-conn-dot" aria-hidden="true"></span>` +
        `<span id="port-status" class="hint" aria-live="polite">Not connected</span>`. (Leave room for the
        E4.2 right group; do not build it.)
  - [x] Add CSS: `#status-bar` sticky bottom, full width, `background: var(--chrome-bg)`,
        `border-top: 1px solid var(--chrome-border)`, `color: var(--chrome-muted)`, `font-size: 12px`,
        flex row, ~26px tall, `padding: 0 12px`, `gap: 16px`, `z-index` above the canvas. Mirror the exact
        `#menu-conn-dot` color pattern for `#status-conn-dot` (base `--status-gray`; `[data-state="connecting"],[data-state="reconnecting"]`→`--status-amber`; `[data-state="connected"]`→`--status-green`; `[data-state="port-lost"]`→`--status-red`), 9px circle, **no `box-shadow`, no `transition`**. Device text span in `var(--chrome-fg)`.
  - [x] Verify the bar sits at the viewport bottom without overlapping/reflowing the terminal (body is
        `display:flex;flex-direction:column;align-items:center` — the bar needs `width:100%`/`align-self:stretch`).
- [x] **Task 2 — Author `www/renderer/status-bar.js`** (AC-1, AC-2, AC-3)
  - [x] Follow the `scroll-state.js`/`slide-chip.js` template (AD-2): module-scope state + injected `…Ref`
        vars + `wireStatusBar(opts)` returning an API + private `projectConnection(state)` + `dispose()` +
        `__getStateForTests`/`__resetForTests`. Import `getPrefs` from `../state/prefs.js` (AD-3 allows).
  - [x] Frozen label maps at module top: `STATUS_TEXT` (`disconnected:'Not connected'`,
        `connecting:'Connecting…'`, `reconnecting:'Reconnecting…'`, `'port-lost':'Connection lost'`) and a
        `DEVICE_LABEL = 'MicroBeast (CP2102N 10c4:ea60)'` constant. Comment-tie `STATUS_TEXT` to
        `menu-bar.js` `CONN_STATUS_LABELS` (identical values, no cross-import).
  - [x] `projectConnection(state)`: `dotEl.dataset.state = state`; if `connected`, compose
        `` `${DEVICE_LABEL} — ${baud} ${dataBits}${parity[0].toUpperCase()}${stopBits}` `` from
        `getPrefs().serial`; else `textEl.textContent = STATUS_TEXT[state] || STATUS_TEXT.disconnected`.
  - [x] In `wireStatusBar(opts)`: grab `#status-conn-dot` + `#port-status` via `getElementById` (mirror how
        `menu-bar.js` grabs `#menu-conn-dot`); drop any prior subscription before re-subscribing (idempotent
        re-wire — mirror `menu-bar.js:394`); `connUnsub = opts.onConnectionStateChange(projectConnection)`;
        initial paint `projectConnection(opts.getConnectionState?.() || 'disconnected')`.
  - [x] Expose `setConnectionInfo()` on the returned API per AD-6 (a thin re-project that re-reads
        `getPrefs().serial`); the primary path is the prefs read on each `connected` projection, so full
        modal wiring is out of scope here — just provide the hook. `dispose()` calls `connUnsub()`.
- [x] **Task 3 — Wire at the composition root** (AC-1, AC-4)
  - [x] `import { wireStatusBar } from './renderer/status-bar.js';` (near `main.js:68-72`).
  - [x] After `wireMenuBar` and before `wireKeyboard` (AD-12 seam), call
        `const statusBar = wireStatusBar({ onConnectionStateChange: onStateChange, getConnectionState: getState });`
        then `window.__statusBar = statusBar;` (mirror `window.__menuBar`).
  - [x] Remove `portStatusEl` from the `wireSerial({...})` opts (~`main.js:1081`); drop/repurpose the
        `const portStatusEl = document.getElementById('port-status')` (~`main.js:300`) — after relocation it
        resolves to the bar element and must **not** be handed to `serial.js` (that would double-write).
- [x] **Task 4 — Tests** (AC-6)
  - [x] New `www/tests/render/status-bar.spec.js`: `ready(page)` waits on
        `window.__statusBar.__getStateForTests`; add `SERIAL_MOCK` via `addInitScript`. Drive the five
        states (mirror `tests/render/menu-bar-connection.spec.js`’s connection-state driving) and assert
        `#status-conn-dot` `[data-state]` + computed `background-color`, `#port-status` `textContent`, the
        `aria-live` attr, and that `document.querySelectorAll('#port-status').length === 1` inside `#status-bar`.
  - [x] Repoint `tests/render/serial-config-modal.spec.js:208` (`#connection #port-status` count) to reflect
        the new home (0 in `#connection`; 1 in `#status-bar`).
  - [x] Run the full suite; confirm 0 hard failures (treat any wasm-boot-under-parallelism flake as the
        ratified `chromium-transport` + `retries:1` mask — do **not** re-diagnose per-story).

## Dev Notes

### Architecture compliance — the governing decisions (verbatim intent)

- **AD-6 — Status bar is fed, never owned.** `status-bar.js` holds no independent truth (single-writer per
  field), maps `state → frozen label map → textContent`/`data-*`, mirroring `serial.js`’s `BUTTON_LABELS` +
  `applyStateToButton`. Fed two ways: **subscribe** for observer sources (`serial.onStateChange`); **imperative
  push** for observer-less sources (baud/serial-config in prefs — `savePrefs` does **not** fan out) via a
  status-bar API (`statusBar.setConnectionInfo()`). Discrete dot colors, no transitions.
- **AD-5 — Federated state stays owned by its module; new chrome subscribes.** Connection lives in the
  `serial.js` machine (`disconnected|connecting|connected|reconnecting|port-lost`); new chrome subscribes via
  `onStateChange`, never owns or duplicates it.
- **AD-3 — Direct-import allowlist.** A new chrome module may import **only** `renderer/canvas.js` setters and
  `state/prefs.js` directly. Everything else (serial state accessors, etc.) arrives via `wireXxx` opts.
- **AD-1 / AD-2 — Composition-root DI; `wireXxx(opts)` shape.** Plain `.js` under `renderer/`, named export,
  one `wireXxx(opts)` call in `main.js`; follow the `scroll-state.js`/`slide-chip.js` template; expose
  `window.__xxx`.
- **AD-9 — Neutral shell.** Only `var(--chrome-*)` tokens; no phosphor vars, no `[data-theme="crt"]` styling
  branch; the bar looks identical across CRT↔Console. (`--status-*` are theme-independent, defined once at
  `index.html:51-54`.)
- **AD-12 — Boot order.** Wire at the `wireChrome` seam, after `wireMenuBar`, before `wireKeyboard`.
- **Consistency conventions:** element ids kebab-case, feature-prefixed (the spine literally cites
  `#status-conn-dot`); `Object.freeze`d label maps at module top; visual state via `data-*` (never inline
  styles); `getPrefs()` **at use-time** (never cache across a `savePrefs`).

### Exact integration points (read these files before coding)

**`www/transport/serial.js` — the state source (do NOT modify its state machine):**
- Subscribe: `onStateChange(fn)` returns an unsubscribe closure; `fn` receives the **plain state STRING**
  (not an object) — `serial.js:471-477`, fan-out at `setState` `serial.js:595-601`.
- Sync read: `getState()` → current state string — `serial.js:469`.
- States (literals): `'disconnected'` (initial/clean disconnect), `'connecting'`, `'connected'`,
  `'port-lost'`, `'reconnecting'`.
- The device string is a **hard-coded literal**, not derived from `getInfo()` (which only yields numeric
  `usbVendorId`/`usbProductId`). Canonical format at `serial.js:606`:
  `'MicroBeast (CP2102N 10c4:ea60) — 19200 8N1'`. VID/PID constants: `0x10c4`/`0xea60` (`serial.js:39-40`).
- Legacy writes to relocate/kill: `updatePortStatusConnected/Disconnected` (`serial.js:603-611`), fed by the
  `portStatusEl` opt (`serial.js:113,126`); both are `if (!portStatusEl) return;` null-guarded — dropping the
  main.js injection makes them inert.

**`www/state/prefs.js` — baud/framing source:**
- `DEFAULTS.serial = { baud: 19200, dataBits: 8, stopBits: 1, parity: 'none', flowControl: 'none' }`
  (`prefs.js:24`); the defensive merge guarantees `getPrefs().serial.baud` is never undefined (`prefs.js:94`).
- **Watch the two schemas:** the prefs blob uses `baud`; `SerialPort.open()` uses `baudRate`
  (`PRESET_CONFIG`, `serial.js:41-43`). Read **`getPrefs().serial.baud`** for the readout (not `baudRate`).
- No existing formatter builds `19200 8N1` — compose it yourself: `parity[0].toUpperCase()` (`'none'`→`'N'`).

**`www/renderer/menu-bar.js` — the pattern to mirror (do not import it):**
- Subscribe + initial paint (`menu-bar.js:387-401`): drop prior sub, `connUnsub = opts.onConnectionStateChange(projectConnection)`, then `projectConnection(getConnectionStateRef() || 'disconnected')`.
- Projection (`menu-bar.js:1369-1377`): sets `connDotEl.dataset.state = state`; label from a frozen map.
- Frozen maps (`menu-bar.js:63-82`): `CONN_STATUS_LABELS` = `{disconnected:'Not connected', connecting:'Connecting…', connected:'Connected', reconnecting:'Reconnecting…', 'port-lost':'Connection lost'}`.
  **Your status bar reuses the same non-connected strings** (identical values) so the two surfaces agree;
  `connected` differs (the bar shows the full device/baud line, the menu shows `'Connected'`).
- Dot color is **CSS driven by `[data-state]`** (`index.html:128-139`) — replicate that exact selector set
  for `#status-conn-dot`.

**`www/main.js` — wiring:**
- Import block `main.js:68-72`; serial imports `main.js:86` (`onStateChange`, `getState` already imported).
- Seam: after `wireMenuBar` (`main.js:376`, exposed `window.__menuBar` at `:448`), before `wireKeyboard`
  (`main.js:643`). `pushZoom` no-op stub is `main.js:192-200` — **leave it; E4.2 owns the zoom readout.**
- `wireSerial({...})` call at `main.js:1070-1082` passes `portStatusEl` (`main.js:1081`, sourced `main.js:300`)
  — **remove that opt.** (Note `main.js:1170` comment: the `connectionPane` ref is still passed for other
  serial.js reasons — leave that; only `portStatusEl` goes.)

### UX contract — exact tokens & copy (do not paraphrase)

- Tokens (`index.html:40-54`): `--chrome-bg #1e242c`, `--chrome-fg #e4e8ee`, `--chrome-border rgba(255,255,255,.08)`,
  `--chrome-muted rgba(255,255,255,.6)`, `--status-green #33ff66`, `--status-amber #e0b030`,
  `--status-red #e04040`, `--status-gray rgba(255,255,255,.4)`. Font: `ui-monospace, SFMono-Regular, Menlo, Consolas, monospace`.
- Dot colors: gray disconnected · amber connecting/reconnecting · green connected · red port-lost. **Discrete,
  never a gradient, never animated/transitioned — the dot snaps.** Red is reserved for port-lost + security
  only; amber = "action required, not error."
- Verbatim strings: `MicroBeast (CP2102N 10c4:ea60) — 19200 8N1` (em-dash **U+2014**), `Not connected`,
  `Connecting…`/`Reconnecting…` (ellipsis **U+2026**), `Connection lost`.
- Mockup reference (visual only): `mockups/key-screen-chrome.html` `.statusbar` (26px, flex, `gap:16px`,
  `padding:0 12px`, `border-top:1px solid var(--chrome-border)`). The mockup omits `#port-status`/`aria-live`
  and adds a dot `box-shadow` glow — **the spec wins: add the id + aria-live, drop the glow.**

### Testing standards

- Playwright chromium suite under `www/tests/` — new spec in `tests/render/status-bar.spec.js`.
- `ready(page)` guards the boot race: `await page.waitForFunction(() => window.__statusBar && typeof window.__statusBar.__getStateForTests === 'function')`. Add the serial mock via `await page.addInitScript(SERIAL_MOCK)` (from `../transport/mock-serial.js`) to drive real connection transitions.
- Codified menu-driven test idioms (carried from E1/E2/E3 — still per-story, see retro action #1): drive
  menus with `window.__menuBar.open('view')`; click aria-disabled rows with `{ force: true }`; wait for
  canvas sizing `document.getElementById('terminal').width > 0`. For this story, drive **connection** state
  through the serial mock (mirror `tests/render/menu-bar-connection.spec.js`).
- Flake policy: `chromium-transport` project + `retries:1` is the **ratified mask** — do not add per-story
  `--workers=1`; do not re-diagnose the wasm-boot-under-parallelism flake.

### Previous-story intelligence (E1–E3)

- **The injected-opt / DOM-projector seam has held for three epics** — `menu-bar.js` is a projector fed by
  opts; the state module is reached only through opts. Follow it exactly; do not `import serial.js`.
- **`savePrefs` does not fan out (AD-4).** Persisting a value does not update live readers. This is why the
  bar reads `getPrefs().serial` on each `connected` projection rather than caching a baud at wire time —
  a mid-session baud change is picked up on the next connect (the "Config changed — Disconnect and Connect to
  apply" hint from E2.3 already tells the user a reconnect is required).
- **Relocation keeps forcing incumbent-spec edits** (flagged in E2/E3 retros). Here that cost is tiny — only
  `serial-config-modal.spec.js:208` reads `#port-status`. Repoint it; nothing else asserts serial.js writing it.
- **Record the code review in this file** before marking done (E2 action #2 / E3 action #2 — half-adopted;
  E3.1 & E3.4 shipped `done` with "Pending" review sections). Fill the Code Review section below; don't leave
  it "Pending."

### Project Structure Notes

- New file: `www/renderer/status-bar.js` (NEW per the ARCHITECTURE-SPINE Structural Seed). Edits:
  `www/index.html` (remove legacy `#port-status`, add `#status-bar` + CSS), `www/main.js` (import + wire +
  drop `portStatusEl`), `www/tests/render/status-bar.spec.js` (NEW), `www/tests/render/serial-config-modal.spec.js` (repoint one assertion).
- **No** changes to `www/transport/serial.js` source (only its wiring is cut). No new dependencies, no build
  step (static ESM, Chromium ≥ 89).
- **E7 dual-chrome checklist (keep current — retro action #4):** after this story, `<details id="connection">`
  holds only `#download-log-button`; `#port-status` has moved to the permanent `#status-bar`. The `<details>`
  shell + `#top-bar` still retire wholesale in E7.

### Scope boundaries (do NOT build here)

- **Build SHA + zoom readout → E4.2.** Leave the `pushZoom` no-op stub (`main.js:192-200`) untouched.
- **Recent-errors affordance → E4.3.** No error count, no `▲` glyph, no click-to-open-Serial-Config here.
- Optionally include an empty right-group container in `#status-bar` for E4.2 to fill, or add it in E4.2 —
  either is fine; do not implement its contents.

### References

- [Source: epics.md#Story-E4.1] — story statement + epic AC (FR-26; NFR-9; UX-DR3, UX-DR14).
- [Source: ARCHITECTURE-SPINE.md#AD-6] status bar fed/never-owned; [#AD-5] federated state subscribe;
  [#AD-3] import allowlist; [#AD-1/#AD-2] composition-root + `wireXxx` shape; [#AD-9] neutral shell;
  [#AD-12] boot order; [#AD-15] serial DOM-projection injected out (precedent).
- [Source: DESIGN.md#Status-bar] tokens, four discrete dot colors, snap-never-animate, no-shadow, hint role.
- [Source: EXPERIENCE.md#Status-bar] per-state text, `#port-status` aria-live polite, connected-line format.
- [Source: mockups/key-screen-chrome.html] `.statusbar` composition (visual reference).
- [Source: www/transport/serial.js:39-44,469-477,595-611,603-611] state API, states, device literal, legacy writes.
- [Source: www/state/prefs.js:24,94] serial defaults + defensive merge.
- [Source: www/renderer/menu-bar.js:63-82,387-401,1369-1377] subscribe + project pattern, frozen label maps.
- [Source: www/main.js:68-72,86,192-200,300,376-448,643,1070-1082] wiring seam, imports, `pushZoom` stub, `wireSerial` opts.
- [Source: www/index.html:40-54,124-139,1518-1533] tokens, `#menu-conn-dot` CSS pattern, legacy vestige.
- [Source: E3 retro §6 + action 3] E4 build-new framing (spec-based acceptance, not incumbent).

## Dev Agent Record

### Agent Model Used

claude-opus-4-8 (Claude Code, bmad-dev-story workflow)

### Debug Log References

- Full suite: `npx playwright test` → 473 passed / 1 skipped / 13 flaky (all green on
  retry) / 0 hard failures. The flaky set is the ratified wasm-boot-under-parallelism +
  render-focus flake masked by `chromium-transport` + `retries:1`; none are the new
  `status-bar.spec.js` (8/8 green, no retries). Not re-diagnosed per E3 flake policy.
- Geometry sanity check (900×600 viewport): `#status-bar` pins full-width at the
  viewport bottom (top 574 → bottom 600, width 900). The bar overlays the terminal ONLY
  when the 80×24 canvas is itself taller than the viewport (short-window scroll case) —
  the terminal is never reflowed/shrunk (AC-5 / Task-1 constraint honored); on a normal
  window (≥~812px tall) the terminal fits fully above the bar.

### Completion Notes List

- **AC-1** — New `www/renderer/status-bar.js`: named `wireStatusBar(opts)`, no default;
  subscribes via `opts.onConnectionStateChange` + initial paint from
  `opts.getConnectionState`; imports ONLY `state/prefs.js` (no serial/menu-bar/slide-chip
  import — deps injected at the composition root). Exposes `window.__statusBar` with
  `__getStateForTests()`/`__resetForTests()`/`dispose()` (unsubscribes) + `setConnectionInfo()`
  (AD-6 imperative-push hook) + `projectConnection` (test-drive seam, mirroring menu-bar).
- **AC-2** — `#status-conn-dot[data-state]` drives four discrete colours (gray/amber/
  amber/green/red); no `transition`/`animation`, no `box-shadow`. Bar pins
  `--chrome-bg/fg/accent` (same scoped-token pin as `#menu-bar`) so it renders identically
  under CRT↔Console — verified by test (bar bg unchanged across `data-theme` flip). Red only
  on `port-lost`.
- **AC-3** — `#port-status` (aria-live=polite) is the sole writer's target. `connected`
  composes `MicroBeast (CP2102N 10c4:ea60) — 19200 8N1` (U+2014 em-dash) from
  `getPrefs().serial` read at use-time; other states map through the frozen `STATUS_TEXT`
  (values identical to menu-bar `CONN_STATUS_LABELS`, no cross-import). Baud change picked
  up on the next `connected` projection — verified.
- **AC-4** — Legacy `<p id="port-status">` removed from `<details id="connection">`;
  `portStatusEl` dropped from `wireSerial` opts (serial.js's `updatePortStatus*` now inert
  null-guarded no-ops; state machine untouched). Exactly one `#port-status`, in `#status-bar`.
- **AC-5** — Full-width sticky bottom `#status-bar` (26px, gap 16px, padding 0 12px,
  1px `--chrome-border` top hairline, no shadow, `--chrome-muted` 12px monospace; device
  text `--chrome-fg`, 9px dot with 8px gap). Matches the mockup `.statusbar` minus the
  E4.2 right group.
- **AC-6** — New `tests/render/status-bar.spec.js` (8 tests) proves AC-2/3/4 across all
  five states + aria-live + single-`#port-status`; `serial-config-modal.spec.js:208`
  repointed (0 in `#connection`, 1 in `#status-bar`).
- **Scope held**: no build-SHA/zoom (E4.2 — `pushZoom` stub untouched), no errors
  affordance (E4.3). `www/transport/serial.js` source unchanged (wiring only).

### Code Review

Not yet run — this is the gate the `review` status exists for. The independent
`code-review` workflow must be run in a fresh context with a **different** LLM
before this story advances to `done` (E3 retro action #2 done-gate: no story reaches
`done` with the review section unfilled). To be filled with: N findings (severity),
fixed in `<sha>`.

### Change Log

- 2026-07-03 — E4.1 implemented: new `#status-bar` footer + `status-bar.js` connection
  projector (subscribes to serial state machine, single writer of `#status-conn-dot` +
  `#port-status`); `#port-status` relocated out of `<details id="connection">`;
  `portStatusEl` dropped from `wireSerial`. New `status-bar.spec.js` (8 tests);
  `serial-config-modal.spec.js` assertion repointed. Suite green (0 hard failures).

### File List

- www/renderer/status-bar.js (new)
- www/index.html (modified)
- www/main.js (modified)
- www/tests/render/status-bar.spec.js (new)
- www/tests/render/serial-config-modal.spec.js (modified — repoint one assertion)
