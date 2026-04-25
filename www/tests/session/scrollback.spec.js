// BestialiTTY Phase 6 Plan 01 (Wave 0) — SESS-01 scrollback navigation stubs.
//
// All assertions are test.fixme until later waves un-fixme them as the
// corresponding feature lands. Mirrors Phase 5 Wave 0 discipline.
//
// Sources:
//   - 06-CONTEXT.md D-01 (wheel + Shift+PgUp/PgDn input model),
//                  D-02 (wheel sensitivity / trackpad accumulator),
//                  D-03 (stick-to-bottom + chip),
//                  D-04 (snap-to-bottom triggers),
//                  D-05 (Shift+Home jump-to-top),
//                  D-07 (newLinesSinceUserScrolled cadence),
//                  D-09 (cursor hidden while scrolled up),
//                  D-10 (BEL while scrolled up — title prefix only),
//                  D-12 (wheel over chrome panes scrolls pane content),
//                  D-13 (theme toggle keeps row offset).
//   - 06-VALIDATION.md §Phase Requirements → Test Map (scrollback row).
//   - Analog: www/tests/transport/connect.spec.js (setup helper shape).
import { test, expect } from '@playwright/test';
import { SERIAL_MOCK } from '../transport/mock-serial.js';

async function setup(page) {
    await page.addInitScript(SERIAL_MOCK);
    await page.goto('/');
    await page.locator('#terminal-wrapper').focus();
    await page.waitForFunction(() => document.getElementById('terminal').width > 0);
}

test.describe('SESS-01 — Scrollback navigation', () => {
    test.fixme('wheel up scrolls offset; chip appears @fast', async ({ page }) => {
        // TODO: live in Wave 2 when scroll-state.js + chip DOM land.
    });

    test.fixme('Shift+PgUp pages back 24 lines', async ({ page }) => {
        // TODO: live in Wave 2 when scroll-state.js keyboard intercept lands.
    });

    test.fixme('Shift+PgDn pages forward 24 lines', async ({ page }) => {
        // TODO: live in Wave 2 when scroll-state.js keyboard intercept lands.
    });

    test.fixme('Shift+End snaps to live tail @fast', async ({ page }) => {
        // TODO: live in Wave 2 when scroll-state.js snap-to-bottom triggers land.
    });

    test.fixme('Shift+Home jumps to top of scrollback', async ({ page }) => {
        // TODO: live in Wave 2 when scroll-state.js jump-to-top trigger lands.
    });

    test.fixme('chip increments newLinesSinceUserScrolled on every term.feed with newline', async ({ page }) => {
        // TODO: live in Wave 2 when scroll-state.js notifyFeed cadence lands.
    });

    test.fixme('theme toggle while scrolled-up keeps row offset', async ({ page }) => {
        // TODO: live in Wave 2 when scroll-state.js + canvas.js scroll-aware tick land.
    });

    test.fixme('clicking chip snaps to live tail', async ({ page }) => {
        // TODO: live in Wave 2 when scroll-state.js snap-to-bottom + chip DOM land.
    });

    test.fixme('wheel over #settings pane scrolls pane content, not scrollback', async ({ page }) => {
        // TODO: live in Wave 2 when scroll-state.js wheel listener attachment point lands.
    });

    test.fixme('cursor hidden while scrolled up', async ({ page }) => {
        // TODO: live in Wave 2 when canvas.js scroll-aware cursor branch lands.
    });

    test.fixme('BEL while scrolled up: title prefix only, no viewport flash', async ({ page }) => {
        // TODO: live in Wave 2 when canvas.js skips visible-bell flash while scrolled up.
    });
});
