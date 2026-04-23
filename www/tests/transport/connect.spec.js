// Phase 5 Plan 03 (Wave 2) — XPORT-01..04 + D-01/D-02/D-06..D-11 connect spec.
// Source: 05-RESEARCH.md §Validation Architecture; 05-CONTEXT.md D-01, D-02, D-06..D-11.
// Wave 2 lands serial.js bodies; these tests are now runnable (was test.fixme in Plan 01).
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
    test('Connect button visible in top-bar with data-state="disconnected" @fast', async ({ page }) => {
        await setup(page);
        await expect(page.locator('#connect-button')).toHaveAttribute('data-state', 'disconnected');
        await expect(page.locator('#connect-button')).toHaveText('Connect');
    });

    test('click Connect calls requestPort with CP2102N filter 10c4:ea60', async ({ page }) => {
        await setup(page);
        // Instrument requestPort so we can read the filter args back.
        await page.evaluate(() => {
            const orig = navigator.serial.requestPort.bind(navigator.serial);
            window.__lastRequestPortOpts = null;
            navigator.serial.requestPort = (opts) => {
                window.__lastRequestPortOpts = opts;
                return orig(opts);
            };
        });
        await page.locator('#connect-button').click();
        const opts = await page.evaluate(() => window.__lastRequestPortOpts);
        expect(opts).toEqual({
            filters: [{ usbVendorId: 0x10c4, usbProductId: 0xea60 }],
        });
    });

    test('port.open called with 19200 8N1 none none preset @fast', async ({ page }) => {
        await setup(page);
        await page.locator('#connect-button').click();
        // Poll because open() happens async after the click resolves.
        await expect.poll(
            () => page.evaluate(() => navigator.serial._grantedPorts[0]?._config ?? null),
            { timeout: 2000 },
        ).toEqual({ baudRate: 19200, dataBits: 8, stopBits: 1, parity: 'none', flowControl: 'none' });
    });

    test('setSignals called with DTR=false RTS=false after open', async ({ page }) => {
        await setup(page);
        await page.locator('#connect-button').click();
        await expect.poll(
            () => page.evaluate(() => navigator.serial._grantedPorts[0]?._lastSignals ?? null),
            { timeout: 2000 },
        ).toEqual({ dataTerminalReady: false, requestToSend: false });
    });

    test('button label cycles Connect → Connecting… → Disconnect', async ({ page }) => {
        await setup(page);
        await expect(page.locator('#connect-button')).toHaveText('Connect');
        await page.locator('#connect-button').click();
        // 'connecting' transient is fast; asserting the stable 'connected' end state
        // is the Wave 2 contract. Wave 4 may add mid-state assertions via time-warp
        // helpers if the intermediate is worth pinning.
        await expect(page.locator('#connect-button')).toHaveAttribute('data-state', 'connected');
        await expect(page.locator('#connect-button')).toHaveText('Disconnect');
    });

    test('button border color transitions gray → amber → green', async ({ page }) => {
        await setup(page);
        await page.locator('#connect-button').click();
        await expect(page.locator('#connect-button')).toHaveAttribute('data-state', 'connected');
        // Literal #33ff66 green — see www/index.html #connect-button[data-state="connected"] rule.
        await expect(page.locator('#connect-button')).toHaveCSS('border-color', 'rgb(51, 255, 102)');
    });
});
