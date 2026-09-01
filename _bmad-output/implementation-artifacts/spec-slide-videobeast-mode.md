---
title: 'SLIDE VideoBeast mode'
type: 'feature'
created: '2026-09-01'
status: 'done'
context: []
baseline_commit: '182f3797bd22e59144bfed9582af190a708b915c'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** Newer slide.com binaries accept a `V` suffix on the receive argument (`RV`), meaning "write the incoming payload straight into VideoBeast video memory". Beastty hardcodes the receive direction as `R`, so there is no way to drive a VideoBeast transfer from the app.

**Approach:** Add a "VideoBeast mode" checkbox to the SLIDE File Transfer modal, persisted as a new pref. When on, the command Beastty auto-types at the CP/M prompt ends ` RV` instead of ` R`. The protocol, the chip lifecycle and the pull direction are untouched.

## Boundaries & Constraints

**Always:**
- Plain boolean pref, default **off** — existing users and older slide.com binaries keep today's exact bytes.
- `readAutoSendCommandBytes()` in `slide.js` stays the single composition site and the only wire-safety boundary. The existing program-name grammar check still runs first.
- The `V` glues to the `R` as one CP/M argument: `A:SLIDE.COM RV\r`, never `A:SLIDE.COM R V\r`.
- The checkbox uses the modal's existing `.field.check` row shape (checkbox → label → ⓘ `.field-tip`) and the same boot-hydrate + `change → savePrefs` + `PREF_CONTROL_MIRRORS` triple as every other SLIDE checkbox.

**Ask First:**
- Any `CURRENT_VERSION` bump in `prefs.js` (the defensive spread-merge should make one unnecessary — same precedent as `slideConfirmTransfers`).
- Any change to the pull direction (` S `), the SLIDE state machine, the chip lifecycle, or the wire protocol.

**Never:**
- Do not touch `pull-pane.js` — pulls do not read VideoBeast memory, so ` S ` is unchanged.
- Do not touch `echo-swallow.js`. It is handed the actual auto-typed bytes by `enterSendMode`, so the longer command swallows correctly with no change.
- Do not add validation, a warning, or a slide.com version probe. Beastty cannot tell which binary is on the device; the user asserts it with the tickbox.
- Do not modify `crates/` or the SLIDE framing.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Default | pref absent or false, `A:` + `SLIDE.COM` | wire gets `A:SLIDE.COM R\r` | N/A |
| VideoBeast on | pref true, `B:` + `SLIDE` | wire gets `B:SLIDE RV\r` | N/A |
| Auto-start off | pref true, `slideAutoStart: false` | nothing typed (zero-length array) | N/A |
| Invalid location | pref true, name `SLIDE;RM` | nothing typed; existing console.error + chip error + `data-invalid` cue fire unchanged | grammar check wins before the pref is consulted |
| No prefs object | `livePrefs()` returns null (older harness) | shipped fallback `A:SLIDE.COM R\r` — no pref to read, so plain `R` | N/A |
| Pull | pref true, drag out of pull pane | pull command still ` S ` | N/A |
| Reset all preferences | pref true, user resets | pref returns to false, checkbox unticks in place, no reload | N/A |

</frozen-after-approval>

## Code Map

- `www/state/prefs.js` -- `DEFAULTS` (~L54, beside `slideAutoStart`). `slideProgramPath()` (~L377) excludes the direction letter by design — leave it.
- `www/transport/slide.js` -- `AUTO_SEND_DIRECTION = ' R\r'` (L246); used at L254 (no-prefs fallback, keeps plain `R`) and L276 (live-prefs path, gains the `V`).
- `www/index.html` -- `<dialog id="slide-config-modal">`; insert after `#slide-auto-start-row` (~L2755).
- `www/main.js` -- boot wiring beside `slideAutoStartCheckbox` (~L1370); `PREF_CONTROL_MIRRORS` (~L1780).
- `www/tests/transport/slide-program-location.spec.js` -- owns `sendAndReadWire(page)` and the existing `'B:SLIDE R\r'` assertions.
- `www/tests/transport/slide-prefs.spec.js` -- pref default / persistence / reset conventions.

## Tasks & Acceptance

**Execution:**
- [x] `www/state/prefs.js` -- add `slideVideoBeastMode: false` to `DEFAULTS`, commented with what `V` means to slide.com -- new booleans ride the spread-merge, no version bump.
- [x] `www/transport/slide.js` -- split `AUTO_SEND_DIRECTION` into the `R` and `RV` forms and pick between them from the live pref at the L276 site; leave L254 on plain `R` -- one composition site, backwards-compatible default.
- [x] `www/index.html` -- add `#slide-videobeast-row` (`.field.check`, `#slide-videobeast-checkbox`, label "VideoBeast mode", ⓘ tip naming the `RV` argument and the newer-slide.com requirement) after `#slide-auto-start-row`.
- [x] `www/main.js` -- boot-hydrate, `change → savePrefs`, and a `PREF_CONTROL_MIRRORS` entry (`kind: 'bool'`) -- same triple as `slide-show-summary`.
- [x] `www/tests/transport/slide-program-location.spec.js` -- wire tests for the matrix rows (default `R`, pref-on `RV`, auto-start off, invalid location) -- these bytes are the contract that reaches real hardware.
- [x] `www/tests/transport/slide-prefs.spec.js` -- default false, persists across reload, unticks on Reset all preferences.

**Acceptance Criteria:**
- Given the SLIDE File Transfer modal is open, when the user reads the rows, then "VideoBeast mode" appears after "Auto-start SLIDE on the device", unticked, with an ⓘ tip explaining it needs a newer slide.com.
- Given VideoBeast mode is ticked, when the user closes the modal and sends a file without reloading, then the next transfer types the `RV` form — composition reads prefs live per the existing `livePrefs()` contract.
- Given VideoBeast mode is ticked and CP/M echoes the auto-typed command, when the echo arrives, then it is swallowed with no double-print (`echo-swallow.js` unchanged).
- Given the full Playwright chromium suite, when it runs, then it passes with no existing SLIDE spec modified beyond additions.

## Spec Change Log

### 2026-09-01 — review pass 1 (no loopback)

Three reviewers ran (blind hunter, edge-case hunter, acceptance auditor). No `intent_gap`
and no `bad_spec` finding, so the spec itself was not amended and the code was not
re-derived. Recorded here for traceability.

**Patched in place (8):** banned word "gate" in a new test title; invalid-location test
weaker than its matrix row (added `not.toContain('SLIDE')` to match the sibling case);
dead trailing `__resetForTests` (`setupConnected` already resets); no click→wire coverage
of the checkbox itself (added); no render-spec row test pinning label + tip copy (added,
following that file's per-row pattern); ⓘ tip did not mention that the row is a no-op
while auto-start is off (added); "Append `V`" comment described concatenation the code
does not do; `README.md` settings enumeration missing the new row.

**Rejected (verified false):** wire tests called timing-dependent on the 250 ms save
debounce — `savePrefs` updates the in-memory `cached` blob synchronously and `livePrefs()`
reads that, which the pre-existing "location change reaches the wire with no page reload"
test already pins. Row-numbering off-by-one — verified 1–7 sequential in DOM order (the
change also fixed a pre-existing duplicate "Row 3"). Pull test asserting `review.command`
rather than wire bytes — matches the pre-existing sibling test exactly, and pull composes
from its own `CMD_DIRECTION` constant. No use-time validation of the boolean against a
corrupt blob — identical to every other boolean pref in this codebase.

**Deferred (see `deferred-work.md`):** beast-to-beast copies honour the mode while the
copy modal still promises a file copy; the mode is a per-device fact stored as a
per-origin pref.

**KEEP if ever re-derived:** the direction must be chosen *after* the location grammar
check in `readAutoSendCommandBytes`, and `PREF_CONTROL_MIRRORS` must use `kind: 'bool'`
(not `boolDefault`) so a default-false pref does not tick itself on reset.

## Design Notes

```js
// www/transport/slide.js
const AUTO_SEND_DIRECTION    = ' R\r';
const AUTO_SEND_DIRECTION_VB = ' RV\r';   // VideoBeast: write to video memory

// inside readAutoSendCommandBytes(), after the grammar check:
const direction = p.slideVideoBeastMode ? AUTO_SEND_DIRECTION_VB : AUTO_SEND_DIRECTION;
return new TextEncoder().encode(path + direction);
```

This is a fact the user asserts about their device ("the binary on my MicroBeast understands `V`"), not a command they type — consistent with how the SLIDE.COM location was modelled in v2. Hence a checkbox beside auto-start, not an editable command line.

## Verification

**Commands:**
- `cd www && npx playwright test --project=chromium-transport tests/transport/slide-program-location.spec.js tests/transport/slide-prefs.spec.js` -- expected: all pass, including the new `RV` wire assertions. (Transport specs live in the `chromium-transport` project, not `chromium` — `npm test` filters to `--project=chromium` and would skip them entirely.)
- `cd www && npx playwright test` -- expected: both projects green.

**Manual checks:**
- Settings ▸ SLIDE File Transfer: the new row aligns with the other checkbox rows, the ⓘ tip opens on hover and focus, nothing below it shifts.

## Suggested Review Order

**The wire — what actually reaches the MicroBeast**

- The whole feature in three lines: direction picked from the live pref, after the location check.
  [`slide.js:284`](../../www/transport/slide.js#L284)

- The second direction constant. The `V` is glued to the `R` as one CP/M argument.
  [`slide.js:252`](../../www/transport/slide.js#L252)

**The stored fact**

- New pref, default off, no `CURRENT_VERSION` bump — rides the defensive spread-merge.
  [`prefs.js:58`](../../www/state/prefs.js#L58)

- `kind: 'bool'`, not `boolDefault` — a default-false pref must not tick itself on reset.
  [`main.js:1792`](../../www/main.js#L1792)

- Boot hydration + `change → savePrefs`; the same triple as every other SLIDE checkbox.
  [`main.js:1441`](../../www/main.js#L1441)

**The control**

- The row, its copy, and the ⓘ tip naming the auto-start dependency.
  [`index.html:2767`](../../www/index.html#L2767)

**Tests and docs**

- The core contract: pref on produces `B:SLIDE RV\r` on the wire.
  [`slide-program-location.spec.js:301`](../../www/tests/transport/slide-program-location.spec.js#L301)

- Drives the real checkbox through to the wire — pins the main.js wiring end to end.
  [`slide-program-location.spec.js:339`](../../www/tests/transport/slide-program-location.spec.js#L339)

- Default off, persists on, unticks on reset.
  [`slide-prefs.spec.js:141`](../../www/tests/transport/slide-prefs.spec.js#L141)

- Pins the label and tip copy, following the file's per-row pattern.
  [`slide-config-modal.spec.js:115`](../../www/tests/render/slide-config-modal.spec.js#L115)

- The settings enumeration users actually read.
  [`README.md:252`](../../README.md#L252)
