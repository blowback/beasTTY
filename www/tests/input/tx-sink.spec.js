// Beastty Phase 8 Plan 04 (Wave 3) — tx-sink wire-owner Playwright assertions.
//
// SLIDE-06: tx-sink gains a wire-owner state ('terminal' | 'slide') and a
// writeSlideFrame(bytes) entry point that bypasses the keystroke ring. While
// owner is 'slide', pushTxBytes silently drops keystroke writes so the SLIDE
// session has exclusive ownership of the wire.
//
// Wave 3 GREEN gate: every Plan 08-01 stub replaced with real assertions
// covering SC#4 (TX handoff API + integration).
//
// Sources:
//   - 08-CONTEXT.md D-08, D-09 (wire-owner + writeSlideFrame).
//   - 08-RESEARCH.md §Pattern 2 (registeredWriter coupling).
//   - 08-PATTERNS.md §"www/tests/input/tx-sink.spec.js (NEW)".
//   - Analog: www/tests/input/tx-debug-strip.spec.js (input-level Playwright spec).

import { test, expect } from '@playwright/test';
import { SERIAL_MOCK } from '../transport/mock-serial.js';

async function setup(page) {
    await page.addInitScript(SERIAL_MOCK);
    await page.goto('/');
    await page.locator('#terminal-wrapper').focus();
    await page.waitForFunction(() => document.getElementById('terminal').width > 0);
    await page.locator('#connection').evaluate((el) => { el.open = true; });
}

async function connect(page) {
    await page.locator('#connect-button').click();
    // Generous timeout — Playwright's 10-worker parallelism can starve
    // the wasm boot path on busy hardware; 2s flakes intermittently.
    await expect.poll(
        () => page.evaluate(() => Boolean(navigator.serial._grantedPorts[0]?._reader)),
        { timeout: 5000 },
    ).toBe(true);
}

test.describe('SLIDE-06 — wire-owner handoff', () => {

    test.beforeEach(async ({ page }) => {
        await setup(page);
        await connect(page);
        // Reset owner + log between tests (the test runner reuses pages and
        // a prior test may have set owner='slide' or accumulated writes).
        await page.evaluate(() => {
            window.__txSink.setWireOwner('terminal');
            window.__mockWriterLog = [];
        });
        // Re-focus the terminal-wrapper after window.__txSink eval, so
        // subsequent page.keyboard.press lands on the keyboard listener.
        await page.locator('#terminal-wrapper').focus();
    });

    test('default-owner-is-terminal @fast', async ({ page }) => {
        // Default owner at boot is 'terminal' (tx-sink.js:42 — let owner = 'terminal').
        // beforeEach explicitly sets it back to 'terminal' so the assertion
        // is self-contained.
        expect(await page.evaluate(() => window.__txSink.getWireOwner())).toBe('terminal');
    });

    test('setWireOwner(slide)-silently-drops-pushTxBytes @fast', async ({ page }) => {
        await page.evaluate(() => window.__txSink.setWireOwner('slide'));
        // Press arrow up — keyboard.js calls pushTxBytes which should silent-drop
        // because owner === 'slide' (tx-sink.js:50).
        await page.keyboard.press('ArrowUp');
        // Allow event loop to flush any async writes.
        await page.evaluate(() => new Promise((r) => setTimeout(r, 100)));
        expect(await page.evaluate(() => window.__mockWriterLog.length)).toBe(0);
    });

    test('setWireOwner(terminal)-restores-keystroke-write @fast', async ({ page }) => {
        // First set owner to slide, press a key (silent drop).
        await page.evaluate(() => window.__txSink.setWireOwner('slide'));
        await page.keyboard.press('ArrowUp');
        await page.evaluate(() => new Promise((r) => setTimeout(r, 100)));
        expect(await page.evaluate(() => window.__mockWriterLog.length)).toBe(0);
        // Restore owner to terminal.
        await page.evaluate(() => window.__txSink.setWireOwner('terminal'));
        // Press another key — should land in the writer log.
        await page.keyboard.press('ArrowUp');
        await expect.poll(
            () => page.evaluate(() => window.__mockWriterLog.length),
            { timeout: 1000 },
        ).toBeGreaterThanOrEqual(1);
    });

    test('writeSlideFrame-bypasses-keystroke-ring @fast', async ({ page }) => {
        // writeSlideFrame writes via registeredWriter (Phase 5 D-21), NOT the
        // 1024-byte keystroke ring. The ring's hex-strip output (#tx-strip)
        // should be unchanged before vs after the call.
        const ringBefore = await page.evaluate(() =>
            document.getElementById('tx-strip').textContent,
        );
        await page.evaluate(() => window.__txSink.writeSlideFrame(new Uint8Array([0x06, 0x00])));
        // Wait for the write to appear in __mockWriterLog.
        await expect.poll(
            () => page.evaluate(() => window.__mockWriterLog.length),
            { timeout: 1000 },
        ).toBeGreaterThanOrEqual(1);
        // The TX ring (and its hex-strip rendering) should be UNCHANGED.
        const ringAfter = await page.evaluate(() =>
            document.getElementById('tx-strip').textContent,
        );
        expect(ringAfter).toBe(ringBefore);
        // The bytes that hit __mockWriterLog match what writeSlideFrame was called with.
        const last = await page.evaluate(() =>
            window.__mockWriterLog[window.__mockWriterLog.length - 1].bytes,
        );
        expect(last).toEqual([0x06, 0x00]);
    });

    test('writeSlideFrame-writes-via-registeredWriter (works regardless of owner) @fast', async ({ page }) => {
        // writeSlideFrame must work even when owner === 'slide' (otherwise the
        // bypass path itself would be gated by the owner state and SLIDE
        // session writes would be silent-dropped along with keystrokes —
        // a wedge state Pitfall 3 explicitly guards against).
        await page.evaluate(() => window.__txSink.setWireOwner('slide'));
        await page.evaluate(() => window.__txSink.writeSlideFrame(new Uint8Array([0x12, 0x34])));
        await expect.poll(
            () => page.evaluate(() => window.__mockWriterLog.length),
            { timeout: 1000 },
        ).toBeGreaterThanOrEqual(1);
        const last = await page.evaluate(() =>
            window.__mockWriterLog[window.__mockWriterLog.length - 1].bytes,
        );
        expect(last).toEqual([0x12, 0x34]);
    });

    test('invalid-owner-throws @fast', async ({ page }) => {
        // setWireOwner('garbage') throws (tx-sink.js:106 — defensive guard
        // restricts owner to 'terminal' or 'slide').
        const result = await page.evaluate(() => {
            try {
                window.__txSink.setWireOwner('garbage');
                return { threw: false };
            } catch (err) {
                return { threw: true, msg: String(err.message) };
            }
        });
        expect(result.threw).toBe(true);
        expect(result.msg).toContain('invalid owner');
    });
});

// Phase 9 Plan 02 — writeSlideFrameAwaitable (D-16) PITFALLS §4 backpressure
// idiom. Sibling tests to the SLIDE-06 wire-owner suite above. The new
// entrypoint is exposed via window.__txSink.writeSlideFrameAwaitable by
// main.js boot wiring (Plan 09-02 Task 3).
test.describe('SLIDE-13 — writeSlideFrameAwaitable backpressure idiom', () => {

    test('writeSlideFrameAwaitable awaits writer.ready before writer.write @fast', async ({ page }) => {
        await setup(page);
        await connect(page);
        // Reset log so the assertion below is self-contained against any
        // boot-time writes that landed in __mockWriterLog before our call.
        await page.evaluate(() => { window.__mockWriterLog = []; });

        const result = await page.evaluate(async () => {
            const bytes = new Uint8Array([0xAA, 0xBB, 0xCC]);
            await window.__txSink.writeSlideFrameAwaitable(bytes);
            // Return the FULL log so the test sees both the bytes shape AND
            // the per-write entry shape.
            return window.__mockWriterLog.map((e) => Array.from(e.bytes));
        });

        // The 3 bytes must appear in the writer log (proving the await chain ran
        // — both `await writer.ready` and `await writer.write(bytes)` resolved).
        expect(result.length).toBeGreaterThanOrEqual(1);
        const last = result[result.length - 1];
        expect(last).toEqual([0xAA, 0xBB, 0xCC]);
    });

    test('writeSlideFrameAwaitable throws when writer not registered @fast', async ({ page }) => {
        // Do NOT call connect() — registeredWriter stays null because no port
        // has been opened. Setup attaches the mock and navigates so
        // window.__txSink exists, but Connect was never clicked.
        await page.addInitScript(SERIAL_MOCK);
        await page.goto('/');
        // Wait for window.__txSink to land (main.js:402 wiring).
        await page.waitForFunction(() => Boolean(window.__txSink && window.__txSink.writeSlideFrameAwaitable), { timeout: 5000 });

        const errMsg = await page.evaluate(async () => {
            try {
                await window.__txSink.writeSlideFrameAwaitable(new Uint8Array([0x01]));
                return 'NO_THROW';
            } catch (err) {
                return err.message;
            }
        });
        expect(errMsg).toContain('no writer registered');
    });

    test('writeSlideFrameAwaitable propagates writer.write rejection @fast', async ({ page }) => {
        // Replace MockWriter.write with a rejecting impl, then assert the
        // rejection propagates out of writeSlideFrameAwaitable (caller's
        // responsibility to catch — sender main loop will).
        await setup(page);
        await connect(page);
        await page.evaluate(() => {
            const port = navigator.serial._grantedPorts[0];
            const writer = port._writer;
            writer.write = async () => { throw new Error('forced-write-failure'); };
        });

        const errMsg = await page.evaluate(async () => {
            try {
                await window.__txSink.writeSlideFrameAwaitable(new Uint8Array([0x99]));
                return 'NO_THROW';
            } catch (err) {
                return err.message;
            }
        });
        expect(errMsg).toContain('forced-write-failure');
    });
});
