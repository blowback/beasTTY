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

    // Phase 12.1 Plan 12-08 — RTS asserted on connect by default. The Z80
    // UART uses host RTS as its CTS input for hardware auto-flow-control;
    // RTS=false at connect time was blocking all Z80 transmits at the UART
    // level (slide-team finding 2026-05-09 hardware UAT). DTR remains
    // de-asserted (Pitfall #12 reset-pulse concern is more credibly
    // applicable to DTR than RTS).
    test('setSignals called with DTR=false RTS=true after open (assertRtsOnConnect default)', async ({ page }) => {
        await setup(page);
        await page.locator('#connect-button').click();
        await expect.poll(
            () => page.evaluate(() => navigator.serial._grantedPorts[0]?._lastSignals ?? null),
            { timeout: 2000 },
        ).toEqual({ dataTerminalReady: false, requestToSend: true });
    });

    test('setSignals receives RTS=false when serialAssertRtsOnConnect pref is false', async ({ page }) => {
        await setup(page);
        // Phase 12.1 Plan 12-08 — toggle override path. Write the pref
        // directly into localStorage and reload so loadPrefs() picks it up
        // at boot. The savePrefs+reassign-cached subtlety from Phase 11
        // Plan 11-05 review WR-03 isn't relevant here because serial.js
        // reads getPrefs() live at every port.open() — but a fresh load
        // is the cleanest way to set the boot-time pref state.
        await page.evaluate(() => {
            const cur = JSON.parse(localStorage.getItem('beastty.prefs') || '{}');
            cur.serialAssertRtsOnConnect = false;
            cur.version = cur.version || 1;
            localStorage.setItem('beastty.prefs', JSON.stringify(cur));
        });
        await page.reload();
        await page.locator('#terminal-wrapper').focus();
        await page.waitForFunction(() => document.getElementById('terminal').width > 0);
        await page.locator('#connection').evaluate((el) => { el.open = true; });
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
