// Phase 5 Plan 01 (Wave 0) — PLAT-01, PLAT-02, D-32, D-33 stub spec.
// Source: 05-RESEARCH.md §Validation Architecture; 05-CONTEXT.md D-32, D-33; 05-UI-SPEC.md §Polite-fail page.
// Stubs are test.fixme until later waves land production code.
import { test, expect } from '@playwright/test';

// Polite-fail specs DELETE navigator.serial (not mock it) to simulate non-Chromium.
async function setup(page) {
    await page.addInitScript(() => { delete navigator.serial; });
    await page.goto('/');
}

test.describe('PLAT-01, PLAT-02 — Polite-fail for non-Chromium', () => {
    test.fixme('body replaced with polite-fail content when navigator.serial undefined @fast', async ({ page }) => {
        await setup(page);
        await expect(page.locator('h1')).toHaveText('BestialiTTY requires a Chromium-based browser');
    });

    test.fixme('title reads "BestialiTTY — Chromium required"', async ({ page }) => {
        await setup(page);
        await expect(page).toHaveTitle('BestialiTTY — Chromium required');
    });

    test.fixme('no canvas element on polite-fail page', async ({ page }) => {
        await setup(page);
        await expect(page.locator('#terminal')).toHaveCount(0);
    });
});
