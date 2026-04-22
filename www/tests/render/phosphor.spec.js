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

test.describe('Gap #5 (UAT Test 7) — Phosphor switch recolours rendered glyphs', () => {
  test('existing glyphs recolour on phosphor change (green → amber) — gap #5', async ({ page }) => {
    // Plan 03-05 Task 1 adds markAllRowsDirty() in setPhosphor. Pre-fix
    // tick() only repainted dirty rows — atlas was evicted but no row was
    // marked dirty, so old green tiles stayed on screen until the wasm core
    // next flagged a row dirty.
    await page.goto('/');
    await page.waitForFunction(() => document.getElementById('terminal').width > 0);
    await page.locator('#terminal-wrapper').focus();

    // Feed a glyph string in green.
    await page.locator('#debug').evaluate((el) => { el.open = true; });
    await page.fill('#input', 'HELLO');
    await page.click('#feed');
    await page.waitForTimeout(150);

    // Switch to amber and wait for repaint.
    await page.click('[data-phosphor="amber"]');
    await page.waitForTimeout(250);

    // Amber fg is #ffb000 → rgb(255, 176, 0). After phosphor change every
    // previously-rendered glyph pixel must be amber, NOT green.
    const sampled = await page.evaluate(() => {
      const c = document.getElementById('terminal');
      const ctx = c.getContext('2d');
      const img = ctx.getImageData(0, 0, Math.min(c.width, 640), 64);
      let greenCount = 0;
      let amberCount = 0;
      for (let i = 0; i < img.data.length; i += 4) {
        const r = img.data[i];
        const g = img.data[i + 1];
        const b = img.data[i + 2];
        // Phosphor green #33ff66 → g dominant, b > 50.
        if (g > 150 && r < 100 && b > 50) greenCount++;
        // Phosphor amber #ffb000 → r dominant + g ~176 + b ~0.
        if (r > 200 && g > 100 && g < 220 && b < 80) amberCount++;
      }
      return { greenCount, amberCount };
    });
    expect(sampled.amberCount).toBeGreaterThan(0);
    expect(sampled.greenCount).toBe(0);
  });
});
