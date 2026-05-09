// Beastty Phase 12 Plan 12-06 (Gap 1 — UAT Test 5) — modal default-focus
// visible-border regression spec.
//
// Closes the gap diagnosed at .planning/debug/12-uat-focus-ring-missing.md:
// Chromium's :focus-visible heuristic suppresses the focus indicator after
// a programmatic .focus() that follows a pointer-initiated interaction.
// Plan 12-06 mitigates via [data-focused="true"] attribute (mirroring the
// Phase 6 gap #7 pattern on #terminal-wrapper).
//
// CRITICAL: this spec uses the production code path (setInputFiles fires
// the file-input 'change' event → processFiles → showConfirmModal →
// .showModal() → .focus()). It does NOT use page.keyboard.press('Tab')
// or button.focus() from Playwright — those would activate :focus-visible
// and mask the bug.
//
// Spec-isolation: setup helper copied verbatim from the sibling
// selection-drop.spec.js (same directory) per Phase 8/9/10 precedent.

import { test, expect } from '@playwright/test';
import { SERIAL_MOCK } from '../transport/mock-serial.js';

async function setup(page) {
    await page.addInitScript(SERIAL_MOCK);
    await page.goto('/');
    await page.locator('#terminal-wrapper').focus();
    await page.waitForFunction(() => document.getElementById('terminal').width > 0);
    await page.waitForFunction(() => typeof window.__fileSource === 'object' && window.__fileSource !== null);
}

// Two filenames that collide under CP/M 8.3 truncation: both truncate
// to "LONGNAME.TXT" so processFiles flags the second as a collision and
// generates the rename scheme (LONGNAME.TXT, LONGNA~1.TXT or similar
// per computeRenameScheme — exact rename text is NOT asserted here;
// we only need the modal to enter collision-present mode).
const FILE_A = { name: 'longname1.txt', mimeType: 'text/plain', buffer: Buffer.from('aaa') };
const FILE_B = { name: 'longname2.txt', mimeType: 'text/plain', buffer: Buffer.from('bbb') };

test('Plan 12-06 — [Send N renamed] default-focus paints visible border on collision-mode modal open', async ({ page }) => {
    await setup(page);
    // Production trigger path — file-picker dismissal fires 'change' on
    // the hidden #send-file-input which routes through processFiles +
    // showConfirmModal. This is a pointer-initiated path (NOT keyboard)
    // so Chromium suppresses :focus-visible on the subsequent .focus().
    await page.setInputFiles('#send-file-input', [FILE_A, FILE_B]);
    await expect(page.locator('#send-modal')).toBeVisible();

    const sendRenamedBtn = page.locator('#send-modal-send-renamed');
    // Sanity — Phase 12 Plan 12-02 ensures this button is unhidden in
    // collision-present mode.
    await expect(sendRenamedBtn).toBeVisible();

    // Load-bearing: this attribute poll is what catches a missing JS edit.
    // The computed-color check below is defense-in-depth — under
    // Playwright's synthetic file-input path, :focus-visible may still
    // match and paint the same accent color even if the data-focused
    // write is absent. The attribute poll is the contract under test.
    await expect.poll(
        () => sendRenamedBtn.getAttribute('data-focused'),
        { timeout: 2000 },
    ).toBe('true');

    // Defense-in-depth — the [data-focused="true"] CSS rule paints the
    // border-color = var(--chrome-accent). Default theme is data-theme="crt"
    // (body attribute set in www/index.html line 768) where --chrome-accent
    // resolves to var(--phosphor-fg) = #33ff66 = rgb(51, 255, 102).
    const borderColor = await sendRenamedBtn.evaluate((el) =>
        window.getComputedStyle(el).borderColor
    );
    expect(borderColor).toBe('rgb(51, 255, 102)');
});

test('Plan 12-06 — modal close clears data-focused on default-focus button', async ({ page }) => {
    await setup(page);
    await page.setInputFiles('#send-file-input', [FILE_A, FILE_B]);

    const sendRenamedBtn = page.locator('#send-modal-send-renamed');
    // Pre-condition ordering rationale: the JS sets data-focused="true"
    // synchronously BEFORE calling .focus(), but if .focus() queues a
    // microtask in some Chromium builds, asserting modal-visible first
    // could resolve before the JS reaches the setAttribute line. Poll
    // the attribute FIRST (the contract under test), then assert the
    // modal-visible side condition.
    await expect.poll(
        () => sendRenamedBtn.getAttribute('data-focused'),
        { timeout: 2000 },
    ).toBe('true');
    await expect(page.locator('#send-modal')).toBeVisible();

    // Close via [Refuse batch] click (a pointer-initiated dialog close).
    // The onClose handler in showConfirmModal MUST clear data-focused.
    await page.locator('#send-modal-refuse').click();
    await expect(page.locator('#send-modal')).not.toBeVisible();

    // Plan 12-06 contract — onClose clears data-focused="false" on
    // sendRenamedBtnRef (and cancelBtnRef per Task 1's clear logic).
    await expect.poll(
        () => sendRenamedBtn.getAttribute('data-focused'),
        { timeout: 2000 },
    ).toBe('false');
});
