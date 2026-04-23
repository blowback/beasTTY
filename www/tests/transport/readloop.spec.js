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

    test.fixme('visibilitychange !hidden triggers requestFrame catch-up', async ({ page }) => {
        await setup(page);
        expect(true).toBe(true);
    });

    test.fixme('read error transitions state to port-lost', async ({ page }) => {
        await setup(page);
        expect(true).toBe(true);
    });
});
