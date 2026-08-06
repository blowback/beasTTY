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

// Settings ▸ Paste line ending / Paste speed. Both are radio submenus reached
// exactly like Enter key sends (input/crlf-override.spec.js is the incumbent
// idiom); the row click applies the pump setter AND persists, so a paste run
// immediately after sees the new value.
const pasteEolRow = (v) =>
    `#dropdown-settings .submenu[data-submenu-panel="paste-eol"] .menu-item[data-value="${v}"]`;
const pasteSpeedRow = (v) =>
    `#dropdown-settings .submenu[data-submenu-panel="paste-speed"] .menu-item[data-value="${v}"]`;

async function pickSettingsRadio(page, submenu, rowSelector) {
    await page.evaluate(() => window.__menuBar.open('settings'));
    await page.click(`#dropdown-settings .menu-item[data-submenu="${submenu}"]`);
    await page.click(rowSelector);
    await page.evaluate(() => window.__menuBar.close());
}

const setPasteEol = (page, v) => pickSettingsRadio(page, 'paste-eol', pasteEolRow(v));
const setPasteSpeed = (page, v) => pickSettingsRadio(page, 'paste-speed', pasteSpeedRow(v));

// Open/close the serial-config <dialog> so its selects are actionable (verbatim
// idiom from tests/transport/config.spec.js).
async function openForm(page) {
    await page.evaluate(() => document.getElementById('serial-config-modal').showModal());
    await expect(page.locator('#serial-config-modal')).toBeVisible();
}

async function closeForm(page) {
    await page.evaluate(() => document.getElementById('serial-config-modal').close());
    await expect(page.locator('#serial-config-modal')).toBeHidden();
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

    // The duration assumption this test was written against — 32-byte chunks at
    // computeGap(19200) ≈ 19 ms — is now the FULL-SPEED path (Paste speed = 0),
    // not the default. The default is paced (240 B/s), so the test picks Full
    // speed explicitly; that keeps the original wire-rate assertion meaningful
    // AND pins the "speed 0 is byte-for-byte what it was" acceptance criterion.
    test('paste at 19200 baud at full speed paces >= 95% of expected duration @slow', async ({ page }) => {
        await setup(page);
        await page.evaluate(() => window.__menuBar.open('connection'));
        await page.click('#menu-connect-item');
        await expect(page.locator('#menu-connect-item')).toHaveAttribute('data-state', 'connected');
        await setPasteSpeed(page, '0');
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
        // Find an 'A' write (single-byte 0x41) sandwiched by 'E' writes. The
        // sandwich test reads only the FIRST byte of the neighbours, so it is
        // indifferent to the chunk size — 8 bytes at the paced default here,
        // 32 at full speed.
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
    // getCrlfMode(). It no longer does: paste has its own line-ending setting,
    // and the Enter key path is none of the pump's business. The byte-level
    // rewrite matrix lives in tests/input/paste-line-ending.spec.js; this case
    // stays here to prove the rewrite happens BEFORE enqueue, i.e. that what the
    // writer sees is already rewritten.
    test('Paste line ending crlf rewrites 0x0D to 0x0D 0x0A before enqueue', async ({ page }) => {
        await setup(page);
        await page.evaluate(() => window.__menuBar.open('connection'));
        await page.click('#menu-connect-item');
        await expect(page.locator('#menu-connect-item')).toHaveAttribute('data-state', 'connected');
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
    // Uses a 4 KB paste so the pump runs long enough (4096 / 32 = 128 chunks
    // × 19 ms ≈ 2.4 s at 19200 baud) for the assertions to land while the pump
    // is still active — short pastes finish in <100 ms which races the
    // toContainText('Pasting') assertion against 'Paste complete'. Full speed is
    // picked explicitly: at the paced default the same 4 KB takes ~17 s, which
    // is a long time to hold a test open for a layout assertion.
    test('paste toast is a centered overlay that does not displace the canvas', async ({ page }) => {
        await setup(page);
        await page.evaluate(() => window.__menuBar.open('connection'));
        await page.click('#menu-connect-item');
        await expect(page.locator('#menu-connect-item')).toHaveAttribute('data-state', 'connected');
        await setPasteSpeed(page, '0');

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

// The pacing half of the paste-text-loss fix. Pasting at wire speed loses text on
// the MicroBeast whatever the average rate, because a 32-byte write overruns its
// 16-byte UART FIFO inside the single write. A paced paste therefore writes at
// most 8 bytes at a time, ends a chunk at a line terminator rather than carrying
// on past it, and waits longer after a break than after an ordinary chunk.
test.describe('Paste speed — paced chunking', () => {
    // 4 lines of 10 characters. \x0A in the debug textarea reaches the pump as a
    // real 0x0A byte (parseHexEscapes), and the default Paste line ending rewrites
    // each one to 0x0D — so the terminator on the wire is CR.
    const LINES = 4;
    const PACED_PAYLOAD = 'ABCDEFGHIJ\\x0A'.repeat(LINES);

    test('a paced paste writes <= 8 bytes and never spans a line terminator @fast', async ({ page }) => {
        await setup(page);
        await page.evaluate(() => window.__menuBar.open('connection'));
        await page.click('#menu-connect-item');
        await expect(page.locator('#menu-connect-item')).toHaveAttribute('data-state', 'connected');
        await page.locator('#debug').evaluate((el) => { el.open = true; });
        await page.evaluate(() => window.__mockWriterLog.length = 0);
        await page.locator('#input').fill(PACED_PAYLOAD);
        await page.locator('#paste-test').click();
        await expect(page.locator('#paste-toast-text')).toContainText('Paste complete', { timeout: 10_000 });

        const writes = await page.evaluate(() => window.__mockWriterLog.map((e) => e.bytes));
        expect(writes.length).toBeGreaterThan(1);   // it really was chunked
        for (const bytes of writes) {
            expect(bytes.length).toBeLessThanOrEqual(8);
            // A terminator may only be the LAST byte of a write — anything earlier
            // means the chunk carried on past a line break.
            const early = bytes.slice(0, -1).filter((b) => b === 0x0D || b === 0x0A);
            expect(early).toEqual([]);
        }
        // Nothing was lost or duplicated on the way: 4 × (10 chars + CR).
        const all = writes.flat();
        expect(all.length).toBe(LINES * 11);
        expect(all.filter((b) => b === 0x0D).length).toBe(LINES);
    });

    test('the pause after a line terminator is the longer one @slow', async ({ page }) => {
        await setup(page);
        await page.evaluate(() => window.__menuBar.open('connection'));
        await page.click('#menu-connect-item');
        await expect(page.locator('#menu-connect-item')).toHaveAttribute('data-state', 'connected');
        await page.locator('#debug').evaluate((el) => { el.open = true; });

        // At 240 B/s: gapMs = round(8 / 240 * 1000) = 33, lineGapMs = 33 × 5 = 165.
        const pacing = await page.evaluate(() => window.__pastePump.__getStateForTests());
        expect(pacing).toMatchObject({ chunkSize: 8, gapMs: 33, lineGapMs: 165, speed: 240 });

        // 8 short lines, each a single chunk that ends in a terminator, so every
        // gap in the run is a LINE gap: >= 7 × 165 ms ≈ 1.15 s. Were they ordinary
        // gaps the whole paste would be done in ~230 ms, so the lower bound
        // discriminates by 5×. Timers only ever fire late, never early, which is
        // why this asserts a floor and not a window.
        await page.locator('#input').fill('ABCD\\x0A'.repeat(8));
        const t0 = await page.evaluate(() => performance.now());
        await page.locator('#paste-test').click();
        await expect(page.locator('#paste-toast-text')).toContainText('Paste complete', { timeout: 10_000 });
        const elapsed = await page.evaluate((t) => performance.now() - t, t0);
        expect(elapsed).toBeGreaterThanOrEqual(7 * 165 * 0.95);
    });

    test('a speed above the wire is clamped to the byte rate @fast', async ({ page }) => {
        await setup(page);
        // 480 B/s asked for, on a 2400-baud connection that carries 216 B/s.
        await setPasteSpeed(page, '480');
        await openForm(page);
        await page.locator('#serial-baud').selectOption('2400');
        await closeForm(page);
        await page.evaluate(() => window.__menuBar.open('connection'));
        await page.click('#menu-connect-item');
        await expect(page.locator('#menu-connect-item')).toHaveAttribute('data-state', 'connected');

        // Unclamped this would be round(8 / 480 * 1000) = 17 ms — nearly twice the
        // wire's rate. Clamped: round(8 / 216 * 1000) = 37 ms.
        const pacing = await page.evaluate(() => window.__pastePump.__getStateForTests());
        expect(pacing.speed).toBe(480);
        expect(pacing.gapMs).toBe(37);
        expect(pacing.rate).toBe(216);
    });

    test('speed 0 restores the 32-byte full-speed chunking @fast', async ({ page }) => {
        await setup(page);
        await page.evaluate(() => window.__menuBar.open('connection'));
        await page.click('#menu-connect-item');
        await expect(page.locator('#menu-connect-item')).toHaveAttribute('data-state', 'connected');
        await setPasteSpeed(page, '0');
        await page.locator('#debug').evaluate((el) => { el.open = true; });

        // computeGap(19200) — the pre-fix pacing, unchanged.
        const pacing = await page.evaluate(() => window.__pastePump.__getStateForTests());
        expect(pacing).toMatchObject({ chunkSize: 32, gapMs: 19, lineGapMs: 19, speed: 0 });

        // And no terminator-splitting either: a line break mid-chunk is carried
        // straight through, exactly as it was before the paced path existed.
        await page.evaluate(() => window.__mockWriterLog.length = 0);
        await page.locator('#input').fill('ABCD\\x0A'.repeat(16));   // 80 B = 32 + 32 + 16
        await page.locator('#paste-test').click();
        await expect(page.locator('#paste-toast-text')).toContainText('Paste complete', { timeout: 10_000 });
        const sizes = await page.evaluate(() => window.__mockWriterLog.map((e) => e.bytes.length));
        expect(sizes).toEqual([32, 32, 16]);
    });
});
