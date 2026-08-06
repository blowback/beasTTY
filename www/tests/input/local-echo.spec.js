// Phase 4 Plan 04 — INPUT-04 — Local echo toggle default OFF; flip ON renders typed char.
import { test, expect } from '@playwright/test';

// Cell layout from Phase 1 Plan 04: 8 bytes/cell, [ch, fg, bg, attr, ...].
// Grid is 24 rows × 80 cols. Cell (0, 0) char byte is at offset 0.

async function setup(page) {
    await page.goto('/');
    await page.locator('#terminal-wrapper').focus();
    await page.waitForFunction(() => document.getElementById('terminal').width > 0);
    await page.waitForFunction(() => typeof window.__testGridView === 'function');
    await page.waitForFunction(() =>
        window.__menuBar && typeof window.__menuBar.open === 'function');
    await page.locator('#debug').evaluate((el) => { el.open = true; });
    await page.locator('#tx-reset').click();
}

// E7.1 — Local echo is a Settings-menu checkable now (the #local-echo checkbox
// retired with <details id="settings">). Toggle it via the menu row; the live
// effect (keyboard.js setLocalEcho) is what these behavioural tests exercise.
async function setLocalEcho(page, on) {
    const cur = await page.evaluate(() => window.__keyboardState.getLocalEcho());
    if (cur === on) return;
    await page.evaluate(() => window.__menuBar.open('settings'));
    await page.click('#menu-local-echo-item');
    await page.evaluate(() => window.__menuBar.close());
    await page.locator('#terminal-wrapper').focus();
}

test.describe('INPUT-04 — Local echo toggle', () => {
    test('default OFF — typed key does NOT render on grid @fast', async ({ page }) => {
        await setup(page);
        // Confirm default state (keyboard.js is the live owner).
        expect(await page.evaluate(() => window.__keyboardState.getLocalEcho())).toBe(false);

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
        await setLocalEcho(page, true);
        expect(await page.evaluate(() => window.__keyboardState.getLocalEcho())).toBe(true);

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
        await setLocalEcho(page, true);
        await page.locator('#terminal-wrapper').focus();
        await page.keyboard.press('Shift+KeyC');
        await page.waitForTimeout(80);
        const onCh = await page.evaluate(() => window.__testGridView()[0]);
        expect(onCh).toBe(0x43);

        // OFF again — next press does not advance cell (0,1).
        await setLocalEcho(page, false);
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

// A pasted multi-line block must echo as multiple lines.
//
// The wire copy and the display copy are not the same bytes. The core treats
// 0x0D as a column reset that leaves the row alone (terminal.rs:364), so with
// the default Paste line ending — CR, which is what the MicroBeast needs — a
// pasted block fed verbatim to the terminal draws every line on top of the last:
// one row of overstrike where the user pasted five lines, in the DEFAULT
// configuration. The pump shows a bare CR as 0x0A instead, which resets the
// column AND advances the row.
test.describe('Local echo — a pasted block echoes as separate lines', () => {
    const ROW = 80 * 8;   // 8 bytes/cell, 80 cols — start of the next row

    async function pasteAndSettle(page, text) {
        await page.locator('#input').fill(text);
        await page.locator('#paste-test').click();
        await expect(page.locator('#paste-toast-text')).toContainText('Paste complete', { timeout: 10_000 });
        await page.waitForTimeout(80);   // rAF render tick (incumbent local-echo idiom)
    }

    for (const { eol, label } of [
        { eol: 'cr', label: 'CR' },
        { eol: 'lf', label: 'LF' },
        { eol: 'crlf', label: 'CRLF' },
    ]) {
        test(`ending ${label}: three pasted lines occupy three rows`, async ({ page }) => {
            await setup(page);
            await setLocalEcho(page, true);
            if (eol !== 'cr') {
                await page.evaluate(() => window.__menuBar.open('settings'));
                await page.click('#dropdown-settings .menu-item[data-submenu="paste-eol"]');
                await page.click(
                    `#dropdown-settings .submenu[data-submenu-panel="paste-eol"] .menu-item[data-value="${eol}"]`);
                await page.evaluate(() => window.__menuBar.close());
                await page.locator('#terminal-wrapper').focus();
            }
            await pasteAndSettle(page, 'AB\\x0ACD\\x0AEF');

            const grid = await page.evaluate(() => Array.from(window.__testGridView()));
            // Rows 0, 1, 2 each hold their own pair, at column 0.
            expect([grid[0], grid[8]]).toEqual([0x41, 0x42]);
            expect([grid[ROW], grid[ROW + 8]]).toEqual([0x43, 0x44]);
            expect([grid[2 * ROW], grid[2 * ROW + 8]]).toEqual([0x45, 0x46]);
        });
    }

    test('ending As-is: a bare CR overstrikes the row instead of opening a new one', async ({ page }) => {
        // 'As-is' promises the clipboard bytes pass through untouched, and the echo
        // is part of that promise. A transcript that uses a bare CR to redraw one
        // line in place ("Loading 10%\rLoading 20%\r") is doing exactly that on the
        // MicroBeast; showing it locally as a column of scrolling rows would put a
        // different picture on the screen from the one the hardware is drawing.
        // The CR→LF display substitution belongs to the modes that REWROTE the
        // breaks, and to those only.
        await setup(page);
        await setLocalEcho(page, true);
        await page.evaluate(() => window.__menuBar.open('settings'));
        await page.click('#dropdown-settings .menu-item[data-submenu="paste-eol"]');
        await page.click('#dropdown-settings .submenu[data-submenu-panel="paste-eol"] .menu-item[data-value="raw"]');
        await page.evaluate(() => window.__menuBar.close());
        await page.locator('#terminal-wrapper').focus();

        await pasteAndSettle(page, 'ABCD\\x0DZ');
        const grid = await page.evaluate(() => Array.from(window.__testGridView()));
        expect(grid[0]).toBe(0x5A);           // 'Z' overwrote the 'A' at column 0
        expect(grid[8]).toBe(0x42);           // 'B' still standing beside it
        expect(grid[ROW]).not.toBe(0x5A);     // and nothing was drawn on the next row
    });

    test('a CRLF pair split across two writes still renders ONE new row', async ({ page }) => {
        // Reachable at Full speed, where the chunker does not stop at terminators,
        // so a CR can end one write and its LF open the next. The display copy
        // looks ahead into the QUEUE rather than the chunk, so the CR is left
        // alone and the LF does the single line feed — no blank row between.
        await setup(page);
        await setLocalEcho(page, true);
        await page.evaluate(() => window.__menuBar.open('settings'));
        await page.click('#dropdown-settings .menu-item[data-submenu="paste-eol"]');
        await page.click('#dropdown-settings .submenu[data-submenu-panel="paste-eol"] .menu-item[data-value="raw"]');
        await page.click('#dropdown-settings .menu-item[data-submenu="paste-speed"]');
        await page.click('#dropdown-settings .submenu[data-submenu-panel="paste-speed"] .menu-item[data-value="0"]');
        await page.evaluate(() => window.__menuBar.close());
        await page.locator('#terminal-wrapper').focus();

        // 31 characters, then CRLF: the 32-byte full-speed chunk ends on the CR
        // and the LF opens the next write.
        await pasteAndSettle(page, `${'A'.repeat(31)}\\x0D\\x0AZ`);
        const grid = await page.evaluate(() => Array.from(window.__testGridView()));
        expect(grid[0]).toBe(0x41);
        expect(grid[ROW]).toBe(0x5A);        // 'Z' on the NEXT row, column 0
        expect(grid[2 * ROW]).not.toBe(0x5A); // and not two rows down (no blank row)
    });
});
