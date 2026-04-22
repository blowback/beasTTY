// Phase 3 Plan 04 — RENDER-03 — Focus indicator.
// #terminal-wrapper border changes colour between focused and blurred states
// without layout reflow (D-13: 1 px solid transparent border on the default
// state; :focus-visible swaps border-color to accent).
import { test, expect } from '@playwright/test';

test.describe('RENDER-03 — Focus indicator', () => {
  test('border colour changes on focus / blur without layout reflow', async ({ page }) => {
    await page.goto('/');
    await page.waitForFunction(() => document.getElementById('terminal').width > 0);

    const wrapper = page.locator('#terminal-wrapper');

    // Start focused (chrome.js auto-focuses at boot). Capture dimensions + border.
    await wrapper.focus();
    const focused = await wrapper.evaluate((el) => ({
      border: getComputedStyle(el).borderColor,
      width: el.offsetWidth,
      height: el.offsetHeight,
    }));

    // Blur the wrapper by clicking into the Debug textarea.
    await page.locator('#debug').evaluate((el) => { el.open = true; });
    await page.focus('#input');
    await page.waitForTimeout(50);

    const blurred = await wrapper.evaluate((el) => ({
      border: getComputedStyle(el).borderColor,
      width: el.offsetWidth,
      height: el.offsetHeight,
    }));

    // D-13: no reflow — dimensions identical between focused and blurred.
    expect(blurred.width).toBe(focused.width);
    expect(blurred.height).toBe(focused.height);

    // Border colour must differ between states.
    expect(focused.border).not.toBe(blurred.border);

    // Re-focus and confirm the border colour returns.
    await wrapper.focus();
    await page.waitForTimeout(50);
    const refocused = await wrapper.evaluate((el) => ({
      border: getComputedStyle(el).borderColor,
      width: el.offsetWidth,
      height: el.offsetHeight,
    }));
    expect(refocused.width).toBe(focused.width);
    expect(refocused.height).toBe(focused.height);
    expect(refocused.border).toBe(focused.border);
  });

  test('focused attribute data-focused mirrors activeElement state', async ({ page }) => {
    await page.goto('/');
    const wrapper = page.locator('#terminal-wrapper');

    // Auto-focused at boot — chrome.js sets data-focused="true" on focus event.
    await wrapper.focus();
    await page.waitForTimeout(50);
    await expect(wrapper).toHaveAttribute('data-focused', 'true');

    // Blur → data-focused="false".
    await page.locator('#debug').evaluate((el) => { el.open = true; });
    await page.focus('#input');
    await page.waitForTimeout(50);
    await expect(wrapper).toHaveAttribute('data-focused', 'false');
  });
});
