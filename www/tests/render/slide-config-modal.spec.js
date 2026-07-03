// Epic E3 Story E3.4 (FR-20) — SLIDE File Transfer modal.
//
// A RELOCATION story: the SLIDE transfer controls (Save-to-folder, Auto-send command,
// Show-summary, Confirm-transfers, Compatibility mode) moved out of the legacy nested
// <details id="settings-slide"> pane into an openModal-driven <dialog id="slide-config-modal">,
// opened from Settings ▸ SLIDE File Transfer…. Same id-keyed controls / verbatim copy /
// option-sets; only the home + chrome changed. Exact mirror of the E2.3 serial-config /
// E3.3 reserved-ctrl action-row → injected-opener pattern. Locks AC-1..AC-9.
//
// Idioms (E1/E2 retros): boot-race guard on window.__menuBar/__modal; window.__menuBar.open
// for a deterministic open (NOT a title click); menu-driven open → data-action dispatch;
// focus-restore asserted via document.activeElement.id.
import { test, expect } from '@playwright/test';

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
  await page.click('#dropdown-settings .menu-item[data-action="slide-config"]');
  await expect(page.locator('#slide-config-modal')).toBeVisible();
}

const dialog = (page) => page.locator('#slide-config-modal');

test.describe('E3.4 AC-1 — opens from the Settings menu via openModal; dropdown closes; focus round-trips', () => {
  test('activating the row opens the modal + closes the dropdown @fast', async ({ page }) => {
    await ready(page);
    await openModal(page);
    expect(await page.evaluate(() => window.__menuBar.getOpenMenu())).toBe(null);
    expect(await page.evaluate(() => window.__modal.__getStateForTests().openDialogId))
      .toBe('slide-config-modal');
  });

  test('Close returns focus to #terminal-wrapper (restoreTo) @fast', async ({ page }) => {
    await ready(page);
    await openModal(page);
    await page.click('#slide-config-modal form[method="dialog"] button');
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

  test('header title is verbatim "SLIDE File Transfer" (no trailing ellipsis) @fast', async ({ page }) => {
    await ready(page);
    await openModal(page);
    await expect(page.locator('#slide-config-modal-title')).toHaveText('SLIDE File Transfer');
  });
});

test.describe('E3.4 AC-2 — Save-received-files-to-folder row moves verbatim', () => {
  test('row hosts the checkbox/label/button/status/help with verbatim ids + copy @fast', async ({ page }) => {
    await ready(page);
    await openModal(page);
    const row = dialog(page).locator('#slide-recv-folder-row');
    await expect(row).toHaveCount(1);
    // Checkbox + label copy + verbatim title.
    await expect(row.locator('#slide-recv-to-folder-checkbox')).toHaveCount(1);
    await expect(row.locator('label[for="slide-recv-to-folder-checkbox"]'))
      .toHaveText('Save received files to a folder');
    await expect(row.locator('label[for="slide-recv-to-folder-checkbox"]'))
      .toHaveAttribute('title', "When enabled, files received via SLIDE land in a folder you pick. Otherwise they download to your browser's Downloads folder.");
    // Choose-folder button + its default (toggle-off) title + status default.
    await expect(row.locator('#slide-recv-folder-button')).toHaveText('Choose folder…');
    await expect(row.locator('#slide-recv-folder-button')).toHaveAttribute('title', 'Toggle the checkbox first');
    await expect(row.locator('#slide-recv-folder-status')).toHaveText('No folder selected');
    // Dynamic folder-help (default toggle-off copy) — now the ⓘ .field-tip content.
    await expect(row.locator('#slide-recv-folder-help'))
      .toHaveText('Received files land in your Downloads folder. Toggle this to pick a fixed destination.');
  });
});

test.describe('E3.4 AC-3 — Auto-send command row + validation cue move verbatim', () => {
  test('input default + static hint + hidden validation hint @fast', async ({ page }) => {
    await ready(page);
    await openModal(page);
    const row = dialog(page).locator('#slide-auto-send-row');
    await expect(row.locator('#slide-auto-send-input')).toHaveValue('B:SLIDE R');
    await expect(row.locator('#slide-auto-send-input')).toHaveAttribute('autocomplete', 'off');
    await expect(row.locator('#slide-auto-send-input')).toHaveAttribute('spellcheck', 'false');
    await expect(row.getByText('\\r appended automatically')).toBeVisible();
    // Validation hint present but hidden by default (JS live-toggles it — NOT a tooltip).
    await expect(row.locator('#slide-auto-send-validation-hint')).toBeHidden();
    await expect(row.locator('#slide-auto-send-validation-hint'))
      .toHaveText('Auto-send command unsafe — disabled.');
  });
});

test.describe('E3.4 AC-4 — Show-summary + Confirm-transfers toggles move verbatim with defaults', () => {
  test('show-summary default checked + label @fast', async ({ page }) => {
    await ready(page);
    await openModal(page);
    await expect(dialog(page).locator('#slide-show-summary')).toBeChecked();
    await expect(dialog(page).locator('label[for="slide-show-summary"]'))
      .toHaveText('Show transfer summary chip');
  });

  test('confirm-transfers default checked + label + verbatim help copy @fast', async ({ page }) => {
    await ready(page);
    await openModal(page);
    await expect(dialog(page).locator('#slide-confirm-transfers-checkbox')).toBeChecked();
    await expect(dialog(page).locator('label[for="slide-confirm-transfers-checkbox"]'))
      .toHaveText('Confirm file transfers');
    // Help copy relocated verbatim into the ⓘ .field-tip.
    await expect(dialog(page).locator('#slide-confirm-transfers-row .field-tip'))
      .toHaveText('When off, drops and picker selections begin transferring immediately. Filename collisions are auto-renamed.');
  });
});

test.describe('E3.4 AC-5 — Compatibility-mode select moves verbatim with its exact option set', () => {
  test('select default "auto" + verbatim option values/labels @fast', async ({ page }) => {
    await ready(page);
    await openModal(page);
    const sel = dialog(page).locator('#slide-compat-select');
    await expect(sel).toHaveValue('auto');
    const opts = await sel.locator('option').evaluateAll(
      (els) => els.map((o) => [o.value, o.textContent]));
    expect(opts).toEqual([
      ['auto', 'Auto'],
      ['wakeup-required', 'Wakeup-required'],
      ['force-start', 'Force-start (legacy slide.com)'],
    ]);
  });
});

test.describe('E3.4 AC-7 — neutral-shell styling + focus + aria-live', () => {
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

  test('the folder-status line is the aria-live=polite region @fast', async ({ page }) => {
    await ready(page);
    await openModal(page);
    await expect(dialog(page).locator('#slide-recv-folder-status'))
      .toHaveAttribute('aria-live', 'polite');
  });

  test('initial focus is the first form control (Save-to-folder checkbox) @fast', async ({ page }) => {
    await ready(page);
    await openModal(page);
    expect(await page.evaluate(() => document.activeElement && document.activeElement.id))
      .toBe('slide-recv-to-folder-checkbox');
    await expect(dialog(page).locator('#slide-recv-to-folder-checkbox'))
      .toHaveAttribute('data-focused', 'true');
  });
});

test.describe('E3.4 AC-8 — footer is Close only; no Reset button', () => {
  test('exactly one footer button, id=slide-config-close, value=close @fast', async ({ page }) => {
    await ready(page);
    await openModal(page);
    const buttons = dialog(page).locator('footer button');
    await expect(buttons).toHaveCount(1);
    await expect(buttons).toHaveText('Close');
    await expect(dialog(page).locator('#slide-config-close')).toHaveAttribute('value', 'close');
    // No "Reset" affordance anywhere in the modal (Q2 — SLIDE has no preset-reset analog).
    expect(await dialog(page).getByText(/reset/i).count()).toBe(0);
  });
});

test.describe('E3.4 AC-9 — legacy pane retired; exactly one SLIDE surface', () => {
  test('#settings-slide pane is gone; each control exists exactly once, inside the modal @fast', async ({ page }) => {
    await ready(page);
    // The pane must be removed even before the modal opens (it is retired wholesale).
    await expect(page.locator('#settings-slide')).toHaveCount(0);
    await openModal(page);
    for (const id of [
      '#slide-recv-to-folder-checkbox',
      '#slide-auto-send-input',
      '#slide-show-summary',
      '#slide-confirm-transfers-checkbox',
      '#slide-compat-select',
    ]) {
      // Exactly one instance globally (no dual-chrome / dual-state — NFR-4)…
      await expect(page.locator(id)).toHaveCount(1);
      // …and it lives inside the modal.
      await expect(dialog(page).locator(id)).toHaveCount(1);
    }
  });
});
