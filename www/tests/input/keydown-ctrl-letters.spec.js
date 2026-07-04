// Phase 4 Plan 04 — INPUT-03 — Ctrl-letter combinations transmit control byte + keep focus.
import { test, expect } from '@playwright/test';

async function setup(page) {
    await page.goto('/');
    await page.locator('#terminal-wrapper').focus();
    await page.waitForFunction(() => document.getElementById('terminal').width > 0);
    await page.locator('#debug').evaluate((el) => { el.open = true; });
    await page.locator('#tx-reset').click();
}

test.describe('INPUT-03 — Ctrl-letter → control byte', () => {
    test('Ctrl+KeyL forwards 0x0C and keeps focus @fast', async ({ page }) => {
        await setup(page);
        await page.keyboard.press('Control+KeyL');
        await expect(page.locator('#tx-strip')).toHaveText('0C');
        await expect(page.locator('#terminal-wrapper')).toBeFocused();
    });

    test('Ctrl+KeyA → 0x01; Ctrl+KeyM → 0x0D; Ctrl+KeyZ → 0x1A', async ({ page }) => {
        await setup(page);
        await page.keyboard.press('Control+KeyA');
        await expect(page.locator('#tx-strip')).toHaveText('01');
        await page.locator('#tx-reset').click();

        await page.keyboard.press('Control+KeyM');
        await expect(page.locator('#tx-strip')).toHaveText('0D');
        await page.locator('#tx-reset').click();

        await page.keyboard.press('Control+KeyZ');
        await expect(page.locator('#tx-strip')).toHaveText('1A');
    });

    test('Ctrl+BracketLeft → 0x1B (ESC via Ctrl-[)', async ({ page }) => {
        await setup(page);
        await page.keyboard.press('Control+BracketLeft');
        // Ctrl+[ is encoded via Char(0x5B) + ctrl mod → key.rs:113 maps to b'[' - b'@' = 0x1B.
        await expect(page.locator('#tx-strip')).toHaveText('1B');
    });

    test('Settings menu exposes the browser-reserved Ctrl combinations note', async ({ page }) => {
        await page.goto('/');
        // E7.1 — the reserved-Ctrl copy lives in #reserved-ctrl-modal (E3.3), opened
        // from Settings ▸ Browser-reserved Ctrl combinations… (the legacy
        // <details class="reserved"> pane retired with <details id="settings">).
        await page.waitForFunction(() => window.__menuBar && typeof window.__menuBar.open === 'function');
        await page.evaluate(() => window.__menuBar.open('settings'));
        await page.click('#dropdown-settings .menu-item[data-action="reserved-ctrl"]');
        await expect(page.locator('#reserved-ctrl-modal')).toBeVisible();
        const noteText = await page.locator('#reserved-ctrl-modal .modal-body .hint').textContent();
        expect(noteText).toContain('Ctrl+W, Ctrl+N, Ctrl+T are claimed by Chromium');
    });
});
