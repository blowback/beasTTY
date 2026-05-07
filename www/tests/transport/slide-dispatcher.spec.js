// BestialiTTY Phase 8 Plan 01 (Wave 0) — dispatcher routing Playwright stubs.
//
// SLIDE-05: dispatchInbound routes inbound Web Serial bytes to either the
// VT52 parser (terminal mode) or the Slide framer (recv mode), preserving
// the Phase 5 post-feed invariant chain (sampleBell → drainHostReply →
// requestFrame → sessionLog.append) when in terminal mode.
//
// Wave 0 RED gate: all stubs use test.skip(true, ...). Plan 08-04 lights them
// up after Plan 08-02 (Rust façade) and Plan 08-03 (JS dispatcher) ship.
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

    test.skip('terminal-mode-pass-through-byte-identical-to-baseline @fast', async ({ page }) => {
        // TODO Plan 08-04: in default terminal mode, push 'HELLO' bytes; assert the
        // grid renders 'HELLO' and dispatchInbound calls term.feed with the verbatim
        // chunk (no wrapping, no truncation).
        await setup(page);
        expect(true).toBe(true);
    });

    test.skip('post-feed-invariant-BEL-flash-fires-through-dispatcher @fast', async ({ page }) => {
        // TODO Plan 08-04: push 0x07 (BEL) via the dispatcher; assert sampleBell()
        // flashes the canvas (Phase 5 D-31 chain step 1).
        await setup(page);
        expect(true).toBe(true);
    });

    test.skip('post-feed-invariant-ESC-Z-returns-host-reply @fast', async ({ page }) => {
        // TODO Plan 08-04: push 0x1B 0x5A (ESC Z); assert host-reply
        // (ESC / K identify-terminal) is drained and sent via the writer
        // (Phase 5 D-31 chain step 2).
        await setup(page);
        expect(true).toBe(true);
    });

    test.skip('recv-mode-bytes-feed-slide-feed_chunk @fast', async ({ page }) => {
        // TODO Plan 08-04: trigger wakeup, then push a SLIDE control byte (CTRL_RDY)
        // and assert it goes through slide.feed_chunk, not term.feed.
        await setup(page);
        expect(true).toBe(true);
    });

    test.skip('recv-mid-stream-wakeup-passthrough (D-07 — Phase 10 will add re-entry detector) @fast', async ({ page }) => {
        // TODO Plan 08-04: while in recv mode, push the 7-byte wakeup pattern
        // again; assert it is fed to slide.feed_chunk (NOT re-detected as a
        // new wakeup — re-entry detection deferred to Phase 10 per D-07).
        await setup(page);
        expect(true).toBe(true);
    });

    test.skip('recv-completes-via-FIN-flips-mode-to-terminal @fast', async ({ page }) => {
        // TODO Plan 08-04: drive the receiver SM to the Done state via a
        // valid RDY → DATA → FIN sequence; assert mode flips back to 'terminal'
        // and subsequent bytes go to term.feed again.
        await setup(page);
        expect(true).toBe(true);
    });

    test.skip('session-end-flips-tx-owner-back-to-terminal @fast', async ({ page }) => {
        // TODO Plan 08-04: at session end (FIN-FIN exchange complete), assert
        // tx-sink wire-owner is restored to 'terminal' so subsequent keystrokes
        // resume reaching the writer (SLIDE-06 cross-boundary check).
        await setup(page);
        expect(true).toBe(true);
    });

    test.skip('chunk-tail-after-wakeup-feeds-slide-only — Pitfall 2 off-by-one @fast', async ({ page }) => {
        // TODO Plan 08-04: push a single chunk that contains the wakeup
        // followed by additional bytes (e.g. CTRL_RDY); assert the tail is
        // routed to slide.feed_chunk and NOT replayed to term.feed.
        await setup(page);
        expect(true).toBe(true);
    });
});
