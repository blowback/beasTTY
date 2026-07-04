// Epic E5 Story E5.1 — Debug ▸ Show Debug Panel.
//
// The previously-un-wired Debug-menu placeholder row now toggles the in-page debug
// panel (the ONE persistent chrome element — AD-11). It is the `localEcho` template
// again, minus a legacy mirror: a new persisted boolean (showDebugPanel, default OFF)
// rides the generic data-pref checkable seam AND — because it has a LIVE DOM effect —
// calls an injected setDebugPanelVisible setter (persist ≠ apply). applyPrefs owns the
// panel's visibility on boot/reset (single writer); menuBar.projectDebugPanel owns only
// the row glyph. These specs pin the story's correctness points: default OFF ⇒ fully
// invisible, toggle shows + persists + keeps the menu open + glyph/aria lockstep, reset
// re-projection, retainFocus, and one widget-still-works assertion after the move.
// [Source: e5-1 story AC-1…AC-7]
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
  await page.waitForFunction(() => typeof window.__testGridView === 'function');
}

const DEBUG_ROW = '#dropdown-debug .menu-item[data-pref="showDebugPanel"]';

test.describe('E5.1 AC-3/AC-4 — default OFF is completely invisible', () => {
  test('fresh page: row unchecked, panel + widgets fully hidden, no summary furniture @fast', async ({ page }) => {
    await ready(page);
    // The panel container generates NO box when off (#debug:not([open]) { display:none }).
    await expect(page.locator('#debug')).toBeHidden();
    await expect(page.locator('#input')).toBeHidden();
    // The native <summary> disclosure paints nothing — the menu is the sole toggle (AC-4).
    await expect(page.locator('#debug summary')).toBeHidden();
    // Pref default is OFF and the row glyph is derived from it (not the HTML literal).
    expect(await page.evaluate(() => window.__prefs.getPrefs().showDebugPanel)).toBe(false);
    await page.evaluate(() => window.__menuBar.open('debug'));
    await expect(page.locator(DEBUG_ROW)).toHaveAttribute('data-checked', 'false');
    await expect(page.locator(DEBUG_ROW).locator('.check')).toHaveText('');
  });
});

test.describe('E5.1 AC-1/AC-2/AC-5 — toggle shows/hides, persists, applies live', () => {
  test('toggle shows the panel, persists, keeps menu open, glyph/aria lockstep, retains focus @fast', async ({ page }) => {
    await ready(page);
    // Focus the terminal first so retainFocus can prove focus never leaves it.
    await page.locator('#terminal-wrapper').focus();
    await expect
      .poll(() => page.evaluate(() => document.activeElement && document.activeElement.id))
      .toBe('terminal-wrapper');

    await page.evaluate(() => window.__menuBar.open('debug'));
    const row = page.locator(DEBUG_ROW);
    await expect(row).toHaveAttribute('data-checked', 'false');
    await expect(row.locator('.check')).toHaveText('');

    await row.click();

    // Glyph / aria / data-checked flip in lockstep, and the menu STAYS OPEN (AC-1).
    await expect(row).toHaveAttribute('data-checked', 'true');
    await expect(row).toHaveAttribute('aria-checked', 'true');
    await expect(row.locator('.check')).toHaveText('✓');
    expect(await page.evaluate(() => window.__menuBar.getOpenMenu())).toBe('debug');

    // Persist ≠ apply: pref persisted AND the panel is live-visible now (no reload).
    expect(await page.evaluate(() => window.__prefs.getPrefs().showDebugPanel)).toBe(true);
    await expect(page.locator('#debug')).toBeVisible();
    await expect(page.locator('#debug')).toHaveAttribute('open', '');
    await expect(page.locator('#input')).toBeVisible();

    // retainFocus (AC-5) — the click never stole keyboard focus off the terminal.
    expect(await page.evaluate(() => document.activeElement && document.activeElement.id)).toBe('terminal-wrapper');
  });

  test('toggle again hides the panel (setter re-applied) @fast', async ({ page }) => {
    await ready(page);
    // ON.
    await page.evaluate(() => window.__menuBar.open('debug'));
    await page.locator(DEBUG_ROW).click();
    await expect(page.locator('#debug')).toBeVisible();
    // OFF.
    await page.locator(DEBUG_ROW).click();
    await expect(page.locator(DEBUG_ROW)).toHaveAttribute('data-checked', 'false');
    expect(await page.evaluate(() => window.__prefs.getPrefs().showDebugPanel)).toBe(false);
    await expect(page.locator('#debug')).toBeHidden();
    await expect(page.locator('#input')).toBeHidden();
  });

  test('a debug widget still works after the move: Feed renders #input bytes to the grid @fast', async ({ page }) => {
    await ready(page);
    // Reveal the panel via the menu (the real path).
    await page.evaluate(() => window.__menuBar.open('debug'));
    await page.locator(DEBUG_ROW).click();
    await page.evaluate(() => window.__menuBar.close());
    await expect(page.locator('#input')).toBeVisible();

    // Feed 'A' (0x41) through the #input textarea → it lands at cell (0,0). Proves the
    // relocated #input + #feed widgets are still functional after the container change.
    await page.fill('#input', 'A');
    await page.locator('#feed').click();
    await expect.poll(() => page.evaluate(() => window.__testGridView()[0])).toBe(0x41);
  });
});

test.describe('E5.1 AC-3/AC-6 — reset re-projection + single-writer', () => {
  test('projectPrefs re-derives the row from prefs (no View menu needed) @fast', async ({ page }) => {
    await ready(page);
    // Non-default blob → the row tracks it.
    await page.evaluate(() => window.__menuBar.projectPrefs({ showDebugPanel: true }));
    await expect(page.locator(DEBUG_ROW)).toHaveAttribute('data-checked', 'true');
    await expect(page.locator(DEBUG_ROW).locator('.check')).toHaveText('✓');
    // Defaults blob → the row returns to unchecked.
    await page.evaluate(() => window.__menuBar.projectPrefs({ showDebugPanel: false }));
    await expect(page.locator(DEBUG_ROW)).toHaveAttribute('data-checked', 'false');
  });

  test('resetPrefs() restores default OFF in BOTH the row and the panel (subscribers wired) @fast', async ({ page }) => {
    await ready(page);
    // Turn it on via the menu, then reset — the menuBar.projectPrefs subscriber must
    // re-derive the row to unchecked AND applyPrefs (the panel single-writer) must hide it.
    await page.evaluate(() => window.__menuBar.open('debug'));
    await page.locator(DEBUG_ROW).click();
    await expect(page.locator('#debug')).toBeVisible();
    await expect(page.locator(DEBUG_ROW)).toHaveAttribute('data-checked', 'true');

    await page.evaluate(() => window.__prefs.resetPrefs());

    await expect(page.locator(DEBUG_ROW)).toHaveAttribute('data-checked', 'false');
    expect(await page.evaluate(() => window.__prefs.getPrefs().showDebugPanel)).toBe(false);
    // applyPrefs (the reset single-writer) also hid the live panel.
    await expect(page.locator('#debug')).toBeHidden();
  });
});

test.describe('E5.1 AC-3 — persisted ON survives reload', () => {
  test('a stored showDebugPanel:true boots with the row checked and the panel shown @fast', async ({ page }) => {
    // Seed prefs before the app boots (single options arg — the addInitScript gotcha).
    await page.addInitScript(() => {
      localStorage.setItem('beastty.prefs', JSON.stringify({ version: 1, showDebugPanel: true }));
    });
    await ready(page);
    // applyPrefs(prefs) ran once at boot → the panel is shown without any interaction.
    await expect(page.locator('#debug')).toBeVisible();
    await expect(page.locator('#input')).toBeVisible();
    await page.evaluate(() => window.__menuBar.open('debug'));
    await expect(page.locator(DEBUG_ROW)).toHaveAttribute('data-checked', 'true');
  });
});
