// Phase 3 Plan 04 — RENDER-09 — Integer zoom via Ctrl +/-/0.
// zoomStep clamps to [1, 4]. canvas.style.width is in CSS px (cellW * 80 * zoom).
import { test, expect } from '@playwright/test';

async function cssWidth(page) {
  return page.evaluate(() => {
    const c = document.getElementById('terminal');
    return parseFloat(c.style.width);
  });
}

test.describe('RENDER-09 — Integer zoom via Ctrl +/-/0', () => {
  test('Ctrl+Equal zooms in; Ctrl+Minus zooms out; Ctrl+Digit0 resets @fast', async ({ page }) => {
    await page.goto('/');
    await page.locator('#terminal-wrapper').focus();
    await page.waitForFunction(() => document.getElementById('terminal').width > 0);

    // CRT 1×: cellW=16, 80 cols → 1280 CSS px wide.
    const base = await cssWidth(page);
    expect(base).toBe(1280);

    await page.keyboard.press('Control+Equal');
    await page.waitForTimeout(60);
    expect(await cssWidth(page)).toBe(base * 2);

    await page.keyboard.press('Control+Equal');
    await page.waitForTimeout(60);
    expect(await cssWidth(page)).toBe(base * 3);

    await page.keyboard.press('Control+Minus');
    await page.waitForTimeout(60);
    expect(await cssWidth(page)).toBe(base * 2);

    await page.keyboard.press('Control+Digit0');
    await page.waitForTimeout(60);
    expect(await cssWidth(page)).toBe(base);
  });

  test('zoom clamps at 4× (Ctrl+Equal past max is a no-op)', async ({ page }) => {
    await page.goto('/');
    await page.locator('#terminal-wrapper').focus();
    await page.waitForFunction(() => document.getElementById('terminal').width > 0);
    const base = await cssWidth(page);

    for (let i = 0; i < 6; i++) {
      await page.keyboard.press('Control+Equal');
    }
    await page.waitForTimeout(60);
    expect(await cssWidth(page)).toBe(base * 4);
  });

  test('zoom clamps at 1× (Ctrl+Minus below floor is a no-op)', async ({ page }) => {
    await page.goto('/');
    await page.locator('#terminal-wrapper').focus();
    await page.waitForFunction(() => document.getElementById('terminal').width > 0);
    const base = await cssWidth(page);

    // Already at 1×; pressing Ctrl+Minus several times must not shrink below base.
    for (let i = 0; i < 3; i++) {
      await page.keyboard.press('Control+Minus');
    }
    await page.waitForTimeout(60);
    expect(await cssWidth(page)).toBe(base);
  });
});

test.describe('Gap #6 (UAT Test 8) — Zoom preserves canvas content', () => {
  test('glyphs painted at 1× are still painted after Ctrl+= zoom to 2× — gap #6', async ({ page }) => {
    // Plan 03-05 Task 1 adds markAllRowsDirty() in zoomStep + resetZoom.
    // Pre-fix zoom resized the canvas, evicted the atlas, and re-primed the
    // cache — but paintRow only ran for dirty rows (all zero after the wasm
    // side last cleared dirty), so the previously-painted content never
    // reappeared at the new zoom level.
    await page.goto('/');
    await page.waitForFunction(() => document.getElementById('terminal').width > 0);
    await page.locator('#terminal-wrapper').focus();

    // Feed glyphs at 1× zoom.
    await page.locator('#debug').evaluate((el) => { el.open = true; });
    await page.fill('#input', 'HELLO');
    await page.click('#feed');
    await page.waitForTimeout(150);

    // Verify glyphs present before zoom.
    const before = await page.evaluate(() => {
      const c = document.getElementById('terminal');
      const ctx = c.getContext('2d');
      const img = ctx.getImageData(0, 0, Math.min(c.width, 640), 64);
      for (let i = 0; i < img.data.length; i += 4) {
        if (img.data[i + 1] > 60) return true;
      }
      return false;
    });
    expect(before).toBe(true);

    // Zoom in — canvas resizes, atlas evicts, all rows should be marked dirty.
    await page.keyboard.press('Control+Equal');
    await page.waitForTimeout(250);

    const after = await page.evaluate(() => {
      const c = document.getElementById('terminal');
      const ctx = c.getContext('2d');
      // At 2× zoom + DPR 2, canvas.width doubles — sample first row (128 px tall).
      const img = ctx.getImageData(0, 0, Math.min(c.width, 1280), 128);
      for (let i = 0; i < img.data.length; i += 4) {
        if (img.data[i + 1] > 60) return true;
      }
      return false;
    });
    expect(after).toBe(true);
  });
});
