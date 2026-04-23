// Phase 5 Plan 01 (Wave 0) — XPORT-09 + D-12..D-23/D-41 stub spec.
// Source: 05-RESEARCH.md §Validation Architecture; 05-CONTEXT.md D-12..D-23, D-41.
// Stubs are test.fixme until later waves land production code.
import { test, expect } from '@playwright/test';
import { SERIAL_MOCK } from './mock-serial.js';

async function setup(page) {
    await page.addInitScript(SERIAL_MOCK);
    await page.goto('/');
    await page.locator('#terminal-wrapper').focus();
    await page.waitForFunction(() => document.getElementById('terminal').width > 0);
    await page.locator('#connection').evaluate((el) => { el.open = true; });
    await page.locator('#debug').evaluate((el) => { el.open = true; });
}

test.describe('XPORT-09 + D-12..D-23/D-41 — Paste pump', () => {
    test.fixme('Paste test button routes textarea through paste-pump @fast', async ({ page }) => {
        await setup(page);
        await page.locator('#connect-button').click();
        await page.fill('#input', 'hello');
        await page.locator('#paste-test').click();
        expect(true).toBe(true);
    });

    test.fixme('paste at 19200 baud paces >= 95% of expected duration @slow', async ({ page }) => {
        await setup(page);
        expect(true).toBe(true);
    });

    test.fixme('progress line Pasting N B — P% updates per chunk', async ({ page }) => {
        await setup(page);
        expect(true).toBe(true);
    });

    test.fixme('Cancel button halts pump and shows "Paste cancelled"', async ({ page }) => {
        await setup(page);
        expect(true).toBe(true);
    });

    test.fixme('Esc while paste active cancels and does NOT emit 0x1B', async ({ page }) => {
        await setup(page);
        expect(true).toBe(true);
    });

    test.fixme('keypresses interleaved during paste queue-jump between chunks', async ({ page }) => {
        await setup(page);
        expect(true).toBe(true);
    });

    test.fixme('port-lost mid-paste shows "Paste cancelled — port lost (N bytes unsent)"', async ({ page }) => {
        await setup(page);
        expect(true).toBe(true);
    });

    test.fixme('CR/LF mode crlf rewrites 0x0D to 0x0D 0x0A before enqueue', async ({ page }) => {
        await setup(page);
        expect(true).toBe(true);
    });
});
