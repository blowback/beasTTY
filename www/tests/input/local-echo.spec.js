// Phase 4 Plan 04 — INPUT-04 — Local echo toggle default OFF; flip ON renders typed char.
import { test, expect } from '@playwright/test';

// Cell layout from Phase 1 Plan 04: 8 bytes/cell, [ch, fg, bg, attr, ...].
// Grid is 24 rows × 80 cols. Cell (0, 0) char byte is at offset 0.

async function setup(page) {
    await page.goto('/');
    await page.locator('#terminal-wrapper').focus();
    await page.waitForFunction(() => document.getElementById('terminal').width > 0);
    await page.waitForFunction(() => typeof window.__testGridView === 'function');
    await page.locator('#settings').evaluate((el) => { el.open = true; });
    await page.locator('#debug').evaluate((el) => { el.open = true; });
    await page.locator('#tx-reset').click();
}

test.describe('INPUT-04 — Local echo toggle', () => {
    test('default OFF — typed key does NOT render on grid @fast', async ({ page }) => {
        await setup(page);
        // Confirm default state.
        await expect(page.locator('#local-echo')).not.toBeChecked();

        // Sanity: cell (0,0) is empty (0x00 or 0x20 depending on wasm init; key.rs
        // has no state, grid starts cleared per Phase 1 Plan 04 D-01).
        const before = await page.evaluate(() => window.__testGridView()[0]);

        await page.locator('#terminal-wrapper').focus();
        await page.keyboard.press('Shift+KeyA');

        // TX-side fired (encoder path works):
        await expect(page.locator('#tx-strip')).toHaveText('41');

        // RX-side UNCHANGED (local-echo is off):
        const after = await page.evaluate(() => window.__testGridView()[0]);
        expect(after).toBe(before);
    });

    test('ON — typed key renders on grid', async ({ page }) => {
        await setup(page);
        await page.locator('#local-echo').check();
        await expect(page.locator('#local-echo')).toBeChecked();

        await page.locator('#terminal-wrapper').focus();
        await page.keyboard.press('Shift+KeyA');

        // Wait briefly for the rAF-driven render tick to complete.
        await page.waitForTimeout(80);

        // TX-side fired:
        await expect(page.locator('#tx-strip')).toHaveText('41');
        // RX-side: cell (0,0) char byte === 'A' (0x41).
        const ch = await page.evaluate(() => window.__testGridView()[0]);
        expect(ch).toBe(0x41);
    });

    test('OFF → ON → OFF flip preserves the correct behaviour each time', async ({ page }) => {
        await setup(page);
        // OFF — no render.
        await page.locator('#terminal-wrapper').focus();
        await page.keyboard.press('Shift+KeyB');
        await page.waitForTimeout(50);
        const offCh = await page.evaluate(() => window.__testGridView()[0]);
        expect(offCh).not.toBe(0x42);

        // ON — renders at whatever the cursor position is after the OFF press
        // (arrow-less + OFF means no cursor change — cursor still at (0,0)).
        await page.locator('#local-echo').check();
        await page.locator('#terminal-wrapper').focus();
        await page.keyboard.press('Shift+KeyC');
        await page.waitForTimeout(80);
        const onCh = await page.evaluate(() => window.__testGridView()[0]);
        expect(onCh).toBe(0x43);

        // OFF again — next press does not advance cell (0,1).
        await page.locator('#local-echo').uncheck();
        await page.locator('#terminal-wrapper').focus();
        await page.keyboard.press('Shift+KeyD');
        await page.waitForTimeout(50);
        // Cell (0,1) should NOT be 0x44 because echo is OFF and the previous ON
        // press at (0,0) advanced cursor to (0,1).
        const cellAfter = await page.evaluate(() => {
            const v = window.__testGridView();
            return v[1 * 8]; // (0, 1) char byte
        });
        expect(cellAfter).not.toBe(0x44);
    });
});
