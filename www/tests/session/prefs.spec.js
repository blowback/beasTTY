// BestialiTTY Phase 6 Plan 06 (Wave 5) — PREF-01/PREF-02/PLAT-05 prefs persistence.
//
// Wave 5 lands www/state/prefs.js, the boot-order reorder, and the Settings-pane
// rows. Plan 06-06 Task 1 un-fixmes the 8 round-trip stubs (defaults, theme,
// debounce, beforeunload, quota, migration, phosphor, serial config). Plan 06-06
// Task 2 un-fixmes the remaining 6 (Reset 2-click confirm, localEcho, crlfMode,
// fontZoom).
//
// Sources:
//   - 06-CONTEXT.md D-32 (single bestialitty.prefs versioned blob),
//                  D-33 (debounced 250 ms save / beforeunload flush),
//                  D-35 (Reset prefs 2-click confirm),
//                  D-36 (first-open defaults).
//   - 06-VALIDATION.md §Phase Requirements → Test Map (prefs row).
//   - Analog: www/tests/transport/connect.spec.js (localStorage assertions).
import { test, expect } from '@playwright/test';
import { SERIAL_MOCK } from '../transport/mock-serial.js';

async function setup(page) {
    await page.addInitScript(SERIAL_MOCK);
    await page.goto('/');
    await page.locator('#terminal-wrapper').focus();
    await page.waitForFunction(() => document.getElementById('terminal').width > 0);
}

test.describe('PREF-01/PREF-02/PLAT-05 — Preferences persistence', () => {
    test('first load with no bestialitty.prefs applies D-36 defaults @fast', async ({ page }) => {
        await setup(page);
        const prefs = await page.evaluate(() => window.__prefs.getPrefs());
        expect(prefs.theme).toBe('crt');
        expect(prefs.phosphor).toBe('green');
        expect(prefs.fontZoom).toBe(1);
        expect(prefs.serial).toEqual({ baud: 19200, dataBits: 8, stopBits: 1, parity: 'none', flowControl: 'none' });
        expect(prefs.localEcho).toBe(false);
        expect(prefs.crlfMode).toBe('cr');
        expect(prefs.autoConnect).toBe(false);
        expect(prefs.version).toBe(1);
    });

    test('theme persists across reload (round-trip)', async ({ page }) => {
        // No addInitScript cleanup — Playwright provides a fresh browser context
        // per test so localStorage starts empty by default. addInitScript runs
        // on EVERY navigation including page.reload(), which would erase the
        // saved blob right before main.js's loadPrefs() reads it.
        await setup(page);
        // Toggle theme via savePrefs (the click handler also fires savePrefs in
        // production; here we drive savePrefs directly so the test does not
        // depend on whether the test-environment focus path runs the click).
        await page.evaluate(() => window.__prefs.savePrefs({ theme: 'clean' }));
        await page.waitForTimeout(300);   // > 250 ms debounce window
        await page.reload();
        await setup(page);
        const prefs = await page.evaluate(() => window.__prefs.getPrefs());
        expect(prefs.theme).toBe('clean');
    });

    test('phosphor persists across reload', async ({ page }) => {
        await setup(page);
        await page.evaluate(() => window.__prefs.savePrefs({ phosphor: 'amber' }));
        await page.waitForTimeout(300);
        await page.reload();
        await setup(page);
        const prefs = await page.evaluate(() => window.__prefs.getPrefs());
        expect(prefs.phosphor).toBe('amber');
    });

    test('serial config persists across reload (baud/dataBits/stopBits/parity/flowCtrl)', async ({ page }) => {
        await setup(page);
        await page.evaluate(() => window.__prefs.savePrefs({
            serial: { baud: 9600, dataBits: 7, stopBits: 2, parity: 'even', flowControl: 'hardware' },
        }));
        await page.waitForTimeout(300);
        await page.reload();
        await setup(page);
        const prefs = await page.evaluate(() => window.__prefs.getPrefs());
        expect(prefs.serial).toEqual({ baud: 9600, dataBits: 7, stopBits: 2, parity: 'even', flowControl: 'hardware' });
    });

    test('savePrefs is debounced 250 ms; burst of changes = one persist', async ({ page }) => {
        await page.addInitScript(() => localStorage.removeItem('bestialitty.prefs'));
        await setup(page);
        // Monkey-patch localStorage.setItem to count writes against the prefs key.
        await page.evaluate(() => {
            window.__prefsSetItemCount = 0;
            const orig = Storage.prototype.setItem;
            Storage.prototype.setItem = function (key, val) {
                if (key === 'bestialitty.prefs') window.__prefsSetItemCount++;
                return orig.call(this, key, val);
            };
        });
        await page.evaluate(() => {
            window.__prefs.savePrefs({ theme: 'crt' });
            window.__prefs.savePrefs({ phosphor: 'amber' });
            window.__prefs.savePrefs({ fontZoom: 2 });
        });
        // Before debounce expires, count should be 0.
        expect(await page.evaluate(() => window.__prefsSetItemCount)).toBe(0);
        // After > 250 ms debounce, count should be exactly 1.
        await page.waitForTimeout(350);
        expect(await page.evaluate(() => window.__prefsSetItemCount)).toBe(1);
    });

    test('beforeunload flushes pending debounced write', async ({ page }) => {
        await page.addInitScript(() => localStorage.removeItem('bestialitty.prefs'));
        await setup(page);
        await page.evaluate(() => {
            window.__prefs.savePrefs({ theme: 'clean' });
        });
        // Trigger beforeunload synchronously BEFORE the 250 ms debounce expires.
        // The flush handler must fire setItem immediately.
        await page.evaluate(() => window.dispatchEvent(new Event('beforeunload')));
        const stored = await page.evaluate(() => JSON.parse(localStorage.getItem('bestialitty.prefs')));
        expect(stored).not.toBeNull();
        expect(stored.theme).toBe('clean');
    });

    test('quota error swallowed silently; in-memory prefs preserved', async ({ page }) => {
        await page.addInitScript(() => localStorage.removeItem('bestialitty.prefs'));
        await setup(page);
        await page.evaluate(() => {
            // Stub setItem to throw QuotaExceededError ONLY for the prefs key
            // (other localStorage writers — e.g. bestialitty.port.preset — must
            // still work; the test only exercises the prefs.js failure path).
            const orig = Storage.prototype.setItem;
            Storage.prototype.setItem = function (key, val) {
                if (key === 'bestialitty.prefs') {
                    const err = new Error('quota');
                    err.name = 'QuotaExceededError';
                    throw err;
                }
                return orig.call(this, key, val);
            };
            window.__prefs.savePrefs({ theme: 'clean' });
        });
        await page.waitForTimeout(300);
        // In-memory prefs MUST reflect the change even though setItem threw.
        expect(await page.evaluate(() => window.__prefs.getPrefs().theme)).toBe('clean');
    });

    test('version migration: parsed.version > CURRENT_VERSION → fall back to defaults', async ({ page }) => {
        await page.addInitScript(() => {
            localStorage.setItem('bestialitty.prefs', JSON.stringify({ version: 999, theme: 'wat' }));
        });
        await setup(page);
        const prefs = await page.evaluate(() => window.__prefs.getPrefs());
        expect(prefs.version).toBe(1);
        expect(prefs.theme).toBe('crt');   // fallen back to D-36 default
    });

    test('localEcho persists across reload', async ({ page }) => {
        await setup(page);
        await page.locator('#settings').evaluate((el) => el.open = true);
        await page.locator('#local-echo').check();
        await page.waitForTimeout(300);
        await page.reload();
        await setup(page);
        expect(await page.evaluate(() => window.__prefs.getPrefs().localEcho)).toBe(true);
    });

    test('crlfMode persists across reload', async ({ page }) => {
        await setup(page);
        await page.locator('#settings').evaluate((el) => el.open = true);
        // Drive the change handler; click is shadowed by the mousedown
        // preventDefault sequence (Phase 4 D-16) so we use .check() directly.
        await page.locator('#crlf-lf').check();
        await page.waitForTimeout(300);
        await page.reload();
        await setup(page);
        expect(await page.evaluate(() => window.__prefs.getPrefs().crlfMode)).toBe('lf');
    });

    test('fontZoom persists across reload', async ({ page }) => {
        await setup(page);
        // Use the savePrefs API directly — the keyboard-chord path is exercised
        // in the Phase 3 zoom suite; here we focus on the persistence contract.
        await page.evaluate(() => window.__prefs.savePrefs({ fontZoom: 2 }));
        await page.waitForTimeout(300);
        await page.reload();
        await setup(page);
        expect(await page.evaluate(() => window.__prefs.getPrefs().fontZoom)).toBe(2);
    });

    test('Reset prefs button: first click changes label to "Click again to confirm (3 s)"', async ({ page }) => {
        await page.addInitScript(() => localStorage.removeItem('bestialitty.prefs'));
        await setup(page);
        await page.locator('#settings').evaluate((el) => el.open = true);
        await page.locator('#reset-prefs-button').click();
        await expect(page.locator('#reset-prefs-button')).toHaveText('Click again to confirm (3 s)');
    });

    test('Reset prefs button: second click within 3s clears bestialitty.prefs and reloads defaults', async ({ page }) => {
        await page.addInitScript(() => localStorage.removeItem('bestialitty.prefs'));
        await setup(page);
        // First customize prefs.
        await page.evaluate(() => window.__prefs.savePrefs({ theme: 'clean' }));
        await page.waitForTimeout(300);
        expect(await page.evaluate(() => localStorage.getItem('bestialitty.prefs'))).not.toBeNull();
        await page.locator('#settings').evaluate((el) => el.open = true);
        await page.locator('#reset-prefs-button').click();
        await page.locator('#reset-prefs-button').click();
        // Defaults reloaded in-place (no page reload — D-35).
        expect(await page.evaluate(() => window.__prefs.getPrefs().theme)).toBe('crt');
        expect(await page.evaluate(() => localStorage.getItem('bestialitty.prefs'))).toBeNull();
        // Label restored.
        await expect(page.locator('#reset-prefs-button')).toHaveText('Reset all preferences');
    });

    test('Reset prefs button: 3s timeout returns label to "Reset all preferences"', async ({ page }) => {
        await page.addInitScript(() => localStorage.removeItem('bestialitty.prefs'));
        await setup(page);
        await page.locator('#settings').evaluate((el) => el.open = true);
        await page.locator('#reset-prefs-button').click();
        await expect(page.locator('#reset-prefs-button')).toHaveText('Click again to confirm (3 s)');
        await page.waitForTimeout(3500);   // wait > 3 s
        await expect(page.locator('#reset-prefs-button')).toHaveText('Reset all preferences');
    });
});
