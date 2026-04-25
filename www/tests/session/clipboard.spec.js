// BestialiTTY Phase 6 Plan 01 (Wave 0) — SESS-02/SESS-03 clipboard stubs.
//
// All assertions are test.fixme until later waves un-fixme them as the
// corresponding feature lands. Mirrors Phase 5 Wave 0 discipline.
//
// Sources:
//   - 06-CONTEXT.md D-19 (successful copy clears selection),
//                  D-21 (Ctrl+Shift+C copy / plain Ctrl+C sacred),
//                  D-22 (Ctrl+Shift+V paste / plain Ctrl+V sacred),
//                  D-23 (copy format: trim trailing whitespace, '\n'),
//                  D-24 (paste preprocessing: strip 0x00–0x1F + CR/LF rewrite),
//                  D-25 (large-paste >= 4096 confirm chip).
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
}

test.describe('SESS-02/SESS-03 — Clipboard', () => {
    test.fixme('Ctrl+Shift+C copies plain text to clipboard @fast', async ({ page }) => {
        // TODO: live in Wave 3 when clipboard.js + keyboard.js Ctrl+Shift+C intercept land.
    });

    test.fixme('plain Ctrl+C still sends 0x03 (sacred)', async ({ page }) => {
        // TODO: live in Wave 3 when keyboard.js Ctrl+Shift+C intercept lands (preserves plain Ctrl+C path).
    });

    test.fixme('Ctrl+Shift+V pastes clipboard via paste-pump @fast', async ({ page }) => {
        // TODO: live in Wave 3 when clipboard.js + keyboard.js Ctrl+Shift+V intercept land.
    });

    test.fixme('plain Ctrl+V still sends 0x16 SYN (sacred)', async ({ page }) => {
        // TODO: live in Wave 3 when keyboard.js Ctrl+Shift+V intercept lands (preserves plain Ctrl+V path).
    });

    test.fixme('copy format: trailing whitespace trimmed per line, \\n line endings', async ({ page }) => {
        // TODO: live in Wave 3 when clipboard.copySelection lands.
    });

    test.fixme('single-line copy has no trailing \\n', async ({ page }) => {
        // TODO: live in Wave 3 when clipboard.copySelection lands.
    });

    test.fixme('paste preprocessing strips 0x00–0x1F except CR/LF/Tab', async ({ page }) => {
        // TODO: live in Wave 3 when clipboard.pasteFromClipboard preprocessing lands.
    });

    test.fixme('paste applies CR/LF rewrite per Phase 4 crlfMode', async ({ page }) => {
        // TODO: live in Wave 3 when clipboard.pasteFromClipboard reuses CRLF_MODES from keyboard.js.
    });

    test.fixme('large paste >= 4096 bytes shows confirm chip; pump waits for click', async ({ page }) => {
        // TODO: live in Wave 3 when large-paste confirm chip lands in paste-progress region.
    });

    test.fixme('Cancel on confirm chip discards pending bytes', async ({ page }) => {
        // TODO: live in Wave 3 when large-paste confirm chip lands.
    });

    test.fixme('empty selection + Ctrl+Shift+C is a silent no-op (no clipboard write)', async ({ page }) => {
        // TODO: live in Wave 3 when clipboard.copySelection empty-selection guard lands.
    });

    test.fixme('successful copy clears selection', async ({ page }) => {
        // TODO: live in Wave 3 when clipboard.copySelection + selection.js lifecycle integration lands.
    });
});
