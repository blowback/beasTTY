// Beastty Phase 6 Plan 05 (Wave 4) — SESS-04/SESS-05 session log download tests.
//
// Wave 0 stubs un-fixmed. Wave 4 production code lives in:
//   - www/transport/session-log.js (new module)
//   - www/transport/serial.js (read-loop append + reset on Connect)
//   - www/index.html (#download-log-button)
//
// Sources:
//   - 06-CONTEXT.md D-29 (log lifecycle / per-connection),
//                  D-30 (chunks-by-reference Blob),
//                  D-31 (filename connect-time UTC stamp / Download log button).
//   - 06-VALIDATION.md §Phase Requirements → Test Map (log-download row).
//   - Analog: www/tests/transport/readloop.spec.js (__mockReaderPush pattern).
import { test, expect } from '@playwright/test';
import { SERIAL_MOCK } from '../transport/mock-serial.js';

async function setup(page) {
    await page.addInitScript(SERIAL_MOCK);
    await page.goto('/');
    await page.locator('#terminal-wrapper').focus();
    await page.waitForFunction(() => document.getElementById('terminal').width > 0);
    // Wait for window.__sessionLog (set by main.js after wireSessionLog).
    await page.waitForFunction(() => typeof window.__sessionLog === 'object' && window.__sessionLog !== null);
}

// E7.1 — the #download-log-button retired with <details id="connection">; File ▸
// Download Session Log is the sole download surface now. Its enabled/disabled state
// + tooltip live on the menu row (#menu-download-log-item), byte-gated by session-log.
const DL_ROW = '#menu-download-log-item';
async function downloadViaMenu(page) {
    await page.evaluate(() => window.__menuBar.open('file'));
    await page.click(DL_ROW);
}

test.describe('SESS-04/SESS-05 — Session log download', () => {
    test('log auto-starts per Connect; chunks accumulate by reference @fast', async ({ page }) => {
        await setup(page);
        await page.evaluate(() => window.__menuBar.open('connection'));
        await page.click('#menu-connect-item');
        await page.waitForSelector('#menu-connect-item[data-state="connected"]', { state: 'attached', timeout: 5000 });
        await page.evaluate(() => window.__mockReaderPush(new TextEncoder().encode('hello')));
        await page.evaluate(() => window.__mockReaderPush(new TextEncoder().encode(' world')));
        await page.waitForFunction(() => window.__sessionLog.getCurrentBytes() === 11, { timeout: 2000 });
    });

    test('Download Session Log row enables after first byte arrives', async ({ page }) => {
        await setup(page);
        await page.evaluate(() => window.__menuBar.open('connection'));
        await page.click('#menu-connect-item');
        await page.waitForSelector('#menu-connect-item[data-state="connected"]', { state: 'attached' });
        await page.evaluate(() => window.__menuBar.open('file'));
        await expect(page.locator(DL_ROW)).toHaveAttribute('data-disabled', 'true');
        await page.evaluate(() => window.__mockReaderPush(new Uint8Array([0x41])));
        // The onStateChange hook re-projects the row live while the File menu is open.
        // Enabled = the data-disabled attribute is removed (projectSessionLog only
        // sets it when disabled), so assert its absence rather than "false".
        await expect(page.locator(DL_ROW)).not.toHaveAttribute('data-disabled', 'true');
        await expect(page.locator(DL_ROW)).toHaveAttribute(
            'title', 'Download all bytes received this connection (.bin)');
    });

    test('Download Session Log row disabled before first byte; tooltip "No bytes received yet"', async ({ page }) => {
        await setup(page);
        await page.evaluate(() => window.__menuBar.open('connection'));
        await page.click('#menu-connect-item');
        await page.waitForSelector('#menu-connect-item[data-state="connected"]', { state: 'attached' });
        await page.evaluate(() => window.__menuBar.open('file'));
        await expect(page.locator(DL_ROW)).toHaveAttribute('data-disabled', 'true');
        await expect(page.locator(DL_ROW)).toHaveAttribute('title', 'No bytes received yet');
    });

    test('download produces correct Blob with all bytes (application/octet-stream)', async ({ page }) => {
        await setup(page);
        await page.evaluate(() => window.__menuBar.open('connection'));
        await page.click('#menu-connect-item');
        await page.waitForSelector('#menu-connect-item[data-state="connected"]', { state: 'attached' });
        await page.evaluate(() => window.__mockReaderPush(new TextEncoder().encode('test bytes here')));
        await page.waitForFunction(() => window.__sessionLog.getCurrentBytes() > 0);
        const downloadPromise = page.waitForEvent('download');
        await downloadViaMenu(page);
        const download = await downloadPromise;
        expect(download.suggestedFilename()).toMatch(/^beastty-\d{8}-\d{6}\.bin$/);
        const stream = await download.createReadStream();
        const chunks = [];
        for await (const chunk of stream) chunks.push(chunk);
        const buf = Buffer.concat(chunks);
        expect(buf.toString()).toBe('test bytes here');
    });

    test('mid-session download captures so-far + appends continue', async ({ page }) => {
        await setup(page);
        await page.evaluate(() => window.__menuBar.open('connection'));
        await page.click('#menu-connect-item');
        await page.waitForSelector('#menu-connect-item[data-state="connected"]', { state: 'attached' });
        await page.evaluate(() => window.__mockReaderPush(new TextEncoder().encode('first')));
        await page.waitForFunction(() => window.__sessionLog.getCurrentBytes() === 5);
        const dl1 = page.waitForEvent('download');
        await downloadViaMenu(page);
        await dl1;
        await page.evaluate(() => window.__mockReaderPush(new TextEncoder().encode('two')));
        await page.waitForFunction(() => window.__sessionLog.getCurrentBytes() === 8);
        const dl2 = page.waitForEvent('download');
        await downloadViaMenu(page);
        const d2 = await dl2;
        const stream = await d2.createReadStream();
        const chunks = [];
        for await (const chunk of stream) chunks.push(chunk);
        expect(Buffer.concat(chunks).toString()).toBe('firsttwo');
    });

    test('filename uses connect-time UTC stamp YYYYMMDD-HHMMSS.bin', async ({ page }) => {
        await setup(page);
        await page.evaluate(() => window.__menuBar.open('connection'));
        await page.click('#menu-connect-item');
        await page.waitForSelector('#menu-connect-item[data-state="connected"]', { state: 'attached' });
        await page.evaluate(() => window.__mockReaderPush(new Uint8Array([0x41])));
        await page.waitForFunction(() => window.__sessionLog.getCurrentBytes() > 0);
        const dl = page.waitForEvent('download');
        await downloadViaMenu(page);
        const download = await dl;
        expect(download.suggestedFilename()).toMatch(/^beastty-\d{8}-\d{6}\.bin$/);
    });

    test('subsequent Connect discards prior chunks (per-connection lifecycle)', async ({ page }) => {
        await setup(page);
        await page.evaluate(() => window.__menuBar.open('connection'));
        await page.click('#menu-connect-item');
        await page.waitForSelector('#menu-connect-item[data-state="connected"]', { state: 'attached' });
        await page.evaluate(() => window.__mockReaderPush(new TextEncoder().encode('first conn')));
        await page.waitForFunction(() => window.__sessionLog.getCurrentBytes() === 10);
        // Disconnect.
        await page.evaluate(() => window.__menuBar.open('connection'));
        await page.click('#menu-connect-item');
        await page.waitForSelector('#menu-connect-item[data-state="disconnected"]', { state: 'attached' });
        // Reconnect.
        await page.evaluate(() => window.__menuBar.open('connection'));
        await page.click('#menu-connect-item');
        await page.waitForSelector('#menu-connect-item[data-state="connected"]', { state: 'attached' });
        expect(await page.evaluate(() => window.__sessionLog.getCurrentBytes())).toBe(0);
    });

    // E3.1 (AC-5) — File ▸ Download Session Log drives the SAME download() as the
    // legacy #download-log-button. The legacy-button cases above stay green
    // (session-log is the sole writer of that button); this adds the menu path.
    // --- Settings ▸ Strip ctrl codes from logs ---------------------------------
    // When enabled, download() writes a cleaned, readable transcript: C0 control
    // bytes + whole VT52 escape sequences removed, CR/LF kept; filename becomes
    // .txt. read live at download-click time (persist-only pref, no live apply).
    async function connectAndPush(page, bytes) {
        await page.evaluate(() => window.__menuBar.open('connection'));
        await page.click('#menu-connect-item');
        await page.waitForSelector('#menu-connect-item[data-state="connected"]', { state: 'attached' });
        await page.evaluate((b) => window.__mockReaderPush(new Uint8Array(b)), Array.from(bytes));
        await page.waitForFunction((n) => window.__sessionLog.getCurrentBytes() === n, bytes.length);
    }
    async function readDownload(page) {
        const dl = page.waitForEvent('download');
        await downloadViaMenu(page);
        const download = await dl;
        const stream = await download.createReadStream();
        const chunks = [];
        for await (const chunk of stream) chunks.push(chunk);
        return { name: download.suggestedFilename(), body: Buffer.concat(chunks) };
    }

    // ESC Y ! 0 | "B>dir" | CRLF | ESC K | BEL | "FOO" | NUL | CRLF | ESC Y A B | "done"
    // The two ESC Y sequences prove the parameter bytes (! 0 and the PRINTABLE A B)
    // are consumed with the sequence, not left behind as text.
    const MIXED = [
        0x1B, 0x59, 0x21, 0x30,
        0x42, 0x3E, 0x64, 0x69, 0x72,
        0x0D, 0x0A,
        0x1B, 0x4B,
        0x07,
        0x46, 0x4F, 0x4F,
        0x00,
        0x0D, 0x0A,
        0x1B, 0x59, 0x41, 0x42,
        0x64, 0x6F, 0x6E, 0x65,
    ];

    test('strip ON: removes control codes + VT52 escapes, keeps CR/LF, writes .txt @fast', async ({ page }) => {
        await setup(page);
        await page.evaluate(() => window.__prefs.savePrefs({ stripCtrlLogs: true }));
        await connectAndPush(page, MIXED);
        const { name, body } = await readDownload(page);
        expect(name).toMatch(/^beastty-\d{8}-\d{6}\.txt$/);
        expect(body.toString()).toBe('B>dir\r\nFOO\r\ndone');
    });

    test('strip OFF (default): raw bytes preserved verbatim, writes .bin @fast', async ({ page }) => {
        await setup(page);
        await connectAndPush(page, MIXED);
        const { name, body } = await readDownload(page);
        expect(name).toMatch(/^beastty-\d{8}-\d{6}\.bin$/);
        expect(Array.from(body)).toEqual(MIXED);   // untouched control bytes + escapes
    });

    test('toggling the Settings row affects the NEXT download (read live at click) @fast', async ({ page }) => {
        await setup(page);
        await connectAndPush(page, MIXED);
        // Toggle the pref ON via the real Settings menu row, then download.
        await page.evaluate(() => window.__menuBar.open('settings'));
        await page.click('#menu-strip-ctrl-logs-item');
        const { name, body } = await readDownload(page);
        expect(name).toMatch(/\.txt$/);
        expect(body.toString()).toBe('B>dir\r\nFOO\r\ndone');
    });

    test('File ▸ Download Session Log downloads the .bin via the menu path @fast', async ({ page }) => {
        await setup(page);
        await page.evaluate(() => window.__menuBar.open('connection'));
        await page.click('#menu-connect-item');
        await page.waitForSelector('#menu-connect-item[data-state="connected"]', { state: 'attached' });
        await page.evaluate(() => window.__mockReaderPush(new TextEncoder().encode('menu log')));
        await page.waitForFunction(() => window.__sessionLog.getCurrentBytes() === 8);
        // Boot-race guard, then open File; the row must have enabled off the first
        // byte (onStateChange hook → projectSessionLog) and re-confirm at open time.
        await page.waitForFunction(
            () => window.__menuBar && typeof window.__menuBar.__getStateForTests === 'function');
        await page.evaluate(() => window.__menuBar.open('file'));
        const row = page.locator('#menu-download-log-item');
        await expect(row).not.toHaveAttribute('data-disabled', 'true');
        await expect(row).toHaveAttribute('title', 'Download all bytes received this connection (.bin)');
        const dl = page.waitForEvent('download');
        await row.click();
        const download = await dl;
        expect(download.suggestedFilename()).toMatch(/^beastty-\d{8}-\d{6}\.bin$/);
        // Bytes match the RX buffer.
        const stream = await download.createReadStream();
        const chunks = [];
        for await (const chunk of stream) chunks.push(chunk);
        expect(Buffer.concat(chunks).toString()).toBe('menu log');
        // Menu closed on activation (action semantics).
        await expect(page.locator('#dropdown-file')).toBeHidden();
    });
});
