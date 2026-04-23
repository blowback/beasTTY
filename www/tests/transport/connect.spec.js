// Phase 5 Plan 01 (Wave 0) — XPORT-01..04 + D-01/D-02/D-06..D-11 stub spec.
// Source: 05-RESEARCH.md §Validation Architecture; 05-CONTEXT.md D-01, D-02, D-06..D-11.
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

test.describe('XPORT-01..04 + D-01/D-02/D-06..D-11 — Connect to MicroBeast', () => {
    test.fixme('Connect button visible in top-bar with data-state="disconnected" @fast', async ({ page }) => {
        await setup(page);
        await expect(page.locator('#connect-button')).toHaveAttribute('data-state', 'disconnected');
    });

    test.fixme('click Connect calls requestPort with CP2102N filter 10c4:ea60', async ({ page }) => {
        await setup(page);
        await page.locator('#connect-button').click();
        const info = await page.evaluate(() => navigator.serial._grantedPorts[0].getInfo());
        expect(info).toEqual({ usbVendorId: 0x10c4, usbProductId: 0xea60 });
    });

    test.fixme('port.open called with 19200 8N1 none none preset @fast', async ({ page }) => {
        await setup(page);
        await page.locator('#connect-button').click();
        const cfg = await page.evaluate(() => navigator.serial._grantedPorts[0]._config);
        expect(cfg).toEqual({ baudRate: 19200, dataBits: 8, stopBits: 1, parity: 'none', flowControl: 'none' });
    });

    test.fixme('setSignals called with DTR=false RTS=false after open', async ({ page }) => {
        await setup(page);
        await page.locator('#connect-button').click();
        const sigs = await page.evaluate(() => navigator.serial._grantedPorts[0]._lastSignals);
        expect(sigs).toEqual({ dataTerminalReady: false, requestToSend: false });
    });

    test.fixme('button label cycles Connect → Connecting… → Disconnect', async ({ page }) => {
        await setup(page);
        await expect(page.locator('#connect-button')).toHaveText('Connect');
        await page.locator('#connect-button').click();
        await expect(page.locator('#connect-button')).toHaveText('Disconnect');
    });

    test.fixme('button border color transitions gray → amber → green', async ({ page }) => {
        await setup(page);
        await page.locator('#connect-button').click();
        await expect(page.locator('#connect-button')).toHaveAttribute('data-state', 'connected');
    });
});
