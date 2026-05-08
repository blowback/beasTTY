// Phase 3 Plan 04 — RENDER-11 — Bell overlay flash + title prefix.
// BEL (0x07) triggers a ~100 ms CSS overlay flash (#bell-overlay.flash); when
// document.hidden is true at the moment of feed, document.title is prefixed
// with "(!) " — chrome.js strips the prefix on visibilitychange.
import { test, expect } from '@playwright/test';

test.describe('RENDER-11 — Bell overlay + title prefix', () => {
  test('BEL byte triggers #bell-overlay.flash class momentarily', async ({ page }) => {
    await page.goto('/');
    await page.locator('#debug').evaluate((el) => { el.open = true; });
    await page.fill('#input', '\\x07');
    await page.click('#feed');

    // Overlay flash toggles on synchronously — classList.add('flash') runs
    // inside triggerBellFlash() the instant after term.feed() returns.
    await expect(page.locator('#bell-overlay')).toHaveClass(/flash/, { timeout: 500 });

    // After 100 ms, canvas.js removes the flash class (setTimeout in
    // triggerBellFlash).
    await page.waitForTimeout(200);
    await expect(page.locator('#bell-overlay')).not.toHaveClass(/flash/);
  });

  test('BEL-while-hidden sets (!) title prefix; visibility return clears it', async ({ page }) => {
    await page.goto('/');
    await expect(page).toHaveTitle('Beastty');

    // Simulate the tab being backgrounded. Playwright does not expose a
    // direct "hide page" API, so we shim document.hidden + dispatch the event.
    await page.evaluate(() => {
      Object.defineProperty(document, 'hidden', { configurable: true, get: () => true });
      Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'hidden' });
      document.dispatchEvent(new Event('visibilitychange'));
    });

    // Feed a BEL byte through Debug Feed. main.js sampleBell() runs
    // synchronously and prepends '(!) ' to document.title because
    // document.hidden === true.
    await page.locator('#debug').evaluate((el) => { el.open = true; });
    await page.fill('#input', '\\x07');
    await page.click('#feed');
    await page.waitForTimeout(100);

    await expect(page).toHaveTitle('(!) Beastty');

    // Un-hide; chrome.js visibilitychange listener strips the '(!) ' prefix.
    await page.evaluate(() => {
      Object.defineProperty(document, 'hidden', { configurable: true, get: () => false });
      Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'visible' });
      document.dispatchEvent(new Event('visibilitychange'));
    });
    await page.waitForTimeout(50);
    await expect(page).toHaveTitle('Beastty');
  });

  test('title prefix is not doubled when two BELs arrive while hidden', async ({ page }) => {
    await page.goto('/');

    await page.evaluate(() => {
      Object.defineProperty(document, 'hidden', { configurable: true, get: () => true });
      Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'hidden' });
      document.dispatchEvent(new Event('visibilitychange'));
    });

    await page.locator('#debug').evaluate((el) => { el.open = true; });
    await page.fill('#input', '\\x07');
    await page.click('#feed');
    await page.waitForTimeout(50);
    await page.click('#feed');
    await page.waitForTimeout(50);

    // sampleBell() guards against double-prefix via document.title.startsWith.
    await expect(page).toHaveTitle('(!) Beastty');
  });
});
