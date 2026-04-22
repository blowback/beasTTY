// Phase 4 Plan 04 — SC-5 (focus half) — mouse click on toolbar keeps wrapper focused.
import { test, expect } from '@playwright/test';

test.describe('SC-5 — Focus retention on toolbar click', () => {
    test('click #theme-toggle keeps #terminal-wrapper focused @fast', async ({ page }) => {
        await page.goto('/');
        await page.locator('#terminal-wrapper').focus();
        await expect(page.locator('#terminal-wrapper')).toBeFocused();

        await page.locator('#theme-toggle').click();
        await expect(page.locator('#terminal-wrapper')).toBeFocused();
        // Confirm the click action fired (theme flipped).
        await expect(page.locator('body')).toHaveAttribute('data-theme', 'clean');
    });

    test('click each phosphor button keeps wrapper focused', async ({ page }) => {
        await page.goto('/');
        await page.locator('#terminal-wrapper').focus();

        for (const color of ['amber', 'white', 'green']) {
            await page.locator(`[data-phosphor="${color}"]`).click();
            await expect(page.locator('#terminal-wrapper')).toBeFocused();
            await expect(page.locator(`[data-phosphor="${color}"]`)).toHaveAttribute('aria-pressed', 'true');
        }
    });

    test('click local-echo checkbox keeps wrapper focused + toggles state', async ({ page }) => {
        await page.goto('/');
        await page.locator('#terminal-wrapper').focus();
        await page.locator('#settings').evaluate((el) => { el.open = true; });

        await page.locator('#local-echo').click();
        await expect(page.locator('#terminal-wrapper')).toBeFocused();
        await expect(page.locator('#local-echo')).toBeChecked();
    });

    test('click each CR/LF radio keeps wrapper focused + toggles state', async ({ page }) => {
        await page.goto('/');
        await page.locator('#terminal-wrapper').focus();
        await page.locator('#settings').evaluate((el) => { el.open = true; });

        for (const mode of ['lf', 'crlf', 'cr']) {
            await page.locator(`#crlf-${mode}`).click();
            await expect(page.locator('#terminal-wrapper')).toBeFocused();
            await expect(page.locator(`#crlf-${mode}`)).toBeChecked();
        }
    });

    test('click Reset TX keeps wrapper focused + clears strip', async ({ page }) => {
        await page.goto('/');
        await page.locator('#terminal-wrapper').focus();
        await page.waitForFunction(() => document.getElementById('terminal').width > 0);
        await page.locator('#debug').evaluate((el) => { el.open = true; });

        await page.keyboard.press('ArrowUp');
        await page.locator('#tx-reset').click();
        await expect(page.locator('#terminal-wrapper')).toBeFocused();
        await expect(page.locator('#tx-strip')).toHaveText('(none yet — press any key on the terminal to see TX bytes)');
    });
});
