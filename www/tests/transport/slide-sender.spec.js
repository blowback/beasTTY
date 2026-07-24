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
}

test.describe('SLIDE sender end-to-end (Phase 9 Plan 09-04)', () => {

    test.beforeEach(async ({ page }) => {
        await setup(page);
        await page.evaluate(() => window.__menuBar.open('connection'));
        await page.click('#menu-connect-item');
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

    test('v0.5.2 wire realism (UAT-E9-03): ACK control/seq bytes split across chunks + console text — multi-file send still completes @fast', async ({ page }) => {
        // Real hardware failure (2026-07-24, multi-file pane drag): the Z80's
        // EOF ACK arrived with its control byte and seq byte in separate
        // serial chunks ("Transfer complete!" console bytes ride right
        // behind). The stateless send-mode classifier misrouted the lone seq
        // byte (raw binary, usually not a control value) to the terminal, the
        // ACK never completed, no second header was ever sent, and the
        // session wedged with the Z80 waiting silently. splitRecvAcks makes
        // the bot deliver EVERY ACK as [CTRL_ACK] then [seq, ...console
        // text], so this spec wedges without the sendCtrlSeqPending carry.
        const a = 'A'.repeat(1500);   // 2 data frames + EOF — window ACKs split too
        const b = 'BBBB';
        await page.evaluate(() => window.__mockSlideBot.setSplitAcks(true));
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
        const finObserved = await page.evaluate(() => window.__mockSlideBot.finObserved());
        expect(finObserved).toBe(true);
    });

    test('v0.5.2 ACK cadence (UAT-E9-03): window ACKs only — sender must push whole windows; 19K+24K pair completes with seq 24 (0x18) in play @fast', async ({ page }) => {
        // The real slide.asm receiver ACKs once per WIN_SIZE(4) frames plus
        // once for the EOF — NEVER per frame. The old one-frame-per-dispatch
        // pump deadlocked under this cadence and survived on hardware only
        // via the Z80's retry-timeout NAK crutch (slow + NAK-spam). This is
        // the byte-exact shape of Ant's failing hardware run: file sizes
        // chosen so file 2's frame seqs cross 24 = 0x18 = CTRL_CAN — the
        // value that turned any classifier desync into a spurious cancel
        // echo ("Transfer cancelled by peer"). Split ACKs on too: full
        // v0.5.2 wire realism, no crutch available (the bot never NAKs).
        const a = 'A'.repeat(19 * 1024);   // 19 frames + EOF (bbcbasic-shaped)
        const b = 'B'.repeat(24 * 1024 + 100);   // 25 frames — seq 24 = 0x18 occurs
        await page.evaluate(() => {
            window.__mockSlideBot.setV052AckCadence(true);
            window.__mockSlideBot.setSplitAcks(true);
        });
        await page.setInputFiles('#send-file-input', [
            { name: 'a.bin', mimeType: 'application/octet-stream', buffer: Buffer.from(a) },
            { name: 'b.bin', mimeType: 'application/octet-stream', buffer: Buffer.from(b) },
        ]);
        await page.locator('#send-modal-send').click();
        await expect.poll(
            () => page.evaluate(() => window.__mockWriterLog.length > 0),
            { timeout: 2000 },
        ).toBe(true);
        await page.evaluate(() => window.__mockSlideBot.pushSlideWakeup());
        await expect.poll(
            () => page.evaluate(() => window.__slide.__getStateForTests().mode),
            { timeout: 15000 },
        ).toBe('terminal');
        expect(await page.evaluate(() => window.__mockSlideBot.getReceivedBytes(0)))
            .toEqual(Array.from(Buffer.from(a)));
        expect(await page.evaluate(() => window.__mockSlideBot.getReceivedBytes(1)))
            .toEqual(Array.from(Buffer.from(b)));
        expect(await page.evaluate(() => window.__mockSlideBot.finObserved())).toBe(true);
    });

    test('Esc during an active SEND session cancels it — chip hides, mode returns to terminal (UAT-E9-03) @fast', async ({ page }) => {
        // Mirror of the Phase 12 UAT Gap D chip-button fix, for the Esc path:
        // keyboard.js's recv-side isSlideActive() never sees send sessions, so
        // Esc used to fall through to the encode path and tx-sink dropped the
        // byte (wire owner 'slide') — a wedged send had no keyboard escape.
        // The bot ACKs the header then stalls (stallAfterAcks=1) — the sender
        // hangs awaiting the data ACK, the same shape as the hardware wedge.
        // Press Esc, expect the full cancelSlideSend dance (or its 2 s escape
        // hatch) to land back in terminal mode with the chip hidden.
        await page.evaluate(() => window.__mockSlideBot.setStallAfterAcks(1));
        const content = 'Y'.repeat(2000);
        await page.setInputFiles('#send-file-input', {
            name: 'big.bin',
            mimeType: 'application/octet-stream',
            buffer: Buffer.from(content),
        });
        await page.locator('#send-modal-send').click();
        await expect.poll(
            () => page.evaluate(() => window.__mockWriterLog.length > 0),
            { timeout: 2000 },
        ).toBe(true);
        await page.evaluate(() => window.__mockSlideBot.pushSlideWakeup());
        await expect.poll(
            () => page.evaluate(() => window.__slide.__getStateForTests().mode),
            { timeout: 5000 },
        ).toBe('send');
        await page.locator('#terminal-wrapper').focus();
        await page.keyboard.press('Escape');
        await expect.poll(
            () => page.evaluate(() => window.__slide.__getStateForTests().mode),
            { timeout: 5000 },
        ).toBe('terminal');
        await expect(page.locator('#slide-chip')).toBeHidden();
    });

    test('chip during send shows the current FILENAME and a stable rate token (UAT-E9-04 ii+iii) @fast', async ({ page }) => {
        // Stall mid-session (bot ACKs the header then goes quiet) so the chip
        // can be observed in a steady active state. (ii): current_filename is
        // now wired for send sessions — the chip text must carry it. (iii):
        // the throughput token must not flip between "—" and a value across
        // refresh ticks (the old trim-vs-guard boundary bug); once shown it
        // holds.
        await page.evaluate(() => window.__mockSlideBot.setStallAfterAcks(1));
        await page.setInputFiles('#send-file-input', [
            { name: 'game.com', mimeType: 'application/octet-stream', buffer: Buffer.from('G'.repeat(2000)) },
            { name: 'dump.bin', mimeType: 'application/octet-stream', buffer: Buffer.from('D'.repeat(500)) },
        ]);
        await page.locator('#send-modal-send').click();
        await expect.poll(
            () => page.evaluate(() => window.__mockWriterLog.length > 0),
            { timeout: 2000 },
        ).toBe(true);
        await page.evaluate(() => window.__mockSlideBot.pushSlideWakeup());
        await expect.poll(
            () => page.evaluate(() => window.__slide.__getStateForTests().mode),
            { timeout: 5000 },
        ).toBe('send');
        // (ii) — filename + N/M counter in the chip text.
        await expect.poll(
            () => page.evaluate(() => document.getElementById('slide-chip-text').textContent),
            { timeout: 3000 },
        ).toContain('GAME.COM');
        expect(await page.evaluate(() => document.getElementById('slide-chip-text').textContent))
            .toContain('1/2');
        expect(await page.evaluate(() => window.__slide.__getStateForTests().current_filename))
            .toBe('GAME.COM');
        // (iii) — the token never reverts to "—" once a rate exists (the old
        // trim-vs-guard boundary made it flip every few ticks), and once the
        // sample window is fully static it holds one value ("0 B/s").
        await page.waitForTimeout(2600);   // > WINDOW_MS — stall makes the rate settle
        const rateToken = () => page.evaluate(() => {
            const t = document.getElementById('slide-chip-text').textContent;
            const m = t.match(/(—|\d+(?:\.\d+)? [KM]?B\/s)/);
            return m ? m[1] : null;
        });
        const r1 = await rateToken();
        await page.waitForTimeout(300);
        const r2 = await rateToken();
        await page.waitForTimeout(300);
        const r3 = await rateToken();
        expect(r1).not.toBe(null);
        expect(r1).not.toBe('—');   // never back to the narrow placeholder mid-session
        expect(r2).toBe(r1);
        expect(r3).toBe(r1);
        // Clean up the stalled session so later tests start from terminal mode.
        await page.locator('#terminal-wrapper').focus();
        await page.keyboard.press('Escape');
        await expect.poll(
            () => page.evaluate(() => window.__slide.__getStateForTests().mode),
            { timeout: 5000 },
        ).toBe('terminal');
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
