// Epic E3 Story E3.3 (FR-21) — Browser-reserved Ctrl combinations info modal.
//
// A RELOCATION story: the verbatim reserved-Ctrl paragraph moved out of the legacy
// <details class="reserved"> pane into an openModal-driven <dialog id="reserved-ctrl-modal">,
// opened from Settings ▸ Browser-reserved Ctrl combinations…. Exact mirror of the E2.3
// serial-config action-row → injected-opener pattern, but a non-destructive INFO modal
// (body copy + Close), so initialFocus is the Close button. Locks AC-4..AC-6.
//
// Idioms (E1 retro action #4): boot-race guard on window.__menuBar/__modal;
// window.__menuBar.open('settings') for a deterministic open (NOT a title click);
// menu-driven open → data-action dispatch; focus-restore via activeElement.id.
import { test, expect } from '@playwright/test';

// The verbatim paragraph the move must preserve byte-for-byte (AC-5) — including the
// Ctrl+\ / Ctrl+] / Ctrl+^ / Ctrl+_ run and the parenthetical.
const VERBATIM =
  'Ctrl+W, Ctrl+N, Ctrl+T are claimed by Chromium (close tab, new window, reopen closed tab) and cannot be intercepted by a web page. Use Ctrl+F4, Ctrl+Shift+N, or a different keybinding on the MicroBeast side if you need those control codes. Everything from Ctrl+A through Ctrl+Z (except W, N, T) is forwarded normally, as are Ctrl+@, Ctrl+[, Ctrl+\\, Ctrl+], Ctrl+^, Ctrl+_.';

async function ready(page) {
  await page.goto('/');
  await page.waitForFunction(
    () => window.__menuBar && typeof window.__menuBar.__getStateForTests === 'function'
          && typeof window.__modal === 'object' && window.__modal !== null,
  );
  await page.locator('#terminal-wrapper').focus();
  await page.waitForFunction(() => document.getElementById('terminal').width > 0);
}

// Deterministic open via the real menu path (open Settings → click the row).
async function openModal(page) {
  await page.evaluate(() => window.__menuBar.open('settings'));
  await page.click('#dropdown-settings .menu-item[data-action="reserved-ctrl"]');
  await expect(page.locator('#reserved-ctrl-modal')).toBeVisible();
}

const dialog = (page) => page.locator('#reserved-ctrl-modal');

test.describe('E3.3 AC-4 — opens from the Settings menu via openModal; dropdown closes', () => {
  test('activating the row opens the modal + closes the dropdown @fast', async ({ page }) => {
    await ready(page);
    await openModal(page);
    expect(await page.evaluate(() => window.__menuBar.getOpenMenu())).toBe(null);
    expect(await page.evaluate(() => window.__modal.__getStateForTests().openDialogId))
      .toBe('reserved-ctrl-modal');
  });

  test('initial focus is the Close button (non-destructive default) @fast', async ({ page }) => {
    await ready(page);
    await openModal(page);
    expect(await page.evaluate(() => document.activeElement && document.activeElement.id))
      .toBe('reserved-ctrl-close');
    await expect(page.locator('#reserved-ctrl-close')).toHaveAttribute('data-focused', 'true');
  });

  test('Close returns focus to #terminal-wrapper (restoreTo) @fast', async ({ page }) => {
    await ready(page);
    await openModal(page);
    await page.click('#reserved-ctrl-modal form[method="dialog"] button');
    await expect(dialog(page)).toBeHidden();
    expect(await page.evaluate(() => document.activeElement && document.activeElement.id))
      .toBe('terminal-wrapper');
  });

  test('Esc closes and returns focus to #terminal-wrapper @fast', async ({ page }) => {
    await ready(page);
    await openModal(page);
    await page.keyboard.press('Escape');
    await expect(dialog(page)).toBeHidden();
    expect(await page.evaluate(() => document.activeElement && document.activeElement.id))
      .toBe('terminal-wrapper');
  });
});

test.describe('E3.3 AC-5 — verbatim copy + header', () => {
  test('body contains the byte-for-byte legacy paragraph (incl. Ctrl+\\) @fast', async ({ page }) => {
    await ready(page);
    await openModal(page);
    await expect(dialog(page).locator('.modal-body .hint')).toHaveText(VERBATIM);
    // Header present (AC-5 requires a title + a Close affordance).
    await expect(dialog(page).locator('#reserved-ctrl-modal-title'))
      .toHaveText('Browser-reserved Ctrl combinations');
  });

  test('the copy is single-sourced — still verbatim in the legacy pane during coexistence @fast', async ({ page }) => {
    await ready(page);
    // The legacy <details class="reserved"> stays functional through the E7 window.
    await expect(page.locator('details.reserved > p.hint')).toHaveText(VERBATIM);
  });
});

test.describe('E3.3 AC-6 — neutral-shell styling', () => {
  test('dialog has no drop shadow (scrim-only elevation) @fast', async ({ page }) => {
    await ready(page);
    await openModal(page);
    const shadow = await dialog(page).evaluate((el) => getComputedStyle(el).boxShadow);
    expect(shadow).toBe('none');
  });

  test('rounded/lg 8px corner @fast', async ({ page }) => {
    await ready(page);
    await openModal(page);
    const radius = await dialog(page).evaluate((el) => getComputedStyle(el).borderTopLeftRadius);
    expect(radius).toBe('8px');
  });
});
