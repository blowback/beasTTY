// Phase 5 Plan 01 (Wave 0) — XPORT-11 + SC-5 + D-35/D-38/D-39 stub spec.
// Source: 05-RESEARCH.md §Validation Architecture; 05-CONTEXT.md D-35, D-38, D-39.
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

test.describe('XPORT-11 + SC-5 + D-35/D-38/D-39 — Read loop', () => {
    test.fixme('pushed bytes feed into term.feed and render on grid @fast', async ({ page }) => {
        await setup(page);
        await page.locator('#connect-button').click();
        await page.evaluate(() => window.__mockReaderPush([0x48, 0x49])); // "HI"
        expect(true).toBe(true);
    });

    test.fixme('reader.read called with no size hint', async ({ page }) => {
        await setup(page);
        expect(true).toBe(true);
    });

    test.fixme('visibilitychange !hidden triggers requestFrame catch-up', async ({ page }) => {
        await setup(page);
        expect(true).toBe(true);
    });

    test.fixme('read error transitions state to port-lost', async ({ page }) => {
        await setup(page);
        expect(true).toBe(true);
    });
});
