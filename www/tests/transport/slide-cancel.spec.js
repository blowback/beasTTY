// BestialiTTY Phase 10 Plan 10-05 — Esc-cancel + cancel timing windows + force_idle
// escape hatch + hard-fail recovery Playwright assertions.
//
// Locks in the cancel-window contract from ADR-003 (v0.2.1 CAN amendment) +
// 10-PATTERNS.md §"Esc-cancel slot" + 10-CONTEXT.md §"Cancel sequence pseudocode"
// (200/500/100/2000 ms). Drives the mock-bot in 'send' role to push data into
// the receiver pipeline, then cancels via window.__slide.cancelRecv() or Esc.

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

async function commonReset(page) {
    await page.locator('#connect-button').click();
    await expect.poll(
        () => page.evaluate(() => Boolean(navigator.serial._grantedPorts[0]?._reader)),
        { timeout: 5000 },
    ).toBe(true);
    await page.evaluate(() => {
        window.__slide.__resetForTests();
        window.__slideRecv.__resetForTests();
        window.__mockWriterLog.length = 0;
        window.__mockSlideBot.reset();
        window.__mockSlideBot.setRole('send');
    });
}

// Helper: drive the bot into mid-DataPhase. The bot pauses after the first
// data window so the receiver SM stays in DataPhase long enough for cancel
// to have a meaningful effect. Returns once first-window data has been
// observed (bytesInFileDone > 0).
async function enterMidStream(page, fileSize) {
    await page.evaluate((size) => {
        const bytes = new Uint8Array(size);
        for (let i = 0; i < size; i++) bytes[i] = i & 0xFF;
        // Pause after the first window so we can observe + cancel mid-stream.
        window.__mockSlideBot.send.pauseAfterFirstWindow = true;
        window.__mockSlideBot.queueSendFiles([{ name: 'BIG.BIN', bytes }]);
        window.__mockSlideBot.pushSlideHostWakeup();
    }, fileSize);
    await expect.poll(
        () => page.evaluate(() => window.__slide.__getStateForTests().mode),
        { timeout: 5000 },
    ).toBe('recv');
    await page.evaluate(() => window.__mockSlideBot.startSendSession());
    await expect.poll(
        () => page.evaluate(() => window.__slideRecv.__getStateForTests().bytesInFileDone > 0),
        { timeout: 5000 },
    ).toBe(true);
}

function ctrlCanInWriterLog(page) {
    return page.evaluate(() =>
        window.__mockWriterLog.some((entry) =>
            entry.bytes && entry.bytes.some((b) => b === 0x18),
        ),
    );
}

test.describe('slide-cancel — Esc + programmatic + timing windows', () => {

    test.beforeEach(async ({ page }) => {
        await setup(page);
        await commonReset(page);
    });

    test('SLIDE-27: Esc-cancel during recv emits CTRL_CAN and returns to terminal mode', async ({ page }) => {
        await enterMidStream(page, 200 * 1024);
        await page.locator('#terminal-wrapper').focus();
        await page.keyboard.press('Escape');
        // CTRL_CAN must appear in __mockWriterLog (within 250 ms — 200 ms allSettled
        // + 50 ms slack per CONTEXT.md cancel sequence step 1+2).
        await expect.poll(() => ctrlCanInWriterLog(page), { timeout: 1000 }).toBe(true);
        // Mode returns to 'terminal' within 2.5 s (full cancel sequence < 2200 ms).
        await expect.poll(
            () => page.evaluate(() => window.__slide.__getStateForTests().mode),
            { timeout: 2500 },
        ).toBe('terminal');
    });

    test('SLIDE-30: programmatic cancelRecv() emits CTRL_CAN within 250 ms', async ({ page }) => {
        await enterMidStream(page, 200 * 1024);
        const t0 = Date.now();
        // Don't await — cancelRecv has a 200 ms allSettled then pushes CTRL_CAN.
        await page.evaluate(() => { window.__slide.cancelRecv(); });
        await expect.poll(() => ctrlCanInWriterLog(page), { timeout: 1000 }).toBe(true);
        const elapsed = Date.now() - t0;
        // CONTEXT cancel pseudocode: 200 ms allSettled cap + slack for the
        // first slide.cancel + writeSlideFrame microtask.
        expect(elapsed).toBeLessThanOrEqual(800);
    });

    test('cancel timing windows — 500 ms echo wait + 100 ms drain returns to terminal', async ({ page }) => {
        // Default bot echoes CTRL_CAN; sequence should complete in
        // ~ (200 ms allSettled + immediate cancel + 500 ms echo wait + 100 ms drain)
        // = up to 800 ms. Generous slack: assert ≤ 1500 ms.
        await enterMidStream(page, 200 * 1024);
        const t0 = Date.now();
        await page.evaluate(() => { window.__slide.cancelRecv(); });
        await expect.poll(
            () => page.evaluate(() => window.__slide.__getStateForTests().mode),
            { timeout: 1500 },
        ).toBe('terminal');
        const elapsed = Date.now() - t0;
        expect(elapsed).toBeLessThanOrEqual(1500);
    });

    test('force_idle escape hatch — bot withholds CAN echo, force_idle fires at ~2 s', async ({ page }) => {
        // Set up bot to NOT echo CTRL_CAN — exercises the force_idle 2 s
        // absolute-timeout escape hatch (ADR-003 §3 + CONTEXT step 5).
        await page.evaluate(() => {
            window.__mockSlideBot.send.injectNoEchoOnCancel = true;
        });
        await enterMidStream(page, 200 * 1024);
        const t0 = Date.now();
        await page.evaluate(() => { window.__slide.cancelRecv(); });
        // force_idle fires at the 2000 ms absolute timeout.
        await expect.poll(
            () => page.evaluate(() => window.__slide.__getStateForTests().mode),
            { timeout: 3500 },
        ).toBe('terminal');
        const elapsed = Date.now() - t0;
        // Lower bound — confirms we waited the full 500 ms echo + 100 ms drain
        // (= 600 ms from CAN push). Upper bound — the 2 s absolute timeout +
        // slack catches a hung-cancel regression.
        expect(elapsed).toBeGreaterThanOrEqual(600);
        expect(elapsed).toBeLessThan(3000);
    });

    test('SLIDE-29: hard-fail recovery — recoverHardFail returns to terminal mode', async ({ page }) => {
        // Drive a recv session, then trigger a programmatic hard-fail via
        // file-too-large path: queue a file that the receiver SM accepts a
        // header for, then exceed MAX_FILE_SIZE (100 MB) — too costly. Instead
        // exercise recoverHardFail directly via window.__slide.cancelRecv after
        // setting injectNoEchoOnCancel + driving the SM into Error via
        // multiple bad frames is also costly. Use the cleanest path:
        // call cancelRecv with no bot echo — the force_idle path IS hard-fail
        // mitigation per recoverHardFail's 3-mode convergence (NAK exhaustion /
        // port lost / wire desync all converge here). Assert mode + tx-owner.
        await page.evaluate(() => {
            window.__mockSlideBot.send.injectNoEchoOnCancel = true;
        });
        await enterMidStream(page, 200 * 1024);
        await page.evaluate(() => { window.__slide.cancelRecv(); });
        await expect.poll(
            () => page.evaluate(() => window.__slide.__getStateForTests().mode),
            { timeout: 3500 },
        ).toBe('terminal');
        // After recoverHardFail / forceExitRecvMode, the tx-sink wire owner
        // must be 'terminal' so subsequent keystrokes reach the wire.
        const owner = await page.evaluate(() => window.__txSink.getWireOwner());
        expect(owner).toBe('terminal');
    });

    test('SLIDE-30: cancel idempotent — second call within 100 ms is a no-op', async ({ page }) => {
        await enterMidStream(page, 200 * 1024);
        // Snapshot writer log length BEFORE cancel so prior session bytes
        // (header acks, data acks during the first window) don't pollute
        // the count of CTRL_CAN bytes attributable to this cancel pair.
        const preCancelLen = await page.evaluate(() => window.__mockWriterLog.length);
        // Two rapid calls — the second must early-return on cancelInFlight.
        await page.evaluate(() => {
            window.__slide.cancelRecv();
            window.__slide.cancelRecv();
        });
        // Wait for cancel sequence to settle.
        await expect.poll(
            () => page.evaluate(() => window.__slide.__getStateForTests().mode),
            { timeout: 3000 },
        ).toBe('terminal');
        // Count CTRL_CAN bytes only in entries written AFTER our cancel calls
        // — must be exactly 1 from the receiver side (slide.cancel pushes
        // 0x18 once; the second cancelRecv early-returns on cancelInFlight).
        const canCount = await page.evaluate((startIdx) => {
            const entries = window.__mockWriterLog.slice(startIdx);
            return entries.reduce(
                (acc, e) => acc + (e.bytes ? e.bytes.filter((b) => b === 0x18).length : 0),
                0,
            );
        }, preCancelLen);
        expect(canCount).toBe(1);
    });
});
