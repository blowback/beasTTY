// Beastty Epic E7 Story E7.1 (FR-29 / AD-16 / UX-DR15) — centered paste toast.
//
// Clones the www/tests/transport/slide-chip.spec.js shape: boot-race guard on the
// window.__* hook, drive the transient chip via its window hook + real pastes
// through the debug #paste-test button, assert [hidden] toggling + auto-hide +
// centered position + neutral-shell styling + focus retention + no-null-ref boot.
//
// Covers AC-1 (confirm appears at >= 4096 B; confirm→progress→complete→auto-hide;
// cancel; port-lost), AC-2 (no null-ref at boot with #top-bar absent), AC-5
// (--chrome-* only, focus retention, subscribes to the pump), AC-6 (the new spec).
//
// The pump reports progress only over bytes the WIRE took, so any case that expects
// the chip to advance — or to end at 'Paste complete' — connects first, via the
// Connection menu (the #connect-button retired with #top-bar in E7.1). A paste with
// nothing connected still runs and still echoes, but the chip stays at 0% and ends
// saying so; that behaviour has its own case in tests/transport/paste.spec.js.

import { test, expect } from '@playwright/test';
import { SERIAL_MOCK } from '../transport/mock-serial.js';

const TOAST = '#paste-toast';
const TEXT = '#paste-toast-text';

// `prefs` seeds a stored blob before boot. The paste cadence defaults to the
// measured hardware working point — 1 byte every 200 ms, 5 B/s — so a case whose
// subject is the toast rather than the pacing pins something quicker instead of
// holding the run open for minutes.
async function setup(page, { prefs } = {}) {
    await page.addInitScript(SERIAL_MOCK);
    if (prefs) {
        await page.addInitScript(
            (blob) => localStorage.setItem('beastty.prefs', blob), JSON.stringify(prefs));
    }
    await page.goto('/');
    await page.locator('#terminal-wrapper').focus();
    await page.waitForFunction(() => document.getElementById('terminal').width > 0);
    // Boot-race guard (E0.1 learning): wait on the window.__* hooks before driving.
    await page.waitForFunction(() =>
        window.__pasteToast && typeof window.__pasteToast.__getStateForTests === 'function'
        && window.__pastePump && typeof window.__pastePump.enqueuePaste === 'function');
    // The #paste-test paste driver lives in the debug panel (which STAYS).
    await page.locator('#debug').evaluate((el) => { el.open = true; });
    await page.evaluate(() => window.__pasteToast.__resetForTests());
}

async function connectViaMenu(page) {
    await page.evaluate(() => window.__menuBar.open('connection'));
    await page.click('#menu-connect-item');
    await page.waitForFunction(() =>
        document.getElementById('menu-connect-item').getAttribute('data-state') === 'connected');
}

async function pasteViaDebug(page, text) {
    await page.locator('#input').fill(text);
    await page.locator('#paste-test').click();
}

test.describe('E7.1 — paste toast: large-paste confirm', () => {
    test.beforeEach(async ({ page }) => { await setup(page); });

    test('a >= 4096 B paste surfaces a centered confirm with [Paste]/[Cancel] @fast', async ({ page }) => {
        // Drive the confirm affordance directly (clipboard.js calls this at the gate).
        await page.evaluate(() => {
            window.__confirmResult = 'pending';
            window.__pasteToast.confirmLargePaste(5000, { getChunk: () => 8, getPauseMs: () => 20 })
                .then((ok) => { window.__confirmResult = ok; });
        });
        await expect(page.locator(TOAST)).toBeVisible();
        // The estimate quotes the PUMP's cadence, not the baud — the pump does not
        // pace to the wire at all. The duration is the pauses and only the pauses:
        // ceil(5000 / 8) = 625 writes, 624 of them followed by a 20 ms pause, so
        // 12.5 s → 12. The rate quoted is what those two settings add up to,
        // 8 ÷ 20 × 1000 = 400 B/s, and the two figures divide (5000 ÷ 400 = 12.5)
        // because they come from the same arithmetic. Nothing in it depends on
        // where the line breaks fall. Asserted exactly, not with toContainText —
        // the whole point is the number.
        await expect(page.locator(TEXT)).toHaveText(
            'About to paste 5,000 B (~12 s at 400 B/s).');
        await expect(page.locator(`${TOAST} button[data-action="paste"]`)).toBeVisible();
        await expect(page.locator(`${TOAST} button[data-action="cancel"]`)).toBeVisible();
        expect(await page.evaluate(() => window.__pasteToast.__getStateForTests().lifecycle)).toBe('confirm');
    });

    test('with no pause the estimate quotes the wire rather than collapsing to ~1 s @fast', async ({ page }) => {
        // A pause of 0 means no pacing limit at all: the writer is fed continuously
        // and the wire is the only ceiling, which is not a bytes/sec figure this
        // module can name — so the RATE still reads "wire speed".
        //
        // The DURATION cannot be the pauses, though, because there are none. The
        // paced model's only term is the pauses, so it used to quote "~1 s" for any
        // size at all: 2 MB of Forth source came out as a second. Now that the write
        // path waits on Web Serial backpressure, the wire is real time the user
        // spends waiting, and the estimate takes whichever of the two is slower.
        // 5,000 B at 19200 8N1 (1920 B/s) is 2.6 s.
        await page.evaluate(() => {
            window.__pasteToast.confirmLargePaste(5000, { getChunk: () => 32, getPauseMs: () => 0 });
        });
        await expect(page.locator(TEXT)).toHaveText('About to paste 5,000 B (~3 s at wire speed).');
    });

    test('a 2 MB paste at no pause is not quoted as one second @fast', async ({ page }) => {
        // The case that made the wire bound necessary, stated at the size where the
        // old model was absurd rather than merely wrong. 2,000,000 B at 1920 B/s is
        // 1042 s — seventeen minutes.
        await page.evaluate(() => {
            window.__pasteToast.confirmLargePaste(2000000, { getChunk: () => 32, getPauseMs: () => 0 });
        });
        await expect(page.locator(TEXT)).toHaveText('About to paste 2,000,000 B (~1042 s at wire speed).');
    });

    test('the slowest cadence on the menu is quoted as it really is @fast', async ({ page }) => {
        // 1 byte every 200 ms is 5 B/s, and 5,000 B of it is 1000 s — 16 minutes.
        // Exactly the case the confirm exists for, and exactly the number a
        // baud-derived estimate used to understate by three orders of magnitude.
        await page.evaluate(() => {
            window.__pasteToast.confirmLargePaste(5000, { getChunk: () => 1, getPauseMs: () => 200 });
        });
        await expect(page.locator(TEXT)).toHaveText('About to paste 5,000 B (~1000 s at 5 B/s).');
    });

    test('a handshaking port is quoted as wire speed, with a duration, and says why @fast', async ({ page }) => {
        // On a port opened with RTS/CTS the pump does not pace at all, so the
        // snapshot handed here is the unpaced shape (32 B, no pause) whatever the
        // Paste pause setting holds. Quoting the paced figure for a run that will
        // not be paced would be the same lie the Settings readout must not tell, so
        // the words go on the reason instead.
        //
        // But it still quotes a DURATION. An earlier draft dropped it on the theory
        // that a handshaken paste is over before the sentence is read, and that is
        // wrong: the handshake settles at about 13.5 B/s on a real MicroBeast (an
        // ~800 B block took 59 s), so 5,000 B is 370 s and a 100 kB paste is nearly
        // two hours. "Wire speed" on its own reads like "instant".
        await page.evaluate(() => {
            window.__pasteToast.confirmLargePaste(5000, {
                getChunk: () => 32, getPauseMs: () => 0, isFlowControlled: () => true,
            });
        });
        await expect(page.locator(TEXT)).toHaveText(
            'About to paste 5,000 B (~370 s) at wire speed (flow control).');
    });

    test('the same rounding rule as the Settings readout and the chip @fast', async ({ page }) => {
        // 1 byte every 150 ms is 6.666… B/s. It used to read "7 B/s" here and in the
        // modal the user picks the value from, while the chip measuring the same run
        // said "6.7 B/s" — three surfaces, one number, two answers. One rule now
        // (renderer/paste-rate.js): a decimal below 10, whole numbers above.
        await page.evaluate(() => {
            window.__pasteToast.confirmLargePaste(1000, { getChunk: () => 1, getPauseMs: () => 150 });
        });
        await expect(page.locator(TEXT)).toHaveText('About to paste 1,000 B (~150 s at 6.7 B/s).');
    });

    test('[Cancel] resolves the confirm false and hides the toast @fast', async ({ page }) => {
        await page.evaluate(() => {
            window.__confirmResult = 'pending';
            window.__pasteToast.confirmLargePaste(5000, { getChunk: () => 8, getPauseMs: () => 20 })
                .then((ok) => { window.__confirmResult = ok; });
        });
        await expect(page.locator(TOAST)).toBeVisible();
        await page.locator(`${TOAST} button[data-action="cancel"]`).click();
        await expect.poll(() => page.evaluate(() => window.__confirmResult)).toBe(false);
        await expect(page.locator(TOAST)).toBeHidden();
    });

    test('[Paste] resolves the confirm true @fast', async ({ page }) => {
        await page.evaluate(() => {
            window.__confirmResult = 'pending';
            window.__pasteToast.confirmLargePaste(5000, { getChunk: () => 8, getPauseMs: () => 20 })
                .then((ok) => { window.__confirmResult = ok; });
        });
        await expect(page.locator(TOAST)).toBeVisible();
        await page.locator(`${TOAST} button[data-action="paste"]`).click();
        await expect.poll(() => page.evaluate(() => window.__confirmResult)).toBe(true);
    });
});

// The progress case needs a cadence pinned at boot, so it seeds its own prefs and
// therefore its own setup() — it sits outside the beforeEach describe below rather
// than running setup() twice over the same page (which reloaded the page and
// re-installed the serial mock for no reason).
test.describe('E7.1 — paste toast: live progress from a real paste', () => {
    test('progress line "Pasting N B — P%" updates then "Paste complete" then auto-hides', async ({ page }) => {
        // 8 bytes every 20 ms: 32 writes, long enough for the progress line to be
        // observed and short enough to complete inside the assertion window. The
        // default 5 B/s would hold it open for nearly a minute.
        await setup(page, { prefs: { version: 2, pasteChunk: 8, pastePauseMs: 20 } });
        // Connected, because 'Paste complete' is a claim about the wire now.
        await connectViaMenu(page);
        await pasteViaDebug(page, 'B'.repeat(256));
        await expect(page.locator(TEXT)).toContainText('Pasting 256 B —', { timeout: 2000 });
        await expect(page.locator(TEXT)).toContainText('Paste complete', { timeout: 5000 });
        // Auto-hide within the 2 s complete timeout (+ margin).
        await expect(page.locator(TOAST)).toBeHidden({ timeout: 4000 });
    });
});

test.describe('E7.1 — paste toast: live progress', () => {
    test.beforeEach(async ({ page }) => { await setup(page); });

    test('[Cancel] mid-pump halts the pump and shows "Paste cancelled"', async ({ page }) => {
        await pasteViaDebug(page, 'C'.repeat(4096));   // long enough to catch mid-stream
        await expect(page.locator(TOAST)).toBeVisible({ timeout: 2000 });
        await page.locator(`${TOAST} button[data-action="cancel"]`).click();
        await expect(page.locator(TEXT)).toContainText('Paste cancelled', { timeout: 2000 });
    });

    test('Esc while paste active cancels via keyboard.js and does NOT emit 0x1B', async ({ page }) => {
        await connectViaMenu(page);
        await pasteViaDebug(page, 'D'.repeat(4096));
        await expect(page.locator(TOAST)).toBeVisible();
        await page.evaluate(() => { window.__mockWriterLog.length = 0; });
        await page.locator('#terminal-wrapper').focus();
        await page.keyboard.press('Escape');
        await expect(page.locator(TEXT)).toContainText('Paste cancelled');
        const post = await page.evaluate(() => window.__mockWriterLog.flatMap((e) => e.bytes));
        expect(post).not.toContain(0x1B);
    });

    test('port-lost mid-paste shows "Paste cancelled — port lost (N bytes unsent)"', async ({ page }) => {
        await connectViaMenu(page);
        await pasteViaDebug(page, 'F'.repeat(4096));
        await expect(page.locator(TOAST)).toBeVisible();
        await page.evaluate(() => window.__simulateUnplug());
        await expect(page.locator(TEXT)).toContainText('Paste cancelled — port lost', { timeout: 2000 });
        await expect(page.locator(TEXT)).toContainText('bytes unsent');
    });

    test('the chip reports elapsed time and the rate it actually achieved @fast', async ({ page }) => {
        // Both figures are MEASURED — bytes the pump says the wire took, over
        // wall-clock time.
        //
        // The rate window opens at the FIRST chunk, not at 'started', so this drives
        // two chunks with a real 400 ms wait between them. That is a correction, not
        // bookkeeping: the pump writes its first chunk immediately and only then
        // starts pausing, so after n chunks it has sent n chunks' worth of bytes over
        // n − 1 pauses. Measuring from 'started' therefore reported n/(n−1) times the
        // real cadence — double at the second chunk. Measuring from the first chunk
        // divides the bytes sent SINCE it by the pauses that produced them.
        // 800 B in ~0.4 s is ~2000 B/s, and no setting in the app says 2000.
        await page.evaluate(async () => {
            window.__pasteToast.__resetForTests();
            window.__pasteToast.handleProgress({ status: 'started', total: 1600 });
            window.__pasteToast.handleProgress({ status: 'chunk', written: 8, total: 1600 });
            await new Promise((r) => setTimeout(r, 400));
            window.__pasteToast.handleProgress({ status: 'chunk', written: 808, total: 1600 });
        });
        const text = await page.locator(TEXT).textContent();
        expect(text).toMatch(/^Pasting 1600 B — 51% · \d+ s · \d+(\.\d)? B\/s$/);
        const rate = Number(text.match(/· ([\d.]+) B\/s$/)[1]);
        // Generous band — this is a real clock under a real browser — but nowhere
        // near any configured cadence, which is the point.
        expect(rate).toBeGreaterThan(500);
        expect(rate).toBeLessThan(20000);
    });

    test('an appended paste restarts the clock instead of decaying the rate @fast', async ({ page }) => {
        // A paste appended to a live run compacts the pump's queue, so `written`
        // drops back to the new run's first chunk while the clock kept running. The
        // chip then divided a handful of bytes by the whole elapsed time and reported
        // 0.0 B/s for the rest of the run — the readout going dead in exactly the
        // situation (a second paste on top of a slow one) where the user is watching
        // it hardest.
        await page.evaluate(async () => {
            window.__pasteToast.__resetForTests();
            window.__pasteToast.handleProgress({ status: 'started', total: 4000 });
            window.__pasteToast.handleProgress({ status: 'chunk', written: 100, total: 4000 });
            await new Promise((r) => setTimeout(r, 1200));
            window.__pasteToast.handleProgress({ status: 'chunk', written: 900, total: 4000 });
            // The append: total changes and written restarts from the bottom.
            window.__pasteToast.handleProgress({ status: 'chunk', written: 100, total: 5000 });
            await new Promise((r) => setTimeout(r, 300));
            window.__pasteToast.handleProgress({ status: 'chunk', written: 400, total: 5000 });
        });
        const text = await page.locator(TEXT).textContent();
        // Elapsed restarted with the byte count — 0 s, not the 1 s+ the first half
        // of the run had already spent.
        expect(text).toContain('· 0 s ·');
        const rate = Number(text.match(/· ([\d.]+) B\/s$/)[1]);
        // 300 B over ~0.3 s is ~1000 B/s. Without the restart it would be 400 B over
        // ~1.5 s — under 300 — so the band below distinguishes them.
        expect(rate).toBeGreaterThan(500);
    });

    test('the clock starts at the pump, not when the confirm opened @fast', async ({ page }) => {
        // A large-paste confirm can sit on screen for as long as the user takes to
        // read it, and none of that is paste time. If the clock started at the
        // confirm, this chip would open claiming several seconds had elapsed.
        await page.evaluate(async () => {
            window.__pasteToast.__resetForTests();
            window.__pasteToast.confirmLargePaste(5000, { getChunk: () => 8, getPauseMs: () => 20 });
            await new Promise((r) => setTimeout(r, 1500));
        });
        await expect(page.locator(TEXT)).toContainText('About to paste 5,000 B');
        // Resolve the confirm and start pumping.
        await page.locator(`${TOAST} button[data-action="paste"]`).click();
        await page.evaluate(() => {
            window.__pasteToast.handleProgress({ status: 'started', total: 5000 });
            window.__pasteToast.handleProgress({ status: 'chunk', written: 8, total: 5000 });
        });
        await expect(page.locator(TEXT)).toContainText('Pasting 5000 B — 0% · 0 s');
    });

    test('elapsed and rate advance as the paste proceeds @fast', async ({ page }) => {
        await page.evaluate(async () => {
            window.__pasteToast.__resetForTests();
            window.__pasteToast.handleProgress({ status: 'started', total: 4000 });
            await new Promise((r) => setTimeout(r, 1100));
            window.__pasteToast.handleProgress({ status: 'chunk', written: 1000, total: 4000 });
        });
        const first = await page.locator(TEXT).textContent();
        await page.evaluate(async () => {
            await new Promise((r) => setTimeout(r, 1100));
            window.__pasteToast.handleProgress({ status: 'chunk', written: 2000, total: 4000 });
        });
        const second = await page.locator(TEXT).textContent();
        const secs = (t) => Number(t.match(/· (\d+) s/)[1]);
        expect(secs(first)).toBeGreaterThanOrEqual(1);
        expect(secs(second)).toBeGreaterThan(secs(first));
        expect(second).toContain('50%');
    });

    test('a large-paste confirm is not clobbered by an overlapping paste’s pump events @fast', async ({ page }) => {
        // Regression (whole-branch review): progress + confirm share one toast, so a
        // still-pumping small paste must NOT overwrite an open confirm nor leak its
        // Promise. Drive the pump + confirm directly via the exposed API.
        await page.evaluate(() => {
            window.__confirmResult = 'pending';
            // A small paste is mid-flight (pump 'started' + a 'chunk').
            window.__pasteToast.handleProgress({ status: 'started', total: 1000 });
            window.__pasteToast.handleProgress({ status: 'chunk', written: 200, total: 1000 });
            // A large paste opens the confirm while the first paste still pumps.
            window.__pasteToast.confirmLargePaste(5000, { getChunk: () => 8, getPauseMs: () => 20 })
                .then((ok) => { window.__confirmResult = ok; });
            // The first pump keeps firing — these must be ignored while confirming.
            window.__pasteToast.handleProgress({ status: 'chunk', written: 600, total: 1000 });
            window.__pasteToast.handleProgress({ status: 'complete' });
        });
        // The confirm survived the pump events: still shown + still 'confirm'.
        await expect(page.locator(TEXT)).toContainText('About to paste 5,000 B');
        await expect(page.locator(`${TOAST} button[data-action="paste"]`)).toBeVisible();
        expect(await page.evaluate(() => window.__pasteToast.__getStateForTests().lifecycle)).toBe('confirm');
        // And its Promise is intact — [Paste] still resolves it (never stranded).
        await page.locator(`${TOAST} button[data-action="paste"]`).click();
        await expect.poll(() => page.evaluate(() => window.__confirmResult)).toBe(true);
    });
});

test.describe('E7.1 — paste toast: neutral shell + placement + focus (AC-5)', () => {
    test.beforeEach(async ({ page }) => { await setup(page); });

    test('is centered over the terminal canvas (not top-right like the SLIDE chip) @fast', async ({ page }) => {
        // Fire-and-forget: confirmLargePaste's Promise resolves only on a button
        // click, so do NOT return it from evaluate (that would hang the call).
        await page.evaluate(() => { window.__pasteToast.confirmLargePaste(5000, { getChunk: () => 8, getPauseMs: () => 20 }); });
        await expect(page.locator(TOAST)).toBeVisible();
        const css = await page.locator(TOAST).evaluate((el) => {
            const s = getComputedStyle(el);
            return { position: s.position, transform: s.transform };
        });
        expect(css.position).toBe('absolute');
        // translate(-50%,-50%) resolves to a matrix() with negative translate parts.
        expect(css.transform).not.toBe('none');
        // Centered: the toast's centre sits near the wrapper's centre.
        const wrap = await page.locator('#terminal-wrapper').boundingBox();
        const toast = await page.locator(TOAST).boundingBox();
        const wrapCx = wrap.x + wrap.width / 2;
        const toastCx = toast.x + toast.width / 2;
        expect(Math.abs(toastCx - wrapCx)).toBeLessThan(4);
    });

    test('styles from --chrome-* only — identical across a data-theme flip, no box-shadow @fast', async ({ page }) => {
        // Fire-and-forget (see above) — the Promise only settles on a button click.
        await page.evaluate(() => { window.__pasteToast.confirmLargePaste(5000, { getChunk: () => 8, getPauseMs: () => 20 }); });
        await expect(page.locator(TOAST)).toBeVisible();
        const read = () => page.locator(TOAST).evaluate((el) => {
            const s = getComputedStyle(el);
            return { bg: s.backgroundColor, fg: s.color, shadow: s.boxShadow };
        });
        const crt = await page.evaluate(() => document.body.getAttribute('data-theme'));
        const before = await read();
        expect(before.shadow).toBe('none');
        // Flip the terminal theme; the neutral shell must NOT restyle the toast.
        await page.evaluate((cur) => {
            document.body.setAttribute('data-theme', cur === 'crt' ? 'console' : 'crt');
        }, crt);
        const after = await read();
        expect(after.bg).toBe(before.bg);
        expect(after.fg).toBe(before.fg);
        expect(after.shadow).toBe('none');
    });

    test('clicking a toast button retains #terminal-wrapper focus (AD-10 sacred) @fast', async ({ page }) => {
        await page.evaluate(() => {
            window.__pasteToast.confirmLargePaste(5000, { getChunk: () => 8, getPauseMs: () => 20 })
                .then((ok) => { window.__confirmResult = ok; });
        });
        await expect(page.locator(TOAST)).toBeVisible();
        await page.locator('#terminal-wrapper').focus();
        await page.locator(`${TOAST} button[data-action="cancel"]`).click();
        expect(await page.evaluate(() => document.activeElement.id)).toBe('terminal-wrapper');
    });
});

// The chip's achieved rate is MEASURED, and this is the pair of runs that proves it:
// the same configured cadence, two different ports, two rates orders of magnitude
// apart. A figure derived from the Paste settings would report the same number twice.
test.describe('paste toast — the achieved rate is the wire, not the setting', () => {
    // Read the "· N B/s" out of the live chip text; 0 when the chip is not showing a
    // rate yet, so expect.poll keeps waiting rather than throwing.
    const chipRate = async (page) => {
        const t = await page.locator(TEXT).textContent();
        const m = t && t.match(/· ([\d.]+) B\/s/);
        return m ? Number(m[1]) : 0;
    };

    test('flow control bypasses the pause, and the chip says so in bytes per second', async ({ page }) => {
        // Configured cadence: 1 byte every 200 ms — 5 B/s. The port is open with
        // RTS/CTS, so the pump does not pace at all and the run goes out at wire
        // speed. The chip must report what the wire delivered.
        await setup(page, {
            prefs: {
                version: 2, pasteChunk: 1, pastePauseMs: 200,
                serial: { baud: 19200, dataBits: 8, stopBits: 1, parity: 'none', flowControl: 'hardware' },
            },
        });
        await connectViaMenu(page);
        expect(await page.evaluate(() => window.__pastePump.getPasteFlowControl())).toBe('hardware');
        await pasteViaDebug(page, 'Z'.repeat(20000));
        await expect.poll(() => chipRate(page), { timeout: 15000 }).toBeGreaterThan(100);
    });

    test('a paced run on a bare port reports the pace it is actually keeping @slow', async ({ page }) => {
        // The same chip, the other side of the comparison: no flow control, 1 byte
        // every 100 ms, and the measured figure lands near the 10 B/s that implies —
        // nowhere near the hundreds the handshaken run above reports.
        await setup(page, { prefs: { version: 2, pasteChunk: 1, pastePauseMs: 100 } });
        await connectViaMenu(page);
        expect(await page.evaluate(() => window.__pastePump.getPasteFlowControl())).toBe('none');
        await pasteViaDebug(page, 'Z'.repeat(60));
        // Wait until a couple of seconds of real progress have accumulated, so the
        // figure is measured over a meaningful interval rather than one chunk.
        await expect.poll(async () => {
            const t = await page.locator(TEXT).textContent();
            const m = t && t.match(/· (\d+) s/);
            return m ? Number(m[1]) : 0;
        }, { timeout: 15000 }).toBeGreaterThanOrEqual(2);
        const rate = await chipRate(page);
        expect(rate).toBeGreaterThan(0);
        expect(rate).toBeLessThan(30);
    });
});

test.describe('E7.1 — no null-reference at boot with #top-bar absent (AC-2)', () => {
    test('boots + pastes with #top-bar / #paste-progress-row removed and no console error @fast', async ({ page }) => {
        const errors = [];
        // Ignore the benign boot-time CSP warning (frame-ancestors via <meta> is a
        // platform notice, present on every page load and unrelated to the toast path).
        const benign = (t) => t.includes("'frame-ancestors' is ignored when delivered via a <meta>");
        page.on('pageerror', (e) => { if (!benign(String(e))) errors.push(String(e)); });
        page.on('console', (m) => { if (m.type() === 'error' && !benign(m.text())) errors.push(m.text()); });
        // 128 B at the default 5 B/s is 25 s; this case is about the absent DOM and
        // a clean console, so the cadence is pinned quick.
        await setup(page, { prefs: { version: 2, pasteChunk: 8, pastePauseMs: 5 } });
        await connectViaMenu(page);   // 'Paste complete' is a claim about the wire
        // The retired surfaces are gone from the DOM.
        expect(await page.locator('#top-bar').count()).toBe(0);
        expect(await page.locator('#paste-progress-row').count()).toBe(0);
        expect(await page.locator('#paste-cancel').count()).toBe(0);
        expect(await page.locator('#paste-confirm').count()).toBe(0);
        // A full paste drives the whole progress path with the row absent.
        await pasteViaDebug(page, 'Z'.repeat(128));
        await expect(page.locator(TEXT)).toContainText('Paste complete', { timeout: 5000 });
        expect(errors).toEqual([]);
    });
});
