// Phase 5 Plan 03 (Wave 2) — XPORT-11 + SC-5 + D-35/D-38/D-39 read-loop spec.
// Source: 05-RESEARCH.md §Validation Architecture; 05-CONTEXT.md D-35, D-38, D-39.
// Wave 2 lands pure-async read loop; Wave 4 hardens visibilitychange + read-error paths.
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
    test('pushed bytes feed into term.feed and render on grid @fast', async ({ page }) => {
        await setup(page);
        await page.locator('#connect-button').click();
        // Wait for the connect path + read loop to start (reader created).
        await expect.poll(
            () => page.evaluate(() => Boolean(navigator.serial._grantedPorts[0]?._reader)),
            { timeout: 2000 },
        ).toBe(true);
        // Push 'HELLO' through the mock reader.
        await page.evaluate(() => window.__mockReaderPush([0x48, 0x45, 0x4C, 0x4C, 0x4F]));
        // Read back from the grid — term.feed should have rendered 'HELLO' at row 0.
        await expect.poll(
            () => page.evaluate(() => {
                const g = window.__testGridView();
                // grid is row-major 80x24 x 8 bytes/cell — byte 0 of each cell is ch.
                return String.fromCharCode(g[0], g[8], g[16], g[24], g[32]);
            }),
            { timeout: 2000 },
        ).toBe('HELLO');
    });

    test('reader.read called with no size hint', async ({ page }) => {
        await setup(page);
        // Instrument MockReader.read BEFORE clicking Connect so the very first
        // read() call is recorded. D-38: no BYOB buffer tuning in v1.
        await page.evaluate(() => {
            // The reader is not created until open() runs, so we instrument
            // MockSerialPort.open to wrap the reader's read() right after it exists.
            const origOpen = navigator.serial.constructor.prototype; // noop
            // Instead, wrap MockReader.read by monkey-patching the first granted port on the next tick.
            window.__readArgs = [];
            const poll = setInterval(() => {
                const p = navigator.serial._grantedPorts[0];
                if (p && p._reader && !p._reader.__wrapped) {
                    const origRead = p._reader.read.bind(p._reader);
                    p._reader.read = (...args) => {
                        window.__readArgs.push(args.length);
                        return origRead(...args);
                    };
                    p._reader.__wrapped = true;
                    clearInterval(poll);
                }
            }, 10);
            // Safety clear after 3s even if we never see a reader.
            setTimeout(() => clearInterval(poll), 3000);
        });
        await page.locator('#connect-button').click();
        // Push a byte so the pending read() resolves and the loop issues another read().
        await expect.poll(
            () => page.evaluate(() => Boolean(navigator.serial._grantedPorts[0]?._reader?.__wrapped)),
            { timeout: 2000 },
        ).toBe(true);
        await page.evaluate(() => window.__mockReaderPush([0x41]));
        // Wait for at least one wrapped read() to be logged.
        await expect.poll(
            () => page.evaluate(() => window.__readArgs.length),
            { timeout: 2000 },
        ).toBeGreaterThanOrEqual(1);
        const argCounts = await page.evaluate(() => window.__readArgs);
        // D-38 — every read() call in the loop has zero arguments (no size hint).
        for (const n of argCounts) expect(n).toBe(0);
    });

    test('visibilitychange !hidden triggers requestFrame catch-up', async ({ page }) => {
        await setup(page);
        await page.locator('#connect-button').click();
        await expect(page.locator('#connect-button')).toHaveAttribute('data-state', 'connected');
        // Simulate hidden → push bytes (they feed into term asynchronously) → visible.
        // The catch-up requestFrame should then wake the renderer; we verify via
        // the grid view that 'HI' is present at the first two cells.
        await page.evaluate(() => {
            Object.defineProperty(document, 'hidden', { configurable: true, get: () => true });
            Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'hidden' });
            document.dispatchEvent(new Event('visibilitychange'));
        });
        await page.evaluate(() => window.__mockReaderPush([0x48, 0x49]));   // 'HI'
        await page.waitForTimeout(100);
        await page.evaluate(() => {
            Object.defineProperty(document, 'hidden', { configurable: true, get: () => false });
            Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'visible' });
            document.dispatchEvent(new Event('visibilitychange'));
        });
        // After the visibilitychange, the catch-up requestFrame should have painted.
        await expect.poll(async () => {
            return await page.evaluate(() => {
                const g = window.__testGridView();
                return String.fromCharCode(g[0], g[8]);
            });
        }, { timeout: 2000 }).toBe('HI');
        // State still connected (visibilitychange did not disrupt transport).
        await expect(page.locator('#connect-button')).toHaveAttribute('data-state', 'connected');
    });

    test('read error transitions state to port-lost', async ({ page }) => {
        await setup(page);
        await page.locator('#connect-button').click();
        await expect(page.locator('#connect-button')).toHaveAttribute('data-state', 'connected');
        // Wait for reader to exist, then force the next read() to throw a
        // NetworkError (permission-revoke simulation — D-28).
        await expect.poll(
            () => page.evaluate(() => Boolean(navigator.serial._grantedPorts[0]?._reader)),
            { timeout: 2000 },
        ).toBe(true);
        await page.evaluate(() => {
            const p = navigator.serial._grantedPorts[0];
            const origRead = p._reader.read.bind(p._reader);
            let thrown = false;
            p._reader.read = async () => {
                if (!thrown) {
                    thrown = true;
                    const e = new Error('simulated network error');
                    e.name = 'NetworkError';
                    throw e;
                }
                return origRead();
            };
            // Kick the pending read by pushing a byte — the patched read() then
            // throws NetworkError which handleReadError treats as permission-revoked.
            window.__mockReaderPush([0x00]);
        });
        await expect(page.locator('#connect-button')).toHaveAttribute('data-state', 'port-lost', { timeout: 3000 });
        await expect(page.locator('#error-log')).toContainText('permission-revoked', { timeout: 2000 });
    });
});
