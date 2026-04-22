// Phase 3 Plan 04 — @fast keyboard-shortcut suite.
// Aggregates the quickest state-level shortcut checks so
// `npm run test:fast` (playwright --grep @fast) runs in under 10 s.
import { test, expect } from '@playwright/test';

test.describe('Keyboard shortcuts @fast', () => {
  test('Ctrl+Shift+T toggles theme (state check only) @fast', async ({ page }) => {
    await page.goto('/');
    await page.locator('#terminal-wrapper').focus();

    await expect(page.locator('body')).toHaveAttribute('data-theme', 'crt');
    await page.keyboard.press('Control+Shift+KeyT');
    await expect(page.locator('body')).toHaveAttribute('data-theme', 'clean');
  });

  test('Ctrl+Digit0 resets zoom to 1× @fast', async ({ page }) => {
    await page.goto('/');
    await page.locator('#terminal-wrapper').focus();
    await page.waitForFunction(() => document.getElementById('terminal').width > 0);

    const base = await page.evaluate(() =>
      parseFloat(document.getElementById('terminal').style.width),
    );

    await page.keyboard.press('Control+Equal');
    await page.keyboard.press('Control+Equal');
    await page.waitForTimeout(60);
    await page.keyboard.press('Control+Digit0');
    await page.waitForTimeout(60);

    const reset = await page.evaluate(() =>
      parseFloat(document.getElementById('terminal').style.width),
    );
    expect(reset).toBe(base);
  });

  test('Ctrl+Equal zooms in; Ctrl+Minus zooms out @fast', async ({ page }) => {
    await page.goto('/');
    await page.locator('#terminal-wrapper').focus();
    await page.waitForFunction(() => document.getElementById('terminal').width > 0);

    const base = await page.evaluate(() =>
      parseFloat(document.getElementById('terminal').style.width),
    );

    await page.keyboard.press('Control+Equal');
    await page.waitForTimeout(60);
    const zoomed = await page.evaluate(() =>
      parseFloat(document.getElementById('terminal').style.width),
    );
    expect(zoomed).toBe(base * 2);

    await page.keyboard.press('Control+Minus');
    await page.waitForTimeout(60);
    const restored = await page.evaluate(() =>
      parseFloat(document.getElementById('terminal').style.width),
    );
    expect(restored).toBe(base);
  });
});
