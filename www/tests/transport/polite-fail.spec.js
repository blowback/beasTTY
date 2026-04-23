// Phase 5 Plan 01 (Wave 0) — PLAT-01, PLAT-02, D-32, D-33 stub spec.
// Source: 05-RESEARCH.md §Validation Architecture; 05-CONTEXT.md D-32, D-33; 05-UI-SPEC.md §Polite-fail page.
// Stubs are test.fixme until later waves land production code.
import { test, expect } from '@playwright/test';

// Polite-fail specs simulate non-Chromium by making `navigator.serial` appear
// undefined to the main.js gate. Plain `delete navigator.serial` doesn't work
// in real Chromium (navigator.serial is a non-configurable getter), so we use
// Object.defineProperty on the Navigator prototype to override the getter with
// one that returns undefined — matching the typeof check in main.js D-32/D-33.
// The expected `throw new Error('__polite-fail__')` in main.js aborts module
// execution; the pageerror handler filters that one expected exception so
// Playwright's default page-error trap doesn't fail the test.
async function setup(page) {
    page.on('pageerror', (err) => {
        if (err.message.includes('__polite-fail__')) return;   // expected abort
        throw err;
    });
    await page.addInitScript(() => {
        // Override the getter on the prototype chain so `navigator.serial` is undefined.
        try {
            Object.defineProperty(Navigator.prototype, 'serial', {
                configurable: true,
                get: () => undefined,
            });
        } catch (e) {
            // Fallback: shadow on the instance.
            Object.defineProperty(navigator, 'serial', {
                configurable: true,
                get: () => undefined,
            });
        }
    });
    await page.goto('/');
}

test.describe('PLAT-01, PLAT-02 — Polite-fail for non-Chromium', () => {
    test('body replaced with polite-fail content when navigator.serial undefined @fast', async ({ page }) => {
        await setup(page);
        await expect(page.locator('h1')).toHaveText('BestialiTTY requires a Chromium-based browser');
        await expect(page.locator('body.polite-fail')).toBeVisible();
    });

    test('title reads "BestialiTTY — Chromium required"', async ({ page }) => {
        await setup(page);
        await expect(page).toHaveTitle('BestialiTTY — Chromium required');
    });

    test('no canvas element on polite-fail page', async ({ page }) => {
        await setup(page);
        // Body innerHTML was replaced — the original #terminal canvas is gone.
        await expect(page.locator('#terminal')).toHaveCount(0);
        // Also verify no wasm import took effect — Terminal global must be undefined.
        const hasTerminalGlobal = await page.evaluate(() => typeof window.Terminal !== 'undefined');
        expect(hasTerminalGlobal).toBe(false);
    });
});
