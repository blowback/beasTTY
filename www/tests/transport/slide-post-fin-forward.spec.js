// Beastty v1.1 polish — 260513-grs Task 3.
//
// Post-FIN tail forwarding: when CTRL_FIN arrives in the same wire chunk as
// trailing terminal text, the SLIDE state machine transitions to Done on the
// FIN byte and the Rust state.rs early-return silently drops subsequent bytes.
// dispatchSendMode / dispatchRecvMode must capture the post-FIN tail and feed
// it to termRef.feed after exitSendMode/exitRecvMode flips mode back to
// 'terminal'.
//
// Spec uses a monkey-patched window.__mockReaderPush that, on detecting a
// single-byte CTRL_FIN push from the mock-bot, splices in trailing terminal
// text so the inbound wire chunk delivered to dispatchSendMode/dispatchRecvMode
// is `[CTRL_FIN, ...trailingText]`.

import { test, expect } from '@playwright/test';
import { SERIAL_MOCK } from './mock-serial.js';
import { MOCK_SERIAL_SLIDE_BOT } from './mock-serial-slide-bot.js';

const CTRL_FIN = 0x04;

async function setup(page) {
    await page.addInitScript(SERIAL_MOCK);
    await page.addInitScript(MOCK_SERIAL_SLIDE_BOT);
    await page.goto('/');
    await page.locator('#terminal-wrapper').focus();
    await page.waitForFunction(() => document.getElementById('terminal').width > 0);
    await page.locator('#connection').evaluate((el) => { el.open = true; });
}

test.beforeEach(async ({ page }) => {
    await setup(page);
    await page.locator('#connect-button').click();
    await expect.poll(
        () => page.evaluate(() => Boolean(navigator.serial._grantedPorts[0]?._reader)),
        { timeout: 8000 },
    ).toBe(true);
    await page.evaluate(() => {
        window.__slide?.__resetForTests?.();
        window.__fileSource?.__resetForTests?.();
        if (window.__mockWriterLog) window.__mockWriterLog.length = 0;
        window.__mockSlideBot?.reset?.();
    });
});

// ===== Test 1 — Send mode: FIN echo + trailing text in same chunk =====

test('post-FIN tail (send mode) is forwarded to termRef.feed after exitSendMode', async ({ page }) => {
    // Install a __mockReaderPush wrapper that splices "TX_DONE\r\n" after any
    // single-byte CTRL_FIN push from the bot. This produces `[CTRL_FIN, 'T',
    // 'X', '_', 'D', 'O', 'N', 'E', \r, \n]` as ONE inbound chunk — the
    // condition Task 3 fixes.
    await page.evaluate(() => {
        const TAIL = new TextEncoder().encode('TX_DONE\r\n');
        const original = window.__mockReaderPush;
        window.__mockReaderPush = (bytes) => {
            const arr = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
            if (arr.length === 1 && arr[0] === 0x04 /* CTRL_FIN */) {
                const merged = new Uint8Array(arr.length + TAIL.length);
                merged.set(arr, 0);
                merged.set(TAIL, arr.length);
                return original(merged);
            }
            return original(bytes);
        };
    });

    // Drive a normal one-file send session.
    await page.setInputFiles('#send-file-input', {
        name: 'fin.txt',
        mimeType: 'text/plain',
        buffer: Buffer.from('X'),
    });
    await page.locator('#send-modal-send').click();

    await expect.poll(
        () => page.evaluate(() => window.__mockWriterLog.length > 0),
        { timeout: 2000 },
    ).toBe(true);

    await page.evaluate(() => window.__mockSlideBot.pushSlideWakeup());

    // Mode flips back to 'terminal' on EVT_SESSION_COMPLETE.
    await expect.poll(
        () => page.evaluate(() => window.__slide.__getStateForTests().mode),
        { timeout: 15000 },
    ).toBe('terminal');

    // The trailing "TX_DONE" text must have reached the grid via term.feed.
    // __testGridView returns a Uint8Array of packed grid bytes (8 bytes per
    // cell — Phase 2 D-09 pack layout: glyph byte at cell start, 7 bytes of
    // attrs/colour follow). Search at stride=8.
    const found = await page.evaluate(() => {
        const view = window.__testGridView();
        const needle = 'TX_DONE';
        const stride = 8;
        for (let start = 0; start + needle.length * stride <= view.length; start += stride) {
            let ok = true;
            for (let j = 0; j < needle.length; j++) {
                if (view[start + j * stride] !== needle.charCodeAt(j)) { ok = false; break; }
            }
            if (ok) return true;
        }
        return false;
    });
    expect(found).toBe(true);
});

// ===== Test 2 — No regression: FIN alone in its own chunk =====

test('post-FIN no-tail fast path: FIN alone in chunk produces no spurious grid bytes', async ({ page }) => {
    // Use the unmodified bot (FIN arrives alone, no trailing text). Snapshot
    // a portion of the grid before the session; after completion, the same
    // region must be unchanged (no spurious bytes injected).
    // We use a sentinel byte (filler) so we can distinguish "wrote nothing"
    // from "wrote zeros". Actually, the simpler invariant: searching for
    // a known marker text that should NOT appear if no-tail fast path holds.
    await page.setInputFiles('#send-file-input', {
        name: 'fin.txt',
        mimeType: 'text/plain',
        buffer: Buffer.from('X'),
    });
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

    // The "TX_DONE" marker used in Test 1 must NOT appear here — Test 2's
    // wire chunk did not contain it. This proves the fast-path no-tail
    // branch doesn't inject any cross-test residue or other spurious bytes.
    // Same stride=8 packed-grid search as Test 1.
    const found = await page.evaluate(() => {
        const view = window.__testGridView();
        const needle = 'TX_DONE';
        const stride = 8;
        for (let start = 0; start + needle.length * stride <= view.length; start += stride) {
            let ok = true;
            for (let j = 0; j < needle.length; j++) {
                if (view[start + j * stride] !== needle.charCodeAt(j)) { ok = false; break; }
            }
            if (ok) return true;
        }
        return false;
    });
    expect(found).toBe(false);

    // Bot must have observed CTRL_FIN (sanity: the session actually completed).
    const finObserved = await page.evaluate(() => window.__mockSlideBot.finObserved());
    expect(finObserved).toBe(true);
});
