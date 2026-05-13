// Beastty v1.1 polish — 260513-grs Task 2.
//
// slideConfirmTransfers preference: default ON preserves the existing
// Phase 9/12 confirm modal. When OFF, drops + picker selections begin
// transferring immediately; filename collisions auto-rename via the
// SLIDE-36 applyCollisionRenames helper.
//
// Spec scaffolding mirrors www/tests/transport/slide-collisions.spec.js
// (SERIAL_MOCK + MOCK_SERIAL_SLIDE_BOT + setInputFiles).

import { test, expect } from '@playwright/test';
import { SERIAL_MOCK } from './mock-serial.js';
import { MOCK_SERIAL_SLIDE_BOT } from './mock-serial-slide-bot.js';

async function setup(page) {
    await page.addInitScript(SERIAL_MOCK);
    await page.addInitScript(MOCK_SERIAL_SLIDE_BOT);
    await page.goto('/');
    await page.locator('#terminal-wrapper').focus();
    await page.waitForFunction(() => document.getElementById('terminal').width > 0);
    await page.locator('#connection').evaluate((el) => { el.open = true; });
}

test.beforeEach(async ({ page }) => {
    await setup(page);
    await page.locator('#connect-button').click();
    await expect.poll(
        () => page.evaluate(() => Boolean(navigator.serial._grantedPorts[0]?._reader)),
        { timeout: 8000 },
    ).toBe(true);
    await page.evaluate(() => {
        window.__slide?.__resetForTests?.();
        window.__fileSource?.__resetForTests?.();
        if (window.__mockWriterLog) window.__mockWriterLog.length = 0;
        window.__mockSlideBot?.reset?.();
        // Reset prefs to defaults so each test starts from a known baseline.
        window.__prefs?.resetPrefs?.();
    });
});

// ===== Test 1 — default ON preserves modal flow =====

test('slideConfirmTransfers default ON shows modal on picker selection', async ({ page }) => {
    // Default DEFAULTS.slideConfirmTransfers === true; confirm via getPrefs().
    const pref = await page.evaluate(() => window.__prefs.getPrefs().slideConfirmTransfers);
    expect(pref).toBe(true);

    await page.setInputFiles('#send-file-input', [
        { name: 'hello.txt', mimeType: 'text/plain', buffer: Buffer.from('a') },
    ]);

    // Modal MUST appear (Phase 9/12 flow preserved).
    await expect(page.locator('#send-modal')).toBeVisible();
});

// ===== Test 2 — toggle OFF skips modal =====

test('slideConfirmTransfers OFF skips modal + fires enterSendMode silently', async ({ page }) => {
    await page.evaluate(() => window.__prefs.savePrefs({ slideConfirmTransfers: false }));
    // Wait for the debounced flush (250ms) to land; getPrefs is in-memory so
    // this is mostly belt-and-braces, but it documents intent.
    await page.waitForTimeout(50);

    const pref = await page.evaluate(() => window.__prefs.getPrefs().slideConfirmTransfers);
    expect(pref).toBe(false);

    await page.setInputFiles('#send-file-input', [
        { name: 'hello.txt', mimeType: 'text/plain', buffer: Buffer.from('a') },
    ]);

    // Modal NEVER appears.
    await expect(page.locator('#send-modal')).toBeHidden();

    // hasPendingSendSession === true within ~200ms proves enterSendMode fired
    // without user confirmation.
    await expect.poll(
        () => page.evaluate(() => window.__slide.__getStateForTests().hasPendingSendSession),
        { timeout: 2000 },
    ).toBe(true);
});

// ===== Test 3 — Settings checkbox round-trip =====

test('#slide-confirm-transfers-checkbox round-trips through savePrefs', async ({ page }) => {
    // Open the Settings → SLIDE disclosure so the checkbox is rendered + clickable.
    await page.locator('#settings').evaluate((el) => { el.open = true; });
    await page.locator('#settings-slide').evaluate((el) => { el.open = true; });

    const cb = page.locator('#slide-confirm-transfers-checkbox');

    // Boot state: checked (default ON).
    await expect(cb).toBeChecked();

    // Click → uncheck → pref becomes false.
    await cb.click();
    await expect(cb).not.toBeChecked();
    const off = await page.evaluate(() => window.__prefs.getPrefs().slideConfirmTransfers);
    expect(off).toBe(false);

    // Click → check → pref becomes true.
    await cb.click();
    await expect(cb).toBeChecked();
    const on = await page.evaluate(() => window.__prefs.getPrefs().slideConfirmTransfers);
    expect(on).toBe(true);

    // resetPrefs() → applyPrefs fires → checkbox reflects DEFAULTS (true).
    await page.evaluate(() => {
        window.__prefs.savePrefs({ slideConfirmTransfers: false });
        window.__prefs.resetPrefs();
    });
    await expect(cb).toBeChecked();
});
