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
