// Phase 5 Plan 01 (Wave 0) — XPORT-05 + D-08 stub spec.
// Source: 05-RESEARCH.md §Validation Architecture; 05-CONTEXT.md D-08; 05-UI-SPEC.md §Copywriting Contract.
// Stubs are test.fixme until later waves land production code.
import { test, expect } from '@playwright/test';
import { SERIAL_MOCK } from './mock-serial.js';

async function setup(page) {
    await page.addInitScript(SERIAL_MOCK);
    await page.goto('/');
    await page.locator('#terminal-wrapper').focus();
    await page.waitForFunction(() => document.getElementById('terminal').width > 0);
    await page.locator('#connection').evaluate((el) => { el.open = true; });
}

test.describe('XPORT-05 + D-08 — Serial config form', () => {
    test.fixme('baud select defaults to 19200 @fast', async ({ page }) => {
        await setup(page);
        await expect(page.locator('#serial-baud')).toHaveValue('19200');
    });

    test.fixme('databits/stopbits/parity/flowctl defaults match MicroBeast preset @fast', async ({ page }) => {
        await setup(page);
        await expect(page.locator('#serial-databits')).toHaveValue('8');
        await expect(page.locator('#serial-stopbits')).toHaveValue('1');
        await expect(page.locator('#serial-parity')).toHaveValue('none');
        await expect(page.locator('#serial-flowctl')).toHaveValue('none');
    });

    test.fixme('Reset to MicroBeast preset button snaps all five selects to defaults', async ({ page }) => {
        await setup(page);
        await page.locator('#serial-baud').selectOption('9600');
        await page.locator('#serial-reset-preset').click();
        await expect(page.locator('#serial-baud')).toHaveValue('19200');
    });

    test.fixme('changing baud while connected shows Config changed hint', async ({ page }) => {
        await setup(page);
        expect(true).toBe(true);
    });

    test.fixme('connect honors non-default config values', async ({ page }) => {
        await setup(page);
        await page.locator('#serial-baud').selectOption('9600');
        await page.locator('#connect-button').click();
        const cfg = await page.evaluate(() => navigator.serial._grantedPorts[0]._config);
        expect(cfg.baudRate).toBe(9600);
    });
});
