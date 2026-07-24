// Epic E8 Story E8.2 — command-history recall overlay (trigger, filter, edit, send).
//
// The VISIBLE half of command history: renderer/command-history.js opens a floating
// overlay on ↑/↓ at an empty prompt, filters (multi-term AND) → navigates →
// Tab-copies → edits locally → Enter-sends. It is the ONLY place in E8 that emits
// bytes to the wire, and it does so by preventDefaulting every key while open so
// keyboard.js never encodes a byte during editing (NFR-2 is structural).
//
// This spec drives REAL keydowns on #terminal-wrapper (the interception must be
// exercised end-to-end, like E8.1's real-keyboard test) and proves the wire bytes
// by reading the TX sink directly (window.__txSink.formatHexStrip / resetTx) — no
// wasm-heavy serial connect, so it stays green in the fully-parallel render
// project on retries:1 (no --workers=1). Covers AC-1…AC-11.
//
// Boot-race guard (E0.1 learning): wait on window.__commandHistoryOverlay AND the
// wasm encoder (canvas sized) before driving real keydowns.
//
// Amended per the E8 retro §6 (2026-07-24) hardware feedback, superseding the
// AC text where they conflict: the list renders oldest→newest top→bottom (newest
// at the bottom, ↑ = older, ↓ = newer); Enter sends the highlighted entry when
// the edit line is empty OR ↑/↓ moved the highlight since the text last changed
// (typed text with an untouched highlight still wins); ←/→ on an empty edit
// line copy the highlight (as Tab); the legend reads "↑↓ select · Tab edit ·
// Enter send · Esc cancel". Internal state stays newest-first (highlight/
// filtered indices are unchanged — only display order and key mappings flipped).
import { test, expect } from '@playwright/test';

// Boot, wait for the overlay + engine + tx-sink hooks, focus the wrapper, then
// clear history + close overlay + reset the TX ring for a known-clean slate.
// Most tests never touch the wasm encoder — the overlay preventDefaults every key
// it handles, so ArrowUp-to-open / filter / Tab / Enter / Esc never reach
// keyboard.js. Only the AC-2 passthrough tests, which encode a real arrow into
// ESC A, additionally await the encoder (waitForEncoder) — keeping this common
// wait light reduces the per-page boot cost under the shared static server.
async function ready(page) {
  await page.goto('/');
  await page.waitForFunction(
    () => window.__commandHistoryOverlay
      && window.__commandHistory
      && window.__txSink,
  );
  await page.locator('#terminal-wrapper').focus();
  await page.evaluate(() => {
    window.__commandHistory.__resetForTests();       // clear store + mirror
    window.__commandHistoryOverlay.__resetForTests(); // close + reset per-open state
    window.__txSink.resetTx();                        // empty the TX ring
  });
}

// The wasm encoder is ready once the canvas has been sized. Only the passthrough
// tests need it (a real ↑ must encode to ESC A via keyboard.js).
async function waitForEncoder(page) {
  await page.waitForFunction(() => document.getElementById('terminal').width > 0);
}

// Seed the history store. `cmds` is oldest-first; committing in order leaves the
// LAST element newest (commit moves each to the head). getHistory() then returns
// them newest-first (reverse of the input).
async function seed(page, cmds) {
  await page.evaluate((list) => {
    for (const c of list) window.__commandHistory.commit(c);
  }, cmds);
}

const ostate  = (page) => page.evaluate(() => window.__commandHistoryOverlay.__getStateForTests());
const history = (page) => page.evaluate(() => window.__commandHistory.getHistory());
const hex     = (page) => page.evaluate(() => window.__txSink.formatHexStrip());
const hidden  = (page) => page.evaluate(() => document.getElementById('command-history-overlay').hasAttribute('hidden'));
const resetTx = (page) => page.evaluate(() => window.__txSink.resetTx());

// ASCII bytes of `s` as an uppercase space-joined hex strip (the formatHexStrip
// format), optionally suffixed with a terminator strip.
async function asciiHex(page, s, term = '0D') {
  return page.evaluate(({ str, t }) => {
    const pairs = [...str].map((c) => (c.charCodeAt(0) & 0xFF).toString(16).padStart(2, '0').toUpperCase());
    return pairs.join(' ') + (t ? ' ' + t : '');
  }, { str: s, t: term });
}

// ============================================================================
test.describe('E8.2 AC-1 — trigger opens only at empty prompt + enabled + non-empty', () => {
  test('↑ opens the overlay with the newest entry highlighted @fast', async ({ page }) => {
    await ready(page);
    await seed(page, ['LIST', 'RUN', '10 PRINT "HELLO FROM Z80"']);  // newest = the PRINT line
    await resetTx(page);

    await page.keyboard.press('ArrowUp');

    expect(await hidden(page)).toBe(false);
    const s = await ostate(page);
    expect(s.isOpen).toBe(true);
    expect(s.total).toBe(3);
    expect(s.highlight).toBe(0);
    expect(s.filtered[0]).toBe('10 PRINT "HELLO FROM Z80"');  // newest highlighted
    expect(s.caption).toBe('3 commands');
    // Trigger preventDefaulted the arrow — nothing reached the wire.
    expect(await hex(page)).toBe('');
  });

  test('↓ also opens the overlay @fast', async ({ page }) => {
    await ready(page);
    await seed(page, ['DIR']);
    await page.keyboard.press('ArrowDown');
    expect((await ostate(page)).isOpen).toBe(true);
  });
});

// ============================================================================
test.describe('E8.2 AC-2 — trigger is inert otherwise: ↑/↓ pass through as VT52 bytes', () => {
  test('empty history → ↑ forwards ESC A (does not open) @fast', async ({ page }) => {
    await ready(page);                          // store empty
    await waitForEncoder(page);
    await resetTx(page);
    await page.keyboard.press('ArrowUp');
    expect((await ostate(page)).isOpen).toBe(false);
    expect(await hidden(page)).toBe(true);
    expect(await hex(page)).toBe('1B 41');      // ESC A reached the wire byte-for-byte
  });

  test('feature disabled → ↑ forwards ESC A (does not open) @fast', async ({ page }) => {
    await ready(page);
    await seed(page, ['LIST']);
    await waitForEncoder(page);
    await page.evaluate(() => window.__prefs.savePrefs({ commandHistoryEnabled: false }));
    await resetTx(page);
    await page.keyboard.press('ArrowUp');
    expect((await ostate(page)).isOpen).toBe(false);
    expect(await hex(page)).toBe('1B 41');
    await page.evaluate(() => window.__prefs.savePrefs({ commandHistoryEnabled: true }));
  });

  test('mid-line (prompt not empty) → ↑ forwards ESC A (does not open) @fast', async ({ page }) => {
    await ready(page);
    await seed(page, ['LIST']);
    await waitForEncoder(page);
    await page.keyboard.type('A');              // real keystroke → mirror non-empty + 0x41 on wire
    expect(await page.evaluate(() => window.__commandHistory.isLineEmpty())).toBe(false);
    await resetTx(page);
    await page.keyboard.press('ArrowUp');
    expect((await ostate(page)).isOpen).toBe(false);
    expect(await hex(page)).toBe('1B 41');
  });
});

// ============================================================================
test.describe('E8.2 AC-3 — filter: whitespace-split AND narrows the list', () => {
  test('typing narrows to AND matches; caption + highlight update @fast', async ({ page }) => {
    await ready(page);
    // newest-first: 10 PRINT..., PRINT FRE(0), RUN, LIST
    await seed(page, ['LIST', 'RUN', 'PRINT FRE(0)', '10 PRINT "HELLO FROM Z80"']);
    await page.keyboard.press('ArrowUp');

    await page.keyboard.type('print');
    let s = await ostate(page);
    expect(s.filtered).toEqual(['10 PRINT "HELLO FROM Z80"', 'PRINT FRE(0)']);
    expect(s.caption).toBe('2 of 4 match');     // single "match"
    expect(s.highlight).toBe(0);                // highlight on the first (newest) match

    await page.keyboard.type(' 10');            // AND-narrow: only the numbered line has "10"
    s = await ostate(page);
    expect(s.filtered).toEqual(['10 PRINT "HELLO FROM Z80"']);
    expect(s.caption).toBe('1 of 4 match');
  });

  test('no match → "No matching commands", typed text retained @fast', async ({ page }) => {
    await ready(page);
    await seed(page, ['LIST', 'RUN']);
    await page.keyboard.press('ArrowUp');
    await page.keyboard.type('zzz');
    const s = await ostate(page);
    expect(s.filtered).toEqual([]);
    expect(s.editText).toBe('zzz');             // retained — still sendable with Enter
    expect(s.caption).toBe('0 of 2 match');
    await expect(page.locator('#command-history-overlay .ch-empty')).toHaveText('No matching commands');
  });
});

// ============================================================================
test.describe('E8.2 AC-4 — navigate: ↑/↓ move the highlight (clamped, no wrap)', () => {
  test('↑/↓ move within the filtered list and clamp at both ends @fast', async ({ page }) => {
    await ready(page);
    await seed(page, ['A', 'B', 'C', 'D']);      // newest-first: D, C, B, A
    await page.keyboard.press('ArrowUp');        // open, highlight 0 (D — bottom row)
    expect((await ostate(page)).highlight).toBe(0);

    // ↑ moves visually up = older = higher newest-first index (retro tweak i).
    await page.keyboard.press('ArrowUp');
    await page.keyboard.press('ArrowUp');
    expect((await ostate(page)).highlight).toBe(2);

    await page.keyboard.press('ArrowDown');
    expect((await ostate(page)).highlight).toBe(1);

    // Clamp at the bottom (newest) — five ↓ from row 1 never goes negative.
    for (let i = 0; i < 5; i++) await page.keyboard.press('ArrowDown');
    expect((await ostate(page)).highlight).toBe(0);

    // Clamp at the top (oldest) — ten ↑ stops at the last row (index 3).
    for (let i = 0; i < 10; i++) await page.keyboard.press('ArrowUp');
    expect((await ostate(page)).highlight).toBe(3);

    // aria-activedescendant tracks the highlight.
    await expect(page.locator('#command-history-overlay .ch-txt'))
      .toHaveAttribute('aria-activedescendant', 'ch-opt-3');
  });
});

// ============================================================================
test.describe('E8.2 AC-5 — Tab copies the highlight into the edit line', () => {
  test('Tab replaces the edit line with the highlighted row (caret at end) @fast', async ({ page }) => {
    await ready(page);
    await seed(page, ['LIST', 'RUN']);           // newest-first: RUN, LIST
    await page.keyboard.press('ArrowUp');        // open, highlight 0 = RUN (bottom)
    await page.keyboard.press('ArrowUp');        // highlight 1 = LIST (visually up)
    await page.keyboard.press('Tab');
    const s = await ostate(page);
    expect(s.editText).toBe('LIST');
    expect(s.caretIndex).toBe(4);                // caret at end
  });

  test('Tab on a no-match list is a no-op @fast', async ({ page }) => {
    await ready(page);
    await seed(page, ['RUN']);
    await page.keyboard.press('ArrowUp');
    await page.keyboard.type('zzz');             // no match
    await page.keyboard.press('Tab');
    expect((await ostate(page)).editText).toBe('zzz');   // unchanged
  });
});

// ============================================================================
test.describe('E8.2 AC-6 — local edit only: ←/→, Backspace, typing; nothing hits the wire', () => {
  test('editing keys update locally and transmit ZERO bytes @fast', async ({ page }) => {
    await ready(page);
    await seed(page, ['LIST', 'RUN']);
    await page.keyboard.press('ArrowUp');
    await resetTx(page);                          // clean ring before editing

    await page.keyboard.type('run');              // insert
    await page.keyboard.press('ArrowLeft');       // move caret
    await page.keyboard.press('Backspace');       // delete before caret ('ru|n' → 'r|n')
    await page.keyboard.press('ArrowRight');
    await page.keyboard.type('x');

    const s = await ostate(page);
    expect(s.editText).toBe('rnx');               // r + n + x (u deleted)
    // STRUCTURAL NFR-2: every key was preventDefaulted → keyboard.js encoded nothing.
    expect(await hex(page)).toBe('');
  });
});

// ============================================================================
test.describe('E8.2 AC-7 — Enter sends the edit line + terminator, closes, commits newest', () => {
  test('Tab-copy then Enter sends exact ASCII + CR, closes, commits newest @fast', async ({ page }) => {
    await ready(page);
    await seed(page, ['LIST', 'RUN']);            // newest-first: RUN, LIST
    await page.keyboard.press('ArrowUp');         // highlight 0 = RUN
    await page.keyboard.press('Tab');             // edit line = RUN
    await resetTx(page);

    await page.keyboard.press('Enter');

    expect(await hex(page)).toBe(await asciiHex(page, 'RUN', '0D'));   // 52 55 4E 0D
    expect(await hidden(page)).toBe(true);        // closed
    expect((await ostate(page)).isOpen).toBe(false);
    expect((await history(page))[0]).toBe('RUN'); // re-sorted newest
    expect(await history(page)).toEqual(['RUN', 'LIST']);  // dedup — no duplicate
  });

  test('Enter on an empty edit line sends the highlighted entry as-is (retro tweak ii) @fast', async ({ page }) => {
    await ready(page);
    await seed(page, ['RUN', 'LIST']);            // newest-first: LIST, RUN
    await page.keyboard.press('ArrowUp');         // open, edit line empty (placeholder)
    await page.keyboard.press('ArrowUp');         // highlight 1 = RUN (visually up)
    await resetTx(page);

    await page.keyboard.press('Enter');           // no Tab — sends the highlight

    expect(await hex(page)).toBe(await asciiHex(page, 'RUN', '0D'));   // 52 55 4E 0D
    expect(await hidden(page)).toBe(true);
    expect(await history(page)).toEqual(['RUN', 'LIST']);  // sent entry re-sorted newest
  });

  test('typed edit text with an untouched highlight still wins (precedence rule) @fast', async ({ page }) => {
    await ready(page);
    await seed(page, ['RUN']);                    // 'ru' filters to RUN → highlighted
    await page.keyboard.press('ArrowUp');
    await page.keyboard.type('ru');               // typing only — no arrow after it
    expect((await ostate(page)).filtered).toEqual(['RUN']);
    await resetTx(page);

    await page.keyboard.press('Enter');           // highlight untouched → 'ru' sent, not RUN

    expect(await hex(page)).toBe(await asciiHex(page, 'ru', '0D'));
    expect((await history(page))[0]).toBe('ru');  // the typed text committed newest
  });

  test('filter → ↑/↓ → Enter sends the arrowed-to highlight, not the filter text @fast', async ({ page }) => {
    await ready(page);
    await seed(page, ['PRINT A', 'LIST', 'PRINT B']);  // newest-first: PRINT B, LIST, PRINT A
    await page.keyboard.press('ArrowUp');
    await page.keyboard.type('print');            // filtered: PRINT B (bottom), PRINT A (top)
    expect((await ostate(page)).filtered).toEqual(['PRINT B', 'PRINT A']);

    await page.keyboard.press('ArrowUp');         // arrow = explicit selection → PRINT A
    expect((await ostate(page)).navigated).toBe(true);
    await resetTx(page);
    await page.keyboard.press('Enter');

    expect(await hex(page)).toBe(await asciiHex(page, 'PRINT A', '0D'));
    expect((await history(page))[0]).toBe('PRINT A');  // the selection committed newest
  });

  test('typing after arrowing resets selection intent — Enter sends the new text @fast', async ({ page }) => {
    await ready(page);
    await seed(page, ['PRINT A', 'PRINT B']);
    await page.keyboard.press('ArrowUp');
    await page.keyboard.type('print');
    await page.keyboard.press('ArrowUp');         // navigated
    await page.keyboard.type('x');                // text changed → intent reset ('printx', no match)
    expect((await ostate(page)).navigated).toBe(false);
    await resetTx(page);

    await page.keyboard.press('Enter');

    expect(await hex(page)).toBe(await asciiHex(page, 'printx', '0D'));
  });

  test('terminator follows getCrlfMode — LF via a seeded prefs blob @fast', async ({ page }) => {
    // A stored crlfMode of 'lf' is applied at boot (applyPrefs → setCrlfMode), so
    // the overlay's injected getCrlfMode returns 'lf' and the terminator is 0x0A.
    await page.goto('/');
    await page.waitForFunction(() => window.__commandHistoryOverlay);
    await page.evaluate(() => localStorage.setItem('beastty.prefs',
      JSON.stringify({ version: 1, crlfMode: 'lf', commandHistory: ['RUN', 'LIST'] })));
    await page.reload();
    // Wait until boot has applied the stored crlfMode (applyPrefs → setCrlfMode),
    // so the overlay's injected getCrlfMode returns 'lf' — deterministic, no
    // dependency on canvas timing.
    await page.waitForFunction(
      () => window.__commandHistoryOverlay
        && window.__keyboardState && window.__keyboardState.getCrlfMode() === 'lf');
    await page.locator('#terminal-wrapper').focus();

    await page.keyboard.press('ArrowUp');         // highlight 0 = RUN (stored newest-first)
    await page.keyboard.press('Tab');
    await page.evaluate(() => window.__txSink.resetTx());
    await page.keyboard.press('Enter');

    expect(await hex(page)).toBe(await asciiHex(page, 'RUN', '0A'));   // 52 55 4E 0A
  });
});

// ============================================================================
test.describe('E8.2 AC-8 — Esc closes, sends nothing, leaves the prompt empty', () => {
  test('Esc closes without transmitting and keeps the mirror empty @fast', async ({ page }) => {
    await ready(page);
    await seed(page, ['LIST', 'RUN']);
    await page.keyboard.press('ArrowUp');
    await page.keyboard.type('run');
    await resetTx(page);

    await page.keyboard.press('Escape');

    expect(await hidden(page)).toBe(true);
    expect((await ostate(page)).isOpen).toBe(false);
    expect(await hex(page)).toBe('');             // 0x1B never reached the wire
    expect(await page.evaluate(() => window.__commandHistory.isLineEmpty())).toBe(true);
  });
});

// ============================================================================
test.describe('E8.2 AC-9 — always-visible key-hint legend', () => {
  test('legend reads the verbatim hints with bolded keys @fast', async ({ page }) => {
    await ready(page);
    await seed(page, ['RUN']);
    await page.keyboard.press('ArrowUp');
    const legend = page.locator('#command-history-overlay .ch-legend');
    // Retro tweak iv (refined): arrows first, "↑↓ select · Tab edit · Enter
    // send · Esc cancel" — no "←→" hint, no "move".
    expect(await legend.textContent()).toMatch(/↑↓ select.*Tab edit.*Enter send.*Esc cancel/);
    await expect(legend).not.toContainText('←→');
    await expect(legend).not.toContainText('move');
    // Each key label is bolded (4 <b> keys).
    expect(await legend.locator('b').count()).toBe(4);
  });
});

// ============================================================================
test.describe('E8.2 AC-10 — accessibility roles + focus retention', () => {
  test('combobox/listbox/option roles + aria-live + focus stays on the wrapper @fast', async ({ page }) => {
    await ready(page);
    await seed(page, ['LIST', 'RUN']);
    await page.keyboard.press('ArrowUp');

    await expect(page.locator('#command-history-overlay .ch-txt')).toHaveAttribute('role', 'combobox');
    await expect(page.locator('#command-history-overlay #ch-listbox')).toHaveAttribute('role', 'listbox');
    await expect(page.locator('#command-history-overlay .ch-count')).toHaveAttribute('aria-live', 'polite');
    expect(await page.locator('#command-history-overlay .ch-row[role="option"]').count()).toBe(2);

    // Sacred: focus never left #terminal-wrapper (the fake-caret / passive-layer model).
    expect(await page.evaluate(() => document.activeElement.id)).toBe('terminal-wrapper');
  });
});

// ============================================================================
test.describe('E8.2 AC-11 — Flow 6 end-to-end (Reza): recall → filter → Tab → send', () => {
  test('↑ → filter print → Tab copies the numbered line → Enter sends it exactly @fast', async ({ page }) => {
    await ready(page);
    await seed(page, ['LIST', 'RUN', '10 PRINT "HELLO FROM Z80"']);  // newest = the PRINT line
    await page.keyboard.press('ArrowUp');         // open

    await page.keyboard.type('print');            // AND-filter to the one PRINT line
    expect((await ostate(page)).filtered).toEqual(['10 PRINT "HELLO FROM Z80"']);

    await page.keyboard.press('Tab');             // copy it into the edit line
    expect((await ostate(page)).editText).toBe('10 PRINT "HELLO FROM Z80"');

    await resetTx(page);
    await page.keyboard.press('Enter');           // send exactly as if keyed

    expect(await hex(page)).toBe(await asciiHex(page, '10 PRINT "HELLO FROM Z80"', '0D'));
    expect(await hidden(page)).toBe(true);
    expect((await history(page))[0]).toBe('10 PRINT "HELLO FROM Z80"');  // newest entry
  });
});

// ============================================================================
test.describe('E8 retro §6 — hardware-feedback tweaks (2026-07-24)', () => {
  test('tweak i: rows render oldest→newest top→bottom, newest highlighted at the bottom @fast', async ({ page }) => {
    await ready(page);
    await seed(page, ['LIST', 'RUN', 'DIR']);     // newest-first: DIR, RUN, LIST
    await page.keyboard.press('ArrowUp');

    const rows = page.locator('#command-history-overlay .ch-row .ch-row-txt');
    await expect(rows).toHaveText(['LIST', 'RUN', 'DIR']);   // oldest at the top
    // The bottom row (newest, beside the edit line) carries the highlight.
    const last = page.locator('#command-history-overlay .ch-row').last();
    await expect(last).toHaveClass(/sel/);
    await expect(last).toHaveAttribute('id', 'ch-opt-0');    // ids stay newest-first
  });

  test('tweak iii: ← on an empty edit line copies the highlight (as Tab); then moves the caret @fast', async ({ page }) => {
    await ready(page);
    await seed(page, ['LIST', 'RUN']);            // newest-first: RUN, LIST
    await page.keyboard.press('ArrowUp');         // open, highlight RUN, edit line empty

    await page.keyboard.press('ArrowLeft');       // empty edit line → grab the highlight
    let s = await ostate(page);
    expect(s.editText).toBe('RUN');
    expect(s.caretIndex).toBe(3);                 // caret at end, exactly like Tab

    await page.keyboard.press('ArrowLeft');       // edit line has text → caret moves
    s = await ostate(page);
    expect(s.editText).toBe('RUN');
    expect(s.caretIndex).toBe(2);
  });

  test('tweak iii: → also copies the highlight on an empty edit line @fast', async ({ page }) => {
    await ready(page);
    await seed(page, ['LIST', 'RUN']);
    await page.keyboard.press('ArrowUp');         // open, highlight RUN (bottom)
    await page.keyboard.press('ArrowUp');         // highlight LIST
    await page.keyboard.press('ArrowRight');
    const s = await ostate(page);
    expect(s.editText).toBe('LIST');
    expect(s.caretIndex).toBe(4);
  });
});
