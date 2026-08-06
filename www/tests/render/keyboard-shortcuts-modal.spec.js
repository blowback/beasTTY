// Epic E6 Story E6.1 (FR-24) — Keyboard Shortcuts info modal.
//
// A fourth static-content <dialog id="keyboard-shortcuts-modal"> on the shared modal
// rails (clone of #reserved-ctrl-modal / E3.3), opened from Help ▸ Keyboard Shortcuts….
// Exact mirror of the E3.3 action-row → injected-opener pattern: a non-destructive INFO
// modal (aligned shortcut rows + Close), so initialFocus is the Close button. Locks
// AC-1..AC-5.
//
// Idioms (E1 retro action #4, re-embedded per E5.1 Q3): boot-race guard on
// window.__menuBar/__modal; window.__menuBar.open('help') for a deterministic open
// (NOT a title click); menu-driven open → data-action dispatch; focus-restore via
// activeElement.id.
import { test, expect } from '@playwright/test';

// FR-24's five named shortcut groups — every one must be present + code-accurate
// (see Dev Notes §"The shortcut content"). Copy/paste is Ctrl+Shift+C/V (bare Ctrl+C/V
// encode control codes to the remote — showing "Ctrl+C" would be wrong).
const REQUIRED = [
  'Ctrl+Alt+T',       // toggle theme
  'Ctrl+=',           // zoom in
  'Ctrl+-',           // zoom out
  'Ctrl+0',           // actual size
  'Ctrl+Shift+C',     // copy selection
  'Ctrl+Shift+V',     // paste
  'Esc',              // cancel chain
  'Ctrl+W / Ctrl+N / Ctrl+T',   // reserved combos
  // E8 escape hatch (2026-08-06). The body is rendered from SHORTCUT_GROUPS, so these
  // three rows exist without a line of hand-written HTML — which is the point: the
  // toggle chords and the ↑/↓ bypass were both undocumented before this change.
  'Ctrl+Shift+Esc',                  // clear selection (was live but unregistered)
  'Ctrl+Shift+Insert / Ctrl+Alt+H',  // toggle command history
  'Ctrl+Shift+↑ / Ctrl+Shift+↓',     // informational — per-keypress history bypass
];

async function ready(page) {
  await page.goto('/');
  await page.waitForFunction(
    () => window.__menuBar && typeof window.__menuBar.__getStateForTests === 'function'
          && typeof window.__modal === 'object' && window.__modal !== null,
  );
  await page.locator('#terminal-wrapper').focus();
  await page.waitForFunction(() => document.getElementById('terminal').width > 0);
}

// Deterministic open via the real menu path (open Help → click the row).
async function openModal(page) {
  await page.evaluate(() => window.__menuBar.open('help'));
  await page.click('#dropdown-help .menu-item[data-action="keyboard-shortcuts"]');
  await expect(page.locator('#keyboard-shortcuts-modal')).toBeVisible();
}

const dialog = (page) => page.locator('#keyboard-shortcuts-modal');

test.describe('E6.1 AC-1/AC-3 — opens from the Help menu via openModal; dropdown closes', () => {
  test('activating the row opens the modal + closes the dropdown @fast', async ({ page }) => {
    await ready(page);
    await openModal(page);
    expect(await page.evaluate(() => window.__menuBar.getOpenMenu())).toBe(null);
    expect(await page.evaluate(() => window.__modal.__getStateForTests().openDialogId))
      .toBe('keyboard-shortcuts-modal');
  });

  test('initial focus is the Close button (non-destructive default) @fast', async ({ page }) => {
    await ready(page);
    await openModal(page);
    expect(await page.evaluate(() => document.activeElement && document.activeElement.id))
      .toBe('keyboard-shortcuts-close');
    await expect(page.locator('#keyboard-shortcuts-close')).toHaveAttribute('data-focused', 'true');
  });

  test('Close returns focus to #terminal-wrapper (restoreTo) @fast', async ({ page }) => {
    await ready(page);
    await openModal(page);
    await page.click('#keyboard-shortcuts-modal form[method="dialog"] button');
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

test.describe('E6.1 AC-2 — lists all five required shortcut groups + header', () => {
  test('body lists every FR-24 shortcut, code-accurate @fast', async ({ page }) => {
    await ready(page);
    await openModal(page);
    const body = dialog(page).locator('.modal-body');
    for (const combo of REQUIRED) {
      await expect(body).toContainText(combo);
    }
    // Copy + Paste actions named (FR-24 "copy/paste").
    await expect(body).toContainText('Copy selection');
    await expect(body).toContainText('Paste');
    // E8 escape hatch — the group heading and the two actions it names.
    await expect(body).toContainText('Command history');
    await expect(body).toContainText('Turn command history on / off');
    await expect(body).toContainText('without opening the recall overlay');
    // Header present (a title + a Close affordance).
    await expect(dialog(page).locator('#keyboard-shortcuts-modal-title'))
      .toHaveText('Keyboard Shortcuts');
  });
});

test.describe('E6.1 AC-4 — neutral clean-modal styling', () => {
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
