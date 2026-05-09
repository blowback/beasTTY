---
status: diagnosed
trigger: "UAT Test 7: typing 'B:RM *.* ; SLIDE R' into Settings auto-send field shows no red border"
created: 2026-05-09T00:30:00Z
updated: 2026-05-09T00:35:00Z
---

## Current Focus

reasoning_checkpoint:
  hypothesis: "The `#settings-slide #slide-auto-send-input` rule (specificity 0,2,0,0) overrides the `#slide-auto-send-input[data-invalid=\"true\"]` rule (specificity 0,1,1,0) so the data-invalid `border-color` never applies. The JS path correctly toggles `data-invalid='true'` but CSS specificity wins for the parent compound selector, leaving the original `--chrome-border` color (`rgba(255,255,255,0.08)`) painted."
  confirming_evidence:
    - "index.html:217-225 — the active border style is set via `#settings-slide #slide-auto-send-input { border: 1px solid var(--chrome-border) }`. Two-ID selector → specificity (0,2,0,0)."
    - "index.html:735-737 — the invalid-state rule is `#slide-auto-send-input[data-invalid=\"true\"] { border-color: rgba(255,255,255,0.6) }`. One-ID + one-attribute selector → specificity (0,1,1,0). LOSES."
    - "index.html:969 confirms `#slide-auto-send-input` is inside `<details id=\"settings-slide\">`, so the compound selector matches."
    - "main.js:582-605 (change handler) AND main.js:573-578 (boot-time sync) both correctly compute `cmdWithCr = v + '\\r'` and call `setAttribute('data-invalid','true')` — the JS half of the contract is honored. The attribute IS set on the DOM element; CSS just doesn't paint it."
    - "Plan 12-03 author was aware of the 'no red — uses neutral muted token' policy (comment at index.html:734) — the intended invalid color IS muted (rgba(255,255,255,0.6)), so even if it painted the user might not perceive it as 'red'. But specificity prevents it from painting at all."
  falsification_test: "Open DevTools on the Settings pane with an unsafe value typed in. Inspect the input — `data-invalid='true'` attribute IS present in the DOM (proves JS works). Then check Computed → border-color: it should read `rgba(255,255,255,0.08)` (winning rule), NOT `rgba(255,255,255,0.6)` (intended invalid rule). Confirming this would prove specificity is the cause."
  fix_rationale: "Bump the invalid-state selector's specificity to match or beat (0,2,0,0). Either: (a) prefix with `#settings-slide` → `#settings-slide #slide-auto-send-input[data-invalid=\"true\"]` (0,2,1,0); or (b) keep declaration but use full `border` shorthand (border: 1px solid …) so it cascades cleanly when both rules apply at equal weight; or (c) add `!important`. Option (a) is cleanest — matches existing pattern at lines 217+227. This addresses the root cause (cascade) not just the symptom."
  blind_spots: "Did not run the page in a browser to confirm computed style live. Did not verify whether the `.validation-hint` row also has a specificity collision — the hint hide/show is driven by the `hidden` HTML attribute + `[hidden] { display:none }` rule, which is the well-trodden idiom and should work. Test 7 reporter only mentioned 'no red border' so the hint visibility status is unverified — but the hint-toggling code path runs only inside slide.js use-time gate (after Send-file click), not on the Settings change handler, so user blurring the field would NOT show the hint by design (UI-SPEC §D)."

## Symptoms

expected: "Typing unsafe value (e.g. 'B:RM *.* ; SLIDE R') into #slide-auto-send-input and blurring the field paints a muted-tone border via the [data-invalid='true'] rule + (separately, on Send-file click) shows the validation-hint sub-row."
actual: "User reports 'nope, no red border'. Validation-hint visibility unverified by user."
errors: "[none — silent CSS cascade defeat, no console warnings]"
reproduction: "1) Open www/index.html in Chromium. 2) Click Settings. 3) Expand SLIDE file transfer details. 4) Type 'B:RM *.* ; SLIDE R' into Auto-send command. 5) Tab/click out (blur fires change event). 6) Observe input border color — remains the default rgba(255,255,255,0.08) instead of rgba(255,255,255,0.6)."
started: "Phase 12 Plan 12-03 commit 27d4872 (Task 3) — when Settings input visual cue was added."

## Eliminated

- hypothesis: "Event listener wired to wrong event"
  evidence: "main.js:582 wires `change` event correctly. `change` fires on blur for text inputs, which matches the user's reproduction step. JS attribute-setting code at 595-604 IS correct."
  timestamp: 2026-05-09T00:33:00Z

- hypothesis: "JS forgot to append `\\r` so isAutoSendSafe sees a different string"
  evidence: "main.js:587 correctly computes `cmdWithCr = v.length === 0 ? '' : v + '\\r'`. For input 'B:RM *.* ; SLIDE R', isAutoSendSafe still returns false because '*', '.', and ';' are not in the [A-Za-z0-9: ] character class. Either way, the unsafe input is correctly classified."
  timestamp: 2026-05-09T00:33:00Z

- hypothesis: "Boot-time sync not running on reload"
  evidence: "main.js:573-578 implements the boot-time sync correctly inside `if (slideAutoSendInput)`. It runs on page load. But this code path also writes `data-invalid='true'` via setAttribute, which is then defeated by the same CSS specificity bug."
  timestamp: 2026-05-09T00:34:00Z

- hypothesis: "A typo in the CSS attribute selector"
  evidence: "index.html:735 reads `#slide-auto-send-input[data-invalid=\"true\"]` — exact match for the JS-set attribute (main.js:599 sets `'data-invalid', 'true'`). No typo."
  timestamp: 2026-05-09T00:34:00Z

- hypothesis: "Missing CSS rule"
  evidence: "Rule exists at index.html:735-737. Selector matches. Property is `border-color: rgba(255,255,255,0.6)`."
  timestamp: 2026-05-09T00:34:00Z

## Evidence

- timestamp: 2026-05-09T00:31:00Z
  checked: "12-03-SUMMARY.md §Files Modified §www/main.js"
  found: "Settings input change handler documented as 'computes cmdWithCr = value + \\r, toggles data-invalid + aria-invalid + validation-hint visibility based on isAutoSendSafe, persists via savePrefs while resetting slideAutoSendCommandConfirmed = '''. Plan author intent matches reality."
  implication: "The plan's intent was correct; defect is in execution layer, not design."

- timestamp: 2026-05-09T00:31:30Z
  checked: "www/state/prefs.js:174 SAFE_AUTO_SEND_RE + isAutoSendSafe export"
  found: "Regex `/^[A-Za-z0-9: ]*\\r$/` — Plan 12-03 widened class to include space. For input 'B:RM *.* ; SLIDE R\\r' the chars `*`, `.`, `;` are NOT in the class so the test correctly returns false. Helper is exported, named correctly, and works."
  implication: "Layer 2 (pure helper) is healthy."

- timestamp: 2026-05-09T00:32:00Z
  checked: "www/main.js:558-615 Settings input wiring"
  found: "(a) wired to '#slide-auto-send-input' element (line 558). (b) computes `cmdWithCr = v + '\\r'` (line 587). (c) calls setAttribute('data-invalid','true') (line 599) and removeAttribute (line 595). (d) toggles `slideAutoSendValidationHint.hidden = true` on safe path (line 597). (e) listens for 'change' event (line 582) — fires on blur. (f) no early-return path skips the visual-cue branch. (g) boot-time sync (lines 573-578) runs on page load too. ALL JS WIRING IS CORRECT."
  implication: "Layer 1 (event wiring) is healthy."

- timestamp: 2026-05-09T00:32:30Z
  checked: "www/transport/slide.js:214-244 readAutoSendCommandBytes use-time gate"
  found: "Use-time gate (line 232 isAutoSendSafe(cmd)) sets data-invalid (line 241) AND unhides validation-hint (line 244). This path runs on Send-file click, NOT on Settings change. By UI-SPEC §D this is intentional: validation-hint stays hidden on Settings change; only use-time fires it. So the user's report of 'no red border' is the relevant signal — they did not click Send-file in test 7."
  implication: "Hint not showing on Settings blur is by design; expected only the border to change."

- timestamp: 2026-05-09T00:32:45Z
  checked: "www/index.html:217-225 — base border styling"
  found: "`#settings-slide #slide-auto-send-input, #settings-slide #slide-compat-select { ... border: 1px solid var(--chrome-border); ... }` — TWO-ID compound selector → CSS specificity (0,2,0,0). `--chrome-border` resolves to `rgba(255,255,255,0.08)` (default theme) or unchanged for crt theme."
  implication: "This is the rule painting the actual border."

- timestamp: 2026-05-09T00:33:00Z
  checked: "www/index.html:735-737 — invalid state rule"
  found: "`#slide-auto-send-input[data-invalid=\"true\"] { border-color: rgba(255, 255, 255, 0.6); }` — ONE-ID + ONE-attribute → specificity (0,1,1,0). DOES NOT include `#settings-slide` ancestor."
  implication: "ROOT CAUSE: specificity (0,1,1,0) loses to (0,2,0,0). The base border declaration wins; data-invalid is never visible."

- timestamp: 2026-05-09T00:33:30Z
  checked: "www/index.html:969 — DOM hierarchy confirmation"
  found: "`<details class=\"reserved\" id=\"settings-slide\">` wraps `<input id=\"slide-auto-send-input\">` (line 993). Confirms the compound parent selector matches."
  implication: "Specificity collision is real, not a false alarm from a non-matching parent."

- timestamp: 2026-05-09T00:34:00Z
  checked: "www/index.html:730-734 — author comments on intended color tone"
  found: "Comment block: 'Muted border + validation hint row. Visual cue ONLY — does NOT block savePrefs ... muted/destructive policy reaffirmed (no red — uses neutral muted token).'"
  implication: "Even if the rule painted, the intended color is muted-not-red. User's phrasing 'no red border' is consistent with the design (Beastty uses muted, not red, per project policy). But the deeper bug is the rule isn't applying at all due to specificity. Once fixed, user should be told the border tone is muted-by-design — not red."

## Resolution

root_cause: "CSS specificity collision: `#settings-slide #slide-auto-send-input` (index.html:217, specificity 0,2,0,0) declares `border: 1px solid var(--chrome-border)` and BEATS `#slide-auto-send-input[data-invalid=\"true\"]` (index.html:735, specificity 0,1,1,0) which only sets `border-color`. The data-invalid rule never paints. The JS layer correctly sets `data-invalid='true'` on the DOM but the cascade discards the visual cue."
fix: "[for /gsd-plan-phase --gaps] Increase specificity of the invalid rule to match or beat (0,2,0,0). Recommended: change line 735 to `#settings-slide #slide-auto-send-input[data-invalid=\"true\"]` (specificity 0,2,1,0 — matches existing pattern at lines 217 + 227). Same edit may be needed for any sibling invalid-state rules. Note: the intended color tone is muted (rgba(255,255,255,0.6)), NOT red — Beastty's muted/destructive policy (12-UI-SPEC) forbids red. User's expectation of 'red' is at odds with project design."
verification: "[empty — read-only diagnosis]"
files_changed: []
