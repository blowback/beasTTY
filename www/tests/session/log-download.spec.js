// BestialiTTY Phase 6 Plan 01 (Wave 0) — SESS-04/SESS-05 session log download stubs.
//
// All assertions are test.fixme until later waves un-fixme them as the
// corresponding feature lands. Mirrors Phase 5 Wave 0 discipline.
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
}

test.describe('SESS-04/SESS-05 — Session log download', () => {
    test.fixme('log auto-starts per Connect; chunks accumulate by reference @fast', async ({ page }) => {
        // TODO: live in Wave 4 when session-log.js + serial.js append-after-feed integration land.
    });

    test.fixme('Download log button enabled after first byte arrives', async ({ page }) => {
        // TODO: live in Wave 4 when Connection-pane Download log button lands.
    });

    test.fixme('Download log button disabled before first byte; tooltip "No bytes received yet"', async ({ page }) => {
        // TODO: live in Wave 4 when Connection-pane Download log button lands.
    });

    test.fixme('download produces correct Blob with all bytes (application/octet-stream)', async ({ page }) => {
        // TODO: live in Wave 4 when session-log.download() Blob assembly lands.
    });

    test.fixme('mid-session download captures so-far + appends continue', async ({ page }) => {
        // TODO: live in Wave 4 when session-log.download() does not stop the accumulator.
    });

    test.fixme('filename uses connect-time UTC stamp YYYYMMDD-HHMMSS.bin', async ({ page }) => {
        // TODO: live in Wave 4 when session-log filename helper lands.
    });

    test.fixme('subsequent Connect discards prior chunks (per-connection lifecycle)', async ({ page }) => {
        // TODO: live in Wave 4 when session-log per-connection reset lands.
    });
});
