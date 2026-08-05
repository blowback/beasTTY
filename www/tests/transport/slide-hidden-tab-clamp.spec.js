// Beastty E11 Story S11.4 — a hidden tab never invents a failure.
//
// The cancel sequence's Step 3 ("wait up to 500 ms for the peer's CTRL_CAN
// echo") used to poll `setTimeout(tick, 10)` against a deadline. Two failures
// were riding on that shape:
//
//   1. The receive-side wait read `slideRef` inside its tick. `exitRecvMode`
//      nulls that ref synchronously AT the transition — inside the same read-
//      loop callback that fed the echo byte — so no scheduled tick could ever
//      observe STATE_DONE. Every receive cancel burned the full 500 ms and
//      reported "no echo", on any clock.
//   2. Chromium floors a hidden tab's chained timers at ~1 s while
//      performance.now() keeps real time, so the poll collapsed to one or two
//      samples and the Z80's published ~500 ms echo budget was never sampled.
//      A healthy transfer was then reported as a failure — and at chain depth
//      >= 5 the 2 s absolute timeout could fire first and force_idle a
//      perfectly good session.
//
// Both waits now resolve on the transition, notified from the inbound byte
// dispatcher with the transitioned-to state value passed by argument, against
// a single non-chained deadline. A clamp can only make one deadline fire LATE,
// which is the safe direction — so this spec wedges without the
// resolve-on-transition waits.
//
// The clamp is simulated with a targeted setTimeout floor shim installed right
// before the cancel (page.clock would freeze the wasm boot and the bot pump).

import { test, expect } from '@playwright/test';
import { SERIAL_MOCK } from './mock-serial.js';
import { MOCK_SERIAL_SLIDE_BOT } from './mock-serial-slide-bot.js';

// The 2 s absolute escape hatch is armed when the cancel starts, so a clamped
// run can print its warning long after mode is back to 'terminal'. Wait past
// that deadline (plus slack) before reading the console.
const SETTLE_PAST_ABSOLUTE_MS = 2600;

async function setup(page) {
    await page.addInitScript(SERIAL_MOCK);
    await page.addInitScript(MOCK_SERIAL_SLIDE_BOT);
    await page.goto('/');
    await page.locator('#terminal-wrapper').focus();
    await page.waitForFunction(() => document.getElementById('terminal').width > 0);
}

async function commonReset(page) {
    await page.evaluate(() => window.__menuBar.open('connection'));
    await page.click('#menu-connect-item');
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

// Drive the bot into mid-DataPhase (verbatim from slide-cancel.spec.js) so a
// cancel has a live receive session to act on.
async function enterMidStream(page, fileSize) {
    await page.evaluate((size) => {
        const bytes = new Uint8Array(size);
        for (let i = 0; i < size; i++) bytes[i] = i & 0xFF;
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

// Chromium hidden-tab timer clamp, simulated. Installed via page.evaluate
// immediately before the cancel — NOT addInitScript, because the wasm boot,
// the connect handshake and the bot pump must all stay on real timers.
async function installTimerClamp(page) {
    await page.evaluate(() => {
        const real = window.setTimeout.bind(window);
        window.__restoreTimerClamp = () => { window.setTimeout = real; };
        window.setTimeout = (fn, ms, ...rest) => real(fn, Math.max(ms | 0, 1000), ...rest);
    });
}

async function restoreTimerClamp(page) {
    await page.evaluate(() => {
        if (window.__restoreTimerClamp) window.__restoreTimerClamp();
    });
}

// Drive a SEND session to a steady active state: the bot ACKs the header then
// stalls, so the sender sits mid-session with nothing arriving — the same
// shape slide-sender.spec.js uses for its Esc-cancel case.
async function enterStalledSend(page) {
    await page.evaluate(() => {
        window.__mockSlideBot.setRole('recv');       // bot is the Z80 receiver
        window.__fileSource.__resetForTests();
        window.__mockSlideBot.setStallAfterAcks(1);
    });
    await page.setInputFiles('#send-file-input', {
        name: 'big.bin',
        mimeType: 'application/octet-stream',
        buffer: Buffer.from('Y'.repeat(2000)),
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
}

function hideTab(page) {
    return page.evaluate(() => {
        Object.defineProperty(document, 'visibilityState', {
            value: 'hidden', configurable: true,
        });
        Object.defineProperty(document, 'hidden', {
            value: true, configurable: true,
        });
        document.dispatchEvent(new Event('visibilitychange'));
    });
}

test.describe('slide-hidden-tab-clamp — FR-15 a hidden tab never invents a failure', () => {

    test.beforeEach(async ({ page }) => {
        await setup(page);
        await commonReset(page);
    });

    test('(a) FR-15 recv, ordinary clock — the peer echo is observed, not missed', async ({ page }) => {
        // The receive wait reading slideRef is the defect this case pins:
        // exitRecvMode nulls the ref in the same synchronous callback that fed
        // the echo, so a polled read can never see STATE_DONE — no clamp
        // needed to break it.
        await enterMidStream(page, 200 * 1024);
        await page.evaluate(() => { window.__slide.cancelRecv(); });
        await expect.poll(
            () => page.evaluate(() => window.__slideRecv.__getStateForTests().lastCancelEchoArrived),
            { timeout: 5000 },
        ).toBe(true);
        await expect.poll(
            () => page.evaluate(() => window.__slide.__getStateForTests().mode),
            { timeout: 5000 },
        ).toBe('terminal');
    });

    test('(b) FR-15 recv, clamped clock — echo still observed, no 2 s force_idle', async ({ page }) => {
        const consoleWarnings = [];
        page.on('console', (msg) => {
            if (msg.type() === 'warning') consoleWarnings.push(msg.text());
        });
        await enterMidStream(page, 200 * 1024);
        await installTimerClamp(page);
        await page.evaluate(() => { window.__slide.cancelRecv(); });
        await expect.poll(
            () => page.evaluate(() => window.__slideRecv.__getStateForTests().lastCancelEchoArrived),
            { timeout: 8000 },
        ).toBe(true);
        await expect.poll(
            () => page.evaluate(() => window.__slide.__getStateForTests().mode),
            { timeout: 8000 },
        ).toBe('terminal');
        // Settle past the 2 s absolute deadline before reading the console:
        // the escape hatch was armed at cancel time and fires LATE under the
        // clamp, well after mode has already returned to 'terminal'. Asserting
        // straight after the mode flip reads the console before the warning
        // that proves the defect could have been printed.
        await page.waitForTimeout(SETTLE_PAST_ABSOLUTE_MS);
        await restoreTimerClamp(page);
        expect(consoleWarnings.filter((w) => w.includes('cancel absolute timeout'))).toEqual([]);
    });

    test('(c) FR-15 send, clamped clock — echo still observed, no 2 s force_idle', async ({ page }) => {
        const consoleWarnings = [];
        page.on('console', (msg) => {
            if (msg.type() === 'warning') consoleWarnings.push(msg.text());
        });
        await enterStalledSend(page);
        await installTimerClamp(page);
        await page.locator('#terminal-wrapper').focus();
        await page.keyboard.press('Escape');
        await expect.poll(
            () => page.evaluate(() => window.__slide.__getStateForTests().lastCancelEchoArrived),
            { timeout: 8000 },
        ).toBe(true);
        await expect.poll(
            () => page.evaluate(() => window.__slide.__getStateForTests().mode),
            { timeout: 8000 },
        ).toBe('terminal');
        await page.waitForTimeout(SETTLE_PAST_ABSOLUTE_MS);   // see (b)
        await restoreTimerClamp(page);
        expect(consoleWarnings.filter((w) => w.includes('send-cancel absolute timeout'))).toEqual([]);
    });

    test('(d) ADR-003 §3 — no echo still burns the full 500 ms + 100 ms budget', async ({ page }) => {
        // The safety net for (a)-(c): resolving on a transition must not make
        // the no-echo path resolve early. This case is green before the change
        // and must stay green after it.
        await page.evaluate(() => {
            window.__mockSlideBot.send.injectNoEchoOnCancel = true;
        });
        await enterMidStream(page, 200 * 1024);
        const t0 = Date.now();
        await page.evaluate(() => { window.__slide.cancelRecv(); });
        await expect.poll(
            () => page.evaluate(() => window.__slide.__getStateForTests().mode),
            { timeout: 3500 },
        ).toBe('terminal');
        const elapsed = Date.now() - t0;
        expect(await page.evaluate(
            () => window.__slideRecv.__getStateForTests().lastCancelEchoArrived,
        )).toBe(false);
        expect(elapsed).toBeGreaterThanOrEqual(600);
    });

    test('(e) FR-15 — hiding the tab mid-receive does not cancel the transfer', async ({ page }) => {
        // Split View makes "hidden" an ordinary state during a transfer. The
        // teardown protection D-13 argued for lives on pagehide (asserted in
        // slide-bridge.spec.js), not on every tab switch.
        await enterMidStream(page, 200 * 1024);
        await page.evaluate(() => { window.__mockWriterLog.length = 0; });
        await hideTab(page);
        await page.waitForTimeout(500);
        const sawCtrlCan = await page.evaluate(() =>
            window.__mockWriterLog.some((e) => e.bytes && e.bytes.some((b) => b === 0x18)));
        expect(sawCtrlCan).toBe(false);
        expect(await page.evaluate(() => window.__slide.__getStateForTests().mode)).toBe('recv');
    });
});
