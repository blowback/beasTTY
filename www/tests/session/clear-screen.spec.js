// Beastty Phase 6 Plan 05 (Wave 4) — SESS-06 clear-screen tests.
//
// Wave 0 stubs un-fixmed. Production code (Epic E1 Story E1.5 relocation):
//   - www/renderer/menu-bar.js (clearScreen / clearScrollback + runViewAction
//     dispatch — clear_visible / resize_scrollback / snapToBottom / requestFrame).
//   - www/index.html (View ▸ Clear Screen / Clear Scrollback… + confirm dialog).
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
    await page.waitForFunction(() => typeof window.__term === 'object' && window.__term !== null);
    await page.waitForFunction(() => typeof window.__scrollState === 'object' && window.__scrollState !== null);
    // Epic E1 Story E1.5 — Clear Screen / Clear Scrollback… are now View-menu
    // items (the incumbent #clear-button / #clear-scrollback-button are retired).
    await page.waitForFunction(() => window.__menuBar && typeof window.__menuBar.open === 'function');
}

// Epic E1 Story E1.5 — drive a View ▸ action item (clear-screen / clear-scrollback).
async function clickViewAction(page, action, opts = {}) {
    await page.evaluate(() => window.__menuBar.open('view'));
    await page.click(`#dropdown-view .menu-item[data-action="${action}"]`, opts);
}

// Helper — read every cell's char byte from the visible 80x24 grid (after
// snapshot_grid()). Cell layout is 8 bytes/cell (Cell::BLANK.ch = 0x20 space
// per crate::grid::Cell::BLANK). Returns true if every cell holds 0x20.
function isVisibleAllBlank() {
    window.__term.snapshot_grid();
    const view = window.__testGridView();
    for (let i = 0; i < view.length; i += 8) {
        if (view[i] !== 0x20) return false;
    }
    return true;
}

test.describe('SESS-06 — Clear screen', () => {
    test('View ▸ Clear Screen wipes 80x24 grid; scrollback intact @fast', async ({ page }) => {
        await setup(page);
        // Feed 100 lines so scrollback is non-empty AND visible grid has content.
        await page.evaluate(() => {
            const s = Array.from({ length: 100 }, (_, i) => `line ${i}\r\n`).join('');
            window.__term.feed(new TextEncoder().encode(s));
            window.__requestFrame();
        });
        await clickViewAction(page, 'clear-screen');
        // Visible grid: every cell should be BLANK (Cell::BLANK.ch = 0x20).
        const allBlank = await page.evaluate(isVisibleAllBlank);
        expect(allBlank).toBe(true);
        // Scrollback intact: snapshot_grid_at(N) for some N > 0 should still
        // produce non-empty content.
        const hasHistory = await page.evaluate(() => {
            window.__term.snapshot_grid_at(50);
            const view = window.__testGridView();
            for (let i = 0; i < view.length; i += 8) {
                if (view[i] !== 0x20) return true;
            }
            return false;
        });
        expect(hasHistory).toBe(true);
    });

    test('Shift+activate Clear Screen also wipes scrollback (resize_scrollback(0)→10000)', async ({ page }) => {
        await setup(page);
        await page.evaluate(() => {
            const s = Array.from({ length: 100 }, (_, i) => `line ${i}\r\n`).join('');
            window.__term.feed(new TextEncoder().encode(s));
            window.__requestFrame();
        });
        await clickViewAction(page, 'clear-screen', { modifiers: ['Shift'] });
        // Visible grid blank.
        const allBlank = await page.evaluate(isVisibleAllBlank);
        expect(allBlank).toBe(true);
        // Scrollback also wiped — every cell at offset 50 should now be blank
        // because resize_scrollback(0) dropped the historical rows; the
        // snapshot_grid_at(50) call clamps to the live tail (offset 0
        // equivalent), which IS the freshly-cleared visible grid → all blank.
        const noHistory = await page.evaluate(() => {
            window.__term.snapshot_grid_at(50);
            const view = window.__testGridView();
            for (let i = 0; i < view.length; i += 8) {
                if (view[i] !== 0x20) return false;
            }
            return true;
        });
        expect(noHistory).toBe(true);
    });

    test('clear_visible() does NOT feed \\x1B\\x4A — parser state untouched', async ({ page }) => {
        await setup(page);
        // Put parser in EscState by feeding bare ESC.
        await page.evaluate(() => {
            window.__term.feed(new Uint8Array([0x1B]));
            // Drain any pre-existing host reply so the post-Z assertion is
            // about THIS Z (not whatever leftover the boot path produced).
            window.__term.clear_host_reply();
        });
        await clickViewAction(page, 'clear-screen');
        // Now feed 'Z' — if parser preserved its EscState, this completes ESC Z
        // (identify query) and host_reply will contain [0x1B, 0x2F, 0x4B] (ESC / K).
        // Phase 1 PARSER-05.
        const reply = await page.evaluate(() => {
            window.__term.feed(new Uint8Array([0x5A]));   // 'Z'
            const len = window.__term.host_reply_len();
            const ptr = window.__term.host_reply_ptr();
            const buf = new Uint8Array(window.__wasm.memory.buffer, ptr, len);
            return Array.from(buf);
        });
        expect(reply).toEqual([0x1B, 0x2F, 0x4B]);   // ESC / K
    });

    test('clear-screen is a snap-to-bottom trigger when user is scrolled up', async ({ page }) => {
        await setup(page);
        await page.evaluate(() => {
            const s = Array.from({ length: 100 }, (_, i) => `line ${i}\r\n`).join('');
            window.__term.feed(new TextEncoder().encode(s));
            window.__scrollState.scrollByLines(20);
        });
        await expect(page.locator('#terminal-wrapper')).toHaveAttribute('data-scrolled-back', 'true');
        await clickViewAction(page, 'clear-screen');
        await expect(page.locator('#terminal-wrapper')).not.toHaveAttribute('data-scrolled-back');
    });
});

// Epic E1 Story E1.5 (FR-11) — the Settings 'Clear scrollback' button relocated
// to View ▸ Clear Scrollback…, now behind a deliberate-friction confirm. These
// oracles pin its incumbent behavior AFTER confirming: it cycles
// resize_scrollback(0)→10000, snaps to the live tail (D-04), but — unlike Clear
// Screen — leaves the VISIBLE grid untouched (D-15). [Source: menu-bar.js
// clearScrollback / runViewAction; main.js confirmClearScrollback (openModal);
// index.html #dropdown-view + #clear-scrollback-confirm]
test.describe('SESS-06 — Clear scrollback (View ▸ Clear Scrollback…)', () => {
    async function confirmClearScrollback(page) {
        await clickViewAction(page, 'clear-scrollback');
        await page.locator('#clear-scrollback-confirm').waitFor({ state: 'visible' });
        await page.click('#clear-scrollback-confirm-ok');   // value="confirm"
        await page.waitForTimeout(50);                       // let the resolved promise run clearScrollback
    }

    test('Clear scrollback leaves the visible 80x24 grid untouched @fast', async ({ page }) => {
        await setup(page);
        await page.evaluate(() => {
            const s = Array.from({ length: 100 }, (_, i) => `line ${i}\r\n`).join('');
            window.__term.feed(new TextEncoder().encode(s));
            window.__requestFrame();
        });
        await confirmClearScrollback(page);
        // Visible grid is UNAFFECTED (D-15) — the last-fed lines are still shown.
        // This is the behavioral fingerprint distinguishing it from Clear Screen.
        const allBlank = await page.evaluate(isVisibleAllBlank);
        expect(allBlank).toBe(false);
    });

    test('Clear scrollback snaps to live tail when the user is scrolled up @fast', async ({ page }) => {
        await setup(page);
        await page.evaluate(() => {
            const s = Array.from({ length: 100 }, (_, i) => `line ${i}\r\n`).join('');
            window.__term.feed(new TextEncoder().encode(s));
            window.__scrollState.scrollByLines(20);
        });
        await expect(page.locator('#terminal-wrapper')).toHaveAttribute('data-scrolled-back', 'true');
        await confirmClearScrollback(page);
        // D-04 snap-to-bottom trigger — scrolled-up state cleared.
        await expect(page.locator('#terminal-wrapper')).not.toHaveAttribute('data-scrolled-back');
    });
});
