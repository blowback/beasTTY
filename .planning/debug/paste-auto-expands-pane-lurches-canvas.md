---
status: diagnosed
trigger: "whenever i paste, the connection dialog at the top opens, which causes the TTY part of the display to lurch down the screen alarmingly. I know the paste status is in there, but it shouldn't open the dialog."
created: 2026-04-23
updated: 2026-04-23
goal: find_root_cause_only
---

## Current Focus

hypothesis: "Paste-start handler explicitly sets `connectionPane.open = true`, expanding the `<details id=\"connection\">` pane. Because that pane sits ABOVE `#terminal-wrapper` in DOM order and the body uses normal block/flex flow, expanding the pane shifts every subsequent element (including the terminal canvas) down the viewport — exactly the 'lurch' the user reports."
test: "Read main.js paste observer, confirm the .open=true side effect; read index.html DOM order to confirm pane sits above the terminal."
expecting: "Source-of-truth confirmation matches; both observations match the user-reported symptom."
next_action: "Diagnosis confirmed; return ROOT CAUSE FOUND to caller for plan-phase --gaps."

## Symptoms

expected: "During paste, the Connection pane's paste-progress surfaces WITHOUT auto-expanding the <details> and WITHOUT causing the terminal canvas to lurch down the viewport (D-17 / paste UX)."
actual: "Whenever the user pastes, the Connection <details> pane auto-opens, which pushes the terminal canvas down the viewport — feels alarming."
errors: "None — pure UX regression. Paste itself works."
reproduction: "Test 6 in 05-HUMAN-UAT.md: Connect to MicroBeast → click Debug pane Paste test button → observe Connection pane <details> auto-open and the terminal canvas shift down the viewport."
started: "Discovered during real-hardware UAT 2026-04-25; behavior is the documented Wave 5 (Plan 05-06) behavior since Phase 5 implementation."

## Hypotheses

### H1 (PRIMARY): paste observer sets `connectionPane.open = true` — pane sits above terminal in DOM, so expansion pushes canvas down
- **Evidence:**
  - `www/main.js:307-308` — `preExpansionOpen = connectionPane.open; if (!connectionPane.open) connectionPane.open = true;` runs on the `'started'` paste-progress event.
  - `www/index.html` DOM order is: `#top-bar` (line ~) → `<details id="connection">` (line 395) → `#terminal-wrapper` (line 456) → `#settings` (line 463) → `#debug`. The Connection pane is ABOVE the terminal canvas.
  - `www/index.html:93` — `body { display: flex; flex-direction: column; align-items: center; }` — normal column flow. Terminal-wrapper is NOT fixed/sticky, so any preceding sibling growing in height shifts it down.
  - `www/index.html:241-298` — `#connection` collapses to roughly the summary line (~28 px) when closed, but expanded reveals fieldset (~5 form rows × ~24 px), preset button, multiple `.hint` paragraphs, paste-progress row, error log `<pre>` (max-height 9 em ≈ 144 px), and another hint. Open height easily exceeds 350-400 px.
  - The expansion delta (~350-400 px) is the exact "alarming lurch" the user reports.
- **Falsification test:** Run the app, manually expand the Connection pane via clicking its summary — the terminal canvas should shift down by the same amount as the user reports during paste. (No need to actually paste.)
- **Status:** CONFIRMED via static evidence (code + DOM order + CSS).

### H2 (RULED OUT): The paste pump or some other handler is setting `display: block` / `dialog.show()` / animating something
- **Evidence:** Grep across `www/` for `details.open`, `dialog`, `showModal` returned only the `connectionPane.open = true` calls in `main.js` (paste observer) and `serial.js:410` (error-log auto-expand). No `<dialog>` element, no `showModal`, no slide-down animations, no transition on `<details>` height.
- **Status:** ELIMINATED. Only mechanism is the documented `details.open = true`.

### H3 (RULED OUT): The user is misidentifying the offender — maybe it's the Settings or Debug pane that opens
- **Evidence:** Settings pane lives BELOW the terminal-wrapper (`index.html:463`); Debug pane lives below Settings. Neither pane's `.open = true` would push the canvas down. Only the Connection pane (above the canvas) can produce the symptom. User correctly identified Connection pane.
- **Status:** ELIMINATED.

## Evidence

- timestamp: 2026-04-23
  checked: "www/main.js paste observer code"
  found: |
    Lines 305-348 implement the onPastePumpProgress observer. On status === 'started' (line 306-312):
        preExpansionOpen = connectionPane.open;
        if (!connectionPane.open) connectionPane.open = true;
        pasteProgressRow.hidden = false;
        pasteProgressText.textContent = `Pasting ${ev.total} B — 0%`;
    On 'complete' / 'cancelled' / 'cancelled-port-lost' (lines 318-347), after a 2-3 s delay, the previous open state is restored:
        if (preExpansionOpen === false) connectionPane.open = false;
  implication: "Confirms the paste-start path explicitly mutates `<details id=\"connection\">.open` to true. This is the proximate cause of the layout shift the user reports."

- timestamp: 2026-04-23
  checked: "www/index.html DOM order around connection pane and terminal-wrapper"
  found: |
    Line 395:   <details id="connection">
    ... (full pane: summary, port-status, fieldset with 5 selects, reconnect-hint, reset button, hint paragraph, paste-progress-row, recent-errors hint, error-log <pre>, footer hint)
    Line 453:   </details>
    Line 456:   <div id="terminal-wrapper" tabindex="0">
    Line 457:     <canvas id="terminal" tabindex="-1"></canvas>
  implication: "The Connection <details> is a previous sibling of #terminal-wrapper in normal column flow. Expanding it pushes the canvas down by the full height delta of the pane's closed-vs-open state."

- timestamp: 2026-04-23
  checked: "www/index.html body layout + #terminal-wrapper positioning"
  found: |
    Line 93:  body { display: flex; flex-direction: column; align-items: center; }
    Line 85-91: #terminal-wrapper { position: relative; display: inline-block; margin: 16px auto; ... }
  implication: "Body is a normal flex column. #terminal-wrapper is `position: relative` (inline-block) but NOT pinned or sticky — so any growth in a preceding sibling translates 1:1 into the wrapper's vertical position. The canvas has no layout protection against pane expansion above it."

- timestamp: 2026-04-23
  checked: "www/transport/serial.js error-log auto-expand"
  found: |
    Line 410: if (connectionPane) connectionPane.open = true;  // D-27 auto-expand on error
  implication: "There is a SECOND auto-expand site (on new error log entry) — same mechanism, same lurch potential. Any fix should consider both call sites: the user's specific complaint is paste, but the design pattern of 'auto-open the pane to surface state' applies in two places."

- timestamp: 2026-04-23
  checked: "Phase 5 spec (UI-SPEC.md and CONTEXT.md D-17 + D-06)"
  found: |
    UI-SPEC line 511-516 explicitly specifies: "Trigger: Paste starts (`enqueuePaste` called, pane is collapsed) → Behavior: `details.open = true` → Restore: On paste complete/cancel, pane returns to its previous collapsed state."
    CONTEXT D-17 (line 188): "If the Connection pane is collapsed when `enqueuePaste` is called, open it automatically. When the pump finishes (or is cancelled), the progress line clears and the pane returns to its prior expanded/collapsed state."
  implication: "The auto-expand IS the documented spec — implementation faithfully matches D-17. Therefore the bug is in the SPEC (D-17 wording), not in a wayward implementation. The user's UAT report is the first time someone has seen this behavior on real hardware and felt it as 'alarming'. The truth statement in 05-HUMAN-UAT.md gap rewrites D-17: 'paste-progress surfaces WITHOUT auto-expanding the <details>'. So the fix replaces the auto-expand behavior, not patches a bug in the auto-expand code path."

- timestamp: 2026-04-23
  checked: "Pane height delta when expanded vs collapsed"
  found: |
    Collapsed: just <summary> line ≈ 28 px (font-size 14px + padding 4px 0 + border 1px + outer padding 8px 16px).
    Expanded contents (additive):
      - port-status <p> (~20 px)
      - fieldset with 5 inline labels + selects in a flex-wrap row (gap 16px) ≈ ~80-100 px depending on wrap
      - reconnect-hint span (hidden by default) ≈ 0 px
      - Reset to MicroBeast preset button (~30 px)
      - hint paragraph (~36 px wrapped)
      - paste-progress-row (just-revealed) (~32 px)
      - "Recent errors" hint (~20 px)
      - error-log <pre> (initial state '(no recent errors)' ≈ 24 px; max-height 9 em ≈ 144 px when filled)
      - footer hint paragraph (~36 px)
    Total expanded height: ~280-360 px. Collapsed → expanded delta: ~250-330 px = the visible canvas lurch distance.
  implication: "The lurch is large (250+ pixels) because the pane reveals 9+ child elements when opened. Even if the pane only auto-revealed JUST the paste-progress row, that's still a content-driven shift. The cleanest fix is to anchor the paste-progress UI somewhere that doesn't grow the pane (or doesn't sit above the canvas at all)."

## Resolution

root_cause: |
  www/main.js:307-308 — the paste-start observer explicitly sets `connectionPane.open = true` (faithfully implementing spec D-17 / UI-SPEC §Connection pane auto-expand rules). Because `<details id="connection">` is a previous sibling of `#terminal-wrapper` in the body's normal column flow (DOM order top-bar → connection pane → terminal-wrapper), expanding the pane increases its height by ~250-330 px and pushes every subsequent element — including the terminal canvas — that distance down the viewport. The user reads this as the "TTY part of the display lurching down the screen alarmingly."

  This is not a code-vs-spec bug — it's a **specification bug**. D-17 (CONTEXT) and the matching UI-SPEC table both prescribe the auto-expand. The user's UAT report rewrites the truth statement: paste progress should be visible WITHOUT auto-expanding the pane. So D-17 needs to be amended/replaced, and the implementation in main.js needs to follow.

fix: ""  # diagnose-only mode; deferred to plan-phase --gaps

verification: ""  # n/a in diagnose-only mode

files_changed: []  # n/a in diagnose-only mode

## Suggested Fix Direction

The spec hint in the investigation notes nails it: pull the paste-progress UI **out** of the `<details>` so it's always visible without forcing the pane open. Two viable fix shapes:

**Option A (preferred — smallest visual change, no canvas movement at all):**
Move `<div id="paste-progress-row">` out of `<details id="connection">` and place it **inside `#top-bar`** as a flex item that appears (via `[hidden]` toggle) only during active paste. The top-bar is `position: sticky; top: 0`, so the paste indicator rides at the top of the viewport without ever pushing the canvas down. Remove the `connectionPane.open = true` mutation (and the `preExpansionOpen` capture/restore dance) from main.js's `'started'` / `'complete'` / `'cancelled'` / `'cancelled-port-lost'` branches. Spec D-17 + UI-SPEC §Connection pane auto-expand rules update to: "paste progress renders in the top-bar's paste-status slot; pane is NOT auto-expanded."

**Option B (smaller refactor, marginally less ideal):**
Keep `<div id="paste-progress-row">` inside the Connection pane DOM, but **also** lift it out of the `<details>` collapsed-region — i.e., place it **between `<summary>` and the rest of the pane content** AND change CSS so the paste-progress row is rendered even when `<details>` is closed. (This requires breaking the native `<details>` "show only summary when closed" behavior — typically via absolute positioning or a CSS hack like `details:not([open]) > #paste-progress-row { display: flex; }`.) Cleaner than Option A in that the progress stays inside the Connection pane, but messier in CSS and less robust.

**Either option also needs to address the second auto-expand site at `www/transport/serial.js:410`** (D-27 error-log auto-expand) — though that one is rarer (only on actual errors, not every paste) so it may be acceptable to leave or to similarly route to a top-bar slot.

**Specialist hint:** `general` (vanilla HTML + CSS + JS; no framework-specific concerns).
