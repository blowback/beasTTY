// Phase 4 Plan 04 — INPUT-05 — CR/LF override alters Enter TX bytes.
import { test, expect } from '@playwright/test';

async function setup(page) {
    await page.goto('/');
    await page.locator('#terminal-wrapper').focus();
    await page.waitForFunction(() => document.getElementById('terminal').width > 0);
    await page.locator('#settings').evaluate((el) => { el.open = true; });
    await page.locator('#debug').evaluate((el) => { el.open = true; });
    await page.locator('#tx-reset').click();
}

test.describe('INPUT-05 — CR/LF override', () => {
    test('default CR mode: Enter sends 0x0D @fast', async ({ page }) => {
        await setup(page);
        // Confirm CR radio is default-checked.
        await expect(page.locator('#crlf-cr')).toBeChecked();
        // Return focus to the terminal (clicking Settings could steal focus on some paths).
        await page.locator('#terminal-wrapper').focus();
        await page.keyboard.press('Enter');
        await expect(page.locator('#tx-strip')).toHaveText('0D');
    });

    test('LF mode: Enter sends 0x0A', async ({ page }) => {
        await setup(page);
        await page.locator('#crlf-lf').check();
        await page.locator('#terminal-wrapper').focus();
        await page.keyboard.press('Enter');
        await expect(page.locator('#tx-strip')).toHaveText('0A');
    });

    test('CRLF mode: Enter sends 0x0D 0x0A', async ({ page }) => {
        await setup(page);
        await page.locator('#crlf-crlf').check();
        await page.locator('#terminal-wrapper').focus();
        await page.keyboard.press('Enter');
        await expect(page.locator('#tx-strip')).toHaveText('0D 0A');
    });

    test('radio exclusivity: checking one unchecks the others', async ({ page }) => {
        await setup(page);
        await page.locator('#crlf-lf').check();
        await expect(page.locator('#crlf-lf')).toBeChecked();
        await expect(page.locator('#crlf-cr')).not.toBeChecked();
        await expect(page.locator('#crlf-crlf')).not.toBeChecked();

        await page.locator('#crlf-crlf').check();
        await expect(page.locator('#crlf-crlf')).toBeChecked();
        await expect(page.locator('#crlf-lf')).not.toBeChecked();
    });
});
