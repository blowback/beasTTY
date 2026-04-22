// Phase 4 Plan 04 — INPUT-01 — Printable keys + shifted symbols map to ASCII bytes.
import { test, expect } from '@playwright/test';

async function setup(page) {
    await page.goto('/');
    await page.locator('#terminal-wrapper').focus();
    await page.waitForFunction(() => document.getElementById('terminal').width > 0);
    await page.locator('#debug').evaluate((el) => { el.open = true; });
    await page.locator('#tx-reset').click();
}

test.describe('INPUT-01 — Printable keys map to VT52 bytes', () => {
    test('Shift+KeyA → 0x41 (e.key path — uppercase) @fast', async ({ page }) => {
        await setup(page);
        await page.keyboard.press('Shift+KeyA');
        await expect(page.locator('#tx-strip')).toHaveText('41');
    });

    test('KeyA (no shift) → 0x61 (lowercase)', async ({ page }) => {
        await setup(page);
        await page.keyboard.press('KeyA');
        await expect(page.locator('#tx-strip')).toHaveText('61');
    });

    test('Shift+Digit1 → 0x21 (! — shifted-digit via e.key)', async ({ page }) => {
        await setup(page);
        await page.keyboard.press('Shift+Digit1');
        await expect(page.locator('#tx-strip')).toHaveText('21');
    });

    test('Tab → 0x09; Backspace → 0x08; Escape → 0x1B', async ({ page }) => {
        await setup(page);
        await page.keyboard.press('Tab');
        await expect(page.locator('#tx-strip')).toHaveText('09');
        await page.locator('#tx-reset').click();

        await page.keyboard.press('Backspace');
        await expect(page.locator('#tx-strip')).toHaveText('08');
        await page.locator('#tx-reset').click();

        await page.keyboard.press('Escape');
        await expect(page.locator('#tx-strip')).toHaveText('1B');
    });
});
