// BestialiTTY Phase 8 Plan 01 (Wave 0) — wakeup matcher Playwright stubs.
//
// SLIDE-17: 7-byte ESC ^ S L I D E wakeup detection across torn Web Serial
// chunk boundaries via single-byte carry flag (CONTEXT D-01 match-index counter
// in module-scope state at www/transport/slide.js).
//
// Wave 0 RED gate: all stubs use test.skip(true, ...). Plan 08-04 lights them
// up after Plan 08-02 (Rust façade) and Plan 08-03 (JS dispatcher) ship.
//
// Sources:
//   - 08-CONTEXT.md D-01, D-02, D-03 (matcher + replay-on-fail + ESC^ lore).
//   - 08-VALIDATION.md §"Test Corpus for the 7-Byte Wakeup Matcher".
//   - 08-PATTERNS.md §"www/tests/transport/slide-wakeup.spec.js (NEW)".
//   - Analog: www/tests/transport/readloop.spec.js (setup helper verbatim).

import { test, expect } from '@playwright/test';
import { SERIAL_MOCK } from './mock-serial.js';

const WAKEUP_BYTES = [0x1B, 0x5E, 0x53, 0x4C, 0x49, 0x44, 0x45]; // ESC ^ S L I D E

async function setup(page) {
    await page.addInitScript(SERIAL_MOCK);
    await page.goto('/');
    await page.locator('#terminal-wrapper').focus();
    await page.waitForFunction(() => document.getElementById('terminal').width > 0);
    await page.locator('#connection').evaluate((el) => { el.open = true; });
}

test.describe('SLIDE-17 — 7-byte ESC ^ S L I D E wakeup', () => {

    test.skip('full-match-single-chunk @fast', async ({ page }) => {
        // TODO Plan 08-04: push WAKEUP_BYTES in one chunk; assert mode === 'recv'.
        await setup(page);
        void WAKEUP_BYTES;
        expect(true).toBe(true);
    });

    // Torn-chunk corpus: split-1/6 .. split-6/1 enumerated as individual
    // test.skip declarations (rather than a for-loop) so each stub appears
    // as a discrete source line and grep -c "test.skip" reflects the full
    // runtime test count (per 08-01-PLAN.md acceptance criteria).

    test.skip('torn-chunk-split-1/6 @fast', async ({ page }) => {
        // TODO Plan 08-04: push WAKEUP_BYTES.slice(0, 1), then .slice(1);
        // assert mode === 'recv' after second chunk.
        await setup(page);
        void WAKEUP_BYTES;
        expect(true).toBe(true);
    });

    test.skip('torn-chunk-split-2/5 @fast', async ({ page }) => {
        // TODO Plan 08-04: push WAKEUP_BYTES.slice(0, 2), then .slice(2);
        // assert mode === 'recv' after second chunk.
        await setup(page);
        void WAKEUP_BYTES;
        expect(true).toBe(true);
    });

    test.skip('torn-chunk-split-3/4 @fast', async ({ page }) => {
        // TODO Plan 08-04: push WAKEUP_BYTES.slice(0, 3), then .slice(3);
        // assert mode === 'recv' after second chunk.
        await setup(page);
        void WAKEUP_BYTES;
        expect(true).toBe(true);
    });

    test.skip('torn-chunk-split-4/3 @fast', async ({ page }) => {
        // TODO Plan 08-04: push WAKEUP_BYTES.slice(0, 4), then .slice(4);
        // assert mode === 'recv' after second chunk.
        await setup(page);
        void WAKEUP_BYTES;
        expect(true).toBe(true);
    });

    test.skip('torn-chunk-split-5/2 @fast', async ({ page }) => {
        // TODO Plan 08-04: push WAKEUP_BYTES.slice(0, 5), then .slice(5);
        // assert mode === 'recv' after second chunk.
        await setup(page);
        void WAKEUP_BYTES;
        expect(true).toBe(true);
    });

    test.skip('torn-chunk-split-6/1 @fast', async ({ page }) => {
        // TODO Plan 08-04: push WAKEUP_BYTES.slice(0, 6), then .slice(6);
        // assert mode === 'recv' after second chunk.
        await setup(page);
        void WAKEUP_BYTES;
        expect(true).toBe(true);
    });

    test.skip('torn-chunk-split-7/0 (full match in chunk 1) @fast', async ({ page }) => {
        // TODO Plan 08-04: push all 7 bytes in chunk 1, no chunk 2; assert mode === 'recv'.
        await setup(page);
        void WAKEUP_BYTES;
        expect(true).toBe(true);
    });

    test.skip('benign-ESC-caret-A — no wakeup, replay preserves baseline @fast', async ({ page }) => {
        // TODO Plan 08-04: push [ESC, ^, A]; assert mode === 'terminal' and term grid shows the bytes.
        await setup(page);
        expect(true).toBe(true);
    });

    test.skip('benign-mid-match-X — replay swallowed prefix in original order @fast', async ({ page }) => {
        // TODO Plan 08-04: push [ESC, ^, S, L, X]; assert all bytes reach term.feed in original order.
        await setup(page);
        expect(true).toBe(true);
    });

    test.skip('reprocess-from-idx-0 — ESC^ ESC^ S L I D E detects second wakeup (D-02 critical clause) @fast', async ({ page }) => {
        // TODO Plan 08-04: push [ESC, ^, ESC, ^, S, L, I, D, E]; assert first ESC ^ replays
        // to term.feed, second ESC ^ S L I D E triggers wakeup (mode === 'recv').
        await setup(page);
        expect(true).toBe(true);
    });

    test.skip('benign-isolated-caret — no leading ESC, matcher never advances @fast', async ({ page }) => {
        // TODO Plan 08-04: push [^, S, L, I, D, E]; assert wakeIdx stays 0; bytes reach term.feed unchanged.
        await setup(page);
        expect(true).toBe(true);
    });

    test.skip('benign-isolated-ESC — incomplete escape recovers via vte @fast', async ({ page }) => {
        // TODO Plan 08-04: push [ESC] then [A]; assert wakeIdx flushes after second chunk; bytes reach term.feed.
        await setup(page);
        expect(true).toBe(true);
    });
});
