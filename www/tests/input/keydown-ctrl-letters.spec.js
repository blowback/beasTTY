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

    test('Settings pane exposes browser-reserved Ctrl combinations note', async ({ page }) => {
        await page.goto('/');
        // Open Settings pane (default-collapsed) + inner reserved note (default-collapsed).
        // Phase 11 added a second `<details class="reserved" id="settings-slide">` block,
        // so we narrow the locator with :not(#settings-slide) to keep matching only the
        // original browser-reserved-Ctrl note.
        await page.locator('#settings').evaluate((el) => { el.open = true; });
        await page.locator('#settings details.reserved:not(#settings-slide)').evaluate((el) => { el.open = true; });
        const noteText = await page.locator('#settings details.reserved:not(#settings-slide) p.hint').textContent();
        expect(noteText).toContain('Ctrl+W, Ctrl+N, Ctrl+T are claimed by Chromium');
    });
});
