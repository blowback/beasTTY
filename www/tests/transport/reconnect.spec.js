// Phase 5 Plan 03 (Wave 2) — XPORT-06..08, XPORT-10 + SC-3 reconnect spec.
// Source: 05-RESEARCH.md §Validation Architecture; 05-CONTEXT.md D-03..D-05, D-24..D-26, D-30, D-31, D-36, D-37, D-42.
// Wave 2 lands the teardown cancel-before-close discipline; Wave 4 hardens unplug/replug + getPorts restore + localStorage persist.
import { test, expect } from '@playwright/test';
import { SERIAL_MOCK } from './mock-serial.js';

async function setup(page) {
    await page.addInitScript(SERIAL_MOCK);
    await page.goto('/');
    await page.locator('#terminal-wrapper').focus();
    await page.waitForFunction(() => document.getElementById('terminal').width > 0);
    await page.locator('#connection').evaluate((el) => { el.open = true; });
}

test.describe('XPORT-06..08, XPORT-10 + SC-3 + D-03..D-05/D-24..D-26/D-30..D-31/D-36/D-37/D-42 — Reconnect', () => {
    test('reader.cancel called before port.close on Disconnect click @fast', async ({ page }) => {
        await setup(page);
        // Instrument reader.cancel + port.close BEFORE clicking Connect so the
        // first cancel/close pair is captured. D-36 invariant: reader.cancel()
        // resolves the pending read() with { done: true } BEFORE port.close().
        await page.evaluate(() => {
            window.__teardownOrder = [];
            const poll = setInterval(() => {
                const p = navigator.serial._grantedPorts[0];
                if (p && p._reader && !p.__wrapped) {
                    const origCancel = p._reader.cancel.bind(p._reader);
                    p._reader.cancel = (...args) => {
                        window.__teardownOrder.push('cancel');
                        return origCancel(...args);
                    };
                    const origClose = p.close.bind(p);
                    p.close = (...args) => {
                        window.__teardownOrder.push('close');
                        return origClose(...args);
                    };
                    p.__wrapped = true;
                    clearInterval(poll);
                }
            }, 10);
            setTimeout(() => clearInterval(poll), 3000);
        });
        await page.locator('#connect-button').click();
        await expect(page.locator('#connect-button')).toHaveAttribute('data-state', 'connected');
        await expect.poll(
            () => page.evaluate(() => Boolean(navigator.serial._grantedPorts[0]?.__wrapped)),
            { timeout: 2000 },
        ).toBe(true);
        // Click Disconnect.
        await page.locator('#connect-button').click();
        await expect(page.locator('#connect-button')).toHaveAttribute('data-state', 'disconnected');
        const order = await page.evaluate(() => window.__teardownOrder);
        // Pitfall #1 invariant: reader.cancel MUST precede the FIRST port.close.
        // (runReadLoop's safety-net close after the reader resolves done:true may
        // produce a second 'close' entry — that is benign; port.close() is
        // idempotent and try/catch'd in both call sites.)
        const firstCancelIdx = order.indexOf('cancel');
        const firstCloseIdx = order.indexOf('close');
        expect(firstCancelIdx).toBeGreaterThanOrEqual(0);
        expect(firstCloseIdx).toBeGreaterThanOrEqual(0);
        expect(firstCancelIdx).toBeLessThan(firstCloseIdx);
    });

    test.fixme('simulateUnplug transitions state to port-lost', async ({ page }) => {
        await setup(page);
        await page.locator('#connect-button').click();
        await page.evaluate(() => window.__simulateUnplug());
        await expect(page.locator('#connect-button')).toHaveAttribute('data-state', 'port-lost');
    });

    test.fixme('simulateReplug with matching VID/PID auto-reconnects silently', async ({ page }) => {
        await setup(page);
        await page.locator('#connect-button').click();
        await page.evaluate(() => window.__simulateUnplug());
        await page.evaluate(() => window.__simulateReplug());
        await expect(page.locator('#connect-button')).toHaveAttribute('data-state', 'connected');
    });

    test.fixme('auto-reconnect retries once after 500ms on transient open fail', async ({ page }) => {
        await setup(page);
        expect(true).toBe(true);
    });

    test.fixme('reload with granted port stashes reference but does NOT auto-open', async ({ page }) => {
        await setup(page);
        expect(true).toBe(true);
    });

    test.fixme('connect/disconnect listeners registered on navigator.serial not port', async ({ page }) => {
        await setup(page);
        expect(true).toBe(true);
    });

    test.fixme('localStorage bestialitty.port.preset written after first open', async ({ page }) => {
        await setup(page);
        await page.locator('#connect-button').click();
        const preset = await page.evaluate(() => localStorage.getItem('bestialitty.port.preset'));
        expect(preset).toBeTruthy();
    });
});
