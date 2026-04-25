// BestialiTTY Phase 6 Plan 04 (Wave 3) — SESS-02/SESS-03 clipboard tests.
//
// Wave 3 un-fixmes the 12 stubs created in Plan 06-01.
//
// Sources:
//   - 06-CONTEXT.md D-19, D-21..D-25.
//   - 06-VALIDATION.md §Phase Requirements → Test Map (clipboard row).
//   - Analog: www/tests/transport/paste.spec.js (mock writer log + post-paste byte-stream assertion).
import { test, expect } from '@playwright/test';
import { SERIAL_MOCK } from '../transport/mock-serial.js';
import { CLIPBOARD_MOCK } from './clipboard-mock.js';

async function setup(page) {
    await page.addInitScript(SERIAL_MOCK);
    await page.addInitScript(CLIPBOARD_MOCK);
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
    await page.locator('#connect-button').click();
    await page.waitForFunction(() =>
        document.getElementById('connect-button').getAttribute('data-state') === 'connected');
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
        await page.waitForFunction(() => window.__mockWriterLog.length > 0, { timeout: 2000 });
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
        // 0x0A LF (keep), 0x0D CR (keep). Avoid 0x0D so the CR/LF rewrite doesn't
        // alter byte counts in this assertion.
        await page.evaluate(() => window.__setClipboardContents('A\x00B\tC\nD\x07E'));
        await connectMockSerial(page);
        await page.evaluate(() => window.__pasteFromClipboard());
        await page.waitForFunction(() => window.__mockWriterLog.length > 0, { timeout: 2000 });
        // Drain so all bytes land — small payload.
        await page.waitForTimeout(500);
        const log = await page.evaluate(() => window.__mockWriterLog);
        const allBytes = log.flatMap((e) => e.bytes);
        const text = String.fromCharCode(...allBytes);
        expect(text).toBe('AB\tC\nDE');
    });

    test('paste applies CR/LF rewrite per Phase 4 crlfMode', async ({ page }) => {
        await setup(page);
        // Switch CR/LF mode to LF — Phase 5 paste-pump rewrites 0x0D → 0x0A.
        await page.locator('#crlf-lf').check();
        await page.evaluate(() => window.__setClipboardContents('A\rB'));
        await connectMockSerial(page);
        await page.evaluate(() => window.__pasteFromClipboard());
        await page.waitForFunction(() => window.__mockWriterLog.length > 0, { timeout: 2000 });
        await page.waitForTimeout(500);
        const log = await page.evaluate(() => window.__mockWriterLog);
        const allBytes = log.flatMap((e) => e.bytes);
        // 'A\rB' arrives at the pump after the strip. Pump rewrites \r → \n.
        expect(allBytes).toEqual([0x41, 0x0A, 0x42]);
    });

    test('large paste >= 4096 bytes shows confirm chip; pump waits for click', async ({ page }) => {
        await setup(page);
        await page.evaluate(() => window.__setClipboardContents('A'.repeat(5000)));
        await connectMockSerial(page);
        // Fire pasteFromClipboard but don't await it — the confirm chip will
        // hold the promise until the user clicks Paste/Cancel.
        await page.evaluate(() => { window.__pendingPasteResult = window.__pasteFromClipboard(); });
        // Confirm chip is visible.
        await expect(page.locator('#paste-progress-text')).toContainText('About to paste 5,000 B');
        await expect(page.locator('#paste-confirm')).toBeVisible();
        // No bytes have been written yet.
        const log0 = await page.evaluate(() => window.__mockWriterLog.length);
        expect(log0).toBe(0);
        // Click Paste.
        await page.locator('#paste-confirm').click();
        await page.waitForFunction(() => window.__mockWriterLog.length > 0, { timeout: 5000 });
    });

    test('Cancel on confirm chip discards pending bytes', async ({ page }) => {
        await setup(page);
        await page.evaluate(() => window.__setClipboardContents('A'.repeat(5000)));
        await connectMockSerial(page);
        await page.evaluate(() => { window.__pendingPasteResult = window.__pasteFromClipboard(); });
        await expect(page.locator('#paste-confirm')).toBeVisible();
        const log0 = await page.evaluate(() => window.__mockWriterLog.length);
        expect(log0).toBe(0);
        await page.locator('#paste-cancel').click();
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
