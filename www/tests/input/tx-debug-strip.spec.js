// Phase 4 Plan 04 — SC-1 — TX hex strip placeholder + live update + Reset TX.
import { test, expect } from '@playwright/test';

const PLACEHOLDER = '(none yet — press any key on the terminal to see TX bytes)';

test.describe('SC-1 — TX hex strip', () => {
    test('placeholder shows before any keypress', async ({ page }) => {
        await page.goto('/');
        await page.locator('#debug').evaluate((el) => { el.open = true; });
        await expect(page.locator('#tx-strip')).toHaveText(PLACEHOLDER);
    });

    test('arrow press updates strip; Reset TX restores placeholder @fast', async ({ page }) => {
        await page.goto('/');
        await page.locator('#terminal-wrapper').focus();
        await page.waitForFunction(() => document.getElementById('terminal').width > 0);
        await page.locator('#debug').evaluate((el) => { el.open = true; });

        await page.keyboard.press('ArrowUp');
        await expect(page.locator('#tx-strip')).toHaveText('1B 41');

        await page.locator('#tx-reset').click();
        await expect(page.locator('#tx-strip')).toHaveText(PLACEHOLDER);
    });

    test('last 64 bytes: after many presses, strip shows most-recent slice', async ({ page }) => {
        await page.goto('/');
        await page.locator('#terminal-wrapper').focus();
        await page.waitForFunction(() => document.getElementById('terminal').width > 0);
        await page.locator('#debug').evaluate((el) => { el.open = true; });
        await page.locator('#tx-reset').click();

        // 40 arrow presses → 80 bytes. Strip displays last 64 bytes.
        for (let i = 0; i < 40; i++) {
            await page.keyboard.press('ArrowUp');
        }
        const strip = await page.locator('#tx-strip').textContent();
        // Newest-right: strip must END with "1B 41" and contain at most 64 bytes
        // (64 bytes × 3 chars per space-separated pair = 191 chars — 64 pairs × 2 + 63 spaces).
        expect(strip.endsWith('1B 41')).toBe(true);
        const pairs = strip.split(' ');
        expect(pairs.length).toBeLessThanOrEqual(64);
    });
});
