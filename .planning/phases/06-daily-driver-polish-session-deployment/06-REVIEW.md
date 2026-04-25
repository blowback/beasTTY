---
phase: 06-daily-driver-polish-session-deployment
reviewed: 2026-04-25T00:00:00Z
depth: standard
files_reviewed: 3
files_reviewed_list:
  - www/transport/serial.js
  - www/state/prefs.js
  - www/tests/session/prefs.spec.js
findings:
  critical: 0
  warning: 1
  info: 3
  total: 4
status: issues_found
---

# Phase 6: Code Review Report (Plan 06-09 Gap-Closure Scope)

**Reviewed:** 2026-04-25
**Depth:** standard
**Files Reviewed:** 3
**Status:** issues_found (1 warning, 3 info)

> **Scope note:** This is a `--gaps-only` re-review covering ONLY the three files
> modified by Plan 06-09 (chrome-buttons-non-functional gap closure). The eight
> already-shipped Phase 6 plans were reviewed in the prior full-phase pass; that
> earlier REVIEW.md (5 warnings + 6 info across 30 files) is superseded by this
> file but its open findings (WR-01..WR-05, IN-01..IN-06 in the prior report)
> remain unaddressed and should be triaged separately. This re-review does NOT
> re-assess them.

## Summary

The Plan 06-09 gap closure is sound. The structural fix correctly addresses the
proven Phase 5/6 race surface:

- **`snapPreset()` in `www/transport/serial.js`** now syncs the cached prefs
  blob via `savePrefsFn({ serial: ... })` after mutating the five form `.value`
  fields. Field-name translation (`PRESET_CONFIG.baudRate -> serial.baud`,
  `PRESET_CONFIG.flowControl -> serial.flowControl`) matches the D-32 schema
  shape used elsewhere in the file (form-change listener at lines 251-257).
- **`flushPrefs()` in `www/state/prefs.js`** no longer iterates subscribers.
  The inline comment block (lines 70-79) cleanly documents the rationale and
  the standing invariant. `resetPrefs()` correctly preserves subscriber fan-out
  for the D-35 in-place reset path.
- **`prefs.spec.js`** adds two regression tests that assert the new contract
  (`flushPrefs` is silent; `resetPrefs` still fans out).

Public exports of `prefs.js` are unchanged in name, arity, and shape — confirmed.

One **warning** flags a latent ordering bug in `savePrefs` that predates this
gap closure but is now slightly more exposed because subscribers no longer mask
it via re-application from `flushPrefs`. Three **info** items cover doc drift,
a regression-test that doesn't fully exercise the pre-fix race, and a small
duplication suggestion.

No critical issues. No security vulnerabilities. No new bugs introduced.

---

## Warnings

### WR-01: `savePrefs(partial)` spreads `null` when called before `loadPrefs()` initializes `cached`

**File:** `www/state/prefs.js:64-68`

**Issue:** The module-level `cached` is initialized to `null` (line 29) and only
populated by `loadPrefs()`. If `savePrefs(partial)` is ever called before
`loadPrefs()` runs (e.g. a future test that imports `prefs.js` directly and
calls `savePrefs` without `loadPrefs`, a chrome wiring helper that fires before
main.js's boot order completes, or a regression in the boot order), the merge
silently drops every default field:

```js
cached = { ...cached, ...partial };   // { ...null, ...partial }  →  { ...partial }
```

`{ ...null }` spreads to nothing (no throw), producing a `cached` blob that
**lacks `version` and every other DEFAULTS field**. The 250 ms-later
`flushPrefs` then persists this sparse object. On next page load, `loadPrefs`
reads it back, hits the `typeof parsed.version !== 'number'` branch (line 41),
and falls back to defaults wholesale — silently discarding the user's
just-saved partial.

Pre-fix, `flushPrefs`'s subscriber fan-out gave the chrome a chance to
re-apply state (with whatever was in `cached`), partially masking the data
loss. Post-fix the fan-out is gone, making this latent bug slightly more
exposed if the boot ordering ever regresses.

This is NOT introduced by Plan 06-09 — it predates it — but the gap closure
removed one of the safety nets that previously made it harder to notice.

**Fix:** Guard `savePrefs` against an uninitialized `cached`:

```js
export function savePrefs(partial) {
    if (cached === null) cached = structuredClone(DEFAULTS);   // boot-order safety
    cached = { ...cached, ...partial };
    if (saveTimer) clearTimeout(saveTimer);
    saveTimer = setTimeout(flushPrefs, 250);
}
```

Same guard could be added to `getPrefs()` for symmetry — currently it returns
`null` if called before `loadPrefs`, which would `TypeError` on
`getPrefs().theme`.

---

## Info

### IN-01: `savePrefs` lacks a docstring surfacing the new caller contract

**File:** `www/state/prefs.js:64-68`

**Issue:** The standing invariant introduced by Plan 06-09 — "callers who
mutate prefs-mirrored DOM MUST call `savePrefs` themselves; `flushPrefs` no
longer rescues them via subscribers" — is documented in `06-09-SUMMARY.md`
and inline at `prefs.js:70-79`. But a future contributor reading
`savePrefs` (the entry point) won't see the contract without scrolling down
to the `flushPrefs` comment block.

**Fix:** Add a brief comment above `savePrefs`:

```js
// IMPORTANT: callers who mutate prefs-mirrored DOM (form .value, .checked,
// data-attrs, aria-pressed) MUST call savePrefs themselves to sync the cached
// blob. Since Plan 06-09, flushPrefs (250 ms later) does NOT fan out to
// subscribers, so a missed savePrefs leaves cached out-of-sync with the DOM
// until the next loadPrefs/page-reload. See snapPreset in transport/serial.js
// for the canonical pattern.
export function savePrefs(partial) { ... }
```

---

### IN-02: Second new regression test does not actually demonstrate the pre-fix race

**File:** `www/tests/session/prefs.spec.js:245-260`

**Issue:** The test `'phosphor DOM state survives the 250ms debounce window —
no race-revert'` clicks a phosphor button and asserts `aria-pressed` is still
`'true'` after the 350 ms debounce wait. The test's own comment (lines 254-256)
acknowledges the test would have passed pre-fix too — `applyPrefs` re-applying
the cached state would have set `aria-pressed` to the same value. So this
specific test does not differentiate fixed-vs-broken behavior; it is more of a
contract assertion than a true regression guard.

The first new test (`'flushPrefs does NOT fire subscribers'`, lines 223-243)
IS a true regression guard — it would have failed pre-fix because the spy
subscriber would have been invoked once after the debounce window. So
coverage is not zero, but the second test is weaker than its name suggests.

**Fix:** Either rename to clarify intent (e.g. "phosphor DOM state stable
through debounce window — contract guard") or strengthen by deliberately
desynchronizing cached vs. DOM before the wait — e.g. mutate `aria-pressed`
directly via `evaluate` (bypassing the click handler that calls savePrefs),
then verify the debounce window does NOT revert it. Optional cleanup; current
coverage is acceptable since test #1 carries the actual regression guard.

---

### IN-03: `snapPreset()` field-name translation duplicated across two call sites

**File:** `www/transport/serial.js:251-257, 315-325`

**Issue:** The translation between `PRESET_CONFIG` shape (`baudRate` /
`flowControl` — Web Serial API names) and prefs blob shape (`baud` /
`flowControl` — D-32 schema names) is written out longhand in two places:

1. The form-change listener (lines 252-256) — uses `c.baudRate -> baud`, etc.
2. `snapPreset()` (lines 316-324) — uses `PRESET_CONFIG.baudRate -> baud`, etc.

A future change to add a sixth serial field (or rename one) must be done in
both places or the two paths will silently drift, re-introducing the same
class of bug Plan 06-09 just fixed.

**Fix:** Extract a small helper:

```js
function configToPrefsShape(c) {
    return {
        baud: c.baudRate,
        dataBits: c.dataBits,
        stopBits: c.stopBits,
        parity: c.parity,
        flowControl: c.flowControl,
    };
}
```

Then both call sites become:

```js
if (savePrefsFn) savePrefsFn({ serial: configToPrefsShape(readFormConfig()) });
// and
if (savePrefsFn) savePrefsFn({ serial: configToPrefsShape(PRESET_CONFIG) });
```

Optional refactor — not blocking, but supports the standing invariant by
making the shape-translation discoverable.

---

_Reviewed: 2026-04-25_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_
_Scope: Plan 06-09 gap-closure — 3 files only (NOT a full Phase 6 re-review)_
