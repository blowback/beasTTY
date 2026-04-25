// BestialiTTY Phase 6 Plan 01 (Wave 0) — SESS-02 selection stubs.
//
// All assertions are test.fixme until later waves un-fixme them as the
// corresponding feature lands. Mirrors Phase 5 Wave 0 discipline.
//
// Sources:
//   - 06-CONTEXT.md D-16 (drag-select + double/triple-click),
//                  D-17 (selection across history boundary),
//                  D-18 (drag-past-edge auto-scroll),
//                  D-19 (selection lifecycle / clear conditions),
//                  D-20 (inverted-glyph render via atlas.getInverted).
//   - 06-VALIDATION.md §Phase Requirements → Test Map (selection row).
//   - Analog: www/tests/transport/connect.spec.js (setup helper shape).
import { test, expect } from '@playwright/test';
import { SERIAL_MOCK } from '../transport/mock-serial.js';

async function setup(page) {
    await page.addInitScript(SERIAL_MOCK);
    await page.goto('/');
    await page.locator('#terminal-wrapper').focus();
    await page.waitForFunction(() => document.getElementById('terminal').width > 0);
}

test.describe('SESS-02 — Selection', () => {
    test.fixme('pointerdown→move→up paints inverted glyphs over selected cells @fast', async ({ page }) => {
        // TODO: live in Wave 3 when selection.js + canvas.js inversion overlay land.
    });

    test.fixme('double-click selects whitespace-bounded word', async ({ page }) => {
        // TODO: live in Wave 3 when selection.js word-boundary logic lands.
    });

    test.fixme('triple-click selects entire row', async ({ page }) => {
        // TODO: live in Wave 3 when selection.js triple-click lands.
    });

    test.fixme('selection clears on post-drag scroll', async ({ page }) => {
        // TODO: live in Wave 3 when selection.js lifecycle lands.
    });

    test.fixme('selection clears on theme toggle', async ({ page }) => {
        // TODO: live in Wave 3 when selection.js lifecycle lands.
    });

    test.fixme('selection clears on focus loss', async ({ page }) => {
        // TODO: live in Wave 3 when selection.js lifecycle lands.
    });

    test.fixme('Esc during in-flight drag cancels selection', async ({ page }) => {
        // TODO: live in Wave 3 when selection.js Esc-cancel intercept lands.
    });

    test.fixme('selection across history boundary stable when scrollback grows mid-drag', async ({ page }) => {
        // TODO: live in Wave 3 when selection.js (scrollback_row_offset_from_live_tail, col) endpoints land.
    });

    test.fixme('drag past top edge auto-scrolls viewport up at ~3 lines/sec', async ({ page }) => {
        // TODO: live in Wave 3 when selection.js drag-past-edge auto-scroll lands.
    });
});
