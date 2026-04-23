// Phase 5 Plan 01 (Wave 0) — XPORT-06..08, XPORT-10 + SC-3 + D-03..D-05/D-24..D-26/D-30..D-31/D-36/D-37/D-42 stub spec.
// Source: 05-RESEARCH.md §Validation Architecture; 05-CONTEXT.md D-03..D-05, D-24..D-26, D-30, D-31, D-36, D-37, D-42.
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

test.describe('XPORT-06..08, XPORT-10 + SC-3 + D-03..D-05/D-24..D-26/D-30..D-31/D-36/D-37/D-42 — Reconnect', () => {
    test.fixme('reader.cancel called before port.close on Disconnect click @fast', async ({ page }) => {
        await setup(page);
        await page.locator('#connect-button').click();
        await page.locator('#connect-button').click(); // disconnect
        expect(true).toBe(true);
    });

    test.fixme('simulateUnplug transitions state to port-lost', async ({ page }) => {
        await setup(page);
        await page.locator('#connect-button').click();
        await page.evaluate(() => window.__simulateUnplug());
        await expect(page.locator('#connect-button')).toHaveAttribute('data-state', 'port-lost');
    });

    test.fixme('simulateReplug with matching VID/PID auto-reconnects silently', async ({ page }) => {
        await setup(page);
        await page.locator('#connect-button').click();
        await page.evaluate(() => window.__simulateUnplug());
        await page.evaluate(() => window.__simulateReplug());
        await expect(page.locator('#connect-button')).toHaveAttribute('data-state', 'connected');
    });

    test.fixme('auto-reconnect retries once after 500ms on transient open fail', async ({ page }) => {
        await setup(page);
        expect(true).toBe(true);
    });

    test.fixme('reload with granted port stashes reference but does NOT auto-open', async ({ page }) => {
        await setup(page);
        expect(true).toBe(true);
    });

    test.fixme('connect/disconnect listeners registered on navigator.serial not port', async ({ page }) => {
        await setup(page);
        expect(true).toBe(true);
    });

    test.fixme('localStorage bestialitty.port.preset written after first open', async ({ page }) => {
        await setup(page);
        await page.locator('#connect-button').click();
        const preset = await page.evaluate(() => localStorage.getItem('bestialitty.port.preset'));
        expect(preset).toBeTruthy();
    });
});
