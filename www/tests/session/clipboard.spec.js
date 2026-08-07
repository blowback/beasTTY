// Beastty Phase 6 Plan 04 (Wave 3) — SESS-02/SESS-03 clipboard tests.
//
// Wave 3 un-fixmes the 12 stubs created in Plan 06-01.
//
// Sources:
//   - 06-CONTEXT.md D-19, D-21..D-25.
//   - 06-VALIDATION.md §Phase Requirements → Test Map (clipboard row).
//   - Analog: www/tests/transport/paste.spec.js (mock writer log + post-paste byte-stream assertion).
import { test, expect } from '@playwright/test';
// Settings ▸ Paste settings… — the three paste controls live in #paste-config-modal.
import { setPasteEol, setPasteChunk } from '../paste-settings.js';
import { SERIAL_MOCK } from '../transport/mock-serial.js';
import { CLIPBOARD_MOCK } from './clipboard-mock.js';

// `prefs` seeds a stored blob before boot — used below to open the port with
// hardware flow control (applyPrefs mirrors prefs.serial onto the serial-config
// form, and connectMicroBeast opens with whatever the form holds).
async function setup(page, { prefs } = {}) {
    await page.addInitScript(SERIAL_MOCK);
    await page.addInitScript(CLIPBOARD_MOCK);
    if (prefs) {
        await page.addInitScript(
            (blob) => localStorage.setItem('beastty.prefs', blob), JSON.stringify(prefs));
    }
    await page.goto('/');
    await page.locator('#terminal-wrapper').focus();
    await page.waitForFunction(() => document.getElementById('terminal').width > 0);
    await page.waitForFunction(() => typeof window.__selection === 'object' && window.__selection !== null);
    // Default content for selection-driven copy tests.
    await page.evaluate(() => {
        const bytes = new TextEncoder().encode('hello world\nfoo bar baz\nthe entire line');
        window.__term.feed(bytes);
        window.__term.snapshot_grid();
    });
}

async function selectFirstFiveCells(page) {
    const cs = await page.evaluate(() => window.__getActiveCellSize());
    const box = await page.locator('#terminal').boundingBox();
    const yMid = box.y + cs.cellH / 2;
    await page.mouse.move(box.x + cs.cellW / 2, yMid);
    await page.mouse.down();
    await page.mouse.move(box.x + cs.cellW * 5 + cs.cellW / 2, yMid);
    await page.mouse.up();
}

async function connectMockSerial(page) {
    await page.evaluate(() => window.__menuBar.open('connection'));
    await page.click('#menu-connect-item');
    await page.waitForFunction(() =>
        document.getElementById('menu-connect-item').getAttribute('data-state') === 'connected');
}

test.describe('SESS-02/SESS-03 — Clipboard', () => {
    test('Ctrl+Shift+C copies plain text to clipboard @fast', async ({ page }) => {
        await setup(page);
        await selectFirstFiveCells(page);
        await page.evaluate(() => window.__copySelection());
        const contents = await page.evaluate(() => window.__getClipboardContents());
        expect(contents.length).toBeGreaterThan(0);
        // After successful copy, selection cleared (D-19).
        const sel = await page.evaluate(() => window.__selection.getSelection());
        expect(sel).toBeNull();
    });

    test('plain Ctrl+C still sends 0x03 (sacred)', async ({ page }) => {
        await setup(page);
        // No selection. Plain Ctrl+C goes through the existing Phase 4 encode
        // path — produces 0x03 via tx-sink ring. We sample TX via the hex strip
        // (the visible ground-truth surface in Phase 4 INPUT-04).
        // Use page.keyboard.down to ensure a single Ctrl+C without Shift.
        await page.keyboard.down('Control');
        await page.keyboard.press('c');
        await page.keyboard.up('Control');
        const txStrip = await page.locator('#tx-strip').textContent();
        // 0x03 byte is rendered as "03" in the hex strip.
        expect(txStrip).toContain('03');
    });

    test('Ctrl+Shift+V pastes clipboard via paste-pump @fast', async ({ page }) => {
        await setup(page);
        await page.evaluate(() => window.__setClipboardContents('paste me'));
        await connectMockSerial(page);
        await page.evaluate(() => window.__pasteFromClipboard());
        // Wait for the whole payload, not the first write: at the default cadence a
        // chunk is one byte, so "log is non-empty" only proves the 'p' arrived.
        await page.waitForFunction(
            () => window.__mockWriterLog.reduce((a, e) => a + e.bytes.length, 0) >= 8,
            { timeout: 5000 });
        const log = await page.evaluate(() => window.__mockWriterLog);
        const allBytes = log.flatMap((e) => e.bytes);
        const text = String.fromCharCode(...allBytes);
        expect(text).toContain('paste me');
    });

    test('plain Ctrl+V still sends 0x16 SYN (sacred)', async ({ page }) => {
        await setup(page);
        await page.keyboard.down('Control');
        await page.keyboard.press('v');
        await page.keyboard.up('Control');
        const txStrip = await page.locator('#tx-strip').textContent();
        // 0x16 byte rendered as "16" in the hex strip.
        expect(txStrip).toContain('16');
    });

    test('copy format: trailing whitespace trimmed per line', async ({ page }) => {
        await setup(page);
        // Triple-click row 0 to select the entire line.
        const cs = await page.evaluate(() => window.__getActiveCellSize());
        const box = await page.locator('#terminal').boundingBox();
        const x = box.x + cs.cellW * 4 + cs.cellW / 2;
        const y = box.y + cs.cellH / 2;
        await page.mouse.click(x, y);
        await page.mouse.click(x, y);
        await page.mouse.click(x, y);
        await page.evaluate(() => window.__copySelection());
        const contents = await page.evaluate(() => window.__getClipboardContents());
        // 'hello world' was fed to row 0; trailing blank cells should be stripped.
        expect(contents).toBe('hello world');
    });

    test('single-line copy has no trailing newline', async ({ page }) => {
        await setup(page);
        await selectFirstFiveCells(page);
        await page.evaluate(() => window.__copySelection());
        const contents = await page.evaluate(() => window.__getClipboardContents());
        expect(contents.endsWith('\n')).toBe(false);
    });

    test('paste preprocessing strips 0x00–0x1F except CR/LF/Tab', async ({ page }) => {
        await setup(page);
        // Mix control bytes: 0x00 (NUL — drop), 0x07 (BEL — drop), 0x09 Tab (keep),
        // 0x0A LF (keep).
        //
        // The LF survives the strip and is then rewritten to 0x0D by the default
        // Paste line ending — that is the point of the setting, and it is what the
        // MicroBeast needs to see a line break at all. What this case asserts is
        // the STRIP: NUL and BEL gone, Tab and the break kept, everything else
        // through untouched.
        await page.evaluate(() => window.__setClipboardContents('A\x00B\tC\nD\x07E'));
        await connectMockSerial(page);
        await page.evaluate(() => window.__pasteFromClipboard());
        // Poll for the whole stream rather than sleeping a fixed 500 ms: at the
        // default cadence — 1 byte every 200 ms, the measured hardware working
        // point — seven bytes take 1.2 s, and a fixed sleep would read a truncated
        // wire and call it a strip.
        await expect.poll(async () => page.evaluate(
            () => String.fromCharCode(...window.__mockWriterLog.flatMap((e) => e.bytes))),
            { timeout: 5000 }).toBe('AB\tC\rDE');
    });

    test('paste applies the line-break rewrite per pasteLineEnding', async ({ page }) => {
        await setup(page);
        // Switch Paste line ending to LF — the pump rewrites the break to 0x0A.
        // This used to drive Settings ▸ Enter key sends, because the pump read
        // getCrlfMode(); paste has had its own setting since the paste-text-loss
        // fix, and the Enter-key path is none of the pump's business.
        await setPasteEol(page, 'lf');
        await page.evaluate(() => window.__setClipboardContents('A\rB'));
        await connectMockSerial(page);
        await page.evaluate(() => window.__pasteFromClipboard());
        // Polled, not slept — see the strip case above.
        // 'A\rB' arrives at the pump after the strip. Pump rewrites \r → \n.
        await expect.poll(async () => page.evaluate(
            () => window.__mockWriterLog.flatMap((e) => e.bytes)),
            { timeout: 5000 }).toEqual([0x41, 0x0A, 0x42]);
    });

    test('large paste >= 4096 bytes shows confirm chip; pump waits for click', async ({ page }) => {
        await setup(page);
        await page.evaluate(() => window.__setClipboardContents('A'.repeat(5000)));
        await connectMockSerial(page);
        // Fire pasteFromClipboard but don't await it — the confirm chip will
        // hold the promise until the user clicks Paste/Cancel.
        await page.evaluate(() => { window.__pendingPasteResult = window.__pasteFromClipboard(); });
        // Confirm toast is visible (E7.1 — the confirm rehomed to #paste-toast).
        await expect(page.locator('#paste-toast-text')).toContainText('About to paste 5,000 B');
        await expect(page.locator('#paste-toast button[data-action="paste"]')).toBeVisible();
        // No bytes have been written yet.
        const log0 = await page.evaluate(() => window.__mockWriterLog.length);
        expect(log0).toBe(0);
        // Click Paste.
        await page.locator('#paste-toast button[data-action="paste"]').click();
        await page.waitForFunction(() => window.__mockWriterLog.length > 0, { timeout: 5000 });
    });

    test('the confirm counts WIRE bytes, not clipboard bytes', async ({ page }) => {
        // In 'crlf' every line break becomes two bytes, so the payload that goes out
        // is longer than the text on the clipboard. 1000 lines of 'AAA' is 4000
        // clipboard bytes — under the threshold — but 5000 on the wire. Counting the
        // clipboard copy skipped the confirm entirely AND, when it did fire, quoted
        // a size the paste was never going to be.
        await setup(page);
        await page.waitForFunction(() => window.__menuBar && typeof window.__menuBar.open === 'function');
        await setPasteEol(page, 'crlf');

        await page.evaluate(() => window.__setClipboardContents('AAA\n'.repeat(1000)));
        await connectMockSerial(page);
        await page.evaluate(() => { window.__pendingPasteResult = window.__pasteFromClipboard(); });
        await expect(page.locator('#paste-toast-text')).toContainText('About to paste 5,000 B');
        await page.locator('#paste-toast button[data-action="cancel"]').click();
    });

    test('changing the paste cadence while the confirm is open does not re-pace the run', async ({ page }) => {
        // The confirm is awaited and the Settings menu stays usable underneath it.
        // The quote is taken from a pacing snapshot and the run uses the SAME
        // snapshot, so a chunk size picked in between governs the NEXT paste, not
        // this one — otherwise the user could be quoted 50 B/s and served a
        // 32-byte burst.
        await setup(page);
        await page.waitForFunction(() => window.__menuBar && typeof window.__menuBar.open === 'function');
        await page.evaluate(() => window.__setClipboardContents('A'.repeat(5000)));
        await connectMockSerial(page);
        await page.evaluate(() => { window.__pendingPasteResult = window.__pasteFromClipboard(); });
        await expect(page.locator('#paste-toast-text')).toContainText('About to paste 5,000 B');

        // Switch to a 32-byte chunk WHILE the confirm is up, then accept. The Paste
        // settings modal is reachable with the confirm chip on screen — the chip is
        // not a dialog and does not block the menu.
        await setPasteChunk(page, 32);
        expect(await page.evaluate(() => window.__pastePump.getPasteChunk())).toBe(32);

        await page.locator('#paste-toast button[data-action="paste"]').click();
        await page.waitForFunction(() => window.__mockWriterLog.length >= 4, { timeout: 5000 });
        const sizes = await page.evaluate(() => window.__mockWriterLog.map((e) => e.bytes.length));
        // The quoted 1-byte cadence is what actually ran.
        expect(Math.max(...sizes)).toBe(1);
        await page.evaluate(() => window.__pastePump.cancelPaste());
    });

    test('a handshaking port quotes wire speed in the confirm, end to end', async ({ page }) => {
        // The paste-toast has a branch for "the port is handshaking, so your Paste
        // pause does not apply here" — and a branch nothing reaches is a branch
        // that does not exist. This drives the REAL path: a port opened with
        // RTS/CTS, a real clipboard paste, the string the user actually sees. It
        // fails if main.js stops injecting isFlowControlled, or if serial.js stops
        // telling the pump how the port is framed.
        await setup(page, { prefs: {
            version: 2,
            serial: { baud: 19200, dataBits: 8, stopBits: 1, parity: 'none', flowControl: 'hardware' },
        } });
        await page.evaluate(() => window.__setClipboardContents('A'.repeat(5000)));
        await connectMockSerial(page);
        await page.evaluate(() => { window.__pendingPasteResult = window.__pasteFromClipboard(); });
        await expect(page.locator('#paste-toast-text'))
            .toHaveText('About to paste 5,000 B at wire speed (flow control).');
        await page.locator('#paste-toast button[data-action="cancel"]').click();
    });

    test('Cancel on confirm chip discards pending bytes', async ({ page }) => {
        await setup(page);
        await page.evaluate(() => window.__setClipboardContents('A'.repeat(5000)));
        await connectMockSerial(page);
        await page.evaluate(() => { window.__pendingPasteResult = window.__pasteFromClipboard(); });
        await expect(page.locator('#paste-toast button[data-action="paste"]')).toBeVisible();
        const log0 = await page.evaluate(() => window.__mockWriterLog.length);
        expect(log0).toBe(0);
        await page.locator('#paste-toast button[data-action="cancel"]').click();
        // After Cancel, paste did not start — pump never wrote bytes.
        await page.waitForTimeout(300);
        const logAfter = await page.evaluate(() => window.__mockWriterLog.length);
        expect(logAfter).toBe(0);
    });

    test('empty selection + Ctrl+Shift+C is a silent no-op (no clipboard write)', async ({ page }) => {
        await setup(page);
        // Pre-populate clipboard so we can detect that no write happened.
        await page.evaluate(() => window.__setClipboardContents('previously'));
        await page.evaluate(() => window.__copySelection());
        const contents = await page.evaluate(() => window.__getClipboardContents());
        expect(contents).toBe('previously');
        const log = await page.evaluate(() => window.__mockClipboardLog);
        // No writeText op recorded.
        const writes = log.filter((e) => e.op === 'writeText');
        expect(writes.length).toBe(0);
    });

    test('successful copy clears selection', async ({ page }) => {
        await setup(page);
        await selectFirstFiveCells(page);
        let sel = await page.evaluate(() => window.__selection.getSelection());
        expect(sel).not.toBeNull();
        await page.evaluate(() => window.__copySelection());
        sel = await page.evaluate(() => window.__selection.getSelection());
        expect(sel).toBeNull();
    });
});
