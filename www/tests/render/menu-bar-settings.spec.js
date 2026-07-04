// Epic E3 Story E3.2 — Settings ▸ Local echo + Enter-key-sends.
//
// The two previously-un-wired Settings-menu placeholder rows now drive the SAME
// keyboard.js setters the legacy #local-echo / #crlf-* controls call (reached via
// injected wireMenuBar opts — AD-3 blocks importing keyboard.js), + savePrefs, and
// re-derive from prefs on open / reset. These specs pin the story's correctness
// points: persist ≠ apply (the setter runs, not just savePrefs), menu→pane lockstep
// during the E7 coexistence window, the chosen line ending on the wire, reset
// re-projection, and retainFocus. [Source: e3-2 story AC-1…AC-7]
//
// Boot-race guard (E0/E1 protocol): wait on the window.__* handles before driving.
import { test, expect } from '@playwright/test';

async function ready(page) {
  await page.goto('/');
  await page.waitForFunction(
    () => window.__menuBar && typeof window.__menuBar.__getStateForTests === 'function',
  );
  await page.waitForFunction(
    () => window.__prefs && typeof window.__prefs.getPrefs === 'function',
  );
  await page.waitForFunction(
    () => window.__keyboardState && typeof window.__keyboardState.getLocalEcho === 'function',
  );
  await page.waitForFunction(() => typeof window.__testGridView === 'function');
}

const LOCAL_ECHO = '#dropdown-settings .menu-item[data-pref="localEcho"]';
const CRLF_PARENT = '#dropdown-settings .menu-item[data-submenu="crlf"]';
const crlfRadio = (v) =>
  `#dropdown-settings .submenu[data-submenu-panel="crlf"] .menu-item[data-value="${v}"]`;

test.describe('E3.2 AC-1/AC-4/AC-5 — Local echo', () => {
  test('toggle persists, applies live, keeps menu open, retains focus @fast', async ({ page }) => {
    await ready(page);
    // Focus the terminal first so retainFocus can prove focus never leaves it.
    await page.locator('#terminal-wrapper').focus();
    await expect
      .poll(() => page.evaluate(() => document.activeElement && document.activeElement.id))
      .toBe('terminal-wrapper');

    await page.evaluate(() => window.__menuBar.open('settings'));
    const row = page.locator(LOCAL_ECHO);
    await expect(row).toHaveAttribute('data-checked', 'false');
    await expect(row.locator('.check')).toHaveText('');

    await row.click();

    // Glyph / aria / data-checked flip in lockstep, and the menu STAYS OPEN.
    await expect(row).toHaveAttribute('data-checked', 'true');
    await expect(row).toHaveAttribute('aria-checked', 'true');
    await expect(row.locator('.check')).toHaveText('✓');
    expect(await page.evaluate(() => window.__menuBar.getOpenMenu())).toBe('settings');

    // Persist ≠ apply: BOTH the pref persisted AND the live keyboard.js state changed.
    expect(await page.evaluate(() => window.__prefs.getPrefs().localEcho)).toBe(true);
    expect(await page.evaluate(() => window.__keyboardState.getLocalEcho())).toBe(true);
    // E7.1 — the menu row is the SOLE surface now (the legacy #local-echo checkbox
    // retired with <details id="settings">); no menu→pane mirror to assert.
    // retainFocus (AC-5) — the click never stole keyboard focus.
    expect(await page.evaluate(() => document.activeElement && document.activeElement.id)).toBe('terminal-wrapper');

    // Live apply (AC-1): with echo ON, a typed char is echoed once to the canvas.
    await page.evaluate(() => window.__menuBar.close());
    await page.locator('#terminal-wrapper').focus();
    await page.keyboard.press('Shift+KeyA');
    await page.waitForTimeout(80);   // rAF render tick (incumbent local-echo idiom)
    expect(await page.evaluate(() => window.__testGridView()[0])).toBe(0x41);
  });

  test('toggle OFF again stops the live echo (setter re-applied) @fast', async ({ page }) => {
    await ready(page);
    // ON.
    await page.evaluate(() => window.__menuBar.open('settings'));
    await page.locator(LOCAL_ECHO).click();
    expect(await page.evaluate(() => window.__keyboardState.getLocalEcho())).toBe(true);
    // OFF.
    await page.locator(LOCAL_ECHO).click();
    await expect(page.locator(LOCAL_ECHO)).toHaveAttribute('data-checked', 'false');
    expect(await page.evaluate(() => window.__prefs.getPrefs().localEcho)).toBe(false);
    expect(await page.evaluate(() => window.__keyboardState.getLocalEcho())).toBe(false);
    // Live: OFF means a typed char does NOT render (cell (0,0) unchanged).
    await page.evaluate(() => window.__menuBar.close());
    const before = await page.evaluate(() => window.__testGridView()[0]);
    await page.locator('#terminal-wrapper').focus();
    await page.keyboard.press('Shift+KeyZ');
    await page.waitForTimeout(50);
    expect(await page.evaluate(() => window.__testGridView()[0])).toBe(before);
  });
});

test.describe('E3.2 AC-2/AC-4/AC-5 — Enter key sends', () => {
  // Selecting a radio in the menu must persist + apply crlfMode AND make Enter
  // transmit exactly the chosen bytes. #tx-strip (debug pane) is the byte oracle.
  for (const { value, bytes } of [
    { value: 'lf', bytes: '0A' },
    { value: 'crlf', bytes: '0D 0A' },
  ]) {
    test(`${value} radio persists, Enter transmits ${bytes} @fast`, async ({ page }) => {
      await ready(page);
      await page.locator('#debug').evaluate((el) => { el.open = true; });   // reveal #tx-strip / #tx-reset

      // Open the submenu; default check is CR.
      await page.evaluate(() => window.__menuBar.open('settings'));
      await page.click(CRLF_PARENT);
      await expect(page.locator(crlfRadio('cr'))).toHaveAttribute('data-checked', 'true');

      // Pick the mode.
      await page.click(crlfRadio(value));
      await expect(page.locator(crlfRadio(value))).toHaveAttribute('data-checked', 'true');
      await expect(page.locator(crlfRadio('cr'))).toHaveAttribute('data-checked', 'false');
      // Menu (and submenu) stay open — radio semantics.
      expect(await page.evaluate(() => window.__menuBar.getOpenMenu())).toBe('settings');
      await expect(page.locator(`.submenu[data-submenu-panel="crlf"]`)).toBeVisible();

      // Persist ≠ apply (AC-2/AC-4). E7.1 — the submenu is the SOLE surface now
      // (the legacy #crlf-* radios retired with <details id="settings">).
      expect(await page.evaluate(() => window.__prefs.getPrefs().crlfMode)).toBe(value);
      expect(await page.evaluate(() => window.__keyboardState.getCrlfMode())).toBe(value);
      // retainFocus (AC-5).
      expect(await page.evaluate(() => document.activeElement && document.activeElement.id)).toBe('terminal-wrapper');

      // On the wire: Enter transmits exactly the chosen bytes (close the menu first
      // so bare Enter reaches keyboard.js instead of the menu's activate handler).
      await page.evaluate(() => window.__menuBar.close());
      await page.locator('#tx-reset').click();
      await page.locator('#terminal-wrapper').focus();
      await page.keyboard.press('Enter');
      await expect(page.locator('#tx-strip')).toHaveText(bytes);
    });
  }

  test('default CR: Enter transmits 0x0D on a fresh page (radio derived from prefs) @fast', async ({ page }) => {
    await ready(page);
    await page.locator('#debug').evaluate((el) => { el.open = true; });
    // Fresh page: the submenu's active radio is CR (prefs.crlfMode default).
    await page.evaluate(() => window.__menuBar.open('settings'));
    await page.click(CRLF_PARENT);
    await expect(page.locator(crlfRadio('cr'))).toHaveAttribute('data-checked', 'true');
    await page.evaluate(() => window.__menuBar.close());
    await page.locator('#tx-reset').click();
    await page.locator('#terminal-wrapper').focus();
    await page.keyboard.press('Enter');
    await expect(page.locator('#tx-strip')).toHaveText('0D');
  });
});

test.describe('E3.2 AC-3 — reset re-projection', () => {
  test('projectPrefs re-derives both rows from prefs (no View menu needed) @fast', async ({ page }) => {
    await ready(page);
    // Non-default blob → both rows track it.
    await page.evaluate(() => window.__menuBar.projectPrefs({ localEcho: true, crlfMode: 'crlf' }));
    await expect(page.locator(LOCAL_ECHO)).toHaveAttribute('data-checked', 'true');
    await expect(page.locator(crlfRadio('crlf'))).toHaveAttribute('data-checked', 'true');
    await expect(page.locator(crlfRadio('cr'))).toHaveAttribute('data-checked', 'false');

    // Defaults blob → both rows return to Local echo unchecked + CR checked.
    await page.evaluate(() => window.__menuBar.projectPrefs({ localEcho: false, crlfMode: 'cr' }));
    await expect(page.locator(LOCAL_ECHO)).toHaveAttribute('data-checked', 'false');
    await expect(page.locator(crlfRadio('cr'))).toHaveAttribute('data-checked', 'true');
    await expect(page.locator(crlfRadio('crlf'))).toHaveAttribute('data-checked', 'false');
  });

  test('resetPrefs() restores the Local echo default in the menu DOM (subscriber wired) @fast', async ({ page }) => {
    await ready(page);
    // Turn it on via the menu, then reset — the menuBar.projectPrefs subscriber
    // must re-derive the row back to unchecked.
    await page.evaluate(() => window.__menuBar.open('settings'));
    await page.locator(LOCAL_ECHO).click();
    await expect(page.locator(LOCAL_ECHO)).toHaveAttribute('data-checked', 'true');
    await page.evaluate(() => window.__prefs.resetPrefs());
    await expect(page.locator(LOCAL_ECHO)).toHaveAttribute('data-checked', 'false');
    expect(await page.evaluate(() => window.__prefs.getPrefs().localEcho)).toBe(false);
    // applyPrefs (the reset single-writer) also restored the live keyboard state.
    expect(await page.evaluate(() => window.__keyboardState.getLocalEcho())).toBe(false);
  });
});

// Settings ▸ Wrap long lines — the first pref that reaches the wasm core. The
// checkable row drives term.set_wrap (injected via wireMenuBar — AD-3). "Applied"
// is proven behaviorally: feed 81 chars through the real core and read the cursor.
// With wrap ON the 81st char wraps to row 1 (packed (1<<16)|1); with wrap OFF it
// overstrikes the last column (cursor parks at (0,79) = 79).
const WRAP = '#dropdown-settings .menu-item[data-pref="wrapLongLines"]';
const packedCursor = (row, col) => (row << 16) | col;

// clear_visible() homes the cursor + wipes the grid (and drops any deferred-wrap
// latch) so each feed starts deterministically at (0,0), independent of wrap mode.
async function fillLineAndReadCursor(page, count) {
  return page.evaluate((n) => {
    window.__term.clear_visible();
    window.__term.feed(new Uint8Array(n).fill(0x41)); // 'A' * n
    return window.__term.cursor_packed();
  }, count);
}

test.describe('Settings ▸ Wrap long lines', () => {
  test('toggle persists, applies live (core wraps), keeps menu open, retains focus @fast', async ({ page }) => {
    await ready(page);
    await page.locator('#terminal-wrapper').focus();

    await page.evaluate(() => window.__menuBar.open('settings'));
    const row = page.locator(WRAP);
    await expect(row).toHaveAttribute('data-checked', 'false');
    await expect(row.locator('.check')).toHaveText('');

    await row.click();

    // Glyph / aria / data-checked flip in lockstep; the menu STAYS OPEN.
    await expect(row).toHaveAttribute('data-checked', 'true');
    await expect(row).toHaveAttribute('aria-checked', 'true');
    await expect(row.locator('.check')).toHaveText('✓');
    expect(await page.evaluate(() => window.__menuBar.getOpenMenu())).toBe('settings');

    // Persist ≠ apply: BOTH the pref persisted AND the live core wrap took effect.
    expect(await page.evaluate(() => window.__prefs.getPrefs().wrapLongLines)).toBe(true);
    expect(await fillLineAndReadCursor(page, 81)).toBe(packedCursor(1, 1));

    // retainFocus — the click never stole keyboard focus.
    expect(await page.evaluate(() => document.activeElement && document.activeElement.id)).toBe('terminal-wrapper');
  });

  test('default OFF overstrikes the last column (no wrap) @fast', async ({ page }) => {
    await ready(page);
    // Fresh page: wrapLongLines defaults to false — the 81st char clamps at col 79.
    expect(await page.evaluate(() => window.__prefs.getPrefs().wrapLongLines)).toBe(false);
    expect(await fillLineAndReadCursor(page, 81)).toBe(packedCursor(0, 79));
  });

  test('toggle OFF again re-applies (core stops wrapping) @fast', async ({ page }) => {
    await ready(page);
    // ON.
    await page.evaluate(() => window.__menuBar.open('settings'));
    await page.locator(WRAP).click();
    expect(await fillLineAndReadCursor(page, 81)).toBe(packedCursor(1, 1));
    // OFF.
    await page.locator(WRAP).click();
    await expect(page.locator(WRAP)).toHaveAttribute('data-checked', 'false');
    expect(await page.evaluate(() => window.__prefs.getPrefs().wrapLongLines)).toBe(false);
    expect(await fillLineAndReadCursor(page, 81)).toBe(packedCursor(0, 79));
  });

  test('reset re-projects the row + applyPrefs restores wrap OFF in the core @fast', async ({ page }) => {
    await ready(page);
    // projectPrefs re-derives the row from a passed blob (no View menu needed).
    await page.evaluate(() => window.__menuBar.projectPrefs({ wrapLongLines: true }));
    await expect(page.locator(WRAP)).toHaveAttribute('data-checked', 'true');
    await page.evaluate(() => window.__menuBar.projectPrefs({ wrapLongLines: false }));
    await expect(page.locator(WRAP)).toHaveAttribute('data-checked', 'false');

    // Turn it on via the menu, then resetPrefs() — the subscriber re-derives the row
    // AND applyPrefs (the reset single-writer) restores the core to no-wrap.
    await page.evaluate(() => window.__menuBar.open('settings'));
    await page.locator(WRAP).click();
    await expect(page.locator(WRAP)).toHaveAttribute('data-checked', 'true');
    await page.evaluate(() => window.__prefs.resetPrefs());
    await expect(page.locator(WRAP)).toHaveAttribute('data-checked', 'false');
    expect(await page.evaluate(() => window.__prefs.getPrefs().wrapLongLines)).toBe(false);
    expect(await fillLineAndReadCursor(page, 81)).toBe(packedCursor(0, 79));
  });
});
