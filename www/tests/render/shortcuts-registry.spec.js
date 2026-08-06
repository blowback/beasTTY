// Code-review #7 — the keyboard-shortcut registry is the ONE source of truth for both
// the chord handlers (chrome.js theme/zoom, keyboard.js copy/paste) and the Help ▸
// Keyboard Shortcuts modal. This spec pins the two halves of every mechanical entry
// together so they cannot drift:
//
//   1. Each row's `match` predicate fires for the event its `keys` label advertises,
//      and does NOT fire when a modifier is off by one (the exact class of bug the old
//      hand-transcribed modal could hide — a handler rebind the modal didn't follow).
//   2. The registry still covers every FR-24 chord the modal spec asserts (so an
//      accidental deletion here is caught independently of the render test).
//
// Pure-module import in the page context — same pattern as file-source.spec.js's
// validateCpmFilename unit tests (page.evaluate(import('./input/shortcuts.js'))).
import { test, expect } from '@playwright/test';

// Canonical event (the physical keys the LABEL implies) + a near-miss that must NOT
// match, per chord label. The predicates read only these five fields, so a plain object
// is a faithful stand-in for a KeyboardEvent.
//
// `hit`/`miss` may be a single probe or an ARRAY of them — a label advertising two
// chords (the command-history toggle) has to prove BOTH arms, or half the label could
// rot unnoticed.
const PROBES = {
  'Ctrl+Alt+T':   { hit: { ctrlKey: true, altKey: true, code: 'KeyT' },
                    miss: { ctrlKey: true, altKey: true, shiftKey: true, code: 'KeyT' } },   // Alt+Shift+T ≠ chord
  'Ctrl+=':       { hit: { ctrlKey: true, code: 'Equal' },
                    miss: { ctrlKey: true, shiftKey: true, code: 'Equal' } },
  'Ctrl+-':       { hit: { ctrlKey: true, code: 'Minus' },
                    miss: { ctrlKey: true, altKey: true, code: 'Minus' } },
  'Ctrl+0':       { hit: { ctrlKey: true, code: 'Digit0' },
                    miss: { code: 'Digit0' } },                                              // no Ctrl → not the chord
  'Ctrl+Shift+C': { hit: { ctrlKey: true, shiftKey: true, code: 'KeyC' },
                    miss: { ctrlKey: true, code: 'KeyC' } },                                 // bare Ctrl+C encodes 0x03
  'Ctrl+Shift+V': { hit: { ctrlKey: true, shiftKey: true, code: 'KeyV' },
                    miss: { ctrlKey: true, code: 'KeyV' } },                                 // bare Ctrl+V encodes 0x16
  'Ctrl+Shift+Esc': { hit: { ctrlKey: true, shiftKey: true, code: 'Escape' },
                      miss: { code: 'Escape' } },                                            // bare Esc must reach VT52 workloads
  'Ctrl+Shift+Insert / Ctrl+Alt+H': {
    hit: [{ ctrlKey: true, shiftKey: true, code: 'Insert' },
          { ctrlKey: true, altKey: true, code: 'KeyH' }],
    // Bare Insert is a silent drop (keyboard.js D-17) and bare Ctrl+H encodes 0x08 —
    // neither may be swallowed by this chord. Ctrl+Shift+H is a third near-miss:
    // the two arms must not blur into "Ctrl + any of Shift/Alt + Insert/H".
    miss: [{ code: 'Insert' },
           { ctrlKey: true, code: 'KeyH' },
           { ctrlKey: true, shiftKey: true, code: 'KeyH' }],
  },
};

test('every matchable chord label agrees with its predicate @fast', async ({ page }) => {
  await page.goto('/');
  const result = await page.evaluate(async (probes) => {
    const { SHORTCUT_GROUPS } = await import('./input/shortcuts.js');
    const rows = SHORTCUT_GROUPS.flatMap((g) => g.rows);
    const matchable = rows.filter((r) => typeof r.match === 'function');
    const out = { checked: [], missingProbe: [], hitFail: [], missFail: [] };
    for (const r of matchable) {
      const p = probes[r.keys];
      if (!p) { out.missingProbe.push(r.keys); continue; }
      out.checked.push(r.keys);
      const asList = (v) => (Array.isArray(v) ? v : [v]);
      // Truthiness, not strict === true: the handlers use these predicates in an `if`,
      // and `a && b && c` legitimately short-circuits to a falsy non-boolean.
      if (asList(p.hit).some((ev) => !r.match(ev))) out.hitFail.push(r.keys);
      if (asList(p.miss).some((ev) => r.match(ev))) out.missFail.push(r.keys);
    }
    return out;
  }, PROBES);

  // A matchable row with no probe here means a new mechanical chord was added without a
  // pin — fail loudly rather than silently skip it.
  expect(result.missingProbe).toEqual([]);
  // Label advertises a chord its predicate does not accept → the modal would lie.
  expect(result.hitFail).toEqual([]);
  // Predicate accepts a near-miss its label does not advertise → over-broad handler.
  expect(result.missFail).toEqual([]);
  // Sanity: we actually exercised all eight mechanical chords.
  expect(result.checked.sort()).toEqual(
    ['Ctrl+-', 'Ctrl+0', 'Ctrl+=', 'Ctrl+Alt+T', 'Ctrl+Shift+C', 'Ctrl+Shift+V',
     'Ctrl+Shift+Esc', 'Ctrl+Shift+Insert / Ctrl+Alt+H'].sort(),
  );
});

test('registry covers every FR-24 chord the modal advertises @fast', async ({ page }) => {
  await page.goto('/');
  const labels = await page.evaluate(async () => {
    const { SHORTCUT_GROUPS } = await import('./input/shortcuts.js');
    return SHORTCUT_GROUPS.flatMap((g) => g.rows.map((r) => r.keys));
  });
  for (const combo of [
    'Ctrl+Alt+T', 'Ctrl+=', 'Ctrl+-', 'Ctrl+0',
    'Ctrl+Shift+C', 'Ctrl+Shift+V', 'Esc', 'Ctrl+W / Ctrl+N / Ctrl+T',
    // E8 escape hatch (2026-08-06) — the toggle chords and the informational
    // ↑/↓ bypass row that documents the per-keypress escape.
    'Ctrl+Shift+Esc', 'Ctrl+Shift+Insert / Ctrl+Alt+H', 'Ctrl+Shift+↑ / Ctrl+Shift+↓',
  ]) {
    expect(labels).toContain(combo);
  }
});
