// Beastty Phase 6 Plan 04 (Wave 3) — SESS-02 selection tests.
//
// Wave 3 un-fixmes the 9 selection stubs (Plan 06-01 created them as test.fixme).
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
    await page.waitForFunction(() => typeof window.__selection === 'object' && window.__selection !== null);
    // Feed default content so the grid has glyphs to select.
    await page.evaluate(() => {
        const bytes = new TextEncoder().encode('hello world\nfoo bar baz\nthe entire line');
        window.__term.feed(bytes);
        // Force a snapshot so canvas grid view reflects fed content.
        window.__term.snapshot_grid();
    });
}

async function getCellSize(page) {
    return await page.evaluate(() => window.__getActiveCellSize());
}

test.describe('SESS-02 — Selection', () => {
    test('pointerdown→move→up creates non-empty selection @fast', async ({ page }) => {
        await setup(page);
        const { cellW, cellH } = await getCellSize(page);
        const canvas = page.locator('#terminal');
        const box = await canvas.boundingBox();
        // Drag from col 0 to col 5 on row 0.
        const yMid = box.y + cellH / 2;
        await page.mouse.move(box.x + cellW / 2, yMid);
        await page.mouse.down();
        await page.mouse.move(box.x + cellW * 5 + cellW / 2, yMid);
        await page.mouse.up();
        const sel = await page.evaluate(() => window.__selection.getSelection());
        expect(sel).not.toBeNull();
        expect(sel.rows.length).toBeGreaterThan(0);
        expect(sel.rows[0].length).toBeGreaterThan(0);
    });

    test('double-click selects whitespace-bounded word', async ({ page }) => {
        await setup(page);
        const { cellW, cellH } = await getCellSize(page);
        const canvas = page.locator('#terminal');
        const box = await canvas.boundingBox();
        // Double-click on column 2 of row 0 — inside the word "hello".
        const x = box.x + cellW * 2 + cellW / 2;
        const y = box.y + cellH / 2;
        await page.mouse.dblclick(x, y);
        const sel = await page.evaluate(() => window.__selection.getSelection());
        expect(sel).not.toBeNull();
        expect(sel.rows[0]).toBe('hello');
    });

    test('triple-click selects entire row', async ({ page }) => {
        await setup(page);
        const { cellW, cellH } = await getCellSize(page);
        const canvas = page.locator('#terminal');
        const box = await canvas.boundingBox();
        // Triple-click on row 2 (where "the entire line" was fed).
        const x = box.x + cellW * 4 + cellW / 2;
        const y = box.y + cellH * 2 + cellH / 2;
        await page.mouse.click(x, y);
        await page.mouse.click(x, y);
        await page.mouse.click(x, y);
        const sel = await page.evaluate(() => window.__selection.getSelection());
        expect(sel).not.toBeNull();
        expect(sel.rows[0]).toContain('the entire line');
    });

    test('selection clears on post-drag scroll', async ({ page }) => {
        await setup(page);
        // Real scrollback so scrollByLines(5) actually moves (the offset is
        // clamped to total_len - visible_rows; with no history it would no-op).
        await page.evaluate(() => {
            window.__term.feed(new TextEncoder().encode(Array.from({ length: 40 }, (_, i) => `x${i}`).join('\n')));
            window.__term.snapshot_grid();
        });
        const { cellW, cellH } = await getCellSize(page);
        const canvas = page.locator('#terminal');
        const box = await canvas.boundingBox();
        const yMid = box.y + cellH / 2;
        await page.mouse.move(box.x + cellW / 2, yMid);
        await page.mouse.down();
        await page.mouse.move(box.x + cellW * 5 + cellW / 2, yMid);
        await page.mouse.up();
        let sel = await page.evaluate(() => window.__selection.getSelection());
        expect(sel).not.toBeNull();
        // Trigger scroll AFTER drag.
        await page.evaluate(() => window.__scrollState.scrollByLines(5));
        sel = await page.evaluate(() => window.__selection.getSelection());
        expect(sel).toBeNull();
    });

    test('selection clears on theme toggle', async ({ page }) => {
        await setup(page);
        const { cellW, cellH } = await getCellSize(page);
        const canvas = page.locator('#terminal');
        const box = await canvas.boundingBox();
        const yMid = box.y + cellH / 2;
        await page.mouse.move(box.x + cellW / 2, yMid);
        await page.mouse.down();
        await page.mouse.move(box.x + cellW * 5 + cellW / 2, yMid);
        await page.mouse.up();
        let sel = await page.evaluate(() => window.__selection.getSelection());
        expect(sel).not.toBeNull();
        // Epic E1 Story E1.4 — the D-19 selection-clear rehomed from #theme-toggle
        // onto the View ▸ Theme menu action. Selecting a theme clears the
        // selection (retainFocus keeps terminal focus, so this is the D-19 path,
        // not a focus-loss clear).
        await page.evaluate(() => window.__menuBar.open('view'));
        await page.click('#dropdown-view .menu-item[data-submenu="theme"]');
        await page.click('#dropdown-view .submenu[data-submenu-panel="theme"] .menu-item[data-value="clean"]');
        sel = await page.evaluate(() => window.__selection.getSelection());
        expect(sel).toBeNull();
    });

    test('selection clears on focus loss', async ({ page }) => {
        await setup(page);
        const { cellW, cellH } = await getCellSize(page);
        const canvas = page.locator('#terminal');
        const box = await canvas.boundingBox();
        const yMid = box.y + cellH / 2;
        await page.mouse.move(box.x + cellW / 2, yMid);
        await page.mouse.down();
        await page.mouse.move(box.x + cellW * 5 + cellW / 2, yMid);
        await page.mouse.up();
        let sel = await page.evaluate(() => window.__selection.getSelection());
        expect(sel).not.toBeNull();
        // Move focus away from the wrapper.
        await page.evaluate(() => document.getElementById('terminal-wrapper').blur());
        sel = await page.evaluate(() => window.__selection.getSelection());
        expect(sel).toBeNull();
    });

    test('Esc during in-flight drag cancels selection', async ({ page }) => {
        await setup(page);
        const { cellW, cellH } = await getCellSize(page);
        const canvas = page.locator('#terminal');
        const box = await canvas.boundingBox();
        const yMid = box.y + cellH / 2;
        await page.mouse.move(box.x + cellW / 2, yMid);
        await page.mouse.down();
        await page.mouse.move(box.x + cellW * 5 + cellW / 2, yMid);
        // Mid-drag — verify dragging.
        const draggingMid = await page.evaluate(() => window.__selection.isDragging());
        expect(draggingMid).toBe(true);
        await page.keyboard.press('Escape');
        // After Esc — drag cancelled, selection cleared.
        const draggingAfter = await page.evaluate(() => window.__selection.isDragging());
        expect(draggingAfter).toBe(false);
        const sel = await page.evaluate(() => window.__selection.getSelection());
        expect(sel).toBeNull();
        // Release the held mouse to restore baseline state.
        await page.mouse.up();
    });

    test('selection across history boundary stable when scrollback grows mid-drag', async ({ page }) => {
        await setup(page);
        const { cellW, cellH } = await getCellSize(page);
        const canvas = page.locator('#terminal');
        const box = await canvas.boundingBox();
        const yMid = box.y + cellH / 2;
        await page.mouse.move(box.x + cellW / 2, yMid);
        await page.mouse.down();
        await page.mouse.move(box.x + cellW * 5 + cellW / 2, yMid);
        // Capture the row's tail-relative offset before scrollback grows.
        const rangeBefore = await page.evaluate(() => {
            const r = window.__selection.getActiveRange();
            return r ? { anchor: r.anchor, focus: r.focus } : null;
        });
        expect(rangeBefore).not.toBeNull();
        // Push lines into scrollback (simulates new RX bytes mid-drag).
        await page.evaluate(() => {
            const bytes = new TextEncoder().encode('\n'.repeat(5));
            window.__term.feed(bytes);
            window.__term.snapshot_grid();
        });
        await page.mouse.up();
        const rangeAfter = await page.evaluate(() => {
            const r = window.__selection.getActiveRange();
            return r ? { anchor: r.anchor, focus: r.focus } : null;
        });
        // Tail-relative endpoints must be unchanged (the row those endpoints
        // refer to has just moved further from the live tail).
        expect(rangeAfter.anchor.rowOffsetFromTail).toBe(rangeBefore.anchor.rowOffsetFromTail);
        expect(rangeAfter.anchor.col).toBe(rangeBefore.anchor.col);
    });

    test('drag past top edge auto-scrolls viewport up', async ({ page }) => {
        await setup(page);
        const { cellW, cellH } = await getCellSize(page);
        // Pre-populate scrollback so there is something to scroll up into.
        await page.evaluate(() => {
            const lines = Array.from({ length: 60 }, (_, i) => `scroll-line-${i}`).join('\n');
            window.__term.feed(new TextEncoder().encode(lines));
            window.__term.snapshot_grid();
        });
        const canvas = page.locator('#terminal');
        const box = await canvas.boundingBox();
        const offBefore = await page.evaluate(() => window.__scrollState.getOffset());
        // Start drag inside canvas.
        await page.mouse.move(box.x + cellW * 2, box.y + cellH * 2);
        await page.mouse.down();
        // Move pointer ABOVE the canvas top — pointermove handler must trigger
        // scrollState.scrollByLines(+1).
        await page.mouse.move(box.x + cellW * 2, box.y - 20);
        // Several moves to ensure multiple ticks.
        for (let i = 0; i < 5; i++) {
            await page.mouse.move(box.x + cellW * 2, box.y - 20 - i);
        }
        await page.mouse.up();
        const offAfter = await page.evaluate(() => window.__scrollState.getOffset());
        expect(offAfter).toBeGreaterThan(offBefore);
    });

    // Regression: copying a selection made while scrolled back returned rows from
    // ~one screen (visibleRows-1) BELOW what was highlighted. readRowText's
    // scrollback branch snapshotted the window that lands tail-offset T at the TOP
    // row, but then read the BOTTOM row (tail-offset T-(visibleRows-1)).
    test('copy of a scrolled-back selection returns the highlighted row, not one screen below @fast', async ({ page }) => {
        await page.addInitScript(SERIAL_MOCK);
        await page.goto('/');
        await page.locator('#terminal-wrapper').focus();
        await page.waitForFunction(() => document.getElementById('terminal').width > 0);
        await page.waitForFunction(() => typeof window.__selection === 'object' && window.__selection !== null);

        // Fresh grid total_len is 24 (blank). Feed 60 uniquely-tagged lines →
        // total_len 60, absolute rows 0..59 = ROW-00..ROW-59. Live tail shows
        // ROW-36..ROW-59; the rest is scrollback.
        await page.evaluate(() => {
            const lines = Array.from({ length: 60 }, (_, i) => `ROW-${String(i).padStart(2, '0')}`);
            window.__term.feed(new TextEncoder().encode(lines.join('\n')));
            window.__term.snapshot_grid();
        });

        // Scroll back 30 rows. Viewport now shows absolute [6..29] = ROW-06 (top
        // viewport row) .. ROW-29 (bottom viewport row).
        await page.evaluate(() => window.__scrollState.scrollByLines(30));
        expect(await page.evaluate(() => window.__scrollState.getOffset())).toBe(30);

        const { cellW, cellH } = await getCellSize(page);
        const box = await page.locator('#terminal').boundingBox();
        const tripleClick = async (viewportRow) => {
            const x = box.x + cellW * 2 + cellW / 2;
            const y = box.y + cellH * viewportRow + cellH / 2;
            await page.mouse.click(x, y);
            await page.mouse.click(x, y);
            await page.mouse.click(x, y);
            return page.evaluate(() => window.__selection.getSelection());
        };

        // Top viewport row (row 0) = tail-offset 30+23 = 53 → the scrollback
        // branch. Must copy ROW-06 (highlighted), NOT ROW-29 (the pre-fix
        // bottom-row read, exactly visibleRows-1 = 23 lines more recent).
        const top = await tripleClick(0);
        expect(top).not.toBeNull();
        expect(top.rows[0]).toBe('ROW-06');

        // Bottom viewport row (row 23) = tail-offset 30 → ROW-29. Confirms the
        // mapping is monotonic and correctly spaced across the whole viewport.
        const bottom = await tripleClick(23);
        expect(bottom.rows[0]).toBe('ROW-29');

        // Over-scroll must CLAMP (total 60 - 24 rows → maxOffset 36) rather than
        // run the offset out of range. At max scroll the top row is the oldest
        // retained line ROW-00, and copy still matches display (no blank rows —
        // the pre-clamp bug over-scrolled and copied blank/mismatched lines).
        await page.evaluate(() => window.__scrollState.scrollByLines(1000));
        expect(await page.evaluate(() => window.__scrollState.getOffset())).toBe(36);
        const oldest = await tripleClick(0);
        expect(oldest.rows[0]).toBe('ROW-00');
    });
});
