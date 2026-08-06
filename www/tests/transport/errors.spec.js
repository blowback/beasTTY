// Phase 5 Plan 01 (Wave 0) — D-27, D-28, D-29, D-37, D-40 stub spec.
// Source: 05-RESEARCH.md §Validation Architecture; 05-CONTEXT.md D-27, D-28, D-29, D-37; 05-UI-SPEC.md §Copywriting Contract.
// Stubs are test.fixme until later waves land production code.
//
// E2.3 (FR-15, AD-6) — #error-log MOVED from the <details id="connection"> pane into
// #serial-config-modal, and the D-27 auto-expand (connectionPane.open = true) was
// REMOVED (a modal must not showModal() itself on every error). Log CONTENT asserts
// (.innerHTML / .toContainText) read textContent and work while the dialog is closed;
// the one VISIBILITY assert opens the modal via openLog() (the deliberate view path).
import { test, expect } from '@playwright/test';
import { SERIAL_MOCK } from './mock-serial.js';

async function setup(page) {
    await page.addInitScript(SERIAL_MOCK);
    await page.goto('/');
    await page.locator('#terminal-wrapper').focus();
    await page.waitForFunction(() => document.getElementById('terminal').width > 0);
}

// Open #serial-config-modal so the #error-log inside it is visible (the deliberate
// path a user takes to read accumulated errors — E2.3 AC-6).
async function openLog(page) {
    await page.evaluate(() => document.getElementById('serial-config-modal').showModal());
    await expect(page.locator('#serial-config-modal')).toBeVisible();
}

test.describe('D-27..D-29 + D-37 — Error log & lifecycle', () => {
    test('error log shows last 5 entries newest-first @fast', async ({ page }) => {
        await setup(page);
        // Force 6 consecutive open-failures by overriding requestPort to return
        // a port whose open() always throws. After the 6th click the ring should
        // hold exactly the last 5.
        await page.evaluate(() => {
            const origRequest = navigator.serial.requestPort.bind(navigator.serial);
            navigator.serial.requestPort = () => origRequest().then((p) => {
                p.open = async () => { throw new Error(`fail-${Date.now()}`); };
                return p;
            });
        });
        for (let i = 0; i < 6; i++) {
            await page.evaluate(() => window.__menuBar.open('connection'));
            await page.click('#menu-connect-item');
            await expect(page.locator('#menu-connect-item')).toHaveAttribute('data-state', 'disconnected');
        }
        const logHtml = await page.locator('#error-log').innerHTML();
        const entries = (logHtml.match(/log-entry/g) || []).length;
        expect(entries).toBe(5);   // last 5 only; oldest dropped (D-27 ring-of-5)
    });

    test('permission revoked mid-read shows permission-revoked code', async ({ page }) => {
        await setup(page);
        await page.evaluate(() => window.__menuBar.open('connection'));
        await page.click('#menu-connect-item');
        await expect(page.locator('#menu-connect-item')).toHaveAttribute('data-state', 'connected');
        // Simulate a NetworkError out of the read loop by resolving the pending
        // read() with a throw. Our mock's reader stores the resolver at
        // `_reader.waiter` when read() is awaiting; we reject it instead.
        await page.evaluate(() => {
            const port = navigator.serial._grantedPorts[0];
            if (port._reader && port._reader.waiter) {
                const err = new Error('permission revoked');
                err.name = 'NetworkError';
                // Replace the mock's resolve path with a throw by rewriting the
                // waiter to a thenable that rejects. The simplest route: swap
                // read() so the in-flight await sees a rejection.
                const origRead = port._reader.read.bind(port._reader);
                let first = true;
                port._reader.read = async () => {
                    if (first) { first = false; throw err; }
                    return origRead();
                };
                // Unblock the in-flight read() so the next .read() call hits our override.
                if (port._reader.waiter) {
                    port._reader.waiter({ value: new Uint8Array([0x00]), done: false });
                    port._reader.waiter = null;
                }
            }
        });
        // Wait for the log to pick up the permission-revoked entry.
        await expect(page.locator('#error-log')).toContainText('permission-revoked', { timeout: 3000 });
    });

    test('port-in-use error on open shows port-in-use code', async ({ page }) => {
        await setup(page);
        await page.evaluate(() => {
            const origRequest = navigator.serial.requestPort.bind(navigator.serial);
            navigator.serial.requestPort = () => origRequest().then((p) => {
                p.open = async () => {
                    const e = new Error('port is in use');
                    e.name = 'InvalidStateError';
                    throw e;
                };
                return p;
            });
        });
        await page.evaluate(() => window.__menuBar.open('connection'));
        await page.click('#menu-connect-item');
        await expect(page.locator('#error-log')).toContainText('port-in-use');
        await expect(page.locator('#error-log')).toContainText('another Beastty tab');
    });

    // ===== E11 S11.1 AC-5 — the in-use message, and the shape it is classified on =====
    //
    // Two failures pinned here. First, the copy: the message told the user to CLOSE
    // the other tab, which is the exact configuration E11 needs them to keep open —
    // the right advice is to pick the other MicroBeast, or free this one deliberately.
    // Second, the classifier: it keyed only on InvalidStateError, which per the Web
    // Serial spec is the SAME-PAGE "this SerialPort is already open" check. A second
    // tab holds a DIFFERENT SerialPort object whose state is closed, so its open()
    // sails past that check and fails at device acquisition instead. The case above
    // forces InvalidStateError by hand and so had never exercised the real cross-tab
    // shape at all. So these specs wedge without the widened classifier and the
    // reworded message.
    const IN_USE_MSG = 'That MicroBeast is already connected in another Beastty tab. Choose a different one, or disconnect it there first.';

    // Force the picker to hand back a port whose open() rejects with a given shape.
    async function rejectOpenWith(page, name, message) {
        await page.evaluate(({ name, message }) => {
            const origRequest = navigator.serial.requestPort.bind(navigator.serial);
            navigator.serial.requestPort = () => origRequest().then((p) => {
                p.open = async () => {
                    const e = new Error(message);
                    e.name = name;
                    throw e;
                };
                return p;
            });
        }, { name, message });
        await page.evaluate(() => window.__menuBar.open('connection'));
        await page.click('#menu-connect-item');
    }

    test('AC-5 — the same-page shape produces the verbatim message and never says "close"', async ({ page }) => {
        await setup(page);
        await rejectOpenWith(page, 'InvalidStateError', 'Failed to open serial port.');
        await expect(page.locator('#error-log')).toContainText('port-in-use');
        await expect(page.locator('#error-log')).toContainText(IN_USE_MSG);
        // The advice this story exists to remove. E11 needs the other tab OPEN.
        await expect(page.locator('#error-log')).not.toContainText('close it to connect here');
    });

    // AC-6 — the name and message below are what Chromium ACTUALLY threw on the
    // 2026-08-06 two-tab checkpoint, not what the spec text predicts. Recorded in
    // the story's Debug Log.
    const CROSS_TAB_MSG = "Failed to execute 'open' on 'SerialPort': Failed to open serial port.";

    test('AC-5 — the cross-tab shape produces the SAME message, not the generic open failure', async ({ page }) => {
        await setup(page);
        await rejectOpenWith(page, 'NetworkError', CROSS_TAB_MSG);
        await expect(page.locator('#error-log')).toContainText('port-in-use');
        await expect(page.locator('#error-log')).toContainText(IN_USE_MSG);
        // Before the widening this fell through to "Could not open port: …".
        await expect(page.locator('#error-log')).not.toContainText('Could not open port');
    });

    test('AC-5 — a genuinely different open failure is still NOT called an in-use failure', async ({ page }) => {
        await setup(page);
        // The classifier keys on err.name and nothing else, so this pins the other
        // half of that: a name it does not know stays generic. Without it, widening
        // to cover the cross-tab shape could quietly turn the in-use message into
        // the answer to every open failure.
        await rejectOpenWith(page, 'UnknownError', 'device disappeared');
        await expect(page.locator('#error-log')).toContainText('open-failed');
        await expect(page.locator('#error-log')).toContainText('Could not open port: device disappeared');
        await expect(page.locator('#error-log')).not.toContainText('another Beastty tab');
    });

    test('multiple CP2102N adapters on reconnect shows multiple-adapters code', async ({ page }) => {
        await setup(page);
        await page.evaluate(() => window.__menuBar.open('connection'));
        await page.click('#menu-connect-item');
        await expect(page.locator('#menu-connect-item')).toHaveAttribute('data-state', 'connected');
        // Inject a second CP2102N port + replace the first so identity match fails.
        await page.evaluate(() => {
            const Mock = navigator.serial._grantedPorts[0].constructor;
            // Unplug the currently-connected port (triggers port-lost).
            // We'll mutate _grantedPorts so the next getPorts() returns 2 matches,
            // neither of which === lastPortRef (D-25 ambiguity branch).
            // First, simulate unplug of the current port.
            window.__simulateUnplug();
            // Now replace the granted list with TWO new ports that both match VID/PID.
            navigator.serial._grantedPorts = [
                new Mock({ usbVendorId: 0x10c4, usbProductId: 0xea60 }),
                new Mock({ usbVendorId: 0x10c4, usbProductId: 0xea60 }),
            ];
        });
        await expect(page.locator('#menu-connect-item')).toHaveAttribute('data-state', 'port-lost');
        // Dispatch a connect event on navigator.serial; onNavSerialConnect reads
        // getPorts() (now ambiguous) and lands in Choose MicroBeast... + log.
        await page.evaluate(() => {
            const ev = new Event('connect', { bubbles: true });
            Object.defineProperty(ev, 'target', { value: navigator.serial._grantedPorts[0] });
            navigator.serial.dispatchEvent(ev);
        });
        await expect(page.locator('#error-log')).toContainText('multiple-adapters', { timeout: 2000 });
        await expect(page.locator('#menu-connect-item .lbl')).toHaveText('Choose MicroBeast…');
    });

    test('error log timestamp uses HH:MM:SS 24-hour format', async ({ page }) => {
        await setup(page);
        // Force one open-failure to populate a log entry with timestamp.
        await page.evaluate(() => {
            const origRequest = navigator.serial.requestPort.bind(navigator.serial);
            navigator.serial.requestPort = () => origRequest().then((p) => {
                p.open = async () => { throw new Error('boom'); };
                return p;
            });
        });
        await page.evaluate(() => window.__menuBar.open('connection'));
        await page.click('#menu-connect-item');
        // Open the modal to VIEW the log (E2.3 — no more auto-expand; opening the
        // Serial Configuration modal is the deliberate path to read errors).
        await openLog(page);
        await expect(page.locator('#error-log .log-ts').first()).toBeVisible();
        const ts = await page.locator('#error-log .log-ts').first().textContent();
        expect(ts).toMatch(/^\d{2}:\d{2}:\d{2}$/);
    });
});
