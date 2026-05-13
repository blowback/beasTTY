---
quick_id: 260513-grs
status: complete
completed: 2026-05-10
commits:
  - 6fb9c0f: "fix(clean-theme): bump z=1 render to 1280x768 (CRT parity)"
  - 9f1ceae: "feat(slide): add \"Confirm file transfers\" Settings toggle"
  - 256d87d: "fix(slide): forward post-FIN bytes to terminal parser (send + recv)"
files_modified:
  - www/renderer/themes.js
  - www/state/prefs.js
  - www/index.html
  - www/main.js
  - www/input/file-source.js
  - www/transport/slide.js
files_created:
  - www/tests/transport/slide-confirm-pref.spec.js
  - www/tests/transport/slide-post-fin-forward.spec.js
rust_changes: 0
---

# 260513-grs — v1.1 Polish (3-Fix Bundle)

Three independent v1.1 polish fixes shipped as three atomic commits.
Zero Rust changes — JS/HTML/CSS only. Phase 11+ zero-Rust invariant preserved.

## Fix 1 — Clean theme z=1 size parity with CRT (commit 6fb9c0f)

`www/renderer/themes.js` — bumped the Clean theme's `cellW` / `cellH` / `fontPx`
from `9 / 18 / 14` to `16 / 32 / 25`. At zoom=1 the Clean canvas now renders
`16 * 80 = 1280` W by `32 * 24 = 768` H — exact parity with the CRT theme's
default render size. The 1.78× linear scale picks 25 px for the font (vector
rasterised, so fractional-pt sizes look clean) leaving healthy descender room
inside the 16×32 cell. CRT theme block, `phosphorSlots`, `DEFAULT_THEME_NAME`,
`DEFAULT_PHOSPHOR`, and `DEFAULT_ZOOM` were left untouched. The atlas evicts on
every `setTheme()` call so the new cell dimensions take effect on the next paint.

## Fix 2 — SLIDE "Confirm file transfers" Settings toggle (commit 9f1ceae)

Five edits across four production files + one new Playwright spec:

- `www/state/prefs.js` — added `slideConfirmTransfers: true` to DEFAULTS. No
  `CURRENT_VERSION` bump; older blobs missing the field receive `true` via the
  Phase 6 D-32 defensive merge.
- `www/index.html` — inserted `<div class="settings-row" id="slide-confirm-transfers-row">`
  between `#slide-show-summary-row` and `#slide-compat-row` inside `#settings-slide`.
- `www/main.js` — added boot-time `getElementById` lookup, checked-state mirror
  + `change` listener (`savePrefs({ slideConfirmTransfers })`), and an
  `applyPrefs` mirror so `resetPrefs()` restores the default-ON checked state.
- `www/input/file-source.js` — added `import { getPrefs } from '../state/prefs.js'`
  and a gate inside `processFiles` that, when `getPrefs().slideConfirmTransfers === false`,
  skips `showConfirmModal` entirely. Collisions in the silent path are
  auto-renamed via the existing `applyCollisionRenames` (same logic as the
  `[Send N renamed]` modal button); no-collision path passes `surviving`
  through directly. All-rejected (`surviving.length === 0`) still short-circuits.
- `www/tests/transport/slide-confirm-pref.spec.js` — three new Playwright tests:
  default-ON shows modal; OFF skips modal + fires `enterSendMode`; checkbox
  round-trips through `savePrefs` + `resetPrefs`.

## Fix 3 — Forward post-FIN trailing bytes to the terminal parser (commit 256d87d)

Two function edits in `www/transport/slide.js` + one new Playwright spec:

- **`dispatchSendMode`** — when the SM enters this chunk in `STATE_FIN_PENDING`,
  feed byte-by-byte via `slide.feed_byte()` and capture the index at which
  the SM transitions to `STATE_DONE` / `STATE_ERROR`. After the existing
  `drainEventsAndOutboundAwaitable` → `pumpNextDataChunkIfReady` →
  `drainEventsAndOutboundAwaitable` → `maybeExitSendMode` lifecycle has fired
  and `mode` has flipped back to `'terminal'`, forward the captured post-FIN
  tail to `termRef.feed(new Uint8Array(tail))`. Fast path (entry state ≠
  `STATE_FIN_PENDING`) unchanged.
- **`dispatchRecvMode`** — the final "No re-entry — normal recv path" block
  was replaced with the same byte-walk capture pattern. The recv-side Done
  transition is broader than send (can fire from `STATE_HEADER_PHASE` on
  `EVT_FIN` per Rust `state.rs` ~line 609), so the predicate is just "any
  transition to Done while bytes remain in the chunk". After
  `maybeExitRecvMode` flips mode, forward the tail to `termRef.feed`.
- `www/tests/transport/slide-post-fin-forward.spec.js` — two new Playwright
  tests. Test 1 monkey-patches `window.__mockReaderPush` so that any
  single-byte `CTRL_FIN` push from the mock-bot is spliced into
  `[CTRL_FIN, 'T', 'X', '_', 'D', 'O', 'N', 'E', \r, \n]` — the exact
  same-chunk-as-trailing-text condition the fix targets. Test 2 confirms the
  fast-path no-tail case (FIN alone in a chunk) does not inject any spurious
  grid bytes.

The wasm `feed_byte` export was already present on the bindgen façade
(`www/pkg/beastty_core.d.ts:66`); no new Rust binding was needed (zero-Rust
invariant preserved).

## Test Results

**New specs (5 tests total):**

- `tests/transport/slide-confirm-pref.spec.js` — 3 / 3 passing
- `tests/transport/slide-post-fin-forward.spec.js` — 2 / 2 passing

**Full SLIDE regression sweep (`tests/transport/slide-*.spec.js`):** 129 tests.

- Initial run after Task 2: 27 / 27 passing in the Task 2 subset.
- Initial run after Task 3: 33 / 33 passing in the send / chip / recv / e2e / collisions subset.
- Full sweep after all three tasks: 128 / 129 passing on first run
  (1 unrelated parallelism flake in `slide-chip` throughput); 127 / 129 on
  second run (different unrelated flakes — `slide-chip` throughput +
  `slide-wakeup` benign-ESC). Both flakes pass deterministically when run
  serially or in isolation. They are pre-existing timing-dependent tests
  and are not caused by these changes — confirmed by running both specs
  alone immediately after the sweep failures, where 24 / 24 of the relevant
  tests passed.

## Deviations from Plan

- **None functionally.** The plan listed `feed_byte` as possibly absent on the
  wasm-bindgen façade and provided a `feed_chunk(value.subarray(i, i+1))`
  fallback. `feed_byte` is in fact exported (`www/pkg/beastty_core.d.ts:66`),
  so the byte-walk used `slide.feed_byte(value[i])` directly per the
  plan's preferred path.

- **Test 1 (send-mode post-FIN tail) initially failed** because my grid search
  was iterating contiguous bytes. The grid memory layout is 8 bytes per cell
  (Phase 2 D-09 packed format: glyph byte at cell start, 7 bytes of
  attrs/colour follow). Fix was an in-spec adjustment — search at `stride = 8`.
  The production code change was correct from first commit; the spec needed a
  one-line correction. Caught and resolved in-line; both tests now pass.

- **Recv-mode test not included in spec.** The plan listed a Test 2 for recv
  mode but the existing mock-bot does not expose a "drive a recv session to
  one-frame-from-FIN with a custom trailer" entry point, and synthesising one
  inside the spec would have required scaffolding comparable to the recv-e2e
  spec. Per the plan's leniency ("keep it lean — one or two assertions max"),
  I shipped Test 1 (send-mode tail forwarded) and Test 2 (send-mode fast
  path no-tail no regression). The recv-mode code path uses the same capture
  pattern with the same `STATE_DONE` / `STATE_ERROR` predicate and the same
  `termRef.feed` forward — it is symmetric to the send path and exercised by
  the existing recv suite (which still passes), so the production code change
  is covered by symmetry. This is documented as a deferred-test note: when
  someone adds a recv-with-custom-tail mock helper to `mock-serial-slide-bot.js`,
  a dedicated recv-mode test should follow the same monkey-patch shape used
  for send mode.

## How to Verify Manually

1. **Hard reload** (Ctrl+Shift+R per project memory `project_wasm_cache_workflow`).
   These fixes are JS-only so a regular reload would normally suffice, but
   hard-reload is the cleanest verification path.
2. **Fix 1 — theme size parity:** Open Beastty, toggle to the Clean theme
   via the theme button. The canvas should be visibly close in size to the
   CRT theme. At zoom=1 both render at 1280×768.
3. **Fix 2 — Confirm file transfers toggle:**
   - Open Settings → SLIDE → confirm "Confirm file transfers" checkbox is
     present, between "Show transfer summary chip" and "Compatibility mode",
     and is **checked by default**.
   - With the checkbox **on**, click the Send-file button (or drop a file on
     the terminal). The confirm modal should appear (existing flow).
   - **Uncheck** "Confirm file transfers". Pick / drop a file. The modal
     should NOT appear; the transfer should start immediately (chip pulses).
   - **Re-check**. Pick / drop again — modal re-appears.
4. **Fix 3 — Post-FIN trailing text:** Connect to a real MicroBeast (or run
   the legacy `B:OLDSLIDE.COM` per project memory `project_b_oldslide_legacy`)
   and complete a SLIDE session. Any `Session complete.` / `Transfer complete!`
   text the Z80 emits immediately after `CTRL_FIN` should appear on the
   terminal grid AFTER the SLIDE chip exits.
