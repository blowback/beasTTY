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
  test('↓/↑ move within the filtered list and clamp at both ends @fast', async ({ page }) => {
    await ready(page);
    await seed(page, ['A', 'B', 'C', 'D']);      // newest-first: D, C, B, A
    await page.keyboard.press('ArrowUp');        // open, highlight 0 (D)
    expect((await ostate(page)).highlight).toBe(0);

    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('ArrowDown');
    expect((await ostate(page)).highlight).toBe(2);

    await page.keyboard.press('ArrowUp');
    expect((await ostate(page)).highlight).toBe(1);

    // Clamp at the top — five ↑ from row 1 never goes negative.
    for (let i = 0; i < 5; i++) await page.keyboard.press('ArrowUp');
    expect((await ostate(page)).highlight).toBe(0);

    // Clamp at the bottom — ten ↓ stops at the last row (index 3).
    for (let i = 0; i < 10; i++) await page.keyboard.press('ArrowDown');
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
    await page.keyboard.press('ArrowUp');        // highlight 0 = RUN
    await page.keyboard.press('ArrowDown');      // highlight 1 = LIST
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

  test('bare Enter on an empty edit line sends only the terminator, commits nothing @fast', async ({ page }) => {
    await ready(page);
    await seed(page, ['RUN', 'LIST']);            // newest-first: LIST, RUN
    await page.keyboard.press('ArrowUp');         // open, edit line empty (placeholder)
    await resetTx(page);

    await page.keyboard.press('Enter');

    expect(await hex(page)).toBe('0D');           // bare CR to the Z80
    expect(await hidden(page)).toBe(true);
    expect(await history(page)).toEqual(['LIST', 'RUN']);  // unchanged — no '' stored
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
    for (const token of ['Tab', 'select', '↑↓', 'move', '←→', 'edit', 'Enter', 'send', 'Esc', 'cancel']) {
      await expect(legend).toContainText(token);
    }
    // Each key label is bolded (5 <b> keys).
    expect(await legend.locator('b').count()).toBe(5);
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
