# Retrospective — Epic E1: Menu Bar Backbone + View Menu

- **Date:** 2026-07-02
- **Project:** beastty (Chrome Redesign)
- **Facilitator:** Amelia (Developer)
- **Mode:** Streamlined (no party-mode dialogue) — per request.
- **Previous retro:** `epic-e0-retro-2026-07-01.md` (E0, first of the project).

## Epic Summary

E1 is **the backbone**. It stood up a real sticky menu bar (File · Connection · View ·
Settings · Debug · Help) with dropdown mechanics, full keyboard navigation, the Esc-passthrough
guard, the first working radio submenus, and the entire View menu (theme, phosphor, font, zoom,
clear) — while decomposing `chrome.js` with **zero incumbent behavior lost** and standing up the
reset re-projection path. Every migration honored the "pure relocation" premise: controls moved
home, behavior stayed byte-identical.

| Metric | Value |
| --- | --- |
| Stories completed | 5 / 5 (100%) |
| Hard blockers | 0 |
| Production incidents | 0 |
| Behavior changes (user-visible) | 0 — pure-relocation premise held across all 5 stories |
| New modules | 0 (all work lived inside `menu-bar.js`; `chrome.js` shrank) |
| Test suite growth | ~352 → 402 specs (new: menu-bar, keyboard, boot-order, prefs, view-theme-phosphor, view-font-zoom-clear) |
| Code-review passes with fixes | 2 (E1.4 v1.1 stale-menu/live-region/double-render; E1.5 shipped clean) |

**Stories:**
- **E1.1** — Menu-bar shell + dropdown open/move/click-away + four item variants + status placeholder (additive, `#top-bar` kept).
- **E1.2** — Keyboard nav (←/→/↑/↓, Enter/→) + the Esc-passthrough guard (the epic's single highest-risk clause).
- **E1.3** — `chrome.js` decomposition backbone: relocate the two Clear handlers, pin boot order, stand up the idempotent `projectPrefs` reset seam, decompose `applyPrefs` (single-writer + null-safety).
- **E1.4** — First real radio submenu; View ▸ Theme + Phosphor wired (AD-7 verbatim relocation); Phosphor shown-but-disabled off-CRT (AD-9); retired `#theme-toggle`/`#phosphor-group`.
- **E1.5** — View ▸ Font (3rd radio submenu) + Zoom + Clear; `openModal` friction-confirm for Clear Scrollback; retired `#font-select` + both clear buttons. Closes the View menu.

**Business outcome:** E1's charter — a working menu-bar backbone with the View menu live and no
behavior lost — was fully delivered. E2/E3/E5/E6 are now unblocked; the menu machinery (submenus,
`projectPrefs`, `retainFocus`, Esc-guard) is proven and reusable.

## What Went Well

- **Seam-first sequencing was the standout win.** E1.3 stood up `projectPrefs` as an *idempotent,
  no-throw, no-op* subscriber with the contract locked before there was any state to project. E1.4
  filled its theme/phosphor half; E1.5 filled its font half — each was "fill the body," not "design
  the mechanism." The same held for the radio-submenu mechanic (built once in E1.4, reused verbatim
  for Font in E1.5 with *zero* new mechanic). Paying the abstraction cost up-front compounded.
- **The Esc-passthrough guard (FR-4) landed cleanly** despite being flagged as the silent-regression
  risk. The `defaultPrevented` listener chain (chrome → menu-bar → keyboard) was pinned by a
  `boot-order.spec.js` regression test, and the passthrough branch was proven by a *downstream*
  oracle (bare Esc still cancels an in-flight paste when no menu is open) rather than a brittle
  internal-state assertion.
- **Scope-boundary discipline improved measurably.** E0's retro flagged E0.1 front-running E1.3.
  Every E1 story carried an explicit "Do NOT front-run" scope pin — and they held: E1.3 didn't wire
  the View menu, E1.4 left font/zoom a no-op, E1.5 didn't pull E4's status bar or E3's Settings
  forward. The lesson from E0 was applied.
- **"No behavior lost" was enforced by named-oracle contracts, not hope.** Each relocation retargeted
  the incumbent spec onto the new path and asserted the *downstream effect* (canvas theme applied,
  `body[data-theme]` set, scrollback flushed, selection cleared, `#font-row` gated). Surviving
  side-effects that rode inside deleted helpers (`body[data-theme]`, the `#font-row` CRT-gate, the
  D-19 selection-clear) were consciously re-homed, not dropped.
- **The two-writers problem was resolved architecturally.** Theme is now mutated by both the
  Ctrl+Alt+T chord (stays in `chrome.js`, AD-13) and the View menu (AD-7). Rather than a cross-module
  notify edge (which would violate AD-3), the menu re-derives from `getPrefs()` at use-time on every
  open — clean, coupling-free, and correct because `savePrefs` updates the cache synchronously.

## Challenges / Growth Areas

- **The pre-existing test flake is STILL unfixed — and now two epics old.** Every single E1 story
  spent debug effort re-confirming that a *shifting* set of parallel-load failures
  (`transport/{connect,readloop,slide-chip,config}`, occasionally `session/selection`) was the known
  wasm-boot-starvation flake and not a regression. The `--workers=1` named-oracle convention became
  standing and works — but E0 action item #1's own "done when: flake stops requiring per-story
  re-diagnosis" was **not** met. Five stories each paid the diagnosis tax.
- **Test-infrastructure papercuts recurred in shape.** E1.4: the `selectTheme` helper re-clicked a
  title and toggled the (still-open, per AD-7) menu shut. E1.5: Playwright refuses to click
  `aria-disabled` rows, and scrollback-only clears aren't observable via `snapshot_grid`. Each was
  solved locally, but they're a class of "menu-driven testing idioms" worth codifying so the next
  menu epic (E2/E3/E6) doesn't rediscover them.
- **The coexistence "known variance" now spans the whole epic and keeps growing.** Since E1.1's
  project-lead decision to defer `#top-bar`/`<details>` removal, the running app shows **both** the
  old chrome and the new menu bar simultaneously. It's intentional and it kept the app working
  end-to-end — but it's now carried across E1→E7 and won't fully resolve until E7. The menu-bar's
  neutral-shell `--chrome-*` pin (E1.1) similarly can't retire until the old `[data-theme]` block
  leaves with `#top-bar`.

## Key Insights

1. **Standing up a contract-locked seam before there's state to fill it is high-leverage.**
   The `projectPrefs` no-op (E1.3) and the reusable submenu mechanic (E1.4) turned E1.4/E1.5 into
   body-filling exercises. Repeat this pattern for E2's connection projection and E3's settings.
2. **A convention that removes a decision is not the same as fixing the problem.** The `--workers=1`
   flake protocol removed the *ambiguity* ("is this my regression?") but not the *cost* (re-running,
   re-reading a shifting failure set every story). The root fix is still owed.
3. **When architecture and requirements disagree, the dev resolving it needs a ratification loop.**
   E1.5's Font-disable-off-CRT call was correct (AD-7/AD-9 are explicit; the FRs were silent) and was
   flagged for the PO — but it shipped unratified. Good instinct; needs Ant's confirmation to close.

## Previous-Retro (E0) Follow-Through

| E0 Action | Owner | Status | Evidence |
| --- | --- | --- | --- |
| #1 Flaky-test protocol (serialize/quarantine OR codify `--workers=1` convention) | Amelia | ⏳ **Partial** | Convention codified + applied in all 5 stories, but root flake unfixed; "stops requiring per-story re-diagnosis" **not** met. Carries forward as E1 action #1. |
| #2 Decide `openModal` returnValue-reset policy at first new modal | Winston + Amelia | ⏳ **Triggered early, not documented** | Due "at E2.3" — but E1.5 shipped a *new* modal (`#clear-scrollback-confirm`) via `openModal` first. The policy is still undocumented in `modal.js`. Carries forward as E1 action #3. |
| #3 Note in E1.3 plan that `chrome.js` has zero inline focus sites | Amelia | ✅ **Done** | E1.3 Scope Decision + Dev Notes explicitly honor it; focus-retention rehoming was correctly not re-planned. |

## Next Epic Preview — E2: Connection & Serial Configuration

E2 (FR-12–15; depends on E0 + E1 — **both now complete**) is unblocked. It is the first epic to:
- **Inject `serial.js`'s connect-button DOM projection out** (AD-15) and make `menu-bar.js` the sole
  writer of the Connect item — the connection-status placeholder E1.1 stubbed becomes live.
- **Build the first substantial modal** (Serial Configuration, E2.3) via `openModal` — which is the
  original trigger point for E0 action #2 (returnValue-reset policy). That policy should be settled
  *before* E2.3, using the E1.5 clear-scrollback modal as the retro-audit case.

**Preparation carried in from E1 (no hard blockers):**
- The submenu/`projectPrefs`/`retainFocus`/Esc-guard machinery is proven and directly reusable.
- Inline focus sites still live in `serial.js` (migrate with the E2 connect work, per the E0 plan).
- No significant discovery requires re-planning E2; its plan is sound as written.

## Action Items

| # | Category | Action | Owner | Priority | Done when |
| --- | --- | --- | --- | --- | --- |
| 1 | Process/Test | Land the *real* flake fix, not just the convention: serialize/quarantine the transport connect-handshake specs in `playwright.config.js` (or add a bounded retry to the wasm-boot-starved set) so the full suite is trustworthy in parallel. Two epics of per-story re-diagnosis is enough. | Amelia | High | Full parallel suite is green (or deterministically quarantined) without per-story `--workers=1` re-diagnosis. |
| 2 | Product/Decision | Ratify (or flip) the **Font shown-but-disabled off-CRT** decision. Dev resolved it architecture-authoritative (AD-7/AD-9) against silent FRs; flip is a one-line `syncFontDisabled` removal if Ant wants Font always-available. | Ant + Amelia | Medium | Decision confirmed and noted against FR-9. |
| 3 | Technical/Docs | Decide + document the `openModal` **returnValue-reset policy** in `modal.js` (E0 action #2), retro-auditing the E1.5 `#clear-scrollback-confirm` modal — do it **before** E2.3's Serial Config modal. | Winston + Amelia | Medium | Policy documented in `modal.js`; clear-scrollback modal audited against it. |
| 4 | Process/Tracking | Add a codified "menu-driven testing idioms" note (open via `window.__menuBar.open`, `force:true` on `aria-disabled`, snap-to-bottom as the scrollback-flush fingerprint) so E2/E3/E6 don't rediscover them. | Amelia | Low | Idioms captured where the next menu-story author will see them. |
| 5 | Process/Tracking | Ensure the `#top-bar`/`<details>` coexistence variance is tracked to its E7 close-out, so the dual-chrome window is never shipped to users mid-migration and the neutral-shell pin retires with it. | Amelia | Low | Tracking item exists tying `#top-bar` deletion + pin retirement to E7. |

## Post-Retro Resolutions (2026-07-02, same session)

Three of the five action items were closed immediately after the retro, with Ant present:

- **#1 Flake fix — DONE + verified.** `playwright.config.js` now isolates the 25 wasm-heavy
  transport specs into their own `chromium-transport` project with `fullyParallel: false` (peak
  concurrent wasm boots capped at the worker count, not the whole set), plus `retries: 1` as a
  self-healing backstop for residual boot-under-load timeouts. Verified at full parallelism:
  **397 passed / 1 skipped / 0 hard failures** (transport 169, light 228); the few starvation
  timeouts that still occur are absorbed by the automatic retry — no `--workers=1` re-diagnosis
  needed. This also closes **E0 action #1** (two epics overdue).
- **#2 Font disable-off-CRT — RATIFIED.** Ant confirmed: Font selection disabled when not in CRT
  mode is the intended behavior. The shipped code stands; no change.
- **#3 openModal returnValue-reset policy — DOCUMENTED.** A "Policy for new modals" block was added
  to `modal.js`'s header (reset-to-`''` before `showModal()`; affirmative = non-empty tag; caller
  maps `''`/cancel → bail; destructive actions default-focus Cancel + restore to terminal). The
  E1.5 `#clear-scrollback-confirm` modal was audited and conforms. Closes **E0 action #2**.

Remaining open: **#4** (codify menu-driven testing idioms) and **#5** (track coexistence variance to
E7) — both low-priority tracking items.

## Readiness Assessment

| Dimension | Status |
| --- | --- |
| Stories complete | ✅ 5/5 done |
| Named-oracle regression contracts | ✅ All green in isolation (`--workers=1`) |
| Full parallel suite | ⚠️ Green modulo the known E0 flake (all pass isolated) — action #1 |
| Code review | ✅ E1.4 fixes applied (v1.1); E1.5 clean |
| Behavior loss | ✅ None — pure-relocation premise held |
| Open unratified decisions | ⚠️ Font-disable-off-CRT (action #2); openModal reset policy (action #3) |
| Deployment/stakeholder gates | N/A — no user-facing release cut this epic; migration mid-flight (coexistence variance) |

**Verdict:** E1 is complete and E2 is clear to proceed. Two decisions (actions #2, #3) should be
closed before or early in E2 since E2.3 is the first substantial modal. The flake fix (action #1) is
now genuinely overdue and should not ride into a third epic.
