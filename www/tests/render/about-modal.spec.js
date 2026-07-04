// Epic E6 Story E6.2 (FR-25, UX-DR10) — About Beastty info modal.
//
// A FIFTH static-content <dialog id="about-modal"> on the shared modal rails (clone of
// #keyboard-shortcuts-modal / E6.1), opened from Help ▸ About Beastty…. A non-destructive
// INFO modal (build rows + privacy prose + Close), so initialFocus is the Close button.
// The ONE wrinkle vs E6.1: the Build/Built rows are DYNAMIC — projectAboutBuild (main.js)
// reads window.__buildInfo at open time. Locks AC-1..AC-5.
//
// Idioms (E1 retro action #4, re-embedded per E5.1 Q3): boot-race guard on
// window.__menuBar/__modal — EXTENDED to also await window.__buildInfo (the build push is
// async, mirrors status-bar.spec.js:196); window.__menuBar.open('help') for a deterministic
// open (NOT a title click); menu-driven open → data-action dispatch; focus-restore via
// activeElement.id. The build SHA is asserted against window.__buildInfo.sha read IN-PAGE —
// never hard-coded (it is gitignored / regenerated per build; the fallback is 'unknown (unbuilt)').
import { test, expect } from '@playwright/test';

// Verbatim from the polite-fail page (transport/serial.js:129) — byte-identical.
const PRIVACY = 'No telemetry. No data leaves your browser.';

async function ready(page) {
  await page.goto('/');
  await page.waitForFunction(
    () => window.__menuBar && typeof window.__menuBar.__getStateForTests === 'function'
          && typeof window.__modal === 'object' && window.__modal !== null
          && window.__buildInfo && typeof window.__buildInfo.sha === 'string',
  );
  await page.locator('#terminal-wrapper').focus();
  await page.waitForFunction(() => document.getElementById('terminal').width > 0);
}

// Deterministic open via the real menu path (open Help → click the row).
async function openModal(page) {
  await page.evaluate(() => window.__menuBar.open('help'));
  await page.click('#dropdown-help .menu-item[data-action="about"]');
  await expect(page.locator('#about-modal')).toBeVisible();
}

const dialog = (page) => page.locator('#about-modal');

test.describe('E6.2 AC-1/AC-3 — opens from the Help menu via openModal; dropdown closes', () => {
  test('activating the row opens the modal + closes the dropdown @fast', async ({ page }) => {
    await ready(page);
    await openModal(page);
    expect(await page.evaluate(() => window.__menuBar.getOpenMenu())).toBe(null);
    expect(await page.evaluate(() => window.__modal.__getStateForTests().openDialogId))
      .toBe('about-modal');
  });

  test('initial focus is the Close button (non-destructive default) @fast', async ({ page }) => {
    await ready(page);
    await openModal(page);
    expect(await page.evaluate(() => document.activeElement && document.activeElement.id))
      .toBe('about-close');
    await expect(page.locator('#about-close')).toHaveAttribute('data-focused', 'true');
  });

  test('Close returns focus to #terminal-wrapper (restoreTo) @fast', async ({ page }) => {
    await ready(page);
    await openModal(page);
    await page.click('#about-modal form[method="dialog"] button');
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

test.describe('E6.2 AC-2 — shows all four content blocks, single-sourced', () => {
  test('Build SHA renders window.__buildInfo.sha EXACTLY (single source, not hard-coded) @fast', async ({ page }) => {
    await ready(page);
    await openModal(page);
    // Read the SHA in-page — it is gitignored / regenerated per build (fallback
    // 'unknown (unbuilt)' in CI/dev). Asserting equality proves About == the status bar.
    const sha = await page.evaluate(() => window.__buildInfo.sha);
    await expect(page.locator('#about-build-sha')).toHaveText(sha);
  });

  test('builtAt renders when present, or "—" when null — never a literal null/undefined @fast', async ({ page }) => {
    await ready(page);
    await openModal(page);
    const builtAt = await page.evaluate(() => window.__buildInfo.builtAt);
    const expected = builtAt || '—';
    await expect(page.locator('#about-built-at')).toHaveText(expected);
    const text = await page.locator('#about-built-at').innerText();
    expect(text).not.toContain('null');
    expect(text).not.toContain('undefined');
  });

  test('privacy line verbatim, literal TBD source, Chromium note, header @fast', async ({ page }) => {
    await ready(page);
    await openModal(page);
    const body = dialog(page).locator('.modal-body');
    await expect(body).toContainText(PRIVACY);
    await expect(body).toContainText('TBD');
    await expect(body).toContainText('Chromium-based browser');
    await expect(body).toContainText('Web Serial is a Chromium-only API');
    await expect(dialog(page).locator('#about-modal-title')).toHaveText('About Beastty');
  });
});

test.describe('E6.2 AC-4 — neutral clean-modal styling', () => {
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
