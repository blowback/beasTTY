// Epic E8 Story E8.3 — Settings surfaces: enable, size & clear.
//
// The three Settings-menu rows that let an operator turn command history off, cap
// its size, and clear it. E8.1/E8.2 left this fully plumbed: prefs already exist and
// the engine reads them at use-time, so there is deliberately NO live setter for the
// toggle or the size — the toggle takes effect on the next keystroke (engine
// early-return + overlay trigger both read getPrefs()), and the size persists +
// trims the store immediately. Clear is the Clear-Scrollback modal-confirm pattern.
//
// These specs pin the story's ACs:
//   AC-1 the three rows exist with the right variants/roles/labels; size submenu 100
//   AC-2 toggle off → capture inert + ↑ passes through; toggle on → capture resumes
//   AC-3 size preset persists + trims the store immediately (oldest dropped)
//   AC-4 Clear… → modal confirm; cancel keeps history, confirm empties + restores focus
//   AC-5 resetPrefs() re-projects both rows to their defaults (checked + 100)
//
// Idioms (E1/E2/E8 retros): boot-race guard on window.__*; window.__menuBar.open()
// for a deterministic open; programmatic window.__commandHistory.capture({...}) for
// fast keystroke feeds + a few real keydowns for the trigger passthrough; the TX sink
// (window.__txSink) as the wire-byte oracle. [Source: e8-3 story AC-1…AC-5]
import { test, expect } from '@playwright/test';

// Boot and wait for every hook this story touches: the menu, prefs, the capture
// engine, the recall overlay, and the TX sink. Reset the engine + overlay + TX ring
// for a known-clean slate (mirrors the E8.2 overlay spec's ready()).
async function ready(page) {
  await page.goto('/');
  await page.waitForFunction(
    () => window.__menuBar && typeof window.__menuBar.__getStateForTests === 'function'
      && window.__prefs && typeof window.__prefs.getPrefs === 'function'
      && window.__commandHistory && typeof window.__commandHistory.__getStateForTests === 'function'
      && window.__commandHistoryOverlay && typeof window.__commandHistoryOverlay.isOpen === 'function'
      && window.__txSink,
  );
  await page.locator('#terminal-wrapper').focus();
  await page.evaluate(() => {
    window.__commandHistory.__resetForTests();        // clear store + mirror
    window.__commandHistoryOverlay.__resetForTests();  // close + reset per-open state
    window.__txSink.resetTx();                         // empty the TX ring
  });
}

// The wasm encoder is ready once the canvas has been sized — needed only where a
// real ↑ must encode to ESC A via keyboard.js (the passthrough assertions).
async function waitForEncoder(page) {
  await page.waitForFunction(() => document.getElementById('terminal').width > 0);
}

// Feed each printable char of `str` as a Char-tag keystroke through the engine's
// capture hook (mirrors keyboard.js's { e, code, mods, bytes, wasEnter } info shape).
async function typeStr(page, str) {
  await page.evaluate((s) => {
    for (const ch of s) {
      const b = ch.charCodeAt(0);
      window.__commandHistory.capture({
        e: { key: ch }, code: (b << 8), mods: 0,
        bytes: new Uint8Array([b]), wasEnter: false,
      });
    }
  }, str);
}

// Feed a bare Enter (the commit terminator) through the capture hook.
async function pressEnter(page) {
  await page.evaluate(() => window.__commandHistory.capture({
    e: { key: 'Enter' }, code: 5, mods: 0, bytes: new Uint8Array([0x0D]), wasEnter: true,
  }));
}

// Seed the store oldest-first (commit moves each to the head, so the LAST element
// ends up newest; getHistory() then returns them newest-first).
async function seed(page, cmds) {
  await page.evaluate((list) => {
    for (const c of list) window.__commandHistory.commit(c);
  }, cmds);
}

const history = (page) => page.evaluate(() => window.__commandHistory.getHistory());
const hex = (page) => page.evaluate(() => window.__txSink.formatHexStrip());
const openMenu = (page) => page.evaluate(() => window.__menuBar.getOpenMenu());

const TOGGLE = '#dropdown-settings .menu-item[data-pref="commandHistoryEnabled"]';
const SIZE_PARENT = '#dropdown-settings .menu-item[data-submenu="cmdhistory-size"]';
const sizeRadio = (v) =>
  `#dropdown-settings .submenu[data-submenu-panel="cmdhistory-size"] .menu-item[data-value="${v}"]`;
const CLEAR = '#dropdown-settings .menu-item[data-action="clear-cmd-history"]';

// ============================================================================
test.describe('E8.3 AC-1 — the three Settings rows exist', () => {
  test('toggle / size-submenu / clear rows carry the right variants, roles, labels @fast', async ({ page }) => {
    await ready(page);
    await page.evaluate(() => window.__menuBar.open('settings'));

    // Checkable toggle — starts checked (prefs default true), role menuitemcheckbox.
    const toggle = page.locator(TOGGLE);
    await expect(toggle).toHaveAttribute('id', 'menu-command-history-item');
    await expect(toggle).toHaveAttribute('role', 'menuitemcheckbox');
    await expect(toggle).toHaveAttribute('data-variant', 'checkable');
    await expect(toggle).toHaveAttribute('data-checked', 'true');
    await expect(toggle).toHaveAttribute('aria-checked', 'true');
    await expect(toggle.locator('.lbl')).toHaveText('Command history');
    await expect(toggle.locator('.check')).toHaveText('✓');

    // Radio-submenu parent — role menuitem, radio-submenu variant, ▸ caret.
    const sizeParent = page.locator(SIZE_PARENT);
    await expect(sizeParent).toHaveAttribute('role', 'menuitem');
    await expect(sizeParent).toHaveAttribute('data-variant', 'radio-submenu');
    await expect(sizeParent.locator('.lbl')).toHaveText('Command history size');
    await expect(sizeParent.locator('.caret')).toHaveText('▸');

    // Action row — role menuitem, action variant, trailing-… label, no caret.
    const clear = page.locator(CLEAR);
    await expect(clear).toHaveAttribute('id', 'menu-clear-cmd-history-item');
    await expect(clear).toHaveAttribute('role', 'menuitem');
    await expect(clear).toHaveAttribute('data-variant', 'action');
    await expect(clear.locator('.lbl')).toHaveText('Clear command history…');

    // Size submenu opens with 100 checked (the prefs default) and the others clear.
    await page.click(SIZE_PARENT);
    await expect(page.locator('.submenu[data-submenu-panel="cmdhistory-size"]')).toBeVisible();
    await expect(page.locator(sizeRadio('100'))).toHaveAttribute('data-checked', 'true');
    await expect(page.locator(sizeRadio('100')).locator('.check')).toHaveText('✓');
    for (const v of ['50', '200', '500']) {
      await expect(page.locator(sizeRadio(v))).toHaveAttribute('data-checked', 'false');
    }
  });
});

// ============================================================================
test.describe('E8.3 AC-2 — toggle gates capture + the recall trigger', () => {
  test('off → glyph flips, menu stays open, capture inert, ↑ passes through; on → resumes @fast', async ({ page }) => {
    await ready(page);
    await waitForEncoder(page);
    await page.locator('#terminal-wrapper').focus();

    // Turn the toggle OFF via the menu row.
    await page.evaluate(() => window.__menuBar.open('settings'));
    const toggle = page.locator(TOGGLE);
    await toggle.click();
    await expect(toggle).toHaveAttribute('data-checked', 'false');
    await expect(toggle).toHaveAttribute('aria-checked', 'false');
    await expect(toggle.locator('.check')).toHaveText('');
    // Checkable semantics — the menu stays open, and the pref persisted.
    expect(await openMenu(page)).toBe('settings');
    expect(await page.evaluate(() => window.__prefs.getPrefs().commandHistoryEnabled)).toBe(false);

    // Capture is inert while off: a typed line + Enter commits nothing (engine early-return).
    expect(await history(page)).toEqual([]);
    await typeStr(page, 'DIR');
    await pressEnter(page);
    expect(await history(page)).toEqual([]);

    // Even with a non-empty store, ↑ at an empty prompt does NOT open the overlay —
    // it forwards ESC A byte-for-byte (the trigger reads commandHistoryEnabled).
    await seed(page, ['OLD']);
    await page.evaluate(() => window.__menuBar.close());
    await page.locator('#terminal-wrapper').focus();
    await page.evaluate(() => window.__txSink.resetTx());
    await page.keyboard.press('ArrowUp');
    expect(await page.evaluate(() => window.__commandHistoryOverlay.isOpen())).toBe(false);
    expect(await hex(page)).toBe('1B 41');   // ESC A reached the wire

    // Turn it back ON → capture resumes: a typed line + Enter commits.
    await page.evaluate(() => window.__menuBar.open('settings'));
    await toggle.click();
    await expect(toggle).toHaveAttribute('data-checked', 'true');
    expect(await page.evaluate(() => window.__prefs.getPrefs().commandHistoryEnabled)).toBe(true);
    await typeStr(page, 'LIST');
    await pressEnter(page);
    expect(await history(page)).toEqual(['LIST', 'OLD']);
  });
});

// ============================================================================
test.describe('E8.3 AC-3 — size preset persists and trims immediately', () => {
  test('selecting 50 caps the store to 50 at once, keeping the newest @fast', async ({ page }) => {
    await ready(page);
    // Seed 60 distinct commands (CMD0 oldest … CMD59 newest); default cap 100 keeps all.
    const cmds = Array.from({ length: 60 }, (_, i) => `CMD${i}`);
    await seed(page, cmds);
    expect((await history(page)).length).toBe(60);

    // Select the 50 preset.
    await page.evaluate(() => window.__menuBar.open('settings'));
    await page.click(SIZE_PARENT);
    await page.click(sizeRadio('50'));

    // Radio glyph moved; the menu (and submenu) stay open — radio semantics.
    await expect(page.locator(sizeRadio('50'))).toHaveAttribute('data-checked', 'true');
    await expect(page.locator(sizeRadio('50')).locator('.check')).toHaveText('✓');
    await expect(page.locator(sizeRadio('100'))).toHaveAttribute('data-checked', 'false');
    expect(await openMenu(page)).toBe('settings');

    // Pref persisted AND the store trimmed to 50 IMMEDIATELY, newest retained.
    expect(await page.evaluate(() => window.__prefs.getPrefs().commandHistorySize)).toBe(50);
    const h = await history(page);
    expect(h.length).toBe(50);
    expect(h[0]).toBe('CMD59');     // newest retained
    expect(h).not.toContain('CMD0'); // oldest dropped
    expect(h).not.toContain('CMD9');
    expect(h).toContain('CMD10');   // exactly the newest 50 (CMD10…CMD59) survive
  });
});

// ============================================================================
test.describe('E8.3 AC-4 — Clear command history… modal confirm', () => {
  test('menu closes, dialog opens Cancel-focused; cancel keeps history intact @fast', async ({ page }) => {
    await ready(page);
    await seed(page, ['LIST', 'RUN']);

    await page.evaluate(() => window.__menuBar.open('settings'));
    await page.click(CLEAR);

    // The dropdown closed (so it isn't left open under the dialog); the confirm opened
    // with Cancel default-focused (safe choice on a destructive action).
    expect(await openMenu(page)).toBe(null);
    const dialog = page.locator('#clear-cmd-history-confirm');
    await expect(dialog).toBeVisible();
    await expect(dialog).toContainText('Clear command history?');
    await expect(dialog).toContainText("This can't be undone.");
    await expect
      .poll(() => page.evaluate(() => document.activeElement && document.activeElement.id))
      .toBe('clear-cmd-history-confirm-cancel');

    // Cancel is a no-op — history survives.
    await page.click('#clear-cmd-history-confirm-cancel');
    await expect(dialog).toBeHidden();
    expect(await history(page)).toEqual(['RUN', 'LIST']);
  });

  test('confirm empties the store + persists + restores focus; ↑ afterwards is a no-op @fast', async ({ page }) => {
    await ready(page);
    await waitForEncoder(page);
    await seed(page, ['LIST', 'RUN']);

    await page.evaluate(() => window.__menuBar.open('settings'));
    await page.click(CLEAR);
    await page.click('#clear-cmd-history-confirm-ok');
    await expect(page.locator('#clear-cmd-history-confirm')).toBeHidden();

    // Store emptied AND persisted; focus round-tripped back to the terminal.
    expect(await history(page)).toEqual([]);
    expect(await page.evaluate(() => window.__prefs.getPrefs().commandHistory)).toEqual([]);
    await expect
      .poll(() => page.evaluate(() => document.activeElement && document.activeElement.id))
      .toBe('terminal-wrapper');

    // ↑ at the now-empty prompt is a no-op: overlay stays closed, arrow forwarded.
    await page.evaluate(() => window.__txSink.resetTx());
    await page.keyboard.press('ArrowUp');
    expect(await page.evaluate(() => window.__commandHistoryOverlay.isOpen())).toBe(false);
    expect(await hex(page)).toBe('1B 41');
  });
});

// ============================================================================
test.describe('E8.3 AC-5 — reset re-projects both rows', () => {
  test('resetPrefs() restores the toggle checked + size 100 in the menu DOM @fast', async ({ page }) => {
    await ready(page);

    // Drive both rows off-default: toggle OFF, size 500.
    await page.evaluate(() => window.__menuBar.open('settings'));
    await page.locator(TOGGLE).click();
    await expect(page.locator(TOGGLE)).toHaveAttribute('data-checked', 'false');
    await page.click(SIZE_PARENT);
    await page.click(sizeRadio('500'));
    await expect(page.locator(sizeRadio('500'))).toHaveAttribute('data-checked', 'true');

    // Reset — the menuBar.projectPrefs subscriber re-derives both rows to their defaults.
    await page.evaluate(() => window.__prefs.resetPrefs());
    await expect(page.locator(TOGGLE)).toHaveAttribute('data-checked', 'true');
    await expect(page.locator(sizeRadio('100'))).toHaveAttribute('data-checked', 'true');
    await expect(page.locator(sizeRadio('500'))).toHaveAttribute('data-checked', 'false');
    expect(await page.evaluate(() => window.__prefs.getPrefs().commandHistoryEnabled)).toBe(true);
    expect(await page.evaluate(() => window.__prefs.getPrefs().commandHistorySize)).toBe(100);
  });
});
