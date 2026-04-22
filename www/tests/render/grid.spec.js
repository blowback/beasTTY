// Phase 3 Plan 04 — RENDER-01 / RENDER-04 / RENDER-05
// 80×24 grid renders fixture bytes on the default CRT green theme, plus
// the visual-regression baseline for the default CRT canvas state.
//
// Targets (per 03-04-PLAN.md):
//   - RENDER-01: 80×24 grid present + non-background pixels after fixture feed
//   - RENDER-04: bitmap font rasterisation paints glyph pixels
//   - RENDER-05: fixture feed → canvas paint (end-to-end)
import { test, expect } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FIXTURE = fs.readFileSync(path.join(__dirname, '../fixtures/vt52-sample.bin'));

function bytesToHexEscape(bytes) {
  // parseHexEscapes in main.js accepts \xNN uppercase or lowercase hex pairs.
  let out = '';
  for (const b of bytes) {
    out += '\\x' + b.toString(16).padStart(2, '0').toUpperCase();
  }
  return out;
}

test.describe('RENDER-01 / RENDER-04 / RENDER-05 — 80x24 grid renders', () => {
  test('canvas is sized 1280x768 CSS px for 80x24 CRT grid @fast', async ({ page }) => {
    await page.goto('/');
    await page.waitForFunction(() => {
      const c = document.getElementById('terminal');
      return c && c.width > 0 && c.height > 0;
    });

    // RENDER-01: 80 cols × 24 rows with 16×32 CRT cells → 1280 × 768 CSS px.
    const dims = await page.evaluate(() => {
      const c = document.getElementById('terminal');
      return {
        cssW: parseFloat(c.style.width),
        cssH: parseFloat(c.style.height),
      };
    });
    expect(dims.cssW).toBe(1280);
    expect(dims.cssH).toBe(768);
  });

  test('default CRT green paints fixture bytes with non-bg pixels — gap #2 closure', async ({ page }) => {
    // Gap #2 regression: pre-Plan 03-05 the tick() ordering (reDeriveViews
    // BEFORE snapshot_grid) left gridView a zero-length Uint8Array after the
    // first snapshot memory-grow; paintRow read undefined and painted nothing.
    // Plan 03-05 Task 1 moves snapshot_grid() first + size-delta rebuild.
    await page.goto('/');
    await page.waitForFunction(() => {
      const c = document.getElementById('terminal');
      return c && c.width > 0 && c.height > 0;
    });

    await page.locator('#debug').evaluate((el) => { el.open = true; });
    const hexString = bytesToHexEscape(FIXTURE);
    await page.fill('#input', hexString);
    await page.click('#feed');
    await page.waitForTimeout(200);

    const nonBgFound = await page.evaluate(() => {
      const c = document.getElementById('terminal');
      const ctx = c.getContext('2d');
      const img = ctx.getImageData(0, 0, c.width, Math.min(c.height, 128));
      for (let i = 0; i < img.data.length; i += 4) {
        if (img.data[i] > 30 || img.data[i + 1] > 60) return true;
      }
      return false;
    });
    expect(nonBgFound).toBe(true);
  });

  test('FIRST Feed click after boot paints non-bg pixels (no 64 KB prime needed) — gap #2', async ({ page }) => {
    await page.goto('/');
    await page.waitForFunction(() => document.getElementById('terminal').width > 0);

    // Pre-fix symptom: "cursor moves down but no text appears on Feed. 64 KB
    // stress sends two lines of text. thereafter, Feed works properly." That
    // is the zero-length gridView path. We trigger exactly ONE Feed click
    // with a short (NOT 64 KB) payload and assert glyph pixels appear.
    await page.locator('#debug').evaluate((el) => { el.open = true; });
    await page.fill('#input', 'ABCDEF');
    await page.click('#feed');
    await page.waitForTimeout(150);

    const nonBgFound = await page.evaluate(() => {
      const c = document.getElementById('terminal');
      const ctx = c.getContext('2d');
      // Sample first row region: at DPR=2, cellH*dpr=64 so row 0 spans y=0..63.
      // Scan backing-store pixel band for non-bg (phosphor-green glyph).
      const img = ctx.getImageData(0, 0, Math.min(c.width, 640), 64);
      for (let i = 0; i < img.data.length; i += 4) {
        if (img.data[i + 1] > 60) return true;   // any green > 60 = glyph pixel
      }
      return false;
    });
    expect(nonBgFound).toBe(true);
  });

  test('default CRT canvas matches visual baseline', async ({ page }) => {
    await page.goto('/');
    await page.waitForFunction(() => document.getElementById('terminal').width > 0);
    // Focus wrapper but pause blink phase so baseline is consistent.
    await page.locator('#terminal-wrapper').focus();
    await page.waitForTimeout(300);

    // The cursor blinks on a 530 ms cycle — snapshot the wrapper and allow
    // up to 2% pixel diff (playwright.config.js uses 1%; we loosen here).
    await expect(page.locator('#terminal-wrapper')).toHaveScreenshot('crt-default.png', {
      maxDiffPixelRatio: 0.02,
    });
  });
});
