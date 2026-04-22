// Phase 3 Plan 04 — RENDER-03 — Focus indicator.
// #terminal-wrapper border changes colour between focused and blurred states
// without layout reflow (D-13: 1 px solid transparent border on the default
// state; :focus-visible swaps border-color to accent).
import { test, expect } from '@playwright/test';

test.describe('RENDER-03 — Focus indicator', () => {
  test('border colour changes on focus / blur without layout reflow — gap #7 attribute-selector', async ({ page }) => {
    // Plan 03-06 Task 2 switched the focus border from
    // #terminal-wrapper:focus-visible to #terminal-wrapper[data-focused="true"]
    // because :focus-visible does NOT fire for programmatic .focus() at boot
    // or mouse-click focus in Chromium — only keyboard-initiated focus.
    // The data-focused attribute is set by chrome.js focus handler for BOTH
    // pointer and keyboard focus paths.
    await page.goto('/');
    await page.waitForFunction(() => document.getElementById('terminal').width > 0);

    const wrapper = page.locator('#terminal-wrapper');

    // Start focused (chrome.js auto-focuses at boot → data-focused="true").
    await wrapper.focus();
    await page.waitForTimeout(50);
    await expect(wrapper).toHaveAttribute('data-focused', 'true');
    const focused = await wrapper.evaluate((el) => ({
      border: getComputedStyle(el).borderColor,
      width: el.offsetWidth,
      height: el.offsetHeight,
    }));
    // Focused border MUST be a non-transparent rgb — Chromium serialises
    // transparent as "rgba(0, 0, 0, 0)"; non-transparent is "rgb(...)" or
    // "rgba(..., 1)".
    expect(focused.border).not.toMatch(/rgba\(0,\s*0,\s*0,\s*0\)/);

    // Blur the wrapper.
    await page.locator('#debug').evaluate((el) => { el.open = true; });
    await page.focus('#input');
    await page.waitForTimeout(50);
    await expect(wrapper).toHaveAttribute('data-focused', 'false');

    const blurred = await wrapper.evaluate((el) => ({
      border: getComputedStyle(el).borderColor,
      width: el.offsetWidth,
      height: el.offsetHeight,
    }));

    // D-13 — no reflow: dimensions identical.
    expect(blurred.width).toBe(focused.width);
    expect(blurred.height).toBe(focused.height);
    // Blurred border colour differs from focused.
    expect(blurred.border).not.toBe(focused.border);
    // Blurred border is transparent.
    expect(blurred.border).toMatch(/rgba\(0,\s*0,\s*0,\s*0\)/);

    // Re-focus; border returns to accent.
    await wrapper.focus();
    await page.waitForTimeout(50);
    await expect(wrapper).toHaveAttribute('data-focused', 'true');
    const refocused = await wrapper.evaluate((el) => getComputedStyle(el).borderColor);
    expect(refocused).toBe(focused.border);
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

  test('mouse click focus activates border (pointer path) — gap #7', async ({ page }) => {
    // Pre-fix: :focus-visible selector did NOT trigger on mouse focus.
    // Post-fix: data-focused="true" attribute set by chrome.js click/focus
    // handler regardless of input modality.
    await page.goto('/');
    await page.waitForFunction(() => document.getElementById('terminal').width > 0);

    // Blur first (open debug + focus textarea).
    await page.locator('#debug').evaluate((el) => { el.open = true; });
    await page.focus('#input');
    await page.waitForTimeout(50);
    await expect(page.locator('#terminal-wrapper')).toHaveAttribute('data-focused', 'false');

    // Mouse-click the wrapper — pointer-focus path.
    await page.locator('#terminal-wrapper').click();
    await page.waitForTimeout(50);
    await expect(page.locator('#terminal-wrapper')).toHaveAttribute('data-focused', 'true');

    // Border is NOT transparent.
    const border = await page.locator('#terminal-wrapper').evaluate((el) => getComputedStyle(el).borderColor);
    expect(border).not.toMatch(/rgba\(0,\s*0,\s*0,\s*0\)/);
  });
});
