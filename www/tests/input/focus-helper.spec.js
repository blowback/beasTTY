// Epic E0 Story E0.1 — unit spec for the shared retainFocus helper (AD-10).
// Mirrors the tests/input/focus-retention.spec.js structure (goto '/', focus
// #terminal-wrapper, assert toBeFocused). Uses real (trusted) Playwright input
// so the browser's native focus-on-mousedown is actually exercised — synthetic
// dispatchEvent would not reproduce the focus transfer the helper suppresses.
import { test, expect } from '@playwright/test';

test.describe('E0.1 — retainFocus helper', () => {
    // AC-1 — button branch: mousedown-preventDefault suppresses the focus steal
    // while the element's own click handler still fires.
    test('button wired via retainFocus keeps wrapper focused but still fires click @fast', async ({ page }) => {
        await page.goto('/');
        await page.locator('#terminal-wrapper').focus();
        await expect(page.locator('#terminal-wrapper')).toBeFocused();

        await page.evaluate(async () => {
            const { retainFocus } = await import('/renderer/focus.js');
            const btn = document.createElement('button');
            btn.id = '__test-retain-btn';
            btn.textContent = 'test';
            window.__testBtnClicked = false;
            btn.addEventListener('click', () => { window.__testBtnClicked = true; });
            document.body.appendChild(btn);
            retainFocus(btn);
        });

        await page.locator('#__test-retain-btn').click();
        // Focus never left the wrapper (mousedown-preventDefault blocked it)…
        await expect(page.locator('#terminal-wrapper')).toBeFocused();
        // …but the click handler still fired (click and mousedown are separate).
        expect(await page.evaluate(() => window.__testBtnClicked)).toBe(true);
    });

    // AC-2 — <select> branch: restores focus to the passed restoreTarget on change.
    test('<select> wired via retainFocus restores focus to the passed target on change', async ({ page }) => {
        await page.goto('/');

        await page.evaluate(async () => {
            const { retainFocus } = await import('/renderer/focus.js');
            const sel = document.createElement('select');
            sel.id = '__test-retain-select';
            for (const v of ['a', 'b']) {
                const o = document.createElement('option');
                o.value = v;
                o.textContent = v;
                sel.appendChild(o);
            }
            document.body.appendChild(sel);
            retainFocus(sel, document.getElementById('terminal-wrapper'));
        });

        // Focus lands on the select, then a change restores it to the wrapper.
        await page.locator('#__test-retain-select').focus();
        await expect(page.locator('#__test-retain-select')).toBeFocused();
        await page.locator('#__test-retain-select').selectOption('b');
        await expect(page.locator('#terminal-wrapper')).toBeFocused();
    });

    // AC-4 — test hook reflects wired elements (the theme-button proof site is
    // wired via retainFocus at boot → at least one mousedown-branch entry).
    test('window.__focus.__getStateForTests() reflects wired elements', async ({ page }) => {
        await page.goto('/');
        // Wait in-page for boot to run main.js (which sets window.__focus) and
        // wireChrome (which wires the theme button via retainFocus). Polling
        // in-browser is race-proof: it tolerates window.__focus not yet existing
        // rather than throwing across the evaluate boundary.
        await page.waitForFunction(
            () => Boolean(window.__focus) && window.__focus.__getStateForTests().retainedCount >= 1,
        );
        const state = await page.evaluate(() => window.__focus.__getStateForTests());
        expect(state.retainedCount).toBeGreaterThanOrEqual(1);
        expect(state.elements.some((e) => e.branch === 'mousedown')).toBe(true);
    });
});
