// Phase 4 Plan 04 — INPUT-02 — Arrow keys transmit ESC A/B/C/D.
import { test, expect } from '@playwright/test';

async function setup(page) {
    await page.goto('/');
    await page.locator('#terminal-wrapper').focus();
    await page.waitForFunction(() => document.getElementById('terminal').width > 0);
    await page.locator('#debug').evaluate((el) => { el.open = true; });
    await page.locator('#tx-reset').click();  // clears TX ring to known empty state
}

test.describe('INPUT-02 — Arrow keys transmit ESC A/B/C/D', () => {
    test('ArrowUp pushes 0x1B 0x41 @fast', async ({ page }) => {
        await setup(page);
        await page.keyboard.press('ArrowUp');
        await expect(page.locator('#tx-strip')).toHaveText('1B 41');
    });

    test('ArrowDown pushes 0x1B 0x42', async ({ page }) => {
        await setup(page);
        await page.keyboard.press('ArrowDown');
        await expect(page.locator('#tx-strip')).toHaveText('1B 42');
    });

    test('ArrowRight pushes 0x1B 0x43 (ESC C)', async ({ page }) => {
        await setup(page);
        await page.keyboard.press('ArrowRight');
        await expect(page.locator('#tx-strip')).toHaveText('1B 43');
    });

    test('ArrowLeft pushes 0x1B 0x44 (ESC D)', async ({ page }) => {
        await setup(page);
        await page.keyboard.press('ArrowLeft');
        await expect(page.locator('#tx-strip')).toHaveText('1B 44');
    });

    test('four arrows in sequence produce concatenated TX strip', async ({ page }) => {
        await setup(page);
        await page.keyboard.press('ArrowUp');
        await page.keyboard.press('ArrowDown');
        await page.keyboard.press('ArrowLeft');
        await page.keyboard.press('ArrowRight');
        await expect(page.locator('#tx-strip')).toHaveText('1B 41 1B 42 1B 44 1B 43');
    });
});
