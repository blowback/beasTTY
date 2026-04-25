// BestialiTTY Phase 6 Plan 01 (Wave 0) — SESS-06 clear-screen stubs.
//
// All assertions are test.fixme until later waves un-fixme them as the
// corresponding feature lands. Mirrors Phase 5 Wave 0 discipline.
//
// Sources:
//   - 06-CONTEXT.md D-04 (snap-to-bottom triggers — clear-screen is one),
//                  D-26 (top-bar Clear / Shift+click clears scrollback /
//                        clear_visible() does NOT feed ESC J).
//   - 06-VALIDATION.md §Phase Requirements → Test Map (clear-screen row).
//   - Analog: www/tests/render/grid.spec.js (grid-byte assertions via __testGridView).
import { test, expect } from '@playwright/test';
import { SERIAL_MOCK } from '../transport/mock-serial.js';

async function setup(page) {
    await page.addInitScript(SERIAL_MOCK);
    await page.goto('/');
    await page.locator('#terminal-wrapper').focus();
    await page.waitForFunction(() => document.getElementById('terminal').width > 0);
}

test.describe('SESS-06 — Clear screen', () => {
    test.fixme('top-bar Clear wipes 80x24 grid; scrollback intact @fast', async ({ page }) => {
        // TODO: live in Wave 4 when clear-screen.js + clear_visible() Rust API land.
    });

    test.fixme('Shift+click Clear also wipes scrollback (resize_scrollback(0)→10000)', async ({ page }) => {
        // TODO: live in Wave 4 when clear-screen.js Shift+click branch lands.
    });

    test.fixme('clear_visible() does NOT feed \\x1B\\x4A — parser state untouched', async ({ page }) => {
        // TODO: live in Wave 4 when clear-screen.js calls clear_visible (NOT term.feed b"\x1bJ").
    });

    test.fixme('clear-screen is a snap-to-bottom trigger when user is scrolled up', async ({ page }) => {
        // TODO: live in Wave 4 when clear-screen.js wires snap-to-bottom on click.
    });
});
