// BestialiTTY Phase 8 Plan 01 (Wave 0) — tx-sink wire-owner Playwright stubs.
//
// SLIDE-06: tx-sink gains a wire-owner state ('terminal' | 'slide') and a
// writeSlideFrame(bytes) entry point that bypasses the keystroke ring. While
// owner is 'slide', pushTxBytes silently drops keystroke writes so the SLIDE
// session has exclusive ownership of the wire.
//
// Wave 0 RED gate: all stubs use test.skip(true, ...). Plan 08-04 lights them
// up after Plan 08-02 (Rust façade) and Plan 08-03 (JS dispatcher) ship.
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

test.describe('SLIDE-06 — wire-owner handoff', () => {

    test.skip('default-owner-is-terminal @fast', async ({ page }) => {
        // TODO Plan 08-04: assert tx-sink.getWireOwner() === 'terminal' after boot;
        // pushTxBytes routes to the registered writer normally.
        await setup(page);
        expect(true).toBe(true);
    });

    test.skip('setWireOwner(slide)-silently-drops-pushTxBytes @fast', async ({ page }) => {
        // TODO Plan 08-04: setWireOwner('slide'), then call pushTxBytes(keystroke);
        // assert __mockWriterLog records ZERO entries (silent drop, no throw).
        await setup(page);
        expect(true).toBe(true);
    });

    test.skip('setWireOwner(terminal)-restores-keystroke-write @fast', async ({ page }) => {
        // TODO Plan 08-04: after setWireOwner('slide') then setWireOwner('terminal'),
        // pushTxBytes(keystroke) reaches the writer (entry appears in __mockWriterLog).
        await setup(page);
        expect(true).toBe(true);
    });

    test.skip('writeSlideFrame-bypasses-keystroke-ring @fast', async ({ page }) => {
        // TODO Plan 08-04: writeSlideFrame(bytes) writes immediately to the
        // registered writer regardless of keystroke ring state — bytes appear
        // in __mockWriterLog in the call's program order.
        await setup(page);
        expect(true).toBe(true);
    });

    test.skip('writeSlideFrame-writes-via-registeredWriter @fast', async ({ page }) => {
        // TODO Plan 08-04: assert writeSlideFrame routes through registeredWriter
        // (Phase 5 D-21 coupling), so __mockWriterLog records the bytes verbatim.
        await setup(page);
        expect(true).toBe(true);
    });

    test.skip('invalid-owner-throws @fast', async ({ page }) => {
        // TODO Plan 08-04: setWireOwner('garbage') throws a typed Error
        // (defensive guard — only 'terminal' and 'slide' are valid).
        await setup(page);
        expect(true).toBe(true);
    });
});
