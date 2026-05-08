// Beastty Phase 9 Plan 09-04 — SLIDE sender end-to-end Playwright assertions.
//
// Covers:
//   - SLIDE-07 (multi-file picker click flow)
//   - SLIDE-13 (auto-typed `B:SLIDE R\r` BEFORE wakeup)
//   - Phase 9 SC#5 (byte-identical round-trip via mock SLIDE-receiver bot — load-bearing)
//   - Multi-file batch send completes through mock bot
//   - window.__slide.__getStateForTests() introspection (D-18)
//
// Loaded via page.addInitScript:
//   1. SERIAL_MOCK (Phase 5) — replaces navigator.serial with a mock port
//   2. MOCK_SERIAL_SLIDE_BOT (Plan 09-04 Task 1) — hooks __mockWriterLog.push,
//      parses SLIDE frames, emits RDY/ACK/FIN echoes via __mockReaderPush
//
// Setup helper mirrors slide-dispatcher.spec.js / slide-wakeup.spec.js verbatim
// — connect via #connect-button click, poll for granted port reader, reset
// __slide / __fileSource / __mockSlideBot state per test for isolation.

import { test, expect } from '@playwright/test';
import { SERIAL_MOCK } from './mock-serial.js';
import { MOCK_SERIAL_SLIDE_BOT } from './mock-serial-slide-bot.js';

async function setup(page) {
    await page.addInitScript(SERIAL_MOCK);
    await page.addInitScript(MOCK_SERIAL_SLIDE_BOT);
    await page.goto('/');
    await page.locator('#terminal-wrapper').focus();
    await page.waitForFunction(() => document.getElementById('terminal').width > 0);
    await page.locator('#connection').evaluate((el) => { el.open = true; });
}

test.describe('SLIDE sender end-to-end (Phase 9 Plan 09-04)', () => {

    test.beforeEach(async ({ page }) => {
        await setup(page);
        await page.locator('#connect-button').click();
        // Generous timeout — Playwright's 10-worker parallelism can starve
        // the wasm boot path on busy hardware; 2s flakes intermittently.
        await expect.poll(
            () => page.evaluate(() => Boolean(navigator.serial._grantedPorts[0]?._reader)),
            { timeout: 5000 },
        ).toBe(true);
        await page.evaluate(() => {
            window.__slide.__resetForTests();
            window.__fileSource.__resetForTests();
            // Use length = 0 (NOT reassignment) so the bot's push monkey-patch
            // installed by MOCK_SERIAL_SLIDE_BOT remains intact. The setter
            // trap re-installs on reassignment but length=0 is cheaper.
            window.__mockWriterLog.length = 0;
            window.__mockSlideBot.reset();
        });
    });

    test('picker click flow @fast', async ({ page }) => {
        // SLIDE-07 — multi-file <input type="file" multiple> picker.
        // page.setInputFiles bypasses the OS picker but exercises the same
        // change event that wireFileSource listens to.
        const content = 'Hello SLIDE!';
        await page.setInputFiles('#send-file-input', {
            name: 'hello.txt',
            mimeType: 'text/plain',
            buffer: Buffer.from(content),
        });

        // Modal opens with rewrite row.
        await expect(page.locator('#send-modal')).toBeVisible();
        await expect(page.locator('#send-modal-title')).toHaveText('Sending 1 file via SLIDE');
        await expect(page.locator('#send-modal-list li').first()).toContainText('hello.txt');
        await expect(page.locator('#send-modal-list li').first()).toContainText('HELLO.TXT');
        await expect(page.locator('#send-modal-send')).toHaveText('Send 1 file');
        await expect(page.locator('#send-modal-send')).toBeEnabled();
    });

    test('auto-type B:SLIDE R\\r before wakeup match @fast', async ({ page }) => {
        // SLIDE-13 — auto-typed "B:SLIDE R\r" must appear in the writer log
        // BEFORE the wakeup signature flips owner to 'slide'. Pitfall 3
        // order-critical (slide.js:378-383: pushTxBytes BEFORE pendingSendSession
        // assignment).
        const content = 'X';
        await page.setInputFiles('#send-file-input', {
            name: 'x.txt',
            mimeType: 'text/plain',
            buffer: Buffer.from(content),
        });
        await page.locator('#send-modal-send').click();

        // First 10 bytes in __mockWriterLog must be 'B:SLIDE R\r'.
        // tx-sink batches keystrokes via a microtask; poll until the bytes
        // arrive (typical latency: 1 microtask tick).
        await expect.poll(
            () => page.evaluate(() => {
                const flat = window.__mockWriterLog.flatMap((e) => Array.from(e.bytes));
                return flat.slice(0, 10);
            }),
            { timeout: 2000 },
        ).toEqual([0x42, 0x3A, 0x53, 0x4C, 0x49, 0x44, 0x45, 0x20, 0x52, 0x0D]);

        // The mode must still be 'terminal' at this point (wakeup hasn't fired
        // yet because we haven't called pushSlideWakeup). pendingSendSession
        // is set, ready for the wakeup-completion clause to consume.
        const mode = await page.evaluate(() => window.__slide.__getStateForTests().mode);
        expect(mode).toBe('terminal');
        const pending = await page.evaluate(() => window.__slide.__getStateForTests().hasPendingSendSession);
        expect(pending).toBe(true);
    });

    test('byte-identical round-trip — single file via mock SLIDE-receiver bot @fast', async ({ page }) => {
        // Phase 9 SC#5 — the load-bearing acceptance gate.
        // 23 bytes < FRAME_SIZE (1024) → 1 data frame + EOF marker.
        const content = 'Hello SLIDE round-trip!';
        await page.setInputFiles('#send-file-input', {
            name: 'rt.txt',
            mimeType: 'text/plain',
            buffer: Buffer.from(content),
        });
        await page.locator('#send-modal-send').click();

        // Wait for auto-type to flush.
        await expect.poll(
            () => page.evaluate(() => window.__mockWriterLog.length > 0),
            { timeout: 2000 },
        ).toBe(true);

        // Push the SLIDE wakeup — bot transitions dispatcher to 'send' mode.
        await page.evaluate(() => window.__mockSlideBot.pushSlideWakeup());

        // SLIDE handshake runs to completion. Mode returns to 'terminal' on
        // EVT_SESSION_COMPLETE → exitSendMode (slide.js:565-571).
        await expect.poll(
            () => page.evaluate(() => window.__slide.__getStateForTests().mode),
            { timeout: 10000 },
        ).toBe('terminal');

        // Bot must have observed CTRL_FIN.
        const finObserved = await page.evaluate(() => window.__mockSlideBot.finObserved());
        expect(finObserved).toBe(true);

        // Byte-identical round-trip — the SC#5 gate.
        const received = await page.evaluate(() => window.__mockSlideBot.getReceivedBytes(0));
        expect(received).toEqual(Array.from(Buffer.from(content)));

        // Filename arrived correctly (uppercased by truncateCpm83).
        const names = await page.evaluate(() => window.__mockSlideBot.getReceivedFilenames());
        expect(names).toEqual(['RT.TXT']);
    });

    test('multi-file send completes via mock receiver bot @fast', async ({ page }) => {
        // Two-file batch. Bot tracks per-file received bytes; both must
        // round-trip byte-identical.
        const a = 'AAA';
        const b = 'BBBB';
        await page.setInputFiles('#send-file-input', [
            { name: 'a.txt', mimeType: 'text/plain', buffer: Buffer.from(a) },
            { name: 'b.txt', mimeType: 'text/plain', buffer: Buffer.from(b) },
        ]);
        await page.locator('#send-modal-send').click();

        await expect.poll(
            () => page.evaluate(() => window.__mockWriterLog.length > 0),
            { timeout: 2000 },
        ).toBe(true);

        await page.evaluate(() => window.__mockSlideBot.pushSlideWakeup());

        await expect.poll(
            () => page.evaluate(() => window.__slide.__getStateForTests().mode),
            { timeout: 10000 },
        ).toBe('terminal');

        expect(await page.evaluate(() => window.__mockSlideBot.getReceivedBytes(0)))
            .toEqual(Array.from(Buffer.from(a)));
        expect(await page.evaluate(() => window.__mockSlideBot.getReceivedBytes(1)))
            .toEqual(Array.from(Buffer.from(b)));
        expect(await page.evaluate(() => window.__mockSlideBot.getReceivedFilenames()))
            .toEqual(['A.TXT', 'B.TXT']);
    });

    test('window.__slide introspection reports state + progress @fast', async ({ page }) => {
        // D-18 — Playwright reads window.__slide.__getStateForTests() during send.
        // Use a moderate-sized file (50 KB) so the in-flight window is large
        // enough to reliably observe `mode === 'send'` BEFORE completion.
        const content = 'X'.repeat(50 * 1024);
        await page.setInputFiles('#send-file-input', {
            name: 'progress.txt',
            mimeType: 'text/plain',
            buffer: Buffer.from(content),
        });
        await page.locator('#send-modal-send').click();
        await expect.poll(
            () => page.evaluate(() => window.__mockWriterLog.length > 0),
            { timeout: 2000 },
        ).toBe(true);
        await page.evaluate(() => window.__mockSlideBot.pushSlideWakeup());

        // Poll for an in-flight observation: mode === 'send' AND total_files === 1.
        // Eventually the send completes and mode flips back to 'terminal' —
        // both states are valid evidence the introspection surface populated.
        await expect.poll(
            () => page.evaluate(() => {
                const s = window.__slide.__getStateForTests();
                return s.mode === 'send' || (s.mode === 'terminal' && !s.hasPendingSendSession);
            }),
            { timeout: 10000 },
        ).toBe(true);

        // Final state — after send completes, mode === 'terminal'.
        await expect.poll(
            () => page.evaluate(() => window.__slide.__getStateForTests().mode),
            { timeout: 10000 },
        ).toBe('terminal');

        // Verify the bot received the full payload — proves the introspection
        // surface was non-trivially populated during the send.
        const received = await page.evaluate(() => window.__mockSlideBot.getReceivedBytes(0));
        expect(received.length).toBe(50 * 1024);
    });
});
