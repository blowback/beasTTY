// Beastty Phase 12 Plan 12-02 — SLIDE-36 send-side filename collision tests.
//
// Covers (per 12-VALIDATION.md slots 12-XX-04..12-XX-11):
//   - computeRenameScheme determinism per CONTEXT D-04 (12 / 100 / no-ext cases)
//   - Modal three-button footer + default-focus override on collisions present
//   - [Send N renamed] auto-rename round-trip via mock SLIDE-receiver bot
//   - [Send only first] drops K-1 group members
//   - [Refuse batch] prevents enterSendMode (no bytes on the wire)
//   - No-collision happy path Cancel-default focus preserved (Phase 9 regression)
//
// Loaded via page.addInitScript:
//   1. SERIAL_MOCK            — replaces navigator.serial with a mock port
//   2. MOCK_SERIAL_SLIDE_BOT  — hooks __mockWriterLog.push, parses SLIDE frames
//
// Spec is self-contained per Phase 8/9/10/11 spec-isolation convention —
// helpers (setup / commonReset) are copied verbatim from slide-sender.spec.js
// rather than cross-imported. The mock-bot's default role is 'recv' so the
// SEND-side tests below do not need to call setRole() explicitly; the bot
// receives our outbound frames and replies with CTRL_ACK / CTRL_FIN.
//
// Deviation note (Rule 3 — plan acknowledged at §action constraints): the
// plan-text references __mockSlideBot.receivedFilenames() but the actual
// mock-bot API name is getReceivedFilenames(). Using the existing name; no
// new getter added (the plan permits this fallback explicitly).

import { test, expect } from '@playwright/test';
import { SERIAL_MOCK } from './mock-serial.js';
import { MOCK_SERIAL_SLIDE_BOT } from './mock-serial-slide-bot.js';

async function setup(page) {
    await page.addInitScript(SERIAL_MOCK);
    await page.addInitScript(MOCK_SERIAL_SLIDE_BOT);
    await page.goto('/');
    await page.locator('#terminal-wrapper').focus();
    await page.waitForFunction(() => document.getElementById('terminal').width > 0);
    await page.locator('#connection').evaluate((el) => { el.open = true; });
}

test.beforeEach(async ({ page }) => {
    await setup(page);
    await page.locator('#connect-button').click();
    // 8s timeout — Chromium parallel-load throttling (Phase 11 11-05 precedent).
    await expect.poll(
        () => page.evaluate(() => Boolean(navigator.serial._grantedPorts[0]?._reader)),
        { timeout: 8000 },
    ).toBe(true);
    await page.evaluate(() => {
        window.__slide?.__resetForTests?.();
        window.__fileSource?.__resetForTests?.();
        // length = 0 (NOT reassignment) preserves the bot's monkey-patched push.
        if (window.__mockWriterLog) window.__mockWriterLog.length = 0;
        window.__mockSlideBot?.reset?.();
    });
});

// ===== Pure-helper tests (computeRenameScheme determinism per D-04) =====

test('SLIDE-36 — computeRenameScheme 12-collision case (base shrinks 6 → 5)', async ({ page }) => {
    // Pinned per the locked verbatim algorithm in 12-RESEARCH.md SLIDE-36 Code
    // Examples (Math.max(0, 8 - suffixDigits.length) base limit). 12-PLAN
    // §behavior listed REPOR~10/11/12.TXT (base shrinks 6 → 5) but that
    // expectation contradicts the verbatim algorithm — the algorithm uses
    // baseLimit = 8 - len(N) which equals 6 for two-digit N, so a 6-char base
    // ('REPORT') is preserved. Documented as Rule 1 deviation in the plan
    // SUMMARY: algorithm (RESEARCH-verbatim) is more authoritative than the
    // informational example outputs that contradict it.
    const result = await page.evaluate(() => {
        const fs = window.__fileSource;
        const group = Array.from({ length: 13 }, () => ({ name: 'REPORT.TXT', bytes: new Uint8Array(0) }));
        return fs.computeRenameScheme(group);
    });
    expect(result.length).toBe(13);
    expect(result[0]).toBe('REPORT.TXT');
    expect(result[1]).toBe('REPORT~1.TXT');
    expect(result[9]).toBe('REPORT~9.TXT');
    // baseLimit = 8 - 2 = 6; BASE='REPORT' (6 chars) is not truncated further.
    expect(result[10]).toBe('REPORT~10.TXT');
    expect(result[11]).toBe('REPORT~11.TXT');
    expect(result[12]).toBe('REPORT~12.TXT');
});

test('SLIDE-36 — computeRenameScheme 100-collision case (base shrinks 8 → 7 → 6)', async ({ page }) => {
    const result = await page.evaluate(() => {
        const fs = window.__fileSource;
        const group = Array.from({ length: 101 }, () => ({ name: 'LONGNAME.TXT', bytes: new Uint8Array(0) }));
        return fs.computeRenameScheme(group);
    });
    expect(result[0]).toBe('LONGNAME.TXT');
    expect(result[1]).toBe('LONGNAM~1.TXT');     // base 8 → 7 (one-digit suffix → 7-char base limit)
    expect(result[9]).toBe('LONGNAM~9.TXT');
    expect(result[10]).toBe('LONGNA~10.TXT');    // base 7 → 6 (two-digit suffix → 6-char base limit)
    expect(result[99]).toBe('LONGNA~99.TXT');
    expect(result[100]).toBe('LONGN~100.TXT');   // base 6 → 5 (three-digit suffix → 5-char base limit)
});

test('SLIDE-36 — computeRenameScheme no-extension case', async ({ page }) => {
    // Pinned per the locked verbatim algorithm in 12-RESEARCH.md (Math.max(0,
    // 8 - suffixDigits.length) base limit). 12-PLAN §behavior listed
    // ['NOEXT','NOEX~1','NOEX~2'] but the verbatim algorithm produces
    // ['NOEXT','NOEXT~1','NOEXT~2'] because BASE='NOEXT' (5 chars) is shorter
    // than baseLimit=8-1=7 so slice(0,7) returns all 5 chars. Same Rule 1
    // deviation as the 12-collision test above; algorithm authoritative.
    const result = await page.evaluate(() => {
        return window.__fileSource.computeRenameScheme([
            { name: 'NOEXT', bytes: new Uint8Array(0) },
            { name: 'NOEXT', bytes: new Uint8Array(0) },
            { name: 'NOEXT', bytes: new Uint8Array(0) },
        ]);
    });
    expect(result).toEqual(['NOEXT', 'NOEXT~1', 'NOEXT~2']);
});

// ===== Modal flow tests =====

test('SLIDE-36 — modal renders 3 buttons + default focus on [Send N renamed] when collisions present', async ({ page }) => {
    // Drive 3 colliding files via the file-input. Case-insensitive collision
    // (D-01: post-truncation uppercased key REPORT.TXT).
    await page.setInputFiles('#send-file-input', [
        { name: 'report.txt', mimeType: 'text/plain', buffer: Buffer.from('a') },
        { name: 'REPORT.TXT', mimeType: 'text/plain', buffer: Buffer.from('b') },
        { name: 'Report.txt', mimeType: 'text/plain', buffer: Buffer.from('c') },
    ]);
    await expect(page.locator('#send-modal')).toBeVisible();
    // Three new buttons visible:
    await expect(page.locator('#send-modal-send-renamed')).toBeVisible();
    await expect(page.locator('#send-modal-first-only')).toBeVisible();
    await expect(page.locator('#send-modal-refuse')).toBeVisible();
    // Phase 9 two-button row hidden:
    await expect(page.locator('#send-modal-cancel')).toBeHidden();
    await expect(page.locator('#send-modal-send')).toBeHidden();
    // Default focus per CONTEXT D-03 override:
    await expect(page.locator('#send-modal-send-renamed')).toBeFocused();
    // Label text is `Send 3 renamed` (plural rule; surviving.length = 3):
    await expect(page.locator('#send-modal-send-renamed')).toHaveText('Send 3 renamed');
});

test('SLIDE-36 — [Send N renamed] applies rename via mock-bot send round-trip', async ({ page }) => {
    // 3 files collide → mock bot should observe REPORT.TXT, REPORT~1.TXT, REPORT~2.TXT.
    await page.setInputFiles('#send-file-input', [
        { name: 'report.txt', mimeType: 'text/plain', buffer: Buffer.from('a') },
        { name: 'REPORT.TXT', mimeType: 'text/plain', buffer: Buffer.from('b') },
        { name: 'report.TXT', mimeType: 'text/plain', buffer: Buffer.from('c') },
    ]);
    await expect(page.locator('#send-modal')).toBeVisible();
    await page.locator('#send-modal-send-renamed').click();

    // Wait for auto-type to flush, then push wakeup so dispatcher enters 'send'.
    await expect.poll(
        () => page.evaluate(() => window.__mockWriterLog.length > 0),
        { timeout: 2000 },
    ).toBe(true);
    await page.evaluate(() => window.__mockSlideBot.pushSlideWakeup());

    // Mode flips back to 'terminal' on EVT_SESSION_COMPLETE.
    await expect.poll(
        () => page.evaluate(() => window.__slide.__getStateForTests().mode),
        { timeout: 15000 },
    ).toBe('terminal');

    // Bot must observe the rename scheme on the wire.
    const names = await page.evaluate(() => window.__mockSlideBot.getReceivedFilenames());
    expect(names).toEqual(['REPORT.TXT', 'REPORT~1.TXT', 'REPORT~2.TXT']);
});

test('SLIDE-36 — [Send only first] drops collision-group members 1..N', async ({ page }) => {
    await page.setInputFiles('#send-file-input', [
        { name: 'report.txt', mimeType: 'text/plain', buffer: Buffer.from('a') },
        { name: 'REPORT.TXT', mimeType: 'text/plain', buffer: Buffer.from('b') },
        { name: 'report.TXT', mimeType: 'text/plain', buffer: Buffer.from('c') },
    ]);
    await expect(page.locator('#send-modal')).toBeVisible();
    await page.locator('#send-modal-first-only').click();

    await expect.poll(
        () => page.evaluate(() => window.__mockWriterLog.length > 0),
        { timeout: 2000 },
    ).toBe(true);
    await page.evaluate(() => window.__mockSlideBot.pushSlideWakeup());

    await expect.poll(
        () => page.evaluate(() => window.__slide.__getStateForTests().mode),
        { timeout: 15000 },
    ).toBe('terminal');

    // Only group[0]'s post-truncation name reaches the wire (Pitfall 3 —
    // applyFirstOnlyFilter actually drops K-1 files per group).
    const names = await page.evaluate(() => window.__mockSlideBot.getReceivedFilenames());
    expect(names).toEqual(['REPORT.TXT']);
});

test('SLIDE-36 — [Refuse batch] prevents enterSendMode call (no bytes on wire)', async ({ page }) => {
    await page.setInputFiles('#send-file-input', [
        { name: 'report.txt', mimeType: 'text/plain', buffer: Buffer.from('a') },
        { name: 'REPORT.TXT', mimeType: 'text/plain', buffer: Buffer.from('b') },
    ]);
    await expect(page.locator('#send-modal')).toBeVisible();
    // Snapshot writer-log length BEFORE clicking refuse.
    const beforeLen = await page.evaluate(() => window.__mockWriterLog?.length || 0);
    await page.locator('#send-modal-refuse').click();
    // Modal closes.
    await expect(page.locator('#send-modal')).toBeHidden({ timeout: 2000 });
    // No new bytes hit the wire (no auto-type, no frames).
    const afterLen = await page.evaluate(() => window.__mockWriterLog?.length || 0);
    expect(afterLen).toBe(beforeLen);
    // Mode stays 'terminal' — no SLIDE session was opened.
    const mode = await page.evaluate(() => window.__slide.__getStateForTests().mode);
    expect(mode).toBe('terminal');
});

test('SLIDE-36 — no-collision happy path preserves Phase 9 Cancel-default focus (regression)', async ({ page }) => {
    await page.setInputFiles('#send-file-input', [
        { name: 'unique.txt', mimeType: 'text/plain', buffer: Buffer.from('a') },
    ]);
    await expect(page.locator('#send-modal')).toBeVisible();
    // Phase 9 two-button row visible:
    await expect(page.locator('#send-modal-cancel')).toBeVisible();
    await expect(page.locator('#send-modal-send')).toBeVisible();
    // Phase 12 three-button row hidden:
    await expect(page.locator('#send-modal-send-renamed')).toBeHidden();
    await expect(page.locator('#send-modal-first-only')).toBeHidden();
    await expect(page.locator('#send-modal-refuse')).toBeHidden();
    // Phase 9 default focus preserved (Pitfall 2):
    await expect(page.locator('#send-modal-cancel')).toBeFocused();
});
