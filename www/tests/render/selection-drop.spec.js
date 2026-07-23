// Beastty Phase 12 Plan 01 — SLIDE-12 — Pointer/drop isolation regression spec.
//
// Closes SLIDE-12: the v1.0 pointer-select must defer to the v1.1 SLIDE
// drag-drop overlay so that drag-drop and selection do not produce ghost
// selections / inverse-text artefacts when both compete for the same canvas.
//
// Sources:
//   - 12-UI-SPEC.md §"SLIDE-12 — Pointer/drop isolation" (locked predicate
//     mechanism: strict-equality read of [data-drop-target] === 'true').
//   - 12-RESEARCH.md §Pitfall 4 (null vs 'false' vs missing semantics for
//     getAttribute — strict equality on the literal string 'true').
//   - 12-PATTERNS.md §"www/input/selection.js" (verbatim 3-line insertion).
//   - 12-VALIDATION.md task IDs 12-XX-01..03 (test names match -g filters
//     `pointerdown.*overlay active`, `regression`, `post-drop`).
//
// Spec-isolation convention (Phase 8/9/10 precedent — see 12-PATTERNS.md
// §Pattern E): this file is self-contained. Helpers (setup, getCellSize)
// are inlined; only the SERIAL_MOCK fixture is imported, mirroring the
// shape of www/tests/session/selection.spec.js.
import { test, expect } from '@playwright/test';
import { SERIAL_MOCK } from '../transport/mock-serial.js';

async function setup(page) {
    await page.addInitScript(SERIAL_MOCK);
    await page.goto('/');
    await page.locator('#terminal-wrapper').focus();
    await page.waitForFunction(() => document.getElementById('terminal').width > 0);
    await page.waitForFunction(() => typeof window.__selection === 'object' && window.__selection !== null);
    // Feed default content so the grid has glyphs to potentially select.
    await page.evaluate(() => {
        const bytes = new TextEncoder().encode('hello world\nfoo bar baz');
        window.__term.feed(bytes);
        window.__term.snapshot_grid();
    });
}

async function getCellSize(page) {
    return await page.evaluate(() => {
        // Phase 6 selection.spec.js precedent — cell size derived from
        // window.__getActiveCellSize(); fallback retained for safety.
        const m = window.__metrics?.cellSize?.();
        return m || { cellW: 9, cellH: 18 };
    });
}

test('SLIDE-12 — onPointerDown does not start selection while drop overlay active', async ({ page }) => {
    await setup(page);

    // Activate the drop overlay programmatically (mirrors what file-source.js
    // setDropTarget does on dragenter).
    await page.evaluate(() => {
        document.getElementById('terminal-wrapper').setAttribute('data-drop-target', 'true');
    });

    const { cellW, cellH } = await getCellSize(page);
    const canvas = page.locator('#terminal');
    const box = await canvas.boundingBox();
    const yMid = box.y + cellH / 2;

    await page.mouse.move(box.x + cellW / 2, yMid);
    await page.mouse.down();
    await page.mouse.move(box.x + cellW * 5 + cellW / 2, yMid);
    await page.mouse.up();

    const sel = await page.evaluate(() => window.__selection.getSelection());
    expect(sel).toBeNull();
    const dragging = await page.evaluate(() => window.__selection.isDragging());
    expect(dragging).toBe(false);
});

test('SLIDE-12 — pointerdown starts selection normally when drop overlay inactive (regression)', async ({ page }) => {
    await setup(page);
    // Overlay is absent by default — assert no surprise leftover state.
    const initial = await page.evaluate(() =>
        document.getElementById('terminal-wrapper').getAttribute('data-drop-target')
    );
    expect(initial).toBeNull();

    const { cellW, cellH } = await getCellSize(page);
    const canvas = page.locator('#terminal');
    const box = await canvas.boundingBox();
    const yMid = box.y + cellH / 2;

    await page.mouse.move(box.x + cellW / 2, yMid);
    await page.mouse.down();
    await page.mouse.move(box.x + cellW * 5 + cellW / 2, yMid);
    await page.mouse.up();

    const sel = await page.evaluate(() => window.__selection.getSelection());
    expect(sel).not.toBeNull();
});

test('SLIDE-12 — post-drop pointer-select works after overlay clears', async ({ page }) => {
    await setup(page);
    // Set then clear the attribute (simulating a drop that completed and
    // cleared the overlay).
    await page.evaluate(() => {
        const w = document.getElementById('terminal-wrapper');
        w.setAttribute('data-drop-target', 'true');
        w.removeAttribute('data-drop-target');
    });

    const { cellW, cellH } = await getCellSize(page);
    const canvas = page.locator('#terminal');
    const box = await canvas.boundingBox();
    const yMid = box.y + cellH / 2;

    await page.mouse.move(box.x + cellW / 2, yMid);
    await page.mouse.down();
    await page.mouse.move(box.x + cellW * 5 + cellW / 2, yMid);
    await page.mouse.up();

    const sel = await page.evaluate(() => window.__selection.getSelection());
    expect(sel).not.toBeNull();
});

// ── E9 S9.3 — drag origination from the terminal selection (AC-1). ──
// A pointerdown INSIDE the committed selection arms a native HTML5 drag
// (canvas draggable + stashed payload) instead of restarting selection;
// dragstart/dragend are dispatched synthetically with an in-page DataTransfer
// (the native drag loop itself is the story's manual T7 checkpoint).
test.describe('E9 S9.3 — selection drag origination', () => {
    // Real cell metrics (window.__getActiveCellSize, CSS px — the session
    // selection.spec.js source). The file-top getCellSize fallback (9×18) is
    // wrong for these specs: row-1 math with a stale cellH lands inside row 0.
    const realCellSize = (page) => page.evaluate(() => window.__getActiveCellSize());

    // Drag-select cols 0..5 on the first row ("hello world" → "hello ").
    async function makeSelection(page) {
        const { cellW, cellH } = await realCellSize(page);
        const canvas = page.locator('#terminal');
        const box = await canvas.boundingBox();
        const yMid = box.y + cellH / 2;
        await page.mouse.move(box.x + cellW / 2, yMid);
        await page.mouse.down();
        await page.mouse.move(box.x + cellW * 5 + cellW / 2, yMid);
        await page.mouse.up();
        const sel = await page.evaluate(() => window.__selection.getSelection());
        expect(sel).not.toBeNull();
        return { box, cellW, cellH, yMid, text: sel.rows.join('\n') };
    }

    const draggable = (page) => page.evaluate(() => document.getElementById('terminal').draggable);
    const selection = (page) => page.evaluate(() => window.__selection.getSelection());

    test('pointerdown inside the selection arms draggable + keeps the selection; click clears it @fast', async ({ page }) => {
        await setup(page);
        const { box, cellW, yMid, text } = await makeSelection(page);
        expect(await draggable(page)).toBe(false);
        // Down INSIDE the committed selection (col 2) — no selection restart.
        await page.mouse.move(box.x + cellW * 2 + cellW / 2, yMid);
        await page.mouse.down();
        expect(await draggable(page)).toBe(true);
        const during = await selection(page);
        expect(during).not.toBeNull();
        expect(during.rows.join('\n')).toBe(text);
        // No dragstart fired → the pointerup is a plain click: deselect + disarm.
        await page.mouse.up();
        expect(await selection(page)).toBeNull();
        expect(await draggable(page)).toBe(false);
    });

    test('pointerdown outside the selection starts a fresh selection as before @fast', async ({ page }) => {
        await setup(page);
        const { box, cellW, cellH } = await makeSelection(page);
        // Down on row 1 ("foo bar baz") — outside the row-0 selection.
        const y2 = box.y + cellH + cellH / 2;
        await page.mouse.move(box.x + cellW / 2, y2);
        await page.mouse.down();
        expect(await draggable(page)).toBe(false);   // origination branch NOT taken
        await page.mouse.move(box.x + cellW * 2 + cellW / 2, y2);
        await page.mouse.up();
        const sel = await selection(page);
        expect(sel.rows).toEqual(['foo']);
    });

    test('dragstart carries the stashed text + notifies observers; dragend resets @fast', async ({ page }) => {
        await setup(page);
        const { box, cellW, yMid, text } = await makeSelection(page);
        await page.evaluate(() => {
            window.__dragEvents = [];
            window.__selection.onSelectionDragState((s) => window.__dragEvents.push(s));
        });
        await page.mouse.move(box.x + cellW * 2 + cellW / 2, yMid);
        await page.mouse.down();
        // Synthetic dragstart with a real DataTransfer (Chromium constructor).
        const payload = await page.evaluate(() => {
            const dt = new DataTransfer();
            const ev = new DragEvent('dragstart', { bubbles: true, cancelable: true, dataTransfer: dt });
            document.getElementById('terminal').dispatchEvent(ev);
            // effectAllowed is not asserted: Chromium only honours the setter on
            // a real drag session's data store, so a synthetic DataTransfer
            // reads back 'none' regardless (only provable in the T7 manual run).
            return { text: dt.getData('text/plain'), prevented: ev.defaultPrevented };
        });
        expect(payload.prevented).toBe(false);
        expect(payload.text).toBe(text);
        expect(await page.evaluate(() => window.__dragEvents)).toEqual([{ active: true, text }]);
        // dragend → observers notified, draggable reset.
        await page.evaluate(() => {
            document.getElementById('terminal').dispatchEvent(new DragEvent('dragend', { bubbles: true }));
        });
        expect(await page.evaluate(() => window.__dragEvents)).toEqual([{ active: true, text }, { active: false }]);
        expect(await draggable(page)).toBe(false);
        await page.mouse.up();
    });

    test('a dragstart not armed by the origination branch is aborted @fast', async ({ page }) => {
        await setup(page);
        // No selection, no armed pointerdown — a stray dragstart is cancelled.
        const prevented = await page.evaluate(() => {
            const ev = new DragEvent('dragstart', { bubbles: true, cancelable: true, dataTransfer: new DataTransfer() });
            document.getElementById('terminal').dispatchEvent(ev);
            return ev.defaultPrevented;
        });
        expect(prevented).toBe(true);
    });

    test('D-19 wrapper blur is skipped while a drag is pending (payload survives); normal blur still clears @fast', async ({ page }) => {
        await setup(page);
        const { box, cellW, yMid } = await makeSelection(page);
        // Arm the drag, then blur the wrapper (what the capture-free mousedown
        // does for real) — the selection must survive to feed dragstart.
        await page.mouse.move(box.x + cellW * 2 + cellW / 2, yMid);
        await page.mouse.down();
        await page.evaluate(() => {
            document.getElementById('terminal-wrapper').dispatchEvent(new FocusEvent('blur'));
        });
        expect(await selection(page)).not.toBeNull();
        await page.mouse.up();   // plain click → deselect + disarm
        expect(await selection(page)).toBeNull();
        // Regression: with no drag pending, wrapper blur still clears (D-19).
        await makeSelection(page);
        await page.evaluate(() => {
            document.getElementById('terminal-wrapper').dispatchEvent(new FocusEvent('blur'));
        });
        expect(await selection(page)).toBeNull();
    });
});
