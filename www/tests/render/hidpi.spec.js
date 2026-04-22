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

test.describe('Gap #8 (UAT Test 14) — CRT glyph fills the full cell height on HiDPI', () => {
  test('bitmap glyph paints pixels in the bottom half of a 16×32 CRT cell — gap #8', async ({ page }) => {
    // Plan 03-05 Task 2 fixed rasteriseBitmap to scale 8×16 source glyph to
    // fill a 16×32 cell (derived pxW=cellW/8, pxH=cellH/16 instead of hard
    // z=1 that only filled rows 0..15 of a 32-row cell).
    await page.goto('/');
    await page.waitForFunction(() => document.getElementById('terminal').width > 0);
    await page.locator('#terminal-wrapper').focus();

    // Feed a glyph with pixels in the BOTTOM half of its 16-row source
    // bitmap. Most ASCII glyphs (e.g., 'g', 'j', 'p', 'q', 'y') have
    // descenders past native row 9 — these MUST now render in cell rows
    // 18..31 after the 2× vertical upsample. 'H' is safer: its bottom
    // horizontal stroke in the IBM VGA 8×16 font sits around source row 14,
    // which after 2× upscale lands at cell row 28..29.
    await page.locator('#debug').evaluate((el) => { el.open = true; });
    await page.fill('#input', 'HHHHHHHH');
    await page.click('#feed');
    await page.waitForTimeout(150);

    // Backing store: 1× zoom, CRT, DPR 2 → cell is 16×32 CSS × 2 DPR =
    // 32×64 backing px. Scan the BOTTOM HALF of row 0 (backing y=32..63) —
    // any phosphor-green pixel proves the glyph fills the cell vertically.
    const hasBottomPixel = await page.evaluate(() => {
      const c = document.getElementById('terminal');
      const ctx = c.getContext('2d');
      const img = ctx.getImageData(0, 32, Math.min(c.width, 640), 32);
      for (let i = 0; i < img.data.length; i += 4) {
        if (img.data[i + 1] > 60) return true;
      }
      return false;
    });
    expect(hasBottomPixel).toBe(true);
  });
});
