// Phase 5 Plan 08 (Wave 7 gap_closure) — Gap 1 (Reload hang) regression spec.
// Source: 05-HUMAN-UAT.md Gap 1; .planning/debug/reload-hang-page-unresponsive.md
//
// Asserts the beforeunload handler releases both reader and writer locks
// BEFORE calling port.close(). Violations of this ordering stall Chromium's
// renderer tear-down on the OLD page and surface as "Page unresponsive".
//
// Note: real browser unload lifecycle cannot be fully simulated in Playwright
// (beforeunload is not dispatchable via dispatchEvent in a way that runs
// page-lifecycle cleanup). This spec invokes the handler's logic via
// `window.dispatchEvent(new Event('beforeunload'))` which DOES fire the
// addEventListener callback synchronously — sufficient for asserting the
// close-contract ordering. Real-hardware UAT (05-HUMAN-UAT.md Test 3) is the
// end-to-end reload-while-connected verification.
import { test, expect } from '@playwright/test';
import { SERIAL_MOCK } from './mock-serial.js';

async function setup(page) {
    await page.addInitScript(SERIAL_MOCK);
    await page.goto('/');
    await page.locator('#terminal-wrapper').focus();
    await page.waitForFunction(() => document.getElementById('terminal').width > 0);
    await page.locator('#connection').evaluate((el) => { el.open = true; });
}

test.describe('Gap 1 — beforeunload close-contract (reload hang regression)', () => {
    test('beforeunload releases reader and writer locks before port.close (@fast)', async ({ page }) => {
        await setup(page);
        // Clear the lock log after setup (requestPort.open may have appended noise).
        await page.evaluate(() => { window.__mockLockLog = []; });

        // Connect so a port/reader/writer actually exist.
        await page.locator('#connect-button').click();
        await expect(page.locator('#connect-button')).toHaveAttribute('data-state', 'connected');

        // Clear again — we only care about events AFTER beforeunload fires.
        await page.evaluate(() => { window.__mockLockLog = []; });

        // Fire the beforeunload callback synchronously (the addEventListener
        // callback executes on dispatchEvent; the async .catch()-wrapped
        // promises settle after microtasks).
        await page.evaluate(() => window.dispatchEvent(new Event('beforeunload')));

        // Give fire-and-forget promises a tick to settle (cancel + close).
        await page.waitForFunction(() => {
            const ops = window.__mockLockLog.map(e => e.op);
            return ops.includes('close');
        }, null, { timeout: 2000 });

        const ops = await page.evaluate(() => window.__mockLockLog.map(e => e.op));

        // Contract: both locks released before close.
        const readerRelease = ops.indexOf('reader-release');
        const writerRelease = ops.indexOf('writer-release');
        const closeIdx      = ops.indexOf('close');
        expect(readerRelease, 'reader-release must be logged').toBeGreaterThanOrEqual(0);
        expect(writerRelease, 'writer-release must be logged').toBeGreaterThanOrEqual(0);
        expect(closeIdx,      'close must be logged').toBeGreaterThanOrEqual(0);
        expect(readerRelease, 'reader-release must precede port.close').toBeLessThan(closeIdx);
        expect(writerRelease, 'writer-release must precede port.close').toBeLessThan(closeIdx);

        // Cancel-before-release ordering (consistent with teardown() invariant).
        const readerCancel = ops.indexOf('reader-cancel');
        expect(readerCancel, 'reader-cancel must be logged').toBeGreaterThanOrEqual(0);
        expect(readerCancel, 'reader-cancel must precede reader-release').toBeLessThan(readerRelease);
    });

    test('shuttingDown guard prevents fresh reader re-acquisition during unload', async ({ page }) => {
        await setup(page);
        await page.locator('#connect-button').click();
        await expect(page.locator('#connect-button')).toHaveAttribute('data-state', 'connected');

        // Snapshot the reader identity BEFORE beforeunload.
        const readerBefore = await page.evaluate(() => {
            const p = navigator.serial._grantedPorts[0];
            return p && p._reader ? true : false;
        });
        expect(readerBefore).toBe(true);

        // Clear the log so we only count events that follow beforeunload.
        await page.evaluate(() => { window.__mockLockLog = []; });

        await page.evaluate(() => window.dispatchEvent(new Event('beforeunload')));

        // After beforeunload, runReadLoop's outer while(p.readable) should have
        // exited via the shuttingDown guard rather than acquired a fresh reader.
        // We assert this indirectly: exactly one reader-release event fires
        // (the beforeunload handler's synchronous releaseLock). If the outer
        // while had re-acquired, a second reader would eventually land in its
        // finally-block releaseLock and bump this to >=2.
        await page.waitForTimeout(50);
        const releaseCount = await page.evaluate(
            () => window.__mockLockLog.filter(e => e.op === 'reader-release').length
        );
        expect(releaseCount).toBe(1);
    });
});
