// Phase 4 Plan 04 — INPUT-05 — CR/LF override alters Enter TX bytes.
// E7.1 — the legacy #crlf-* radios retired with <details id="settings">; the
// Settings ▸ Enter key sends submenu (menu-bar.js → keyboard.js setCrlfMode) is
// the sole surface. These behavioural tests drive that submenu and read the wire
// bytes via #tx-strip (debug pane, which stays).
import { test, expect } from '@playwright/test';

const CRLF_PARENT = '#dropdown-settings .menu-item[data-submenu="crlf"]';
const crlfRow = (v) =>
    `#dropdown-settings .submenu[data-submenu-panel="crlf"] .menu-item[data-value="${v}"]`;

async function setup(page) {
    await page.goto('/');
    await page.locator('#terminal-wrapper').focus();
    await page.waitForFunction(() => document.getElementById('terminal').width > 0);
    await page.waitForFunction(() =>
        window.__menuBar && typeof window.__menuBar.open === 'function');
    await page.locator('#debug').evaluate((el) => { el.open = true; });
    await page.locator('#tx-reset').click();
}

async function setCrlf(page, value) {
    await page.evaluate(() => window.__menuBar.open('settings'));
    await page.click(CRLF_PARENT);
    await page.click(crlfRow(value));
    await page.evaluate(() => window.__menuBar.close());
    await page.locator('#terminal-wrapper').focus();
}

test.describe('INPUT-05 — CR/LF override', () => {
    test('default CR mode: Enter sends 0x0D @fast', async ({ page }) => {
        await setup(page);
        // Confirm CR is the default mode (keyboard.js is the live owner).
        expect(await page.evaluate(() => window.__keyboardState.getCrlfMode())).toBe('cr');
        await page.locator('#terminal-wrapper').focus();
        await page.keyboard.press('Enter');
        await expect(page.locator('#tx-strip')).toHaveText('0D');
    });

    test('LF mode: Enter sends 0x0A', async ({ page }) => {
        await setup(page);
        await setCrlf(page, 'lf');
        await page.keyboard.press('Enter');
        await expect(page.locator('#tx-strip')).toHaveText('0A');
    });

    test('CRLF mode: Enter sends 0x0D 0x0A', async ({ page }) => {
        await setup(page);
        await setCrlf(page, 'crlf');
        await page.keyboard.press('Enter');
        await expect(page.locator('#tx-strip')).toHaveText('0D 0A');
    });

    test('submenu exclusivity: checking one unchecks the others', async ({ page }) => {
        await setup(page);
        await page.evaluate(() => window.__menuBar.open('settings'));
        await page.click(CRLF_PARENT);
        await page.click(crlfRow('lf'));
        await expect(page.locator(crlfRow('lf'))).toHaveAttribute('data-checked', 'true');
        await expect(page.locator(crlfRow('cr'))).toHaveAttribute('data-checked', 'false');
        await expect(page.locator(crlfRow('crlf'))).toHaveAttribute('data-checked', 'false');

        await page.click(crlfRow('crlf'));
        await expect(page.locator(crlfRow('crlf'))).toHaveAttribute('data-checked', 'true');
        await expect(page.locator(crlfRow('lf'))).toHaveAttribute('data-checked', 'false');
    });
});
