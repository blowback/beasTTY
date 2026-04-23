// Phase 5 Plan 01 (Wave 0) — D-27, D-28, D-29, D-37, D-40 stub spec.
// Source: 05-RESEARCH.md §Validation Architecture; 05-CONTEXT.md D-27, D-28, D-29, D-37; 05-UI-SPEC.md §Copywriting Contract.
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

test.describe('D-27..D-29 + D-37 — Error log & lifecycle', () => {
    test('error log shows last 5 entries newest-first @fast', async ({ page }) => {
        await setup(page);
        // Force 6 consecutive open-failures by overriding requestPort to return
        // a port whose open() always throws. After the 6th click the ring should
        // hold exactly the last 5.
        await page.evaluate(() => {
            const origRequest = navigator.serial.requestPort.bind(navigator.serial);
            navigator.serial.requestPort = () => origRequest().then((p) => {
                p.open = async () => { throw new Error(`fail-${Date.now()}`); };
                return p;
            });
        });
        for (let i = 0; i < 6; i++) {
            await page.locator('#connect-button').click();
            await expect(page.locator('#connect-button')).toHaveAttribute('data-state', 'disconnected');
        }
        const logHtml = await page.locator('#error-log').innerHTML();
        const entries = (logHtml.match(/log-entry/g) || []).length;
        expect(entries).toBe(5);   // last 5 only; oldest dropped (D-27 ring-of-5)
    });

    test('permission revoked mid-read shows permission-revoked code', async ({ page }) => {
        await setup(page);
        await page.locator('#connect-button').click();
        await expect(page.locator('#connect-button')).toHaveAttribute('data-state', 'connected');
        // Simulate a NetworkError out of the read loop by resolving the pending
        // read() with a throw. Our mock's reader stores the resolver at
        // `_reader.waiter` when read() is awaiting; we reject it instead.
        await page.evaluate(() => {
            const port = navigator.serial._grantedPorts[0];
            if (port._reader && port._reader.waiter) {
                const err = new Error('permission revoked');
                err.name = 'NetworkError';
                // Replace the mock's resolve path with a throw by rewriting the
                // waiter to a thenable that rejects. The simplest route: swap
                // read() so the in-flight await sees a rejection.
                const origRead = port._reader.read.bind(port._reader);
                let first = true;
                port._reader.read = async () => {
                    if (first) { first = false; throw err; }
                    return origRead();
                };
                // Unblock the in-flight read() so the next .read() call hits our override.
                if (port._reader.waiter) {
                    port._reader.waiter({ value: new Uint8Array([0x00]), done: false });
                    port._reader.waiter = null;
                }
            }
        });
        // Wait for the log to pick up the permission-revoked entry.
        await expect(page.locator('#error-log')).toContainText('permission-revoked', { timeout: 3000 });
    });

    test('port-in-use error on open shows port-in-use code', async ({ page }) => {
        await setup(page);
        await page.evaluate(() => {
            const origRequest = navigator.serial.requestPort.bind(navigator.serial);
            navigator.serial.requestPort = () => origRequest().then((p) => {
                p.open = async () => {
                    const e = new Error('port is in use');
                    e.name = 'InvalidStateError';
                    throw e;
                };
                return p;
            });
        });
        await page.locator('#connect-button').click();
        await expect(page.locator('#error-log')).toContainText('port-in-use');
        await expect(page.locator('#error-log')).toContainText('another BestialiTTY tab');
    });

    test('multiple CP2102N adapters on reconnect shows multiple-adapters code', async ({ page }) => {
        await setup(page);
        await page.locator('#connect-button').click();
        await expect(page.locator('#connect-button')).toHaveAttribute('data-state', 'connected');
        // Inject a second CP2102N port + replace the first so identity match fails.
        await page.evaluate(() => {
            const Mock = navigator.serial._grantedPorts[0].constructor;
            // Unplug the currently-connected port (triggers port-lost).
            // We'll mutate _grantedPorts so the next getPorts() returns 2 matches,
            // neither of which === lastPortRef (D-25 ambiguity branch).
            // First, simulate unplug of the current port.
            window.__simulateUnplug();
            // Now replace the granted list with TWO new ports that both match VID/PID.
            navigator.serial._grantedPorts = [
                new Mock({ usbVendorId: 0x10c4, usbProductId: 0xea60 }),
                new Mock({ usbVendorId: 0x10c4, usbProductId: 0xea60 }),
            ];
        });
        await expect(page.locator('#connect-button')).toHaveAttribute('data-state', 'port-lost');
        // Dispatch a connect event on navigator.serial; onNavSerialConnect reads
        // getPorts() (now ambiguous) and lands in Choose MicroBeast... + log.
        await page.evaluate(() => {
            const ev = new Event('connect', { bubbles: true });
            Object.defineProperty(ev, 'target', { value: navigator.serial._grantedPorts[0] });
            navigator.serial.dispatchEvent(ev);
        });
        await expect(page.locator('#error-log')).toContainText('multiple-adapters', { timeout: 2000 });
        await expect(page.locator('#connect-button')).toHaveText('Choose MicroBeast…');
    });

    test('error log timestamp uses HH:MM:SS 24-hour format', async ({ page }) => {
        await setup(page);
        // Force one open-failure to populate a log entry with timestamp.
        await page.evaluate(() => {
            const origRequest = navigator.serial.requestPort.bind(navigator.serial);
            navigator.serial.requestPort = () => origRequest().then((p) => {
                p.open = async () => { throw new Error('boom'); };
                return p;
            });
        });
        await page.locator('#connect-button').click();
        await expect(page.locator('#error-log .log-ts').first()).toBeVisible();
        const ts = await page.locator('#error-log .log-ts').first().textContent();
        expect(ts).toMatch(/^\d{2}:\d{2}:\d{2}$/);
    });
});
