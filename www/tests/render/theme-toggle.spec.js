// Phase 3 Plan 04 — RENDER-06 / RENDER-07 — Theme toggle.
// Covers both click-based theme toggle (button) and keyboard shortcut
// Ctrl+Shift+T, plus the UI-SPEC copywriting contract (button label shows
// destination theme name).
import { test, expect } from '@playwright/test';

test.describe('RENDER-06 / RENDER-07 — Theme toggle', () => {
  test('click on #theme-toggle swaps body[data-theme] @fast', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('body')).toHaveAttribute('data-theme', 'crt');

    await page.click('#theme-toggle');
    await expect(page.locator('body')).toHaveAttribute('data-theme', 'clean');

    await page.click('#theme-toggle');
    await expect(page.locator('body')).toHaveAttribute('data-theme', 'crt');
  });

  test('Ctrl+Shift+T toggles theme @fast', async ({ page }) => {
    await page.goto('/');
    // chrome.js auto-focuses wrapper at boot — wait for focus + ensure we win.
    await page.locator('#terminal-wrapper').focus();
    await expect(page.locator('body')).toHaveAttribute('data-theme', 'crt');

    await page.keyboard.press('Control+Shift+KeyT');
    await expect(page.locator('body')).toHaveAttribute('data-theme', 'clean');

    await page.keyboard.press('Control+Shift+KeyT');
    await expect(page.locator('body')).toHaveAttribute('data-theme', 'crt');
  });

  test('theme-toggle button label shows destination theme name', async ({ page }) => {
    await page.goto('/');
    // CRT active → label shows destination "Clean" (UI-SPEC Copywriting Contract).
    await expect(page.locator('#theme-toggle')).toHaveText('Clean');

    await page.click('#theme-toggle');
    await expect(page.locator('#theme-toggle')).toHaveText('CRT');
  });
});
