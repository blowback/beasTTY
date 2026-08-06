// Review fix (E11 S11.1 follow-up) — half-open rollback.
//
// open() resolving and the connection succeeding are not the same event. Between
// them sit setSignals() and writable.getWriter(), and every path assigns the
// module-level `port` only AFTER all of them. So a throw in that window used to
// leave the device open with nothing referencing it: teardown() walks `port`, which
// is still null, and nothing else has the handle. The port stayed open until the
// page reloaded — locked against every other tab, and against this tab's own retry.
//
// The retry case is the sharp end. handleReconnect fed a still-open port to the
// D-04 retry, whose open() then rejects InvalidStateError — a name isPortInUse()
// classifies as "another Beastty tab". A setSignals fault therefore surfaced, 500ms
// later, as an instruction to go find a tab that was never there.
import { test, expect } from '@playwright/test';
import { SERIAL_MOCK } from './mock-serial.js';

const IN_USE = 'already connected in another Beastty tab';

async function setup(page) {
    await page.addInitScript(SERIAL_MOCK);
    await page.goto('/');
    await page.locator('#terminal-wrapper').focus();
    await page.waitForFunction(() => document.getElementById('terminal').width > 0);
}

// DOMException-shaped, and specifically NetworkError: that is what setSignals()
// rejects with per the Web Serial spec, and it is the name isPortInUse() matches.
// A plain Error would pass this test for the wrong reason.
async function failSetSignals(page, on = true) {
    await page.evaluate((enable) => {
        window.__forceSetSignalsReject = enable
            ? { name: 'NetworkError', message: 'signal fault' }
            : undefined;
    }, on);
}

const connectClick = async (page) => {
    await page.evaluate(() => window.__menuBar.open('connection'));
    await page.click('#menu-connect-item');
};

test.describe('half-open rollback — open() succeeded, a later step threw', () => {
    test('Connect: setSignals failure closes the port instead of stranding it open @fast', async ({ page }) => {
        await setup(page);
        await failSetSignals(page);
        await connectClick(page);
        await expect(page.locator('#menu-connect-item')).toHaveAttribute('data-state', 'disconnected');

        // The port this tab opened must not still be open.
        expect(await page.evaluate(() => navigator.serial._grantedPorts[0]._opened)).toBe(false);
        // And close() was genuinely called, not just a flag flipped elsewhere.
        expect(await page.evaluate(() => window.__mockLockLog.some((e) => e.op === 'close'))).toBe(true);

        // Companion assert: THIS tab held the device, so the in-use copy would be
        // a lie. fromOpen=false routes it to the generic framing.
        await expect(page.locator('#port-status')).toHaveText('Could not open port: signal fault');
        await expect(page.locator('#error-log')).not.toContainText(IN_USE);

        // A subsequent healthy attempt still works.
        await failSetSignals(page, false);
        await connectClick(page);
        await expect(page.locator('#menu-connect-item')).toHaveAttribute('data-state', 'connected');
    });

    test('Reconnect: a setSignals fault never reads as "another Beastty tab" @fast', async ({ page }) => {
        await setup(page);
        await connectClick(page);
        await expect(page.locator('#menu-connect-item')).toHaveAttribute('data-state', 'connected');

        // Unplug → replug drives handleReconnect, whose failure schedules the single
        // D-04 retry 500ms later. Both attempts hit the setSignals fault.
        await failSetSignals(page);
        await page.evaluate(() => window.__simulateUnplug());
        await expect(page.locator('#menu-connect-item')).toHaveAttribute('data-state', 'port-lost');
        await page.evaluate(() => window.__simulateReplug());

        // The retry must report the real fault. Before the rollback fix this read
        // as the port-in-use copy, because the retry's open() found the port that
        // handleReconnect had left open.
        await expect(page.locator('#error-log')).toContainText('Reconnect failed: signal fault', { timeout: 3000 });
        await expect(page.locator('#error-log')).not.toContainText(IN_USE);
        await expect(page.locator('#menu-connect-item')).toHaveAttribute('data-state', 'port-lost');
        expect(await page.evaluate(() => navigator.serial._grantedPorts[0]._opened)).toBe(false);
    });
});
