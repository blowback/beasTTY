// BestialiTTY Phase 6 Plan 06 (Wave 5) — PLAT-05/D-34 auto-connect-on-load.
//
// Wave 5 lands the auto-connect path inside wireSerial (gated on Pitfall 3
// race condition). All five stubs un-fixmed by Plan 06-06 Task 3.
//
// Sources:
//   - 06-CONTEXT.md D-34 (auto-connect-on-load — off by default; opt-in silent open).
//   - 06-RESEARCH.md Pitfall 3 (race against user click — state must be 'disconnected'
//                                at moment of invocation).
//   - 06-VALIDATION.md §Phase Requirements → Test Map (auto-connect row).
//   - Analog: www/tests/transport/connect.spec.js + www/tests/transport/reconnect.spec.js.
import { test, expect } from '@playwright/test';
import { SERIAL_MOCK } from '../transport/mock-serial.js';

const PREFS_AUTOCONNECT_ON = JSON.stringify({
    version: 1,
    theme: 'crt', phosphor: 'green', fontZoom: 1,
    serial: { baud: 19200, dataBits: 8, stopBits: 1, parity: 'none', flowControl: 'none' },
    localEcho: false, crlfMode: 'cr', autoConnect: true,
});
const PREFS_AUTOCONNECT_OFF = JSON.stringify({
    version: 1,
    theme: 'crt', phosphor: 'green', fontZoom: 1,
    serial: { baud: 19200, dataBits: 8, stopBits: 1, parity: 'none', flowControl: 'none' },
    localEcho: false, crlfMode: 'cr', autoConnect: false,
});
const PORT_PRESET = JSON.stringify({ usbVendorId: 0x10c4, usbProductId: 0xea60 });

// Order matters: hook flags MUST run BEFORE SERIAL_MOCK so the mock IIFE sees
// them when it inspects window.__preGrantPort / window.__forceOpenReject.
async function setupWithMock(page, { prefs, portPreset, preGrantPort, forceOpenReject } = {}) {
    if (preGrantPort || forceOpenReject !== undefined) {
        await page.addInitScript((opts) => {
            if (opts.preGrantPort) window.__preGrantPort = true;
            if (typeof opts.forceOpenReject === 'string') window.__forceOpenReject = opts.forceOpenReject;
        }, { preGrantPort, forceOpenReject });
    }
    if (prefs || portPreset) {
        await page.addInitScript((opts) => {
            if (opts.prefs) localStorage.setItem('bestialitty.prefs', opts.prefs);
            if (opts.portPreset) localStorage.setItem('bestialitty.port.preset', opts.portPreset);
        }, { prefs, portPreset });
    }
    await page.addInitScript(SERIAL_MOCK);
    await page.goto('/');
    await page.locator('#terminal-wrapper').focus();
    await page.waitForFunction(() => document.getElementById('terminal').width > 0);
}

test.describe('PLAT-05/D-34 — Auto-connect on load', () => {
    test('prefs.autoConnect=false → no silent open at boot @fast', async ({ page }) => {
        await setupWithMock(page, {
            prefs: PREFS_AUTOCONNECT_OFF,
            portPreset: PORT_PRESET,
            preGrantPort: true,
        });
        // Connect button must remain in the disconnected state — no silent open
        // is allowed when prefs.autoConnect=false (D-36 default).
        await expect(page.locator('#connect-button')).toHaveAttribute('data-state', 'disconnected');
    });

    test('prefs.autoConnect=true + getPorts() match → silent connectMicroBeast() at boot', async ({ page }) => {
        await setupWithMock(page, {
            prefs: PREFS_AUTOCONNECT_ON,
            portPreset: PORT_PRESET,
            preGrantPort: true,
        });
        // Auto-connect should drive the connect button to data-state="connected"
        // without a click. Use the existing #connect-button[data-state] state
        // machine signal as the reliable, race-free assertion.
        await page.waitForSelector('#connect-button[data-state="connected"]', { timeout: 5000 });
    });

    test('prefs.autoConnect=true + getPorts() empty → log "auto-connect-failed", remain disconnected', async ({ page }) => {
        // No portPreset, no preGrantPort: getPorts() returns empty so lastPortRef
        // stays null and the auto-connect path takes the "no granted port" branch.
        await setupWithMock(page, { prefs: PREFS_AUTOCONNECT_ON });
        await expect(page.locator('#connect-button')).toHaveAttribute('data-state', 'disconnected');
        // appendErrorLog auto-expands the Connection pane (D-27); the error
        // text must include the auto-connect-failed code.
        await expect(page.locator('#error-log')).toContainText('auto-connect-failed');
    });

    test('prefs.autoConnect=true + open() rejects → log "auto-connect-failed: {err.message}"', async ({ page }) => {
        await setupWithMock(page, {
            prefs: PREFS_AUTOCONNECT_ON,
            portPreset: PORT_PRESET,
            preGrantPort: true,
            forceOpenReject: 'simulated open failure',
        });
        await expect(page.locator('#connect-button')).toHaveAttribute('data-state', 'disconnected');
        await expect(page.locator('#error-log')).toContainText('simulated open failure');
    });

    test('auto-connect race: state must be "disconnected" at moment of invocation (Pitfall 3)', async ({ page }) => {
        await setupWithMock(page, {
            prefs: PREFS_AUTOCONNECT_ON,
            portPreset: PORT_PRESET,
            preGrantPort: true,
        });
        // Auto-connect path runs synchronously inside wireSerial — by the time
        // the page is interactive, the state machine has either landed on
        // 'connected' (auto-connect path won the race) or remained at
        // 'disconnected' for some reason. Either way, the open() call site
        // must NOT have fired twice (the `state === 'disconnected'` race gate
        // is what prevents the second open).
        await page.waitForSelector('#connect-button[data-state="connected"]', { timeout: 5000 });
        const openedTimes = await page.evaluate(() => window.__mockOpenCount || 0);
        // <= 1 covers both the auto-connect-only path and the user-click-only
        // path; > 1 would mean the race gate failed and we double-opened.
        expect(openedTimes).toBeLessThanOrEqual(1);
    });
});
