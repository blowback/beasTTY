// Phase 5 Plan 05-06 (Wave 5) — XPORT-09 + D-12..D-23/D-41 full paste-pump spec.
// Source: 05-RESEARCH.md §Validation Architecture; 05-CONTEXT.md D-12..D-23, D-41.
// Wave 0 seeded 8 test.fixme stubs; Wave 5 un-fixmes each as live assertions.
//
// E7.1 — paste progress + the large-paste confirm now render on the centered
// #paste-toast (renderer/paste-toast.js), an absolute overlay inside
// #terminal-wrapper. The retired #top-bar #paste-progress-row and its cancel/
// confirm buttons are gone; Connect is driven via the Connection menu row (the
// #connect-button retired with #top-bar). See tests/render/paste-toast.spec.js
// for the dedicated toast suite.
import { test, expect } from '@playwright/test';
import { SERIAL_MOCK } from './mock-serial.js';

async function setup(page) {
    await page.addInitScript(SERIAL_MOCK);
    await page.goto('/');
    await page.locator('#terminal-wrapper').focus();
    await page.waitForFunction(() => document.getElementById('terminal').width > 0);
    await page.locator('#debug').evaluate((el) => { el.open = true; });
}

test.describe('XPORT-09 + D-12..D-23/D-41 — Paste pump', () => {
    test('Paste test button routes textarea through paste-pump @fast', async ({ page }) => {
        await setup(page);
        await page.evaluate(() => window.__menuBar.open('connection'));
        await page.click('#menu-connect-item');
        await expect(page.locator('#menu-connect-item')).toHaveAttribute('data-state', 'connected');
        await page.locator('#debug').evaluate((el) => { el.open = true; });
        await page.locator('#input').fill('HELLO');
        await page.locator('#paste-test').click();
        // Expect 5 bytes to reach mock writer log.
        await expect.poll(async () => {
            return await page.evaluate(() => {
                return window.__mockWriterLog.reduce((a, e) => a + e.bytes.length, 0);
            });
        }, { timeout: 3000 }).toBeGreaterThanOrEqual(5);
    });

    test('paste at 19200 baud paces >= 95% of expected duration @slow', async ({ page }) => {
        await setup(page);
        await page.evaluate(() => window.__menuBar.open('connection'));
        await page.click('#menu-connect-item');
        await expect(page.locator('#menu-connect-item')).toHaveAttribute('data-state', 'connected');
        await page.locator('#debug').evaluate((el) => { el.open = true; });
        const size = 1024;  // 32 chunks × 32B
        const content = 'A'.repeat(size);
        const expectedMs = Math.round(size / (19200 / 10 * 0.90) * 1000);
        await page.locator('#input').fill(content);
        const t0 = await page.evaluate(() => performance.now());
        await page.locator('#paste-test').click();
        await page.waitForFunction(() => {
            return window.__mockWriterLog.reduce((a, e) => a + e.bytes.length, 0) >= 1024;
        }, { timeout: 10_000 });
        const elapsed = await page.evaluate((t) => performance.now() - t, t0);
        // D-41 tolerance: >= 95% of expected.
        expect(elapsed).toBeGreaterThanOrEqual(expectedMs * 0.95);
    });

    test('progress line Pasting N B — P% updates per chunk', async ({ page }) => {
        await setup(page);
        await page.evaluate(() => window.__menuBar.open('connection'));
        await page.click('#menu-connect-item');
        await expect(page.locator('#menu-connect-item')).toHaveAttribute('data-state', 'connected');
        await page.locator('#debug').evaluate((el) => { el.open = true; });
        await page.locator('#input').fill('B'.repeat(256));
        await page.locator('#paste-test').click();
        await expect(page.locator('#paste-toast-text')).toContainText('Pasting 256 B —', { timeout: 2000 });
        // Wait for completion.
        await expect(page.locator('#paste-toast-text')).toContainText('Paste complete', { timeout: 5000 });
    });

    test('Cancel button halts pump and shows "Paste cancelled"', async ({ page }) => {
        await setup(page);
        await page.evaluate(() => window.__menuBar.open('connection'));
        await page.click('#menu-connect-item');
        await expect(page.locator('#menu-connect-item')).toHaveAttribute('data-state', 'connected');
        await page.locator('#debug').evaluate((el) => { el.open = true; });
        await page.locator('#input').fill('C'.repeat(4096));   // large enough that we can cancel mid-stream
        await page.locator('#paste-test').click();
        await expect(page.locator('#paste-toast')).toBeVisible({ timeout: 2000 });
        await page.locator('#paste-toast button[data-action="cancel"]').click();
        await expect(page.locator('#paste-toast-text')).toContainText('Paste cancelled', { timeout: 2000 });
    });

    test('Esc while paste active cancels and does NOT emit 0x1B', async ({ page }) => {
        await setup(page);
        await page.evaluate(() => window.__menuBar.open('connection'));
        await page.click('#menu-connect-item');
        await expect(page.locator('#menu-connect-item')).toHaveAttribute('data-state', 'connected');
        await page.locator('#debug').evaluate((el) => { el.open = true; });
        await page.locator('#input').fill('D'.repeat(4096));
        await page.locator('#paste-test').click();
        await expect(page.locator('#paste-toast')).toBeVisible();
        // Clear __mockWriterLog so we can inspect post-Esc writes cleanly.
        await page.evaluate(() => window.__mockWriterLog.length = 0);
        await page.locator('#terminal-wrapper').focus();
        await page.keyboard.press('Escape');
        await expect(page.locator('#paste-toast-text')).toContainText('Paste cancelled');
        // Ensure no 0x1B byte was emitted AFTER the Escape.
        const post = await page.evaluate(() => {
            return window.__mockWriterLog.flatMap(e => e.bytes);
        });
        expect(post).not.toContain(0x1B);
    });

    test('keypresses interleaved during paste queue-jump between chunks', async ({ page }) => {
        await setup(page);
        await page.evaluate(() => window.__menuBar.open('connection'));
        await page.click('#menu-connect-item');
        await expect(page.locator('#menu-connect-item')).toHaveAttribute('data-state', 'connected');
        await page.locator('#debug').evaluate((el) => { el.open = true; });
        await page.locator('#input').fill('E'.repeat(512));
        await page.locator('#paste-test').click();
        // Wait for pump to start.
        await expect(page.locator('#paste-toast')).toBeVisible();
        // Interject a keypress — goes directly through tx-sink.pushTxBytes (D-19 queue-jump).
        await page.locator('#terminal-wrapper').focus();
        await page.keyboard.press('A');
        // Wait for paste to finish.
        await expect(page.locator('#paste-toast-text')).toContainText('Paste complete', { timeout: 5000 });
        // Inspect writer log: 0x41 ('A') must appear BETWEEN runs of 0x45 ('E') bytes — i.e. not only before/after the paste.
        const log = await page.evaluate(() => window.__mockWriterLog);
        // Find an 'A' write (single-byte 0x41) sandwiched by 'E' writes (32-byte 0x45 chunks).
        let sandwiched = false;
        for (let i = 1; i < log.length - 1; i++) {
            const prev = log[i - 1].bytes;
            const curr = log[i].bytes;
            const next = log[i + 1].bytes;
            if (curr.length === 1 && curr[0] === 0x41 && prev[0] === 0x45 && next[0] === 0x45) {
                sandwiched = true; break;
            }
        }
        expect(sandwiched).toBe(true);
    });

    test('port-lost mid-paste shows "Paste cancelled — port lost (N bytes unsent)"', async ({ page }) => {
        await setup(page);
        await page.evaluate(() => window.__menuBar.open('connection'));
        await page.click('#menu-connect-item');
        await expect(page.locator('#menu-connect-item')).toHaveAttribute('data-state', 'connected');
        await page.locator('#debug').evaluate((el) => { el.open = true; });
        await page.locator('#input').fill('F'.repeat(4096));
        await page.locator('#paste-test').click();
        await expect(page.locator('#paste-toast')).toBeVisible();
        await page.evaluate(() => window.__simulateUnplug());
        await expect(page.locator('#paste-toast-text')).toContainText('Paste cancelled — port lost', { timeout: 2000 });
        await expect(page.locator('#paste-toast-text')).toContainText('bytes unsent');
    });

    test('CR/LF mode crlf rewrites 0x0D to 0x0D 0x0A before enqueue', async ({ page }) => {
        await setup(page);
        await page.evaluate(() => window.__menuBar.open('connection'));
        await page.click('#menu-connect-item');
        await expect(page.locator('#menu-connect-item')).toHaveAttribute('data-state', 'connected');
        // E7.1 — set CR/LF mode via the Settings ▸ Enter key sends submenu (the
        // legacy #crlf-* radios retired with <details id="settings">).
        await page.evaluate(() => window.__menuBar.open('settings'));
        await page.click('#dropdown-settings .menu-item[data-submenu="crlf"]');
        await page.click('#dropdown-settings .submenu[data-submenu-panel="crlf"] .menu-item[data-value="crlf"]');
        await page.evaluate(() => window.__menuBar.close());
        await page.locator('#debug').evaluate((el) => { el.open = true; });
        await page.locator('#input').fill('\\x0D');   // single CR as \x0D
        await page.locator('#paste-test').click();
        await expect.poll(async () => {
            return await page.evaluate(() => window.__mockWriterLog.flatMap(e => e.bytes));
        }, { timeout: 3000 }).toEqual([0x0D, 0x0A]);
    });

    // E7.1 — the Gap-2 "paste must not auto-expand the Connection pane" regression
    // retired with #top-bar / <details id="connection">. Its invariant — paste
    // progress is visible WITHOUT displacing the terminal canvas — now holds by
    // construction: the #paste-toast is an absolute-positioned overlay inside
    // #terminal-wrapper (it never participates in layout / shifts the canvas).
    // This test proves that modern equivalent (the retired #top-bar/#connection
    // assertions are intentionally dropped; #top-bar-absence is covered by
    // menu-bar.spec.js + paste-toast.spec.js).
    //
    // Uses a 4 KB paste so the pump runs long enough (4096 / 32 = 128 chunks
    // × 18 ms ≈ 2.3 s at 19200 baud) for the assertions to land while the pump
    // is still active — short pastes finish in <100 ms which races the
    // toContainText('Pasting') assertion against 'Paste complete'.
    test('paste toast is a centered overlay that does not displace the canvas', async ({ page }) => {
        await setup(page);
        await page.evaluate(() => window.__menuBar.open('connection'));
        await page.click('#menu-connect-item');
        await expect(page.locator('#menu-connect-item')).toHaveAttribute('data-state', 'connected');

        // Open the debug pane + stage the paste FIRST (opening <details id="debug">
        // reflows the page), THEN capture the canvas geometry — so the only thing
        // that can move the canvas between boxBefore and boxDuring is the toast.
        await page.locator('#debug').evaluate((el) => { el.open = true; });
        await page.locator('#input').fill('G'.repeat(4096));
        const boxBefore = await page.locator('#terminal').boundingBox();

        await page.locator('#paste-test').click();

        await expect(page.locator('#paste-toast')).toBeVisible({ timeout: 2000 });
        await expect(page.locator('#paste-toast-text')).toContainText('Pasting', { timeout: 2000 });

        // The toast is an absolute overlay — the canvas has NOT moved or resized.
        const pos = await page.locator('#paste-toast').evaluate((el) => getComputedStyle(el).position);
        expect(pos).toBe('absolute');
        const boxDuring = await page.locator('#terminal').boundingBox();
        expect(boxDuring.x).toBeCloseTo(boxBefore.x, 0);
        expect(boxDuring.y).toBeCloseTo(boxBefore.y, 0);

        await expect(page.locator('#paste-toast-text')).toContainText('Paste complete', { timeout: 10_000 });
    });
});
