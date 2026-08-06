// Beastty Epic E7 Story E7.1 (FR-29 / AD-16 / UX-DR15) — centered paste toast.
//
// Clones the www/tests/transport/slide-chip.spec.js shape: boot-race guard on the
// window.__* hook, drive the transient chip via its window hook + real pastes
// through the debug #paste-test button, assert [hidden] toggling + auto-hide +
// centered position + neutral-shell styling + focus retention + no-null-ref boot.
//
// Covers AC-1 (confirm appears at >= 4096 B; confirm→progress→complete→auto-hide;
// cancel; port-lost), AC-2 (no null-ref at boot with #top-bar absent), AC-5
// (--chrome-* only, focus retention, subscribes to the pump), AC-6 (the new spec).
//
// The pump fires progress regardless of connection (pushTxBytes drops when no
// writer), but the Esc "no 0x1B leaked" oracle needs a live writer, so we connect
// via the Connection menu (the #connect-button retired with #top-bar in E7.1).

import { test, expect } from '@playwright/test';
import { SERIAL_MOCK } from '../transport/mock-serial.js';

const TOAST = '#paste-toast';
const TEXT = '#paste-toast-text';

async function setup(page) {
    await page.addInitScript(SERIAL_MOCK);
    await page.goto('/');
    await page.locator('#terminal-wrapper').focus();
    await page.waitForFunction(() => document.getElementById('terminal').width > 0);
    // Boot-race guard (E0.1 learning): wait on the window.__* hooks before driving.
    await page.waitForFunction(() =>
        window.__pasteToast && typeof window.__pasteToast.__getStateForTests === 'function'
        && window.__pastePump && typeof window.__pastePump.enqueuePaste === 'function');
    // The #paste-test paste driver lives in the debug panel (which STAYS).
    await page.locator('#debug').evaluate((el) => { el.open = true; });
    await page.evaluate(() => window.__pasteToast.__resetForTests());
}

async function connectViaMenu(page) {
    await page.evaluate(() => window.__menuBar.open('connection'));
    await page.click('#menu-connect-item');
    await page.waitForFunction(() =>
        document.getElementById('menu-connect-item').getAttribute('data-state') === 'connected');
}

async function pasteViaDebug(page, text) {
    await page.locator('#input').fill(text);
    await page.locator('#paste-test').click();
}

test.describe('E7.1 — paste toast: large-paste confirm', () => {
    test.beforeEach(async ({ page }) => { await setup(page); });

    test('a >= 4096 B paste surfaces a centered confirm with [Paste]/[Cancel] @fast', async ({ page }) => {
        // Drive the confirm affordance directly (clipboard.js calls this at the gate).
        await page.evaluate(() => {
            window.__confirmResult = 'pending';
            window.__pasteToast.confirmLargePaste(5000, { getBaud: () => 19200 })
                .then((ok) => { window.__confirmResult = ok; });
        });
        await expect(page.locator(TOAST)).toBeVisible();
        await expect(page.locator(TEXT)).toContainText('About to paste 5,000 B');
        await expect(page.locator(`${TOAST} button[data-action="paste"]`)).toBeVisible();
        await expect(page.locator(`${TOAST} button[data-action="cancel"]`)).toBeVisible();
        expect(await page.evaluate(() => window.__pasteToast.__getStateForTests().lifecycle)).toBe('confirm');
    });

    test('[Cancel] resolves the confirm false and hides the toast @fast', async ({ page }) => {
        await page.evaluate(() => {
            window.__confirmResult = 'pending';
            window.__pasteToast.confirmLargePaste(5000, { getBaud: () => 19200 })
                .then((ok) => { window.__confirmResult = ok; });
        });
        await expect(page.locator(TOAST)).toBeVisible();
        await page.locator(`${TOAST} button[data-action="cancel"]`).click();
        await expect.poll(() => page.evaluate(() => window.__confirmResult)).toBe(false);
        await expect(page.locator(TOAST)).toBeHidden();
    });

    test('[Paste] resolves the confirm true @fast', async ({ page }) => {
        await page.evaluate(() => {
            window.__confirmResult = 'pending';
            window.__pasteToast.confirmLargePaste(5000, { getBaud: () => 19200 })
                .then((ok) => { window.__confirmResult = ok; });
        });
        await expect(page.locator(TOAST)).toBeVisible();
        await page.locator(`${TOAST} button[data-action="paste"]`).click();
        await expect.poll(() => page.evaluate(() => window.__confirmResult)).toBe(true);
    });
});

test.describe('E7.1 — paste toast: live progress', () => {
    test.beforeEach(async ({ page }) => { await setup(page); });

    test('progress line "Pasting N B — P%" updates then "Paste complete" then auto-hides', async ({ page }) => {
        await pasteViaDebug(page, 'B'.repeat(256));
        await expect(page.locator(TEXT)).toContainText('Pasting 256 B —', { timeout: 2000 });
        await expect(page.locator(TEXT)).toContainText('Paste complete', { timeout: 5000 });
        // Auto-hide within the 2 s complete timeout (+ margin).
        await expect(page.locator(TOAST)).toBeHidden({ timeout: 4000 });
    });

    test('[Cancel] mid-pump halts the pump and shows "Paste cancelled"', async ({ page }) => {
        await pasteViaDebug(page, 'C'.repeat(4096));   // long enough to catch mid-stream
        await expect(page.locator(TOAST)).toBeVisible({ timeout: 2000 });
        await page.locator(`${TOAST} button[data-action="cancel"]`).click();
        await expect(page.locator(TEXT)).toContainText('Paste cancelled', { timeout: 2000 });
    });

    test('Esc while paste active cancels via keyboard.js and does NOT emit 0x1B', async ({ page }) => {
        await connectViaMenu(page);
        await pasteViaDebug(page, 'D'.repeat(4096));
        await expect(page.locator(TOAST)).toBeVisible();
        await page.evaluate(() => { window.__mockWriterLog.length = 0; });
        await page.locator('#terminal-wrapper').focus();
        await page.keyboard.press('Escape');
        await expect(page.locator(TEXT)).toContainText('Paste cancelled');
        const post = await page.evaluate(() => window.__mockWriterLog.flatMap((e) => e.bytes));
        expect(post).not.toContain(0x1B);
    });

    test('port-lost mid-paste shows "Paste cancelled — port lost (N bytes unsent)"', async ({ page }) => {
        await connectViaMenu(page);
        await pasteViaDebug(page, 'F'.repeat(4096));
        await expect(page.locator(TOAST)).toBeVisible();
        await page.evaluate(() => window.__simulateUnplug());
        await expect(page.locator(TEXT)).toContainText('Paste cancelled — port lost', { timeout: 2000 });
        await expect(page.locator(TEXT)).toContainText('bytes unsent');
    });

    test('a large-paste confirm is not clobbered by an overlapping paste’s pump events @fast', async ({ page }) => {
        // Regression (whole-branch review): progress + confirm share one toast, so a
        // still-pumping small paste must NOT overwrite an open confirm nor leak its
        // Promise. Drive the pump + confirm directly via the exposed API.
        await page.evaluate(() => {
            window.__confirmResult = 'pending';
            // A small paste is mid-flight (pump 'started' + a 'chunk').
            window.__pasteToast.handleProgress({ status: 'started', total: 1000 });
            window.__pasteToast.handleProgress({ status: 'chunk', written: 200, total: 1000 });
            // A large paste opens the confirm while the first paste still pumps.
            window.__pasteToast.confirmLargePaste(5000, { getBaud: () => 19200 })
                .then((ok) => { window.__confirmResult = ok; });
            // The first pump keeps firing — these must be ignored while confirming.
            window.__pasteToast.handleProgress({ status: 'chunk', written: 600, total: 1000 });
            window.__pasteToast.handleProgress({ status: 'complete' });
        });
        // The confirm survived the pump events: still shown + still 'confirm'.
        await expect(page.locator(TEXT)).toContainText('About to paste 5,000 B');
        await expect(page.locator(`${TOAST} button[data-action="paste"]`)).toBeVisible();
        expect(await page.evaluate(() => window.__pasteToast.__getStateForTests().lifecycle)).toBe('confirm');
        // And its Promise is intact — [Paste] still resolves it (never stranded).
        await page.locator(`${TOAST} button[data-action="paste"]`).click();
        await expect.poll(() => page.evaluate(() => window.__confirmResult)).toBe(true);
    });
});

test.describe('E7.1 — paste toast: neutral shell + placement + focus (AC-5)', () => {
    test.beforeEach(async ({ page }) => { await setup(page); });

    test('is centered over the terminal canvas (not top-right like the SLIDE chip) @fast', async ({ page }) => {
        // Fire-and-forget: confirmLargePaste's Promise resolves only on a button
        // click, so do NOT return it from evaluate (that would hang the call).
        await page.evaluate(() => { window.__pasteToast.confirmLargePaste(5000, { getBaud: () => 19200 }); });
        await expect(page.locator(TOAST)).toBeVisible();
        const css = await page.locator(TOAST).evaluate((el) => {
            const s = getComputedStyle(el);
            return { position: s.position, transform: s.transform };
        });
        expect(css.position).toBe('absolute');
        // translate(-50%,-50%) resolves to a matrix() with negative translate parts.
        expect(css.transform).not.toBe('none');
        // Centered: the toast's centre sits near the wrapper's centre.
        const wrap = await page.locator('#terminal-wrapper').boundingBox();
        const toast = await page.locator(TOAST).boundingBox();
        const wrapCx = wrap.x + wrap.width / 2;
        const toastCx = toast.x + toast.width / 2;
        expect(Math.abs(toastCx - wrapCx)).toBeLessThan(4);
    });

    test('styles from --chrome-* only — identical across a data-theme flip, no box-shadow @fast', async ({ page }) => {
        // Fire-and-forget (see above) — the Promise only settles on a button click.
        await page.evaluate(() => { window.__pasteToast.confirmLargePaste(5000, { getBaud: () => 19200 }); });
        await expect(page.locator(TOAST)).toBeVisible();
        const read = () => page.locator(TOAST).evaluate((el) => {
            const s = getComputedStyle(el);
            return { bg: s.backgroundColor, fg: s.color, shadow: s.boxShadow };
        });
        const crt = await page.evaluate(() => document.body.getAttribute('data-theme'));
        const before = await read();
        expect(before.shadow).toBe('none');
        // Flip the terminal theme; the neutral shell must NOT restyle the toast.
        await page.evaluate((cur) => {
            document.body.setAttribute('data-theme', cur === 'crt' ? 'console' : 'crt');
        }, crt);
        const after = await read();
        expect(after.bg).toBe(before.bg);
        expect(after.fg).toBe(before.fg);
        expect(after.shadow).toBe('none');
    });

    test('clicking a toast button retains #terminal-wrapper focus (AD-10 sacred) @fast', async ({ page }) => {
        await page.evaluate(() => {
            window.__pasteToast.confirmLargePaste(5000, { getBaud: () => 19200 })
                .then((ok) => { window.__confirmResult = ok; });
        });
        await expect(page.locator(TOAST)).toBeVisible();
        await page.locator('#terminal-wrapper').focus();
        await page.locator(`${TOAST} button[data-action="cancel"]`).click();
        expect(await page.evaluate(() => document.activeElement.id)).toBe('terminal-wrapper');
    });
});

test.describe('E7.1 — no null-reference at boot with #top-bar absent (AC-2)', () => {
    test('boots + pastes with #top-bar / #paste-progress-row removed and no console error @fast', async ({ page }) => {
        const errors = [];
        // Ignore the benign boot-time CSP warning (frame-ancestors via <meta> is a
        // platform notice, present on every page load and unrelated to the toast path).
        const benign = (t) => t.includes("'frame-ancestors' is ignored when delivered via a <meta>");
        page.on('pageerror', (e) => { if (!benign(String(e))) errors.push(String(e)); });
        page.on('console', (m) => { if (m.type() === 'error' && !benign(m.text())) errors.push(m.text()); });
        await setup(page);
        // The retired surfaces are gone from the DOM.
        expect(await page.locator('#top-bar').count()).toBe(0);
        expect(await page.locator('#paste-progress-row').count()).toBe(0);
        expect(await page.locator('#paste-cancel').count()).toBe(0);
        expect(await page.locator('#paste-confirm').count()).toBe(0);
        // A full paste drives the whole progress path with the row absent.
        await pasteViaDebug(page, 'Z'.repeat(128));
        await expect(page.locator(TEXT)).toContainText('Paste complete', { timeout: 5000 });
        expect(errors).toEqual([]);
    });
});
