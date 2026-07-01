// Beastty Epic E0 Story E0.2 — unit spec for the shared openModal helper (AD-8).
//
// Drives the helper directly against a throwaway <dialog> appended to the page
// (openModal is a leaf that only touches the elements it's handed, so a scratch
// dialog exercises the full contract without the send-modal content-building).
// The production open/close/focus behavior openModal now owns is additionally
// guarded end-to-end by modal-default-focus.spec.js (the primary oracle).
//
// Boot-race guard (E0.1 lesson): window.__modal is set at the tail of main.js,
// so we waitForFunction on it in-page rather than reading it across the evaluate
// boundary before boot has run. The dynamic import('/renderer/modal.js') returns
// the SAME module instance main.js imported, so window.__modal reflects our calls.

import { test, expect } from '@playwright/test';
import { SERIAL_MOCK } from '../transport/mock-serial.js';

async function setup(page) {
    await page.addInitScript(SERIAL_MOCK);
    await page.goto('/');
    await page.locator('#terminal-wrapper').focus();
    await page.waitForFunction(() => document.getElementById('terminal').width > 0);
    await page.waitForFunction(() => typeof window.__modal === 'object' && window.__modal !== null);
}

// AC-1 — data-focused set on initialFocus (before .focus()) and that element focused.
test('openModal sets data-focused="true" on initialFocus and focuses it @fast', async ({ page }) => {
    await setup(page);
    const result = await page.evaluate(async () => {
        const { openModal } = await import('/renderer/modal.js');
        window.__modal.__resetForTests();
        const dlg = document.createElement('dialog');
        dlg.id = '__t-dialog';
        const btn = document.createElement('button');
        btn.id = '__t-initial';
        btn.textContent = 'ok';
        dlg.appendChild(btn);
        document.body.appendChild(dlg);

        const p = openModal(dlg, { initialFocus: btn });
        // Synchronous post-call state: the attribute is set AND the element is
        // focused (openModal set the attribute before calling .focus()).
        const attr = btn.getAttribute('data-focused');
        const focusedId = document.activeElement && document.activeElement.id;

        dlg.close('cancel');
        await p;
        dlg.remove();
        return { attr, focusedId };
    });
    expect(result.attr).toBe('true');
    expect(result.focusedId).toBe('__t-initial');
});

// AC-2 — close resolves to the RAW returnValue string and clears data-focused.
test('close resolves to the raw returnValue and clears data-focused to "false" @fast', async ({ page }) => {
    await setup(page);
    const result = await page.evaluate(async () => {
        const { openModal } = await import('/renderer/modal.js');
        const dlg = document.createElement('dialog');
        const btn = document.createElement('button');
        dlg.appendChild(btn);
        document.body.appendChild(dlg);

        const p = openModal(dlg, { initialFocus: btn });
        dlg.close('send');
        const rv = await p;
        const attr = btn.getAttribute('data-focused');
        dlg.remove();
        return { rv, attr };
    });
    expect(result.rv).toBe('send');
    expect(result.attr).toBe('false');
});

// AC-3 — restoreTo callback: invoked with the raw returnValue, result focused.
test('restoreTo callback is invoked with the returnValue and its result is focused @fast', async ({ page }) => {
    await setup(page);
    const result = await page.evaluate(async () => {
        const { openModal } = await import('/renderer/modal.js');
        const dlg = document.createElement('dialog');
        const btn = document.createElement('button');
        dlg.appendChild(btn);
        const restoreA = document.createElement('button'); restoreA.id = '__t-restoreA';
        const restoreB = document.createElement('button'); restoreB.id = '__t-restoreB';
        document.body.append(dlg, restoreA, restoreB);

        let seenRv = null;
        const p = openModal(dlg, {
            initialFocus: btn,
            restoreTo: (rv) => { seenRv = rv; return rv === 'go' ? restoreA : restoreB; },
        });
        dlg.close('go');
        await p;
        const focusedId = document.activeElement && document.activeElement.id;
        dlg.remove(); restoreA.remove(); restoreB.remove();
        return { seenRv, focusedId };
    });
    expect(result.seenRv).toBe('go');
    expect(result.focusedId).toBe('__t-restoreA');
});

// AC-3 — restoreTo as a plain Element receives focus on close.
test('restoreTo as an element receives focus on close @fast', async ({ page }) => {
    await setup(page);
    const result = await page.evaluate(async () => {
        const { openModal } = await import('/renderer/modal.js');
        const dlg = document.createElement('dialog');
        const btn = document.createElement('button');
        dlg.appendChild(btn);
        const restore = document.createElement('button'); restore.id = '__t-restoreEl';
        document.body.append(dlg, restore);

        const p = openModal(dlg, { initialFocus: btn, restoreTo: restore });
        dlg.close('x');
        await p;
        const focusedId = document.activeElement && document.activeElement.id;
        dlg.remove(); restore.remove();
        return { focusedId };
    });
    expect(result.focusedId).toBe('__t-restoreEl');
});

// AC-5 — window.__modal.__getStateForTests() reflects an open and its close.
test('window.__modal.__getStateForTests() reflects an open and close @fast', async ({ page }) => {
    await setup(page);
    const state = await page.evaluate(async () => {
        const { openModal } = await import('/renderer/modal.js');
        window.__modal.__resetForTests();
        const before = window.__modal.__getStateForTests();

        const dlg = document.createElement('dialog');
        dlg.id = '__t-state-dialog';
        const btn = document.createElement('button');
        dlg.appendChild(btn);
        document.body.appendChild(dlg);

        const p = openModal(dlg, { initialFocus: btn });
        dlg.close('first-only');
        await p;
        const after = window.__modal.__getStateForTests();
        dlg.remove();
        return { before, after };
    });
    expect(state.before.openCount).toBe(0);
    expect(state.after.openCount).toBe(1);
    expect(state.after.lastReturnValue).toBe('first-only');
    expect(state.after.openDialogId).toBe('__t-state-dialog');
});
