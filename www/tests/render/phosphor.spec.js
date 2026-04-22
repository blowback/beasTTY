// Phase 3 Plan 04 — RENDER-08 — Phosphor radio-group (CRT only).
// Assert aria-pressed moves exclusively to the clicked button, and that
// the CSS custom property --phosphor-fg on :root matches the expected hex.
import { test, expect } from '@playwright/test';

const PALETTE = {
  green: '#33ff66',
  amber: '#ffb000',
  white: '#e8e8d8',
};

test.describe('RENDER-08 — Phosphor selection (CRT only)', () => {
  test('each phosphor button updates aria-pressed exclusively', async ({ page }) => {
    await page.goto('/');
    // Default: green pressed, others not.
    await expect(page.locator('[data-phosphor="green"]')).toHaveAttribute('aria-pressed', 'true');
    await expect(page.locator('[data-phosphor="amber"]')).toHaveAttribute('aria-pressed', 'false');
    await expect(page.locator('[data-phosphor="white"]')).toHaveAttribute('aria-pressed', 'false');

    await page.click('[data-phosphor="amber"]');
    await expect(page.locator('[data-phosphor="amber"]')).toHaveAttribute('aria-pressed', 'true');
    await expect(page.locator('[data-phosphor="green"]')).toHaveAttribute('aria-pressed', 'false');
    await expect(page.locator('[data-phosphor="white"]')).toHaveAttribute('aria-pressed', 'false');

    await page.click('[data-phosphor="white"]');
    await expect(page.locator('[data-phosphor="white"]')).toHaveAttribute('aria-pressed', 'true');
    await expect(page.locator('[data-phosphor="amber"]')).toHaveAttribute('aria-pressed', 'false');
    await expect(page.locator('[data-phosphor="green"]')).toHaveAttribute('aria-pressed', 'false');
  });

  test('CSS var --phosphor-fg matches selected palette', async ({ page }) => {
    await page.goto('/');

    for (const [color, hex] of Object.entries(PALETTE)) {
      await page.click(`[data-phosphor="${color}"]`);
      const cssFg = await page.evaluate(() =>
        getComputedStyle(document.documentElement).getPropertyValue('--phosphor-fg').trim(),
      );
      expect(cssFg.toLowerCase()).toBe(hex.toLowerCase());
    }
  });

  test('phosphor group is hidden in clean theme', async ({ page }) => {
    await page.goto('/');
    // CRT theme (default): group visible.
    await expect(page.locator('#phosphor-group')).toBeVisible();

    await page.click('#theme-toggle'); // CRT → clean
    await expect(page.locator('#phosphor-group')).toBeHidden();

    await page.click('#theme-toggle'); // clean → CRT
    await expect(page.locator('#phosphor-group')).toBeVisible();
  });
});
