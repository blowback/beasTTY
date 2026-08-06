// Beastty Phase 6 Plan 06 (Wave 5) — PLAT-05/D-34 auto-connect-on-load.
//
// Wave 5 lands the auto-connect path inside wireSerial (gated on Pitfall 3
// race condition). All five stubs un-fixmed by Plan 06-06 Task 3.
//
// Sources:
//   - 06-CONTEXT.md D-34 (auto-connect-on-load — off by default; opt-in silent open).
//   - 06-RESEARCH.md Pitfall 3 (race against user click — state must be 'disconnected'
//                                at moment of invocation).
//   - 06-VALIDATION.md §Phase Requirements → Test Map (auto-connect row).
//   - Analog: www/tests/transport/connect.spec.js + www/tests/transport/reconnect.spec.js.
import { test, expect } from '@playwright/test';
import { SERIAL_MOCK } from '../transport/mock-serial.js';

const PREFS_AUTOCONNECT_ON = JSON.stringify({
    version: 1,
    theme: 'crt', phosphor: 'green', fontZoom: 1,
    serial: { baud: 19200, dataBits: 8, stopBits: 1, parity: 'none', flowControl: 'none' },
    localEcho: false, crlfMode: 'cr', autoConnect: true,
});
const PREFS_AUTOCONNECT_OFF = JSON.stringify({
    version: 1,
    theme: 'crt', phosphor: 'green', fontZoom: 1,
    serial: { baud: 19200, dataBits: 8, stopBits: 1, parity: 'none', flowControl: 'none' },
    localEcho: false, crlfMode: 'cr', autoConnect: false,
});
const PORT_PRESET = JSON.stringify({ usbVendorId: 0x10c4, usbProductId: 0xea60 });

// Order matters: hook flags MUST run BEFORE SERIAL_MOCK so the mock IIFE sees
// them when it inspects window.__preGrantPort / window.__forceOpenReject.
async function setupWithMock(page, { prefs, portPreset, preGrantPort, preGrantPortCount, forceOpenReject, rejectOpenWith } = {}) {
    if (preGrantPort || preGrantPortCount || forceOpenReject !== undefined) {
        await page.addInitScript((opts) => {
            if (opts.preGrantPort) window.__preGrantPort = true;
            // E11 S11.1 — opt-in multi-adapter pre-grant (mock-serial.js:125-146).
            if (opts.preGrantPortCount) window.__preGrantPortCount = opts.preGrantPortCount;
            if (typeof opts.forceOpenReject === 'string') window.__forceOpenReject = opts.forceOpenReject;
        }, { preGrantPort, preGrantPortCount, forceOpenReject });
    }
    if (prefs || portPreset) {
        await page.addInitScript((opts) => {
            if (opts.prefs) localStorage.setItem('beastty.prefs', opts.prefs);
            if (opts.portPreset) localStorage.setItem('beastty.port.preset', opts.portPreset);
        }, { prefs, portPreset });
    }
    await page.addInitScript(SERIAL_MOCK);
    // E11 S11.1 (AC-5) — reject the pre-granted port's open() with a specific
    // DOMException shape so the AUTO-CONNECT catch is exercised, not just the click
    // path. Added AFTER SERIAL_MOCK on purpose: init scripts run in the order they
    // were added, and the mock's IIFE has to have installed (and pre-granted) before
    // there is a port to patch. __forceOpenReject cannot serve here — it throws a
    // plain Error, and the classifier keys on err.name.
    if (rejectOpenWith) {
        await page.addInitScript((shape) => {
            const p = navigator.serial._grantedPorts[0];
            if (!p) return;
            p.open = async () => {
                const e = new Error(shape.message);
                e.name = shape.name;
                throw e;
            };
        }, rejectOpenWith);
    }
    await page.goto('/');
    await page.locator('#terminal-wrapper').focus();
    await page.waitForFunction(() => document.getElementById('terminal').width > 0);
}

test.describe('PLAT-05/D-34 — Auto-connect on load', () => {
    test('prefs.autoConnect=false → no silent open at boot @fast', async ({ page }) => {
        await setupWithMock(page, {
            prefs: PREFS_AUTOCONNECT_OFF,
            portPreset: PORT_PRESET,
            preGrantPort: true,
        });
        // Connect button must remain in the disconnected state — no silent open
        // is allowed when prefs.autoConnect=false (D-36 default).
        await expect(page.locator('#menu-connect-item')).toHaveAttribute('data-state', 'disconnected');
    });

    test('prefs.autoConnect=true + getPorts() match → silent connectMicroBeast() at boot', async ({ page }) => {
        await setupWithMock(page, {
            prefs: PREFS_AUTOCONNECT_ON,
            portPreset: PORT_PRESET,
            preGrantPort: true,
        });
        // Auto-connect should drive the connect button to data-state="connected"
        // without a click. Use the existing #connect-button[data-state] state
        // machine signal as the reliable, race-free assertion.
        await page.waitForSelector('#menu-connect-item[data-state="connected"]', { state: 'attached', timeout: 5000 });
    });

    test('prefs.autoConnect=true + getPorts() empty → log "auto-connect-failed", remain disconnected', async ({ page }) => {
        // No portPreset, no preGrantPort: getPorts() returns empty so lastPortRef
        // stays null and the auto-connect path takes the "no granted port" branch.
        await setupWithMock(page, { prefs: PREFS_AUTOCONNECT_ON });
        await expect(page.locator('#menu-connect-item')).toHaveAttribute('data-state', 'disconnected');
        // E2.3 (FR-15, AD-6) — #error-log lives in #serial-config-modal now and no
        // longer auto-expands anything (the D-27 pane auto-open was removed). The log
        // still populates the ring silently; toContainText reads its textContent even
        // while the modal is closed, so this asserts the auto-connect-failed code lands.
        await expect(page.locator('#error-log')).toContainText('auto-connect-failed');
    });

    test('prefs.autoConnect=true + open() rejects → log "auto-connect-failed: {err.message}"', async ({ page }) => {
        await setupWithMock(page, {
            prefs: PREFS_AUTOCONNECT_ON,
            portPreset: PORT_PRESET,
            preGrantPort: true,
            forceOpenReject: 'simulated open failure',
        });
        await expect(page.locator('#menu-connect-item')).toHaveAttribute('data-state', 'disconnected');
        await expect(page.locator('#error-log')).toContainText('simulated open failure');
    });

    test('auto-connect race: state must be "disconnected" at moment of invocation (Pitfall 3)', async ({ page }) => {
        await setupWithMock(page, {
            prefs: PREFS_AUTOCONNECT_ON,
            portPreset: PORT_PRESET,
            preGrantPort: true,
        });
        // Auto-connect path runs synchronously inside wireSerial — by the time
        // the page is interactive, the state machine has either landed on
        // 'connected' (auto-connect path won the race) or remained at
        // 'disconnected' for some reason. Either way, the open() call site
        // must NOT have fired twice (the `state === 'disconnected'` race gate
        // is what prevents the second open).
        await page.waitForSelector('#menu-connect-item[data-state="connected"]', { state: 'attached', timeout: 5000 });
        const openedTimes = await page.evaluate(() => window.__mockOpenCount || 0);
        // <= 1 covers both the auto-connect-only path and the user-click-only
        // path; > 1 would mean the race gate failed and we double-opened.
        expect(openedTimes).toBeLessThanOrEqual(1);
    });
});

// Epic E11 Story S11.1 — two tabs, two beasts.
//
// The failure these cases pin: the boot getPorts() scan used ports.find(), which
// returns the SAME first match in every tab. getInfo() carries only VID/PID
// (serial.js:45-46), so two identical CP2102N adapters are indistinguishable —
// there is no "the right one" to pick, yet the scan stashed one in lastPortRef
// anyway and the auto-connect branch then opened it. In the two-tab case that is
// the port the other tab owns.
//
// The repair is to filter rather than find, and to leave lastPortRef null when the
// match is ambiguous. Both cases below drive a two-adapter boot through the opt-in
// __preGrantPortCount hook, so this spec wedges without the filter-don't-find fix
// in wireSerial's boot scan.
test.describe('E11 S11.1 — ambiguous boot match (two identical adapters)', () => {
    // Review fix — a positive "the boot scan has finished" signal. #menu-connect-item
    // ships with data-state="disconnected" in the static markup (index.html:1716), so
    // asserting that attribute is satisfied before a single line of main.js has run
    // and proves nothing about the boot scan. The multi-adapter cue is only ever
    // painted BY that scan (onBootDeviceRecognized → showBootReady), so waiting on it
    // is what makes "nothing opened / nothing logged" a real assertion instead of a
    // race the test can win by being early.
    const MULTI_CUE = '2 MicroBeasts detected — click Connect to choose';
    const bootScanDone = (page) => expect(page.locator('#port-status')).toHaveText(MULTI_CUE);

    // AC-1 — the scan must not stash an arbitrary first match.
    //
    // lastPortRef is not exported and this story adds no hook to read it, so the
    // assertion goes through a reader that is observable: onNavSerialDisconnect
    // (serial.js:862) enters 'port-lost' when the vanished port === lastPortRef.
    // The event is dispatched at _grantedPorts[0] DELIBERATELY — that is the port
    // ports.find() used to stash, so before the fix this boots straight into
    // port-lost. __simulateUnplug targets _grantedPorts[length - 1] and would let
    // the case pass for the wrong reason (mock-serial.js:125-146).
    test('AC-1 — unplugging either adapter does not drop a disconnected tab into port-lost', async ({ page }) => {
        await setupWithMock(page, {
            prefs: PREFS_AUTOCONNECT_OFF,
            portPreset: PORT_PRESET,
            preGrantPortCount: 2,
        });
        await bootScanDone(page);
        await expect(page.locator('#menu-connect-item')).toHaveAttribute('data-state', 'disconnected');
        // Dispatch 'disconnect' at the FIRST granted port — the one the old
        // ports.find() stashed.
        await page.evaluate(() => {
            const ev = new Event('disconnect', { bubbles: true });
            Object.defineProperty(ev, 'target', { value: navigator.serial._grantedPorts[0] });
            navigator.serial.dispatchEvent(ev);
        });
        // With nothing open and two identical adapters attached, the tab genuinely
        // does not know which one was its own — so it stays disconnected.
        await expect.poll(
            () => page.locator('#menu-connect-item').getAttribute('data-state'),
            { timeout: 2000 },
        ).toBe('disconnected');
    });

    // AC-2 — auto-connect declines, and declines QUIETLY.
    //
    // The "no error entry" half is not cosmetic. status-bar.js:163-168 composes the
    // disconnected readout as lastConnectError > boot cue > 'Not connected', so any
    // entry logged here hides AC-3's "2 MicroBeasts detected" instruction behind a
    // failure that did not happen. It also lights the amber "▲ N recent errors"
    // affordance and the red-border Connect signal.
    //
    // Before the fix this boots to 'connected' (auto-connect opened the first
    // match); the naive repair instead falls into the existing `else if
    // (!lastPortRef)` arm, which logs 'auto-connect-failed'. Both are caught here.
    test('AC-2 — autoConnect on + ambiguous match: nothing opened, nothing logged', async ({ page }) => {
        await setupWithMock(page, {
            prefs: PREFS_AUTOCONNECT_ON,
            portPreset: PORT_PRESET,
            preGrantPortCount: 2,
        });
        await bootScanDone(page);
        await expect(page.locator('#menu-connect-item')).toHaveAttribute('data-state', 'disconnected');
        expect(await page.evaluate(() => window.__mockOpenCount || 0)).toBe(0);
        // No entry at all — not merely "not auto-connect-failed".
        await expect(page.locator('#error-log')).not.toContainText('auto-connect-failed');
        // The amber "▲ N recent errors" affordance must stay dark too — a boot that
        // logged nothing wrong must not light it (status-bar.js:220-225).
        const errors = await page.evaluate(() => window.__statusBar.__getStateForTests());
        expect(errors.hasErrors).toBe('false');
        expect(errors.errors).toBe('▲ 0 recent errors');
    });

    // AC-2, second half — declining must not cost the user their first click.
    // The Connect click path never skipped the picker (connectMicroBeast:455-467),
    // so it is honoured first time and lands on the port the user chose.
    test('AC-2 — the subsequent Connect click still goes through the picker and is honoured', async ({ page }) => {
        await setupWithMock(page, {
            prefs: PREFS_AUTOCONNECT_ON,
            portPreset: PORT_PRESET,
            preGrantPortCount: 2,
        });
        await bootScanDone(page);
        await expect(page.locator('#menu-connect-item')).toHaveAttribute('data-state', 'disconnected');
        await page.evaluate(() => window.__menuBar.open('connection'));
        await page.click('#menu-connect-item');
        await expect(page.locator('#menu-connect-item')).toHaveAttribute('data-state', 'connected', { timeout: 5000 });
    });

    // AC-5 — the same rules on both paths. The click path builds its message inside
    // connectMicroBeast's catch; the auto-connect catch had its own, and produced the
    // generic "Auto-connect failed: …" for a port another tab was holding. One
    // classifier, called from both, so the user reads the same sentence either way.
    test('AC-5 — the auto-connect path reports the in-use failure with the same message', async ({ page }) => {
        await setupWithMock(page, {
            prefs: PREFS_AUTOCONNECT_ON,
            portPreset: PORT_PRESET,
            preGrantPortCount: 1,
            rejectOpenWith: { name: 'NetworkError', message: 'Failed to open serial port.' },
        });
        await expect(page.locator('#menu-connect-item')).toHaveAttribute('data-state', 'disconnected');
        await expect(page.locator('#error-log')).toContainText(
            'That MicroBeast is already connected in another Beastty tab. Choose a different one, or disconnect it there first.',
        );
        await expect(page.locator('#error-log')).not.toContainText('Auto-connect failed');
    });

    // AC-4 — the common case is provably untouched. One adapter still stashes,
    // still auto-connects, and still reports no error.
    test('AC-4 — exactly one adapter still auto-connects unchanged', async ({ page }) => {
        await setupWithMock(page, {
            prefs: PREFS_AUTOCONNECT_ON,
            portPreset: PORT_PRESET,
            preGrantPortCount: 1,
        });
        await page.waitForSelector('#menu-connect-item[data-state="connected"]', { state: 'attached', timeout: 5000 });
        await expect(page.locator('#error-log')).not.toContainText('auto-connect-failed');
    });
});
