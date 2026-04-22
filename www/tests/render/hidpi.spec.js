// Phase 3 Plan 04 — RENDER-10 — HiDPI backing-store assertion.
// deviceScaleFactor: 2 is set in playwright.config.js; canvas.width must be
// Math.round(cssWidth * devicePixelRatio).
import { test, expect } from '@playwright/test';

test.describe('RENDER-10 — HiDPI backing store', () => {
  test('canvas.width equals cssWidth × devicePixelRatio @fast', async ({ page }) => {
    await page.goto('/');
    await page.waitForFunction(() => document.getElementById('terminal').width > 0);

    const { backingW, backingH, cssW, cssH, dpr } = await page.evaluate(() => {
      const c = document.getElementById('terminal');
      return {
        backingW: c.width,
        backingH: c.height,
        cssW: parseFloat(c.style.width),
        cssH: parseFloat(c.style.height),
        dpr: window.devicePixelRatio,
      };
    });

    // playwright.config.js chromium project pins deviceScaleFactor to 2.
    expect(dpr).toBe(2);
    // canvas.js resizeToTheme: canvas.width = Math.round(cssW * activeDpr).
    expect(backingW).toBe(Math.round(cssW * dpr));
    expect(backingH).toBe(Math.round(cssH * dpr));
    // Default CRT 1×: cellW=16, 80 cols → 1280 CSS px wide.
    expect(cssW).toBe(1280);
    expect(cssH).toBe(768);
  });
});
