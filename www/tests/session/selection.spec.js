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
        await page.locator('#theme-toggle').click();
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
});
