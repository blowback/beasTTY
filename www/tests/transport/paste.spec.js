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

async function setup(page, opts = {}) {
    await page.addInitScript(SERIAL_MOCK);
    if (opts.prefs) {
        await page.addInitScript(
            (blob) => localStorage.setItem('beastty.prefs', blob), JSON.stringify(opts.prefs));
    }
    await page.goto('/');
    await page.locator('#terminal-wrapper').focus();
    await page.waitForFunction(() => document.getElementById('terminal').width > 0);
    // window.__pastePump is assigned LATE in main.js — the pacing cases read it
    // straight after setup, so wait for the handle rather than racing the boot.
    await page.waitForFunction(
        () => window.__pastePump && typeof window.__pastePump.getPasteChunk === 'function');
    await page.locator('#debug').evaluate((el) => { el.open = true; });
}

// The serial-config form lives in a <dialog>; its selects are only actionable
// while it is open. Same idiom as tests/transport/config.spec.js.
async function setFlowControl(page, value) {
    await page.evaluate(() => document.getElementById('serial-config-modal').showModal());
    await expect(page.locator('#serial-config-modal')).toBeVisible();
    await page.locator('#serial-flowctl').selectOption(value);
    await page.evaluate(() => document.getElementById('serial-config-modal').close());
    await expect(page.locator('#serial-config-modal')).toBeHidden();
}

async function connect(page) {
    await page.evaluate(() => window.__menuBar.open('connection'));
    await page.click('#menu-connect-item');
    await expect(page.locator('#menu-connect-item')).toHaveAttribute('data-state', 'connected');
}

// Settings ▸ Paste line ending / Paste chunk size / Paste pause. All three are
// radio submenus reached exactly like Enter key sends
// (tests/input/crlf-override.spec.js is the incumbent idiom); the row click
// applies the pump setter AND persists.
const submenuRow = (panel, v) =>
    `#dropdown-settings .submenu[data-submenu-panel="${panel}"] .menu-item[data-value="${v}"]`;

async function pickSettingsRadio(page, submenu, value) {
    await page.evaluate(() => window.__menuBar.open('settings'));
    await page.click(`#dropdown-settings .menu-item[data-submenu="${submenu}"]`);
    await page.click(submenuRow(submenu, value));
    await page.evaluate(() => window.__menuBar.close());
}

const setPasteEol = (page, v) => pickSettingsRadio(page, 'paste-eol', v);
const setPasteChunk = (page, v) => pickSettingsRadio(page, 'paste-chunk', v);
const setPastePause = (page, v) => pickSettingsRadio(page, 'paste-pause', v);

// A stored blob that pins the cadence, for the cases whose subject is something
// else entirely (progress copy, cancel, layout). The default 1 byte every 200 ms is
// the measured hardware working point — 5 B/s — which turns a 4 KB fixture into a
// 13-minute test. Pinning it keeps those cases about what they are about.
const pacing = (chunk, pauseMs) => ({ version: 2, pasteChunk: chunk, pastePauseMs: pauseMs });

// The same, plus the serial-config form's flow-control select. applyPrefs mirrors
// prefs.serial onto the form at boot and connectMicroBeast opens the port with
// whatever the form holds, so this is how a spec gets a port opened with RTS/CTS.
const withFlowControl = (fc, blob = {}) => ({
    version: 2,
    ...blob,
    serial: { baud: 19200, dataBits: 8, stopBits: 1, parity: 'none', flowControl: fc },
});

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

    // The baud-derived duration case that used to sit here is gone with the model
    // it tested. The pump no longer reads the port or the wire: the user sets the
    // chunk size and the pause, and the duration follows from those two alone. The
    // arithmetic is pinned in the "Paste cadence" suite below.

    test('progress line Pasting N B — P% updates per chunk', async ({ page }) => {
        await setup(page, { prefs: pacing(8, 20) });
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
        await setup(page, { prefs: pacing(8, 20) });
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
        // Find an 'A' write (single-byte 0x41) sandwiched by 'E' writes. The
        // sandwich test reads only the FIRST byte of each neighbour, so it is
        // indifferent to the chunk size.
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

    // This used to drive Settings ▸ Enter key sends, because the pump read
    // getCrlfMode(). It no longer does: paste has its own line-ending setting and
    // the Enter-key path is none of the pump's business. The byte-level matrix
    // lives in tests/input/paste-line-ending.spec.js; this case keeps the
    // through-the-writer proof that the rewrite happens before enqueue.
    test('Paste line ending crlf rewrites the break to 0x0D 0x0A before enqueue', async ({ page }) => {
        await setup(page);
        await connect(page);
        await setPasteEol(page, 'crlf');
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
    // Uses a 4 KB paste at 32 bytes every 20 ms — 128 writes ≈ 2.6 s — so the
    // assertions land while the pump is still active. Short pastes finish in
    // <100 ms, which races the toContainText('Pasting') assertion against 'Paste
    // complete'; the default 1 byte every 200 ms would hold the test open for 13 min.
    test('paste toast is a centered overlay that does not displace the canvas', async ({ page }) => {
        await setup(page, { prefs: pacing(32, 20) });
        await connect(page);

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


// The pacing half of the paste-text-loss fix, as the hardware forced it to be
// redrawn. Two independent physical controls — how many bytes go out
// back-to-back, and how long the receiver is left idle between them — and
// nothing that looks at what the bytes ARE.
//
// The evidence: on a real MicroBeast with flow control `none`, the same paste
// failed IDENTICALLY at 60, 120 and 240 B/s while the chunk stayed pinned at 8.
// A 4x change in rate that changes nothing means the bytes are lost inside the
// burst, where an inter-chunk pause cannot reach them. So the burst length is
// what has to be testable, and it is what these cases pin.
test.describe('Paste cadence — chunk size and pause', () => {
    test('the defaults are 1 byte every 200 ms, which reads as 5 B/s @fast', async ({ page }) => {
        await setup(page);
        // MEASURED, not chosen. On a real MicroBeast with flow control `none`, 1
        // byte every 200 ms delivers an ~800 B Forth block into VIBE intact; 10 B/s
        // by either route (1 B / 100 ms, 2 B / 200 ms) only nearly works. Two chunk
        // sizes at equal throughput behaving the same is why the pump paces on rate
        // and lets the user pick the burst.
        expect(await page.evaluate(() => window.__pastePump.__getStateForTests()))
            .toMatchObject({ chunkSize: 1, pauseMs: 200, throughput: 5 });
    });

    // 4 lines of 10 characters. \x0A in the debug textarea reaches the pump as a
    // real 0x0A byte (parseHexEscapes), and the default Paste line ending rewrites
    // each one to 0x0D — so the terminator on the wire is CR, at byte 10 of every
    // 11. Chunk boundaries therefore land on, before and after a line break at
    // different chunk sizes, and none of that may make any difference.
    const LINES = 4;
    const PAYLOAD = 'ABCDEFGHIJ\\x0A'.repeat(LINES);
    const WIRE_LEN = LINES * 11;   // 44 bytes

    for (const chunk of [1, 2, 8, 32]) {
        test(`every write is exactly ${chunk} B except the last, line breaks included @fast`, async ({ page }) => {
            // 5 ms rather than the default 20 so the 44-write case at chunk 1 stays
            // a fast test; the pause is not what this case is about.
            await setup(page, { prefs: pacing(chunk, 5) });
            await connect(page);
            await page.locator('#debug').evaluate((el) => { el.open = true; });
            await page.evaluate(() => { window.__mockWriterLog.length = 0; });
            await page.locator('#input').fill(PAYLOAD);
            await page.locator('#paste-test').click();
            await expect(page.locator('#paste-toast-text')).toContainText('Paste complete', { timeout: 10_000 });

            const writes = await page.evaluate(() => window.__mockWriterLog.map((e) => e.bytes));
            const sizes = writes.map((w) => w.length);
            // What the model says, with no reference to the payload's contents:
            // full chunks, then the remainder.
            const expected = [];
            for (let n = WIRE_LEN; n > 0; n -= chunk) expected.push(Math.min(chunk, n));
            expect(sizes).toEqual(expected);
            // And nothing was lost, duplicated or reordered on the way.
            const all = writes.flat();
            expect(all.length).toBe(WIRE_LEN);
            expect(all.filter((b) => b === 0x0D).length).toBe(LINES);
        });
    }

    test('the pause is the same after every chunk, line break or not @slow', async ({ page }) => {
        // 'ABCDEFG' + CR is 8 bytes, so at chunk 4 the writes alternate: ABCD with
        // no terminator in it, then EFG+CR which ends on one. Under the model this
        // replaced, the second of each pair earned an extra pause of at least 50 ms
        // on the theory that a full-screen editor redraws on a newline. That theory
        // was never evidenced, and nothing keys off the bytes any more.
        await setup(page, { prefs: pacing(4, 100) });
        await connect(page);
        await page.locator('#debug').evaluate((el) => { el.open = true; });
        await page.evaluate(() => { window.__mockWriterLog.length = 0; });
        await page.locator('#input').fill('ABCDEFG\\x0A'.repeat(4));   // 32 B → 8 writes, 7 gaps
        await page.locator('#paste-test').click();
        await expect(page.locator('#paste-toast-text')).toContainText('Paste complete', { timeout: 20_000 });

        const log = await page.evaluate(() => window.__mockWriterLog.map((e) => ({ bytes: e.bytes, ts: e.ts })));
        expect(log.map((e) => e.bytes.length)).toEqual([4, 4, 4, 4, 4, 4, 4, 4]);
        // Delay charged for write i = log[i+1].ts - log[i].ts.
        const gaps = log.slice(0, -1).map((e, i) => ({
            endsAtBreak: e.bytes[e.bytes.length - 1] === 0x0D,
            ms: log[i + 1].ts - e.ts,
        }));
        const atBreak = gaps.filter((g) => g.endsAtBreak).map((g) => g.ms);
        const elsewhere = gaps.filter((g) => !g.endsAtBreak).map((g) => g.ms);
        expect(atBreak.length).toBeGreaterThan(1);
        expect(elsewhere.length).toBeGreaterThan(1);
        // Timers fire late, never early, so a floor is the reliable direction.
        for (const ms of [...atBreak, ...elsewhere]) expect(ms).toBeGreaterThanOrEqual(90);
        // The ceilings are taken on the MINIMUM of several samples, so one late
        // timer on a loaded runner cannot fail them — the same reasoning the
        // proportional-gap case used. 150 ms is comfortably under the 150+ ms a
        // break-pause term would have added here.
        expect(Math.min(...atBreak)).toBeLessThan(150);
        expect(Math.min(...elsewhere)).toBeLessThan(150);
    });

    test('a pause of 0 writes at wire speed with the chunk size still honoured @fast', async ({ page }) => {
        await setup(page, { prefs: pacing(8, 0) });
        await connect(page);
        await page.locator('#debug').evaluate((el) => { el.open = true; });
        // No pause means no pacing limit, so there is no throughput figure to
        // quote — the wire is the only ceiling and the pump does not know what it
        // carries. null is what "wire speed" is made of, in the menu readout and in
        // the large-paste confirm alike.
        expect(await page.evaluate(() => window.__pastePump.__getStateForTests()))
            .toMatchObject({ chunkSize: 8, pauseMs: 0, throughput: null });

        await page.evaluate(() => { window.__mockWriterLog.length = 0; });
        await page.locator('#input').fill('Z'.repeat(400));
        const t0 = await page.evaluate(() => performance.now());
        await page.locator('#paste-test').click();
        await expect(page.locator('#paste-toast-text')).toContainText('Paste complete', { timeout: 10_000 });
        const elapsed = await page.evaluate((t) => performance.now() - t, t0);

        const sizes = await page.evaluate(() => window.__mockWriterLog.map((e) => e.bytes.length));
        expect(sizes).toEqual(new Array(50).fill(8));
        // 50 writes with no pause asked for. Whatever the browser's nested-timer
        // resolution turns that into, it is not the 1 s the same payload takes at
        // 20 ms — that is the whole difference this setting makes.
        expect(elapsed).toBeLessThan(1000);
    });

    test('changing the cadence mid-paste does NOT re-pace the run @slow', async ({ page }) => {
        // The pacing a run uses is frozen when the run is enqueued. Without that,
        // picking a bigger chunk during a large paste would dump everything still
        // queued onto the wire in one burst — the exact overrun the pacing exists
        // to prevent, triggered by a menu click the user reads as harmless. The
        // same freeze must not let an APPENDED paste speed the run up either.
        // Pinned at 1 byte every 20 ms rather than left on the defaults: the case is
        // about the freeze, not the rate, and 220 writes at the default 200 ms would
        // hold it open for 44 s.
        await setup(page, { prefs: pacing(1, 20) });
        await connect(page);
        await page.locator('#debug').evaluate((el) => { el.open = true; });
        await page.evaluate(() => { window.__mockWriterLog.length = 0; });
        await page.locator('#input').fill('X'.repeat(200));   // 200 writes ≈ 4 s
        await page.locator('#paste-test').click();
        await expect(page.locator('#paste-toast')).toBeVisible();

        await setPasteChunk(page, '32');
        expect(await page.evaluate(() => window.__pastePump.getPasteChunk())).toBe(32);
        // Append while the run is still in flight — the faster cadence must not
        // reach these bytes either.
        expect(await page.evaluate(() => window.__pastePump.isActive())).toBe(true);
        await page.locator('#input').fill('Y'.repeat(20));
        await page.locator('#paste-test').click();
        await expect(page.locator('#paste-toast-text')).toContainText('Paste complete', { timeout: 30_000 });

        const sizes = await page.evaluate(() => window.__mockWriterLog.map((e) => e.bytes.length));
        expect(Math.max(...sizes)).toBe(1);
        expect(sizes.reduce((a, b) => a + b, 0)).toBe(220);
        // The new value governs the NEXT paste.
        expect(await page.evaluate(() => window.__pastePump.__getStateForTests().chunkSize)).toBe(32);
    });

    test('a paste appended after picking a SLOWER cadence adopts it @slow', async ({ page }) => {
        // The other direction, which freezing must not trap: a user who pastes,
        // sees garbage, drops the chunk size and pastes again before the first run
        // has drained has to get the smaller chunk on the new bytes.
        await setup(page, { prefs: pacing(32, 50) });
        await connect(page);
        await page.locator('#debug').evaluate((el) => { el.open = true; });
        await page.evaluate(() => { window.__mockWriterLog.length = 0; });

        // 1600 B at 32 B every 50 ms is 50 writes ≈ 2.5 s — still running while the
        // menu is driven.
        await page.locator('#input').fill('X'.repeat(1600));
        await page.locator('#paste-test').click();
        await expect(page.locator('#paste-toast')).toBeVisible();

        // 8 B every 50 ms is 160 B/s against the run's 640 B/s, and a quarter of
        // the burst. Adopting it slows the whole remaining queue, appended bytes
        // included — which is the point.
        await setPasteChunk(page, '8');
        expect(await page.evaluate(() => window.__pastePump.isActive())).toBe(true);
        await page.locator('#input').fill('Y'.repeat(60));
        await page.locator('#paste-test').click();
        await expect(page.locator('#paste-toast-text')).toContainText('Paste complete', { timeout: 40_000 });

        const writes = await page.evaluate(() => window.__mockWriterLog.map((e) => e.bytes));
        // It really did start at 32 B…
        expect(Math.max(...writes.map((w) => w.length))).toBe(32);
        // …and no write carrying an appended byte is bigger than the new chunk.
        const appended = writes.filter((w) => w.includes(0x59));
        expect(appended.length).toBeGreaterThan(0);
        expect(Math.max(...appended.map((w) => w.length))).toBe(8);
    });

    test('a longer pause picked mid-run also reaches an appended paste @slow', async ({ page }) => {
        // Same rule on the other control. The run is at 8 B every 5 ms (1600 B/s);
        // 8 B every 50 ms is 160 B/s, so the appended bytes must slow down.
        await setup(page, { prefs: pacing(8, 5) });
        await connect(page);
        await page.locator('#debug').evaluate((el) => { el.open = true; });
        await page.evaluate(() => { window.__mockWriterLog.length = 0; });

        await page.locator('#input').fill('X'.repeat(2400));   // 300 writes ≈ 1.5 s
        await page.locator('#paste-test').click();
        await expect(page.locator('#paste-toast')).toBeVisible();

        await setPastePause(page, '50');
        expect(await page.evaluate(() => window.__pastePump.isActive())).toBe(true);
        await page.locator('#input').fill('Y'.repeat(40));     // 5 writes at the slower pause
        await page.locator('#paste-test').click();
        await expect(page.locator('#paste-toast-text')).toContainText('Paste complete', { timeout: 40_000 });

        const log = await page.evaluate(() => window.__mockWriterLog.map((e) => ({ bytes: e.bytes, ts: e.ts })));
        // The tail is 5 writes of 8 'Y' bytes, so 4 of the gaps in it are the new
        // 50 ms pause. Measured on the MINIMUM gap between adjacent Y-writes, so a
        // single late timer cannot decide it either way.
        const yWrites = log.filter((e) => e.bytes.includes(0x59));
        expect(yWrites.length).toBe(5);
        const yGaps = yWrites.slice(0, -1).map((e, i) => yWrites[i + 1].ts - e.ts);
        expect(Math.min(...yGaps)).toBeGreaterThanOrEqual(45);
        // The chunk size did not change with it — only the pause did.
        expect(yWrites.every((e) => e.bytes.length === 8)).toBe(true);
    });

    test('a SLIDE transfer starting mid-paste stops the pump without advancing progress @fast', async ({ page }) => {
        // enqueuePaste asks isTransferRunning() only at the door. If a transfer
        // starts after that, tx-sink silently discards every remaining write
        // (wire owner 'slide'), so a pump that kept going would drive the progress
        // chip to 100% over bytes that never left the browser. writeOneChunk
        // re-asks before each write and cancels instead.
        await setup(page, { prefs: pacing(8, 20) });
        await connect(page);
        await page.locator('#debug').evaluate((el) => { el.open = true; });
        await page.evaluate(() => { window.__mockWriterLog.length = 0; });
        await page.locator('#input').fill('Y'.repeat(400));   // 50 writes ≈ 1 s
        await page.locator('#paste-test').click();
        await expect(page.locator('#paste-toast')).toBeVisible();

        // Hand the wire to SLIDE, exactly as a transfer starting would.
        await page.evaluate(() => window.__txSink.setWireOwner('slide'));
        await expect(page.locator('#paste-toast-text')).toContainText('Paste cancelled', { timeout: 5000 });
        // It must NOT have run to completion over the dropped bytes.
        await expect(page.locator('#paste-toast-text')).not.toContainText('Paste complete');
        expect(await page.evaluate(() => window.__pastePump.isActive())).toBe(false);
        const written = await page.evaluate(
            () => window.__mockWriterLog.reduce((a, e) => a + e.bytes.length, 0));
        expect(written).toBeLessThan(400);
    });

    test('800 B of 40-char lines takes about what the confirm quotes @slow', async ({ page }) => {
        // The worked example from the fix. 19 lines of 40 characters, each break
        // rewritten to a single CR: 19 × 41 = 779 bytes on the wire. At 8 B every
        // 20 ms that is ceil(779 / 8) = 98 writes and 97 pauses ≈ 1.94 s. The line
        // breaks do not enter into it — that is the point.
        //
        // Every assertion against the clock here is ONE-SIDED, and deliberately.
        // This run is a chain of ~98 nested setTimeouts, each of which can fire
        // late and none of which can fire early, so a wall-clock ceiling is a flake
        // waiting for a loaded runner while proving nothing the floor does not. The
        // quote is pinned to the model exactly (toBe(2)); the only comparison
        // against the clock that survives is "the quote does not OVERSTATE the
        // run", which a slow runner can only make more true.
        await setup(page, { prefs: pacing(8, 20) });
        await connect(page);
        await page.locator('#debug').evaluate((el) => { el.open = true; });
        await page.locator('#input').fill(('A'.repeat(40) + '\\x0A').repeat(19));

        const t0 = await page.evaluate(() => performance.now());
        await page.locator('#paste-test').click();
        await expect(page.locator('#paste-toast-text')).toContainText('Paste complete', { timeout: 30_000 });
        const elapsed = await page.evaluate((t) => performance.now() - t, t0);
        expect(elapsed).toBeGreaterThanOrEqual(1940 * 0.9);

        // What the confirm would quote for the same payload, using the same live
        // pump readings main.js injects into it.
        const quoted = await page.evaluate(async () => {
            const p = window.__pasteToast.confirmLargePaste(779, {
                getChunk: () => window.__pastePump.getPasteChunk(),
                getPauseMs: () => window.__pastePump.getPastePauseMs(),
            });
            const s = window.__pasteToast.__getStateForTests().confirmData.seconds;
            window.__pasteToast.hide();
            await p;
            return s;
        });
        expect(quoted).toBe(2);
        expect(quoted * 1000).toBeLessThanOrEqual(elapsed * 1.15);
    });
});


// Pacing applies ONLY to a port with no flow control.
//
// The measured working point without flow control is 5 B/s — nearly three minutes
// for an 800 B block. With RTS/CTS the same paste is correct at full wire speed,
// because the firmware handshakes per byte, which is strictly better than any
// fixed cadence the pump can impose. Applying the one to the other would turn a
// sub-second paste into a coffee break for no benefit at all.
//
// The pump learns this from serial.js's setLastConfig, the single place the open
// port's config is recorded. That is a hook of exactly the shape setBaudForPump
// had — a setter in the pump that only serial.js calls — and setBaudForPump
// shipped with a comment claiming it was called while NOTHING called it, for
// months, in production or in a test. So the wiring is PROVED here rather than
// asserted in a comment: every case below drives a real connect through the
// Connection menu, and the first one fails outright if the setLastConfig call is
// deleted.
test.describe('Paste pacing — only on a port with no flow control', () => {
    test('the hook serial.js pushes through is live @fast', async ({ page }) => {
        // THIS IS THE WIRING TEST. Delete the setPasteFlowControl call in
        // serial.js's setLastConfig and it fails on the second assertion: the pump
        // would still be reporting the boot value.
        await setup(page, { prefs: withFlowControl('hardware') });
        // Nothing is open yet, so the pump knows nothing — and treats that as
        // `none`, because pacing a connection that does not need it costs time
        // while not pacing one that does costs data.
        expect(await page.evaluate(() => window.__pastePump.getPasteFlowControl())).toBe('none');

        await connect(page);
        expect(await page.evaluate(() => window.__pastePump.getPasteFlowControl())).toBe('hardware');

        // And an explicit Disconnect puts it back: nothing is open, so nothing is
        // known, so the next paste paces again.
        await page.evaluate(() => window.__menuBar.open('connection'));
        await page.click('#menu-connect-item');
        await expect(page.locator('#menu-connect-item')).toHaveAttribute('data-state', 'disconnected');
        expect(await page.evaluate(() => window.__pastePump.getPasteFlowControl())).toBe('none');
    });

    test('a handshaking port runs the paste unpaced, whatever the two rows hold @fast', async ({ page }) => {
        // The defaults are in force — 1 byte every 200 ms — and they are ignored.
        await setup(page, { prefs: withFlowControl('hardware') });
        await connect(page);
        await page.locator('#debug').evaluate((el) => { el.open = true; });

        // The EFFECTIVE pacing is the unpaced shape: one 32-byte chunk after
        // another with no pause, which is byte-for-byte what the pump did before
        // any pacing existed.
        expect(await page.evaluate(() => window.__pastePump.__getStateForTests()))
            .toMatchObject({
                chunkSize: 32, pauseMs: 0, throughput: null,
                flowControl: 'hardware', bypassedByFlowControl: true,
            });
        // The SETTINGS are untouched by any of it. They are still the user's, they
        // still show in the menu, and they apply again the moment a bare port is
        // opened. Nothing was clamped, defaulted or overwritten.
        expect(await page.evaluate(() => window.__pastePump.getPasteChunk())).toBe(1);
        expect(await page.evaluate(() => window.__pastePump.getPastePauseMs())).toBe(200);

        await page.evaluate(() => { window.__mockWriterLog.length = 0; });
        await page.locator('#input').fill('Z'.repeat(400));
        const t0 = await page.evaluate(() => performance.now());
        await page.locator('#paste-test').click();
        await expect(page.locator('#paste-toast-text')).toContainText('Paste complete', { timeout: 10_000 });
        const elapsed = await page.evaluate((t) => performance.now() - t, t0);

        const sizes = await page.evaluate(() => window.__mockWriterLog.map((e) => e.bytes.length));
        expect(sizes).toEqual([...new Array(12).fill(32), 16]);   // 400 = 12 x 32 + 16
        // 400 B at the settings the user actually holds would be 80 seconds.
        expect(elapsed).toBeLessThan(2000);
    });

    test('a port with no flow control paces normally @fast', async ({ page }) => {
        // The same connect, the same settings, the other flow control. The form
        // default is `none`, which is the MicroBeast preset.
        await setup(page, { prefs: withFlowControl('none', { pasteChunk: 1, pastePauseMs: 20 }) });
        await connect(page);
        await page.locator('#debug').evaluate((el) => { el.open = true; });

        expect(await page.evaluate(() => window.__pastePump.__getStateForTests()))
            .toMatchObject({
                chunkSize: 1, pauseMs: 20, throughput: 50,
                flowControl: 'none', bypassedByFlowControl: false,
            });

        await page.evaluate(() => { window.__mockWriterLog.length = 0; });
        await page.locator('#input').fill('Z'.repeat(40));
        await page.locator('#paste-test').click();
        await expect(page.locator('#paste-toast-text')).toContainText('Paste complete', { timeout: 10_000 });
        const sizes = await page.evaluate(() => window.__mockWriterLog.map((e) => e.bytes.length));
        expect(sizes).toEqual(new Array(40).fill(1));
    });

    test('reopening the port with different flow control changes the next paste @fast', async ({ page }) => {
        // Matrix row: reopened hardware → none, the next paste paces again. The
        // form is the thing that changes; setLastConfig is what carries it through.
        await setup(page, { prefs: withFlowControl('hardware', { pasteChunk: 1, pastePauseMs: 20 }) });
        await connect(page);
        expect(await page.evaluate(() => window.__pastePump.__getStateForTests().bypassedByFlowControl))
            .toBe(true);

        // Disconnect, switch the port to no flow control, connect again.
        await page.evaluate(() => window.__menuBar.open('connection'));
        await page.click('#menu-connect-item');
        await expect(page.locator('#menu-connect-item')).toHaveAttribute('data-state', 'disconnected');
        await setFlowControl(page, 'none');
        await connect(page);

        expect(await page.evaluate(() => window.__pastePump.__getStateForTests()))
            .toMatchObject({
                chunkSize: 1, pauseMs: 20, throughput: 50,
                flowControl: 'none', bypassedByFlowControl: false,
            });

        // And back the other way, so neither direction is a one-off.
        await page.evaluate(() => window.__menuBar.open('connection'));
        await page.click('#menu-connect-item');
        await expect(page.locator('#menu-connect-item')).toHaveAttribute('data-state', 'disconnected');
        await setFlowControl(page, 'hardware');
        await connect(page);
        expect(await page.evaluate(() => window.__pastePump.__getStateForTests().bypassedByFlowControl))
            .toBe(true);
    });

    test('a connect DURING a paced paste does not re-pace the run @slow', async ({ page }) => {
        // The flow control is frozen at enqueue with the rest of the pacing
        // snapshot. Without that, opening a handshaking port halfway through a
        // paced paste would dump the whole remaining queue on the wire in one
        // burst — the exact overrun the pacing exists to prevent, triggered by a
        // click the user reads as unrelated.
        //
        // The paste starts with nothing open (tx-sink drops the early writes,
        // which is fine — the pump paces regardless), and the port is opened
        // with RTS/CTS while it runs.
        await setup(page, { prefs: withFlowControl('hardware', { pasteChunk: 1, pastePauseMs: 20 }) });
        await page.locator('#debug').evaluate((el) => { el.open = true; });
        await page.locator('#input').fill('X'.repeat(400));   // 400 writes ≈ 8 s
        await page.locator('#paste-test').click();
        await expect(page.locator('#paste-toast')).toBeVisible();

        await connect(page);
        // The hook fired mid-run…
        expect(await page.evaluate(() => window.__pastePump.getPasteFlowControl())).toBe('hardware');
        expect(await page.evaluate(() => window.__pastePump.isActive())).toBe(true);
        await page.evaluate(() => { window.__mockWriterLog.length = 0; });

        await expect(page.locator('#paste-toast-text')).toContainText('Paste complete', { timeout: 30_000 });
        // …and every write the now-open port saw is still one byte. The run kept
        // what it froze; only the NEXT paste is unpaced.
        const sizes = await page.evaluate(() => window.__mockWriterLog.map((e) => e.bytes.length));
        expect(sizes.length).toBeGreaterThan(0);
        expect(Math.max(...sizes)).toBe(1);
        expect(await page.evaluate(() => window.__pastePump.__getStateForTests().bypassedByFlowControl))
            .toBe(true);
    });
});
