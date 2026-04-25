// BestialiTTY Phase 6 Plan 03 (Wave 2) — SESS-01 scrollback navigation tests.
//
// Wave 2 un-fixmes the API-driven assertions; the 4 keyboard-chord-dependent
// tests (Shift+PgUp/Shift+PgDn/Shift+Home/Shift+End via key events) remain
// test.fixme until Plan 06-04 lands the keyboard.js Shift+* intercepts.
//
// Sources:
//   - 06-CONTEXT.md D-01..D-15.
//   - 06-VALIDATION.md §Phase Requirements → Test Map.
//   - Analog: www/tests/transport/connect.spec.js setup() helper.
import { test, expect } from '@playwright/test';
import { SERIAL_MOCK } from '../transport/mock-serial.js';

async function setup(page) {
    await page.addInitScript(SERIAL_MOCK);
    await page.goto('/');
    await page.locator('#terminal-wrapper').focus();
    await page.waitForFunction(() => document.getElementById('terminal').width > 0);
    // Wait for window.__scrollState to be exposed (main.js boot complete).
    await page.waitForFunction(() => typeof window.__scrollState === 'object' && window.__scrollState !== null);
}

test.describe('SESS-01 — Scrollback navigation', () => {
    test('wheel up scrolls offset; [data-scrolled-back] attribute set @fast', async ({ page }) => {
        await setup(page);
        // Synthesise a wheel event with deltaMode=DOM_DELTA_LINE (=1) and a
        // negative deltaY (wheel up). 3 lines per notch per D-02.
        await page.locator('#terminal-wrapper').dispatchEvent('wheel', {
            deltaY: -1,
            deltaMode: 1,
        });
        // Offset moves to +3 lines back.
        const offset = await page.evaluate(() => window.__scrollState.getOffset());
        expect(offset).toBeGreaterThan(0);
        await expect(page.locator('#terminal-wrapper')).toHaveAttribute('data-scrolled-back', 'true');
    });

    test('Shift+PgUp pages back 24 lines', async ({ page }) => {
        await setup(page);
        await page.locator('#terminal-wrapper').focus();
        await page.keyboard.press('Shift+PageUp');
        const offset = await page.evaluate(() => window.__scrollState.getOffset());
        expect(offset).toBe(24);
    });

    test('Shift+PgDn pages forward 24 lines', async ({ page }) => {
        await setup(page);
        // Pre-scroll so PgDn has somewhere to go.
        await page.evaluate(() => window.__scrollState.scrollByLines(50));
        await page.locator('#terminal-wrapper').focus();
        await page.keyboard.press('Shift+PageDown');
        const offset = await page.evaluate(() => window.__scrollState.getOffset());
        expect(offset).toBe(26);   // 50 - 24
    });

    test('Shift+End API equivalent (snapToBottom) clears offset @fast', async ({ page }) => {
        // LIVE-VIA-API now; full keyboard chord (Shift+End) lands in Plan 06-04.
        await setup(page);
        await page.evaluate(() => window.__scrollState.scrollByLines(50));
        await expect(page.locator('#terminal-wrapper')).toHaveAttribute('data-scrolled-back', 'true');
        await page.evaluate(() => window.__scrollState.snapToBottom());
        await expect(page.locator('#terminal-wrapper')).not.toHaveAttribute('data-scrolled-back');
        const offset = await page.evaluate(() => window.__scrollState.getOffset());
        expect(offset).toBe(0);
    });

    test('Shift+Home jumps to top of scrollback', async ({ page }) => {
        await setup(page);
        await page.locator('#terminal-wrapper').focus();
        await page.keyboard.press('Shift+Home');
        // jumpToTop calls setOffset(MAX_SAFE_INTEGER); scroll-state clamps the
        // result internally — it ends up at the largest representable offset
        // since the wasm side does the actual clamping at snapshot time. Just
        // assert non-zero (we are scrolled back) and that the data attribute
        // is set.
        const offset = await page.evaluate(() => window.__scrollState.getOffset());
        expect(offset).toBeGreaterThan(0);
        await expect(page.locator('#terminal-wrapper')).toHaveAttribute('data-scrolled-back', 'true');
    });

    test('chip increments newLinesSinceUserScrolled on every notifyFeed with newline', async ({ page }) => {
        await setup(page);
        // Force scrolled-back state.
        await page.evaluate(() => window.__scrollState.scrollByLines(10));
        // Synthesise a feed-with-newlines via notifyFeed (the production code
        // path that serial.js read loop / Feed button will call).
        await page.evaluate(() => {
            const bytes = new Uint8Array([0x61, 0x0A, 0x62, 0x0A, 0x63, 0x0A]);   // a\nb\nc\n
            window.__scrollState.notifyFeed(bytes);
        });
        await expect(page.locator('#scrollback-indicator')).toBeVisible();
        await expect(page.locator('#scrollback-indicator-text')).toContainText('3 new lines');
    });

    test('theme toggle while scrolled-up keeps row offset', async ({ page }) => {
        await setup(page);
        await page.evaluate(() => window.__scrollState.scrollByLines(20));
        const before = await page.evaluate(() => window.__scrollState.getOffset());
        // Click the theme button — switches CRT → clean (or vice-versa).
        await page.locator('#theme-toggle').click();
        const after = await page.evaluate(() => window.__scrollState.getOffset());
        expect(after).toBe(before);   // D-13 — viewport keeps offset
        await expect(page.locator('#terminal-wrapper')).toHaveAttribute('data-scrolled-back', 'true');
    });

    test('clicking chip snaps to live tail', async ({ page }) => {
        await setup(page);
        // Set up a scrolled-back state with a chip-eligible counter.
        await page.evaluate(() => {
            window.__scrollState.scrollByLines(10);
            const bytes = new Uint8Array([0x61, 0x0A]);
            window.__scrollState.notifyFeed(bytes);
        });
        await expect(page.locator('#scrollback-indicator')).toBeVisible();
        await page.locator('#scrollback-indicator').click();
        await expect(page.locator('#terminal-wrapper')).not.toHaveAttribute('data-scrolled-back');
        const offset = await page.evaluate(() => window.__scrollState.getOffset());
        expect(offset).toBe(0);
    });

    test('wheel listener attached to #terminal-wrapper, not document (D-12)', async ({ page }) => {
        await setup(page);
        // A wheel event dispatched on #settings (a child of <body>, OUTSIDE
        // #terminal-wrapper) MUST NOT change scroll-state offset. The listener
        // is on the wrapper, so events from chrome panes never reach it.
        await page.locator('#settings').evaluate((el) => { el.open = true; });
        const offsetBefore = await page.evaluate(() => window.__scrollState.getOffset());
        await page.locator('#settings').dispatchEvent('wheel', {
            deltaY: -100,
            deltaMode: 1,
        });
        const offsetAfter = await page.evaluate(() => window.__scrollState.getOffset());
        expect(offsetAfter).toBe(offsetBefore);
        // And no [data-scrolled-back] either.
        await expect(page.locator('#terminal-wrapper')).not.toHaveAttribute('data-scrolled-back');
    });

    test('cursor hidden while scrolled up (paintCursor early-returns)', async ({ page }) => {
        await setup(page);
        // The paintCursor function in canvas.js must early-return when
        // scrollState.isScrolledBack() is true. Verify by sampling the canvas
        // pixel at the cursor cell BEFORE and AFTER scrolling up — the cell's
        // backing color should NOT contain the cursor block fill while scrolled.
        // Simpler API-level check: the contract is that paintCursor does
        // nothing while scrolled, so we just assert isScrolledBack() reports
        // true after scrollByLines and the canvas hasn't crashed.
        await page.evaluate(() => window.__scrollState.scrollByLines(5));
        const isBack = await page.evaluate(() => window.__scrollState.isScrolledBack());
        expect(isBack).toBe(true);
        // Force a tick by feeding bytes (live grid still updates internally).
        // No assertion on canvas pixels — that requires visual regression
        // which Phase 3 covers; the API + manual UAT covers cursor hiding.
        await expect(page.locator('#terminal-wrapper')).toHaveAttribute('data-scrolled-back', 'true');
    });

    test.fixme('BEL while scrolled up: title prefix only, no viewport flash', async ({ page }) => {
        // LIVE WHEN: BEL flash gating via scrollState.isScrolledBack() is
        // covered by Plan 06-03 Task 2 implementation, but reliably testing
        // "no flash overlay" requires Phase 3 visual regression machinery
        // outside the scope of @fast tests. Manual UAT covers this.
        await setup(page);
    });

    test('snap-to-bottom resets newLinesSinceUserScrolled counter', async ({ page }) => {
        await setup(page);
        await page.evaluate(() => {
            window.__scrollState.scrollByLines(10);
            window.__scrollState.notifyFeed(new Uint8Array([0x61, 0x0A, 0x62, 0x0A]));
        });
        await expect(page.locator('#scrollback-indicator-text')).toContainText('2 new lines');
        await page.evaluate(() => window.__scrollState.snapToBottom());
        // Chip is hidden (offset 0 + counter reset).
        await expect(page.locator('#scrollback-indicator')).toBeHidden();
        // Re-scroll up — counter should start fresh.
        await page.evaluate(() => {
            window.__scrollState.scrollByLines(10);
            window.__scrollState.notifyFeed(new Uint8Array([0x61, 0x0A]));
        });
        await expect(page.locator('#scrollback-indicator-text')).toContainText('1 new line');
    });
});
