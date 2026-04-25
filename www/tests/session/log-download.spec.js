// BestialiTTY Phase 6 Plan 05 (Wave 4) — SESS-04/SESS-05 session log download tests.
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
    // Open Connection pane so #download-log-button is visible / clickable.
    await page.locator('#connection').evaluate((el) => { el.open = true; });
}

test.describe('SESS-04/SESS-05 — Session log download', () => {
    test('log auto-starts per Connect; chunks accumulate by reference @fast', async ({ page }) => {
        await setup(page);
        await page.locator('#connect-button').click();
        await page.waitForSelector('#connect-button[data-state="connected"]', { timeout: 5000 });
        await page.evaluate(() => window.__mockReaderPush(new TextEncoder().encode('hello')));
        await page.evaluate(() => window.__mockReaderPush(new TextEncoder().encode(' world')));
        await page.waitForFunction(() => window.__sessionLog.getCurrentBytes() === 11, { timeout: 2000 });
    });

    test('Download log button enabled after first byte arrives', async ({ page }) => {
        await setup(page);
        await page.locator('#connect-button').click();
        await page.waitForSelector('#connect-button[data-state="connected"]');
        await expect(page.locator('#download-log-button')).toBeDisabled();
        await page.evaluate(() => window.__mockReaderPush(new Uint8Array([0x41])));
        await page.waitForSelector('#download-log-button:not([disabled])');
        await expect(page.locator('#download-log-button')).toHaveAttribute(
            'title', 'Download all bytes received this connection (.bin)');
    });

    test('Download log button disabled before first byte; tooltip "No bytes received yet"', async ({ page }) => {
        await setup(page);
        await page.locator('#connect-button').click();
        await page.waitForSelector('#connect-button[data-state="connected"]');
        await expect(page.locator('#download-log-button')).toBeDisabled();
        await expect(page.locator('#download-log-button')).toHaveAttribute('title', 'No bytes received yet');
    });

    test('download produces correct Blob with all bytes (application/octet-stream)', async ({ page }) => {
        await setup(page);
        await page.locator('#connect-button').click();
        await page.waitForSelector('#connect-button[data-state="connected"]');
        await page.evaluate(() => window.__mockReaderPush(new TextEncoder().encode('test bytes here')));
        await page.waitForSelector('#download-log-button:not([disabled])');
        const downloadPromise = page.waitForEvent('download');
        await page.locator('#download-log-button').click();
        const download = await downloadPromise;
        expect(download.suggestedFilename()).toMatch(/^bestialitty-\d{8}-\d{6}\.bin$/);
        const stream = await download.createReadStream();
        const chunks = [];
        for await (const chunk of stream) chunks.push(chunk);
        const buf = Buffer.concat(chunks);
        expect(buf.toString()).toBe('test bytes here');
    });

    test('mid-session download captures so-far + appends continue', async ({ page }) => {
        await setup(page);
        await page.locator('#connect-button').click();
        await page.waitForSelector('#connect-button[data-state="connected"]');
        await page.evaluate(() => window.__mockReaderPush(new TextEncoder().encode('first')));
        await page.waitForFunction(() => window.__sessionLog.getCurrentBytes() === 5);
        const dl1 = page.waitForEvent('download');
        await page.locator('#download-log-button').click();
        await dl1;
        await page.evaluate(() => window.__mockReaderPush(new TextEncoder().encode('two')));
        await page.waitForFunction(() => window.__sessionLog.getCurrentBytes() === 8);
        const dl2 = page.waitForEvent('download');
        await page.locator('#download-log-button').click();
        const d2 = await dl2;
        const stream = await d2.createReadStream();
        const chunks = [];
        for await (const chunk of stream) chunks.push(chunk);
        expect(Buffer.concat(chunks).toString()).toBe('firsttwo');
    });

    test('filename uses connect-time UTC stamp YYYYMMDD-HHMMSS.bin', async ({ page }) => {
        await setup(page);
        await page.locator('#connect-button').click();
        await page.waitForSelector('#connect-button[data-state="connected"]');
        await page.evaluate(() => window.__mockReaderPush(new Uint8Array([0x41])));
        await page.waitForSelector('#download-log-button:not([disabled])');
        const dl = page.waitForEvent('download');
        await page.locator('#download-log-button').click();
        const download = await dl;
        expect(download.suggestedFilename()).toMatch(/^bestialitty-\d{8}-\d{6}\.bin$/);
    });

    test('subsequent Connect discards prior chunks (per-connection lifecycle)', async ({ page }) => {
        await setup(page);
        await page.locator('#connect-button').click();
        await page.waitForSelector('#connect-button[data-state="connected"]');
        await page.evaluate(() => window.__mockReaderPush(new TextEncoder().encode('first conn')));
        await page.waitForFunction(() => window.__sessionLog.getCurrentBytes() === 10);
        // Disconnect.
        await page.locator('#connect-button').click();
        await page.waitForSelector('#connect-button[data-state="disconnected"]');
        // Reconnect.
        await page.locator('#connect-button').click();
        await page.waitForSelector('#connect-button[data-state="connected"]');
        expect(await page.evaluate(() => window.__sessionLog.getCurrentBytes())).toBe(0);
    });
});
