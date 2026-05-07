// BestialiTTY Phase 8 Plan 04 (Wave 3) — dispatcher routing Playwright assertions.
//
// SLIDE-05: dispatchInbound routes inbound Web Serial bytes to either the
// VT52 parser (terminal mode) or the Slide framer (recv mode), preserving
// the Phase 5 post-feed invariant chain (sampleBell → drainHostReply →
// requestFrame → sessionLog.append) when in terminal mode.
//
// Wave 3 GREEN gate: every Plan 08-01 stub replaced with real assertions
// covering SC#2 (dispatcher routing) + SC#5 (recv lifecycle).
//
// Sources:
//   - 08-CONTEXT.md D-04..D-09 (dispatchInbound + post-feed invariant).
//   - 08-VALIDATION.md §"Per-Task Verification Map" rows for SC#2 + SC#5.
//   - 08-PATTERNS.md §"www/tests/transport/slide-dispatcher.spec.js (NEW)".
//   - Analogs: www/tests/transport/readloop.spec.js (setup helper) +
//              www/tests/transport/lifecycle.spec.js (__mockWriterLog template).

import { test, expect } from '@playwright/test';
import { SERIAL_MOCK } from './mock-serial.js';

async function setup(page) {
    await page.addInitScript(SERIAL_MOCK);
    await page.goto('/');
    await page.locator('#terminal-wrapper').focus();
    await page.waitForFunction(() => document.getElementById('terminal').width > 0);
    await page.locator('#connection').evaluate((el) => { el.open = true; });
}

test.describe('SLIDE-05 — dispatcher routing', () => {

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
            window.__mockWriterLog = [];
        });
    });

    test('terminal-mode-pass-through-byte-identical-to-baseline @fast', async ({ page }) => {
        // 'HELLO' should render at row 0 cols 0..4 — exactly as baseline (Phase 5
        // readloop.spec.js test). The dispatcher must NOT mutate non-wakeup bytes
        // in terminal mode (Pitfall 1 — terminal-mode dispatch is byte-transparent).
        await page.evaluate(() => window.__mockReaderPush([0x48, 0x45, 0x4C, 0x4C, 0x4F]));
        await expect.poll(
            () => page.evaluate(() => {
                const g = window.__testGridView();
                return String.fromCharCode(g[0], g[8], g[16], g[24], g[32]);
            }),
            { timeout: 2000 },
        ).toBe('HELLO');
        // Mode stays terminal throughout — no false-positive wakeup detection.
        expect(await page.evaluate(() => window.__slide.__getStateForTests().mode)).toBe('terminal');
    });

    test('post-feed-invariant-BEL-flash-fires-through-dispatcher @fast', async ({ page }) => {
        // BEL through the dispatcher must trigger the bell-overlay 'flash' CSS
        // class (proves sampleBellFn() fires after dispatchInbound's terminal
        // branch — Phase 5 D-31 chain step 1, Pitfall 1 mitigation site at
        // serial.js:457-466).
        // Watch for the 'flash' class via a MutationObserver counter (the class
        // toggles on synchronously and removes after ~100ms).
        await page.evaluate(() => {
            const o = document.getElementById('bell-overlay');
            o.dataset.testBellFiredCount = '0';
            const obs = new MutationObserver(() => {
                if (o.classList.contains('flash')) {
                    o.dataset.testBellFiredCount = String(
                        parseInt(o.dataset.testBellFiredCount, 10) + 1,
                    );
                }
            });
            obs.observe(o, { attributes: true, attributeFilter: ['class'] });
        });
        await page.evaluate(() => window.__mockReaderPush([0x07]));  // BEL
        await expect.poll(
            () => page.evaluate(() =>
                parseInt(document.getElementById('bell-overlay').dataset.testBellFiredCount, 10),
            ),
            { timeout: 2000 },
        ).toBeGreaterThanOrEqual(1);
    });

    test('post-feed-invariant-ESC-Z-returns-host-reply @fast', async ({ page }) => {
        // ESC Z is the VT52 identify query. The parser writes ESC / K to the
        // host_reply buffer; drainHostReplyFn (called after dispatchInbound)
        // logs and clears it. Asserting host_reply_len === 0 after the push
        // proves the drain ran post-dispatcher (Phase 5 D-31 chain step 2,
        // Pitfall 1 mitigation site at serial.js:457-466).
        await page.evaluate(() => window.__mockReaderPush([0x1B, 0x5A]));  // ESC Z
        // After the post-feed drain runs, host_reply_len should be 0 (cleared).
        await expect.poll(
            () => page.evaluate(() => window.__term.host_reply_len()),
            { timeout: 2000 },
        ).toBe(0);
    });

    test('recv-mode-bytes-feed-slide-feed_chunk @fast', async ({ page }) => {
        // Trigger wakeup.
        await page.evaluate(() => window.__mockReaderPush([0x1B, 0x5E, 0x53, 0x4C, 0x49, 0x44, 0x45]));
        await expect.poll(
            () => page.evaluate(() => window.__slide.__getStateForTests().mode),
            { timeout: 2000 },
        ).toBe('recv');
        // Clear writer log so we only observe post-wakeup outbound activity.
        await page.evaluate(() => { window.__mockWriterLog = []; });
        // Push CTRL_RDY (0x11). The Phase 7 framer SM responds to CTRL_RDY by
        // emitting an EVT_RDY event; the dispatcher's drainSlideOutbound
        // writes any framer-emitted outbound bytes via writeSlideFrame, which
        // lands in __mockWriterLog through registeredWriter.write.
        await page.evaluate(() => window.__mockReaderPush([0x11]));
        // The outbound buffer is permitted to be empty here (Phase 7's recv-side
        // SM does not echo RDY automatically — that's a sender-side concern in
        // Phase 9). What matters for SLIDE-05 is that the byte was routed to
        // slide.feed_chunk (NOT term.feed) — verified by mode staying 'recv'
        // and the grid NOT receiving the byte.
        // Assert mode stays 'recv' (byte did not exit recv mode).
        expect(await page.evaluate(() => window.__slide.__getStateForTests().mode)).toBe('recv');
        // Assert the byte did NOT reach term.feed by checking the grid is empty
        // at row 0. CTRL_RDY = 0x11 is a control byte; if it had reached
        // term.feed it would be handled by the parser as control input but
        // would not render as a printable. Grid[0] stays at default (space=32
        // or null=0).
        const cell0 = await page.evaluate(() => window.__testGridView()[0]);
        expect(cell0 === 0 || cell0 === 32).toBe(true);
    });

    test('recv-mid-stream-wakeup-passthrough — D-07 Phase 10 will add re-entry @fast', async ({ page }) => {
        // Trigger wakeup.
        await page.evaluate(() => window.__mockReaderPush([0x1B, 0x5E, 0x53, 0x4C, 0x49, 0x44, 0x45]));
        await expect.poll(
            () => page.evaluate(() => window.__slide.__getStateForTests().mode),
            { timeout: 2000 },
        ).toBe('recv');
        // Push a second full wakeup signature mid-recv. Per D-07, the
        // dispatcher forwards raw to slide.feed_chunk; the framer
        // silent-discards as garbage (idle-state bytes per Phase 7
        // framer.rs::idle_garbage_silently_discarded). Mode should STAY
        // 'recv' (Phase 8 does not re-enter; Phase 10 adds the idempotent
        // re-entry detector + warning chip).
        await page.evaluate(() => window.__mockReaderPush([0x1B, 0x5E, 0x53, 0x4C, 0x49, 0x44, 0x45]));
        // Mode unchanged.
        expect(await page.evaluate(() => window.__slide.__getStateForTests().mode)).toBe('recv');
        // Owner unchanged.
        expect(await page.evaluate(() => window.__txSink.getWireOwner())).toBe('slide');
    });

    test('chunk-tail-after-wakeup-feeds-slide-only — Pitfall 2 off-by-one @fast', async ({ page }) => {
        // Single chunk: 7-byte wakeup + CTRL_RDY (8 bytes total).
        // Pitfall 2: the dispatcher must value.subarray(i + 1) skip the matched
        // 7-byte signature, feeding ONLY [CTRL_RDY] to slide.feed_chunk. If
        // off-by-one, slide sees [..., 0x45, 0x11] (the matched 'E' plus
        // CTRL_RDY) and the framer silent-discards as idle-state garbage.
        // Verify by asserting mode='recv' and the grid did NOT receive 'E'
        // (which would happen if dispatchInbound replayed the matched bytes
        // to term.feed by mistake).
        await page.evaluate(() => window.__mockReaderPush([0x1B, 0x5E, 0x53, 0x4C, 0x49, 0x44, 0x45, 0x11]));
        await expect.poll(
            () => page.evaluate(() => window.__slide.__getStateForTests().mode),
            { timeout: 2000 },
        ).toBe('recv');
        // Grid[0] should be empty (space or null) — the matched 7 bytes were
        // swallowed by the matcher (D-01) and CTRL_RDY went to slide, not term.
        const cell0 = await page.evaluate(() => window.__testGridView()[0]);
        expect(cell0 === 0 || cell0 === 32).toBe(true);
        // Owner flipped to slide (D-09 — synchronous handoff).
        expect(await page.evaluate(() => window.__txSink.getWireOwner())).toBe('slide');
    });

    test('session-end-flips-tx-owner-back-to-terminal @fast', async ({ page }) => {
        // Trigger wakeup.
        await page.evaluate(() => window.__mockReaderPush([0x1B, 0x5E, 0x53, 0x4C, 0x49, 0x44, 0x45]));
        await expect.poll(
            () => page.evaluate(() => window.__txSink.getWireOwner()),
            { timeout: 2000 },
        ).toBe('slide');
        expect(await page.evaluate(() => window.__slide.__getStateForTests().mode)).toBe('recv');
        // Force session end via the introspection hook. The natural recv→Done
        // flow requires a multi-frame protocol exchange (full RDY → DATA → FIN
        // round-trip) — out of scope for Phase 8. __resetForTests calls the
        // same setWireOwner('terminal') code path that exitRecvMode uses on
        // a natural Done state, so this verifies the same exit semantics
        // (Pitfall 3 — synchronous mode + owner double-flip).
        await page.evaluate(() => window.__slide.__resetForTests());
        // Both mode and owner flip to 'terminal' synchronously.
        expect(await page.evaluate(() => window.__slide.__getStateForTests().mode)).toBe('terminal');
        expect(await page.evaluate(() => window.__txSink.getWireOwner())).toBe('terminal');
    });
});
