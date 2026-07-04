// Phase 4 Plan 04 — SC-1 — TX hex strip placeholder + live update + Reset TX.
//
// E5.1 (FR-23) — the debug widgets now live behind Debug ▸ Show Debug Panel (default
// OFF) instead of a native <details> disclosure. As the DIRECT test of these widgets,
// this spec reveals them the real way — via the menu toggle — proving the relocated
// widgets still work after the move (AC-2/AC-7). Other specs keep `el.open = true`
// (still valid: visibility keys off the container's `open` attribute — E5.1 Q1).
import { test, expect } from '@playwright/test';

const PLACEHOLDER = '(none yet — press any key on the terminal to see TX bytes)';

// Menu-driven reveal: open Debug ▸ Show Debug Panel, toggle it on, close the menu.
// The panel stays shown (its visibility is pref/setter-driven, not menu-driven).
async function revealDebugPanel(page) {
    await page.waitForFunction(
        () => window.__menuBar && typeof window.__menuBar.open === 'function',
    );
    await page.evaluate(() => window.__menuBar.open('debug'));
    await page.click('#dropdown-debug .menu-item[data-pref="showDebugPanel"]');
    await page.evaluate(() => window.__menuBar.close());
    await expect(page.locator('#debug')).toBeVisible();
}

test.describe('SC-1 — TX hex strip', () => {
    test('placeholder shows before any keypress', async ({ page }) => {
        await page.goto('/');
        await revealDebugPanel(page);
        await expect(page.locator('#tx-strip')).toHaveText(PLACEHOLDER);
    });

    test('arrow press updates strip; Reset TX restores placeholder @fast', async ({ page }) => {
        await page.goto('/');
        await page.locator('#terminal-wrapper').focus();
        await page.waitForFunction(() => document.getElementById('terminal').width > 0);
        await revealDebugPanel(page);

        await page.keyboard.press('ArrowUp');
        await expect(page.locator('#tx-strip')).toHaveText('1B 41');

        await page.locator('#tx-reset').click();
        await expect(page.locator('#tx-strip')).toHaveText(PLACEHOLDER);
    });

    test('last 64 bytes: after many presses, strip shows most-recent slice', async ({ page }) => {
        await page.goto('/');
        await page.locator('#terminal-wrapper').focus();
        await page.waitForFunction(() => document.getElementById('terminal').width > 0);
        await revealDebugPanel(page);
        await page.locator('#tx-reset').click();

        // 40 arrow presses → 80 bytes. Strip displays last 64 bytes.
        for (let i = 0; i < 40; i++) {
            await page.keyboard.press('ArrowUp');
        }
        const strip = await page.locator('#tx-strip').textContent();
        // Newest-right: strip must END with "1B 41" and contain at most 64 bytes
        // (64 bytes × 3 chars per space-separated pair = 191 chars — 64 pairs × 2 + 63 spaces).
        expect(strip.endsWith('1B 41')).toBe(true);
        const pairs = strip.split(' ');
        expect(pairs.length).toBeLessThanOrEqual(64);
    });
});
