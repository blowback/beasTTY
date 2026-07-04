# Epic E5 Retrospective — Debug Menu & In-Page Debug Panel

**Date:** 2026-07-04 · **Facilitator:** Amelia (Dev) · **Format:** streamlined (no party-mode)
**Epic status:** 1/1 story complete (e5-1) · **Next epic:** E6 · Help Menu

---

## 1. Summary

E5 is the **third relocation mode**: E0–E3 removed legacy `<details>` panes (relocate-and-delete),
E4 built new status-bar chrome (build-new), and E5 **relocates-and-keeps** the one surface that stays
in-page (AD-11). The debug widgets (`#input`, Feed / 64 KB Stress / Paste test, TX-strip `<pre>`, Reset
TX) moved from a native `<details>` disclosure to a Debug ▸ Show Debug Panel checkable (default OFF),
staying fully functional after the move. This is the one pane that survives the E7 dual-chrome sweep.

| Story | Scope | Outcome | New tests |
|-------|-------|---------|-----------|
| E5.1 | Debug ▸ Show Debug Panel checkable → in-page debug panel (relocate-and-keep) | Done — **0 code-review findings, clean** | +1 spec (`menu-bar-debug.spec.js`); `tx-debug-strip.spec.js` converted to a menu-driven reveal |

Suite green: `chromium` 335 pass / 1 skip, `chromium-transport` 169 pass (2+2 flakes, all passed on
first retry — the known wasm-boot / transport masks, not regressions). **Zero new mechanic** — E5.1 was
`localEcho` minus the legacy mirror: a new persisted boolean (`showDebugPanel`) riding the E2.2 `data-pref`
checkable seam + the E3.2 injected-setter template. No new runtime module.

## 2. What went well

- **The "relocate-and-keep" third mode landed exactly as E4's retro (§6) framed it.** Every debug-widget
  id was preserved verbatim (`#input`/`#feed`/`#stress64k`/`#paste-test`/`#tx-strip`/`#tx-reset`), the
  `main.js` widget handlers were untouched, and "still works after the move" was proven by a Feed→grid
  oracle — not by inspection. Acceptance was written against *still-works-after-move*, as instructed.
- **Q1 (container mechanism) was the quiet win of the epic.** Keeping the element as `<details id="debug">`
  and gating visibility on the `open` attribute (`#debug summary { display:none }` +
  `#debug:not([open]) { display:none }`) meant the ~15 existing `page.locator('#debug').evaluate(el => el.open = true)`
  fixtures **kept revealing the widgets verbatim — zero spec sweep.** The rejected alternative
  (`<div id="debug-panel" hidden>` + a shared reveal helper + sweeping every fixture) produces the identical
  visible result but is broad, flake-prone churn on a pure-relocation story. Choosing the low-risk path on
  the risk axis is the reusable judgement here.
- **Single-writer discipline held cleanly in a new shape.** `applyPrefs` is the sole writer of the panel's
  live visibility on boot/reset; the menu handler owns it on toggle; both go through the *one* injected
  `setDebugPanelVisible` setter. `projectDebugPanel` re-derives only the row glyph — it never touches the
  panel node. Two writers never appear (AD-14 intact). `menu-bar.js` imported no panel module — the setter
  arrived only via opts (AD-3 held).
- **E4.2's foresight paid off precisely as predicted.** `#build-sha` was already relocated to `#status-build`,
  so E5.1's "build info does not live here" AC was satisfied *before* E5 began. The standing
  `index.html:1700-1702` comment prevented any re-add.
- **Completely-invisible-when-OFF met Ant's explicit requirement** — `display:none` on the whole container
  (not a collapsed-but-present box), so a fresh page shows zero debug furniture: no summary triangle, no
  empty bordered box. Panel styling moved to DESIGN.md `debug-panel` tokens (`--field-bg`/`--chrome-fg`/
  1px `--chrome-border`/`rounded/sm`), replacing hardcoded hex.

## 3. What was harder / worth watching

- **Correctness trap #1 (persist ≠ apply) recurs for every live-effect checkable.** `savePrefs` does not
  fire subscribers (AD-4), so a checkable with a live DOM effect *must* also call its injected setter in the
  same branch — persisting alone flips the glyph and survives reload but leaves the panel unchanged until the
  next `applyPrefs`, a silent bug. Handled correctly here (mirrors `localEcho`), but it is a standing foot-gun
  for the next live checkable author.
- **The regression surface was the story's real danger, and it hinged on one decision.** The debug widgets
  double as byte-injection fixtures across ~15 specs; had the container stopped being a `<details>` (or gone
  `[hidden]`), `el.open = true` becomes a no-op and `page.fill('#input', …)` times out on a hidden element —
  a red suite. Q1's mechanism defused it entirely, but the whole regression outcome rode on that single
  design choice.
- **AD-11 literal deviation, on record.** The implementation used `open` + `:not([open])` rather than the
  spec's literal `[hidden]`/`data-*`. Documented as intentional (Q1) and read as intentional in review. Fine,
  but it is a spec-vs-implementation divergence worth carrying in memory for anyone auditing AD-11 conformance.

## 4. The headline — the process-debt pattern finally broke

E4's retro concluded, across **four** retros: *"technical guidance gets applied, process guidance gets
deferred."* **E5 is where that broke.** Both long-running process actions closed at their structural root:

- **The code-review-recording ghost (E2 #2 / E3 #2 / E4 #2) is dead.** `scripts/check-story-done-consistency.py`
  now asserts every `done` story's front-matter and Code Review section agree; it caught and fixed real drift
  (E1.2 front-matter, E3.1 stub) on its first run. E5.1's own Code Review section is properly filled
  (0 findings, detailed verification notes) — the first story where "record the review" fired as part of
  "mark done." The gate is now *code that blocks the inconsistency*, not prose reminding a human to fill it.
- **The codified-idioms carry (E1 #4 / E2 #1 / E3 #1 / E4 #3 — five epics) is resolved.** E5.1's Q3 formally
  closed it as *intentionally per-story*: the zero-sweep Q1 mechanism removed the only natural extraction
  trigger, so forcing a `tests/helpers/` extraction E5.1 didn't need was rejected in favour of a clean close.
  The block is re-embedded per story by design; it is no longer an open action.

**The lesson that generalizes:** the structural fix — a script that *blocks* the bad state — worked where
four retros of restating the gate in prose did not. Write the gate as code, not as a reminder.

## 5. E4 retro follow-through

| E4 action | State | Evidence in E5 |
|-----------|-------|----------------|
| #1 Backfill the three E4 Code Review sections | **Done** | All three E4 story files carry findings + fix-sha (E4.3 in `8d2795e`). |
| #2 Fold "record the review" into "mark story done" | **Done** | `scripts/check-story-done-consistency.py` asserts front-matter + Code Review agree; fixed E1.2/E3.1 drift on first run. E5.1's review section is filled. |
| #3 Kill or extract the codified-idioms carry (last call, 5 epics) | **Done** | E5.1 Q3 formally closed it as intentionally per-story; zero-sweep Q1 removed the extraction trigger. |
| #4 Carry E7 dual-chrome close-out forward, with the E5 exception | **Applied — still open for E7** | E5.1 records the debug panel as the ONE pane that does not retire; formal sweep is correctly deferred to E7. |
| #5 Watch the status-bar setter surface | **N/A to E5 — still open** | E5 never touched `status-bar.js`; the "fed, never owned" watch carries forward as a standing check. |

**Insight:** the pattern E4 flagged as consistent-across-four-retros (technical applied, process deferred)
inverted this epic — the two *process* actions closed and the two *technical* carries (E7 sweep, setter
watch) are the ones correctly still open, because their close-out points genuinely lie in later epics. The
difference was structural enforcement, not another restatement.

## 6. Housekeeping reconciled in sprint-status this retro

Several `action_items` were resolved *inside* E5.1 but never flipped in `sprint-status.yaml`. Closed now:

- **Codified-idioms carry → done** at e1 #4, e2 #1, e3 #1, e4 #3 (all the same carried action; resolved by
  E5.1 Q3, closed as intentionally per-story).
- **Code-review recording → done** at e2 #2, e3 #2 (root fixed by the E4 #2 consistency script; E5.1's review
  is recorded).
- **Flake endgame (e2 #3) → done — decided this retro.** Ant ratified: **accept `retries:1` as the permanent
  mask.** The `chromium-transport` (`fullyParallel:false`) + `retries:1` policy has held clean across E2–E5;
  stop per-story flake re-diagnosis. Recorded here in writing as the standing convention (see action #1).

Correctly left **open**: e1 #5, e2 #4, e3 #4, e4 #4 (E7 dual-chrome — formal sweep is E7) and e4 #5
(status-bar setter watch — standing).

## 7. Next epic (E6 · Help Menu) readiness

**E6 depends on E0 + E1** (both long done) — **not on E5.** E5 does not gate E6. Two reference modals:

- ✅ **E6.2 (About Beastty) is pre-wired.** E4.2 deliberately kept `window.__buildInfo` alive, single-sourced
  with `#status-build`, *for exactly this* — build SHA + `builtAt` are ready. The modal also needs the
  verbatim "No telemetry. No data leaves your browser." string, a source link (literal `TBD` placeholder),
  and the Chromium-requirement note (FR-25 / UX-DR10).
- ✅ **E6.1 (Keyboard Shortcuts) and E6.2 are `openModal` surfaces** (E0.2 done). Both must follow the
  **clean-modal aesthetic**: aligned rows + ⓘ tooltips matching `key-screen-chrome.html`, not transplanted
  verbose panels.
- ✅ The menu-test idioms apply directly (Help is a menu — `window.__menuBar.open`, checkable/item mechanics
  identical to View/Settings). The idioms block is re-embedded per story by the now-closed convention.

**No significant discovery. Nothing in E5 invalidates E6's plan. No epic update required.**

## 8. Action items

| # | Action | Owner | Type |
|---|--------|-------|------|
| 1 | **Ratify `retries:1` as the permanent flake policy in writing at the source.** Add a one-line comment in `playwright.config.js` recording the decision (accept the `chromium-transport` + `retries:1` mask; no per-story `--workers=1` re-diagnosis) so it is never re-litigated. Closes E2 #3. | Amelia | Technical |
| 2 | **Carry the E7 dual-chrome close-out forward WITH the debug-panel exception recorded.** After E5, the debug pane has been relocated behind the Debug menu and *stays* — it is the one pane that does NOT retire. Keep the E7 retirement checklist current through E6 so nothing ships mid-migration; the formal sweep is E7. Continues E1 #5 / E2 #4 / E3 #4 / E4 #4. | Amelia | Technical |
| 3 | **E6 prep — confirm the About modal's build source and apply the clean-modal aesthetic.** E6.2 reads `window.__buildInfo` (kept alive by E4.2, single-sourced with `#status-build`); both E6 modals follow the aligned-rows + ⓘ-tooltip convention (`key-screen-chrome.html`), not verbose panels. Verify the source-link `TBD` placeholder and the verbatim privacy string land as specified. | Amelia | Process |
| 4 | **Keep watching the status-bar setter surface (standing).** The imperative-push API (`setConnectionInfo`/`setBuild`/`setZoom`/`setErrorCount`) grew a writer per E4 story. E5 didn't touch it; before any future story adds another, confirm the "fed, never owned" contract still holds. Continues E4 #5. | Amelia | Technical |

## 9. Readiness verdict

E5 is **functionally complete and clear to proceed to E6** — 1/1 story done, **0 code-review findings**,
suite green, single-writer discipline intact, every debug widget preserved verbatim and proven still-working
after the move, and the debug pane correctly marked as the one surface that survives E7. The epic's real
significance is process, not features: **the two multi-epic process debts (review-recording ghost, codified-
idioms carry) both closed at their structural root**, breaking the four-retro "process guidance gets deferred"
pattern — the lesson being that a script that blocks the bad state succeeds where restated prose failed. The
flake endgame is now decided (accept `retries:1`), and the only carries still open are those whose close-out
genuinely lies in E7. No significant discovery; no epic update required.
