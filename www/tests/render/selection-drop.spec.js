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
