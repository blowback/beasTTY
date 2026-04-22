// Phase 4 Plan 04 — SC-5 (IME half) — compositionend emits committed bytes once; no double-emit.
// RESEARCH Open Question 1: Playwright's synthetic CompositionEvent may not
// drive Chromium's internal isComposing flag. We ship the automated assertion
// covering the listener logic (our isComposing flag in keyboard.js is set/
// cleared by our own compositionstart/end handlers); the full end-to-end
// check (native IME → no double-emit) is manual UAT (VALIDATION.md Manual-Only
// Verifications, row "Real IME composition").
import { test, expect } from '@playwright/test';

async function setup(page) {
    await page.goto('/');
    await page.locator('#terminal-wrapper').focus();
    await page.waitForFunction(() => document.getElementById('terminal').width > 0);
    await page.locator('#debug').evaluate((el) => { el.open = true; });
    await page.locator('#tx-reset').click();
}

test.describe('SC-5 — IME composition does not double-emit', () => {
    test('synthetic compositionend emits the committed data once', async ({ page }) => {
        await setup(page);

        // Dispatch a compositionstart → compositionend lifecycle with data 'a'.
        // Our keyboard.js compositionend handler iterates event.data bytes and
        // pushes each to pushTxBytes via encode_key_raw.
        await page.evaluate(() => {
            const el = document.getElementById('terminal-wrapper');
            el.dispatchEvent(new CompositionEvent('compositionstart', { data: '' }));
            el.dispatchEvent(new CompositionEvent('compositionupdate', { data: 'a' }));
            el.dispatchEvent(new CompositionEvent('compositionend', { data: 'a' }));
        });

        // Expect exactly one 'a' byte (0x61), not two.
        await expect(page.locator('#tx-strip')).toHaveText('61');
    });

    test('compositionend with multi-char data emits each byte in order', async ({ page }) => {
        await setup(page);

        await page.evaluate(() => {
            const el = document.getElementById('terminal-wrapper');
            el.dispatchEvent(new CompositionEvent('compositionstart', { data: '' }));
            el.dispatchEvent(new CompositionEvent('compositionend', { data: 'abc' }));
        });

        await expect(page.locator('#tx-strip')).toHaveText('61 62 63');
    });

    test('keydown during composition (isComposing===true) is dropped', async ({ page }) => {
        await setup(page);

        // Enter composition state.
        await page.evaluate(() => {
            const el = document.getElementById('terminal-wrapper');
            el.dispatchEvent(new CompositionEvent('compositionstart', { data: '' }));
        });

        // Press a key while our flag is set.
        await page.keyboard.press('Shift+KeyA');

        // Exit composition with empty data.
        await page.evaluate(() => {
            const el = document.getElementById('terminal-wrapper');
            el.dispatchEvent(new CompositionEvent('compositionend', { data: '' }));
        });

        // Our keyboard.js isComposing flag suppressed the Shift+KeyA keydown.
        // The compositionend with empty data adds nothing either, so TX is empty.
        // (Note: if Chromium also drives its own isComposing for the physical
        // keydown this test becomes even more robust; we do NOT rely on that.)
        const stripText = await page.locator('#tx-strip').textContent();
        expect(stripText).not.toContain('41');
    });
});
