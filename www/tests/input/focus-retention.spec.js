// Phase 4 Plan 04 — SC-5 (focus half) — mouse click on toolbar keeps wrapper focused.
import { test, expect } from '@playwright/test';

test.describe('SC-5 — Focus retention on toolbar click', () => {
    // Epic E1 Story E1.4 — theme/phosphor retired to View ▸ Theme / Phosphor.
    // retainFocus on every submenu row keeps #terminal-wrapper focused (D-16/AD-10).
    test('View ▸ Theme select keeps #terminal-wrapper focused @fast', async ({ page }) => {
        await page.goto('/');
        await page.waitForFunction(() => window.__menuBar && typeof window.__menuBar.open === 'function');
        await page.locator('#terminal-wrapper').focus();
        await expect(page.locator('#terminal-wrapper')).toBeFocused();

        await page.evaluate(() => window.__menuBar.open('view'));
        await page.click('#dropdown-view .menu-item[data-submenu="theme"]');
        await page.click('#dropdown-view .submenu[data-submenu-panel="theme"] .menu-item[data-value="clean"]');
        await expect(page.locator('#terminal-wrapper')).toBeFocused();
        // Confirm the action fired (theme flipped).
        await expect(page.locator('body')).toHaveAttribute('data-theme', 'clean');
    });

    test('View ▸ Phosphor selects keep wrapper focused', async ({ page }) => {
        await page.goto('/');
        await page.waitForFunction(() => window.__menuBar && typeof window.__menuBar.open === 'function');
        await page.locator('#terminal-wrapper').focus();

        const P = '#dropdown-view .submenu[data-submenu-panel="phosphor"]';
        for (const color of ['amber', 'white', 'green']) {
            await page.evaluate(() => window.__menuBar.open('view'));
            await page.click('#dropdown-view .menu-item[data-submenu="phosphor"]');
            await page.click(`${P} .menu-item[data-value="${color}"]`);
            await expect(page.locator('#terminal-wrapper')).toBeFocused();
            await expect(page.locator(`${P} .menu-item[data-value="${color}"]`)).toHaveAttribute('aria-checked', 'true');
        }
    });

    // E7.1 — Local echo / Enter-key-sends are Settings-menu rows now (the
    // <details id="settings"> checkbox + radios retired); retainFocus lives on the
    // menu rows.
    test('Settings ▸ Local echo row keeps wrapper focused + toggles state @fast', async ({ page }) => {
        await page.goto('/');
        await page.waitForFunction(() => window.__menuBar && typeof window.__menuBar.open === 'function');
        await page.locator('#terminal-wrapper').focus();

        await page.evaluate(() => window.__menuBar.open('settings'));
        await page.click('#menu-local-echo-item');
        await expect(page.locator('#terminal-wrapper')).toBeFocused();
        await expect(page.locator('#menu-local-echo-item')).toHaveAttribute('data-checked', 'true');
    });

    test('Settings ▸ Enter key sends rows keep wrapper focused + toggle state', async ({ page }) => {
        await page.goto('/');
        await page.waitForFunction(() => window.__menuBar && typeof window.__menuBar.open === 'function');
        await page.locator('#terminal-wrapper').focus();

        await page.evaluate(() => window.__menuBar.open('settings'));
        await page.click('#dropdown-settings .menu-item[data-submenu="crlf"]');
        const row = (v) => `#dropdown-settings .submenu[data-submenu-panel="crlf"] .menu-item[data-value="${v}"]`;
        for (const mode of ['lf', 'crlf', 'cr']) {
            await page.click(row(mode));
            await expect(page.locator('#terminal-wrapper')).toBeFocused();
            await expect(page.locator(row(mode))).toHaveAttribute('data-checked', 'true');
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
