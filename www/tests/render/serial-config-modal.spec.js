// Epic E2 Story E2.3 (FR-15) — Serial Configuration modal.
//
// A RELOCATION story: the serial-config form (5 selects + Reset), both toggles +
// their verbatim hints, the default/single-tab note, and the #error-log moved
// verbatim out of the legacy <details id="connection"> pane into a new
// openModal-driven <dialog id="serial-config-modal">, opened from Connection ▸
// Serial Configuration…. Ids/option-sets/copy are unchanged, so serial.js's
// injected refs keep working; the code changes are the menu wiring, the removed
// error auto-expand, and modal-appropriate focus. This spec locks AC-1..AC-9.
//
// Idioms (E1 retro action #4): boot-race guard on window.__menuBar/__modal;
// window.__menuBar.open('connection') for a deterministic open (NOT a title click);
// menu-driven open → data-action dispatch; focus-restore via activeElement.id.
import { test, expect } from '@playwright/test';
import { SERIAL_MOCK } from '../transport/mock-serial.js';

// Verbatim copy the move must preserve byte-for-byte (AC-3 / AC-4).
const HINT_SHOW_ALL = "Off by default — the picker only lists the Silicon Labs CP2102N (the chip on stock MicroBeast hardware). Turn this on if your MicroBeast uses a different USB-serial bridge (FTDI, CH340, CP2104) or you're connecting via a virtual COM port (USB-IP, Bluetooth-SPP, ser2net). Takes effect on the next Connect click.";
const HINT_ASSERT_RTS = "On by default. The MicroBeast's Z80 UART uses host-side RTS as its CTS input for hardware auto-flow-control — without this, Z80→PC transmits (wakeup byte, ACKs, file data) are blocked at the Z80 UART. Turn this off if your hardware has RTS wired to a reset line instead. DTR is always de-asserted on connect (Pitfall #12 reset-pulse concern). Takes effect on the next Connect click.";
const HINT_DEFAULT = 'MicroBeast default is 19200 8N1, no flow control. Single-tab ownership is enforced by Chromium — close any other Beastty tab that holds this port first.';
const RECONNECT_TEXT = 'Config changed — Disconnect and Connect to apply';

async function ready(page, { preGrant = false } = {}) {
    if (preGrant) await page.addInitScript(() => { window.__preGrantPort = true; });
    await page.addInitScript(SERIAL_MOCK);
    await page.goto('/');
    await page.waitForFunction(
        () => window.__menuBar && typeof window.__menuBar.__getStateForTests === 'function'
              && typeof window.__modal === 'object' && window.__modal !== null,
    );
    await page.locator('#terminal-wrapper').focus();
    await page.waitForFunction(() => document.getElementById('terminal').width > 0);
}

// Deterministic open via the real menu path (open Connection menu → click item).
async function openModal(page) {
    await page.evaluate(() => window.__menuBar.open('connection'));
    await page.click('#dropdown-connection .menu-item[data-action="serial-config"]');
    await expect(page.locator('#serial-config-modal')).toBeVisible();
}

const dialog = (page) => page.locator('#serial-config-modal');

test.describe('E2.3 AC-1 — opens from the Connection menu via openModal; focus round-trips', () => {
    test('activating Serial Configuration… opens the modal + closes the dropdown @fast', async ({ page }) => {
        await ready(page);
        await openModal(page);
        // Dropdown closed (AD-3/AC-1) and the shared modal helper drove the open.
        expect(await page.evaluate(() => window.__menuBar.getOpenMenu())).toBe(null);
        expect(await page.evaluate(() => window.__modal.__getStateForTests().openDialogId))
            .toBe('serial-config-modal');
    });

    test('Close returns focus to #terminal-wrapper (restoreTo) @fast', async ({ page }) => {
        await ready(page);
        await openModal(page);
        await page.click('#serial-config-modal form[method="dialog"] button');
        await expect(dialog(page)).toBeHidden();
        expect(await page.evaluate(() => document.activeElement && document.activeElement.id))
            .toBe('terminal-wrapper');
    });

    test('Esc closes and returns focus to #terminal-wrapper @fast', async ({ page }) => {
        await ready(page);
        await openModal(page);
        await page.keyboard.press('Escape');
        await expect(dialog(page)).toBeHidden();
        expect(await page.evaluate(() => document.activeElement && document.activeElement.id))
            .toBe('terminal-wrapper');
    });
});

test.describe('E2.3 AC-2 — five serial selects, verbatim option sets + defaults', () => {
    test('all five selects exist inside the modal with MicroBeast defaults @fast', async ({ page }) => {
        await ready(page);
        await openModal(page);
        const d = dialog(page);
        await expect(d.locator('#serial-baud')).toHaveValue('19200');
        await expect(d.locator('#serial-databits')).toHaveValue('8');
        await expect(d.locator('#serial-stopbits')).toHaveValue('1');
        await expect(d.locator('#serial-parity')).toHaveValue('none');
        await expect(d.locator('#serial-flowctl')).toHaveValue('none');
    });

    test('baud option set is the full 300..115200 ladder @fast', async ({ page }) => {
        await ready(page);
        await openModal(page);
        const opts = await page.$$eval('#serial-baud option', (os) => os.map((o) => o.value));
        expect(opts).toEqual(['300', '1200', '2400', '4800', '9600', '19200', '38400', '57600', '115200']);
    });

    test('parity + flow-control option labels are preserved verbatim @fast', async ({ page }) => {
        await ready(page);
        await openModal(page);
        const parity = await page.$$eval('#serial-parity option', (os) => os.map((o) => [o.value, o.textContent]));
        expect(parity).toEqual([['none', 'None'], ['even', 'Even'], ['odd', 'Odd']]);
        const flow = await page.$$eval('#serial-flowctl option', (os) => os.map((o) => [o.value, o.textContent]));
        expect(flow).toEqual([['none', 'None'], ['hardware', 'Hardware (RTS/CTS)']]);
    });
});

test.describe('E2.3 AC-3/AC-4 — toggles, Reset, hints + error log preserved verbatim', () => {
    test('both toggles exist with their default state and verbatim hints @fast', async ({ page }) => {
        await ready(page);
        await openModal(page);
        const d = dialog(page);
        // show-all default unchecked; assert-RTS default checked (AC-3).
        await expect(d.locator('#show-all-serial-devices')).not.toBeChecked();
        await expect(d.locator('#serial-assert-rts-on-connect-checkbox')).toBeChecked();
        // Verbatim hint copy (byte-for-byte).
        await expect(d).toContainText(HINT_SHOW_ALL);
        await expect(d).toContainText(HINT_ASSERT_RTS);
    });

    test('Reset button, default hint, single-tab note, and empty error log present @fast', async ({ page }) => {
        await ready(page);
        await openModal(page);
        const d = dialog(page);
        await expect(d.locator('#serial-reset-preset')).toHaveText('Reset to MicroBeast defaults');
        await expect(d).toContainText(HINT_DEFAULT);
        await expect(d.locator('#error-log')).toHaveText('(no recent errors)');
    });
});

test.describe('E2.3 AC-5 — reconnect hint on config change while connected', () => {
    test('changing baud while connected shows the hint; Reset clears it @fast', async ({ page }) => {
        await ready(page, { preGrant: true });
        // Connect via the legacy top-bar mirror (outside the modal), then open the modal.
        await page.locator('#connect-button').click();
        await expect(page.locator('#connect-button')).toHaveAttribute('data-state', 'connected');
        await openModal(page);
        await expect(page.locator('#serial-reconnect-hint')).toBeHidden();
        await page.locator('#serial-baud').selectOption('9600');
        await expect(page.locator('#serial-reconnect-hint')).toBeVisible();
        await expect(page.locator('#serial-reconnect-hint')).toHaveText(RECONNECT_TEXT);
        // Reset snaps back to preset AND clears the hint, without closing the modal.
        await page.locator('#serial-reset-preset').click();
        await expect(page.locator('#serial-baud')).toHaveValue('19200');
        await expect(page.locator('#serial-reconnect-hint')).toBeHidden();
        await expect(dialog(page)).toBeVisible();
    });
});

test.describe('E2.3 AC-6 — errors accumulate silently; the modal never self-opens', () => {
    test('an open failure populates #error-log WITHOUT opening the modal @fast', async ({ page }) => {
        await ready(page);
        // Make the next open() throw so appendErrorLog fires.
        await page.evaluate(() => {
            const orig = navigator.serial.requestPort.bind(navigator.serial);
            navigator.serial.requestPort = () => orig().then((p) => {
                p.open = async () => { throw new Error('boom'); };
                return p;
            });
        });
        await page.locator('#connect-button').click();
        // Log populated (read via textContent while the dialog is closed)...
        await expect(page.locator('#error-log')).not.toHaveText('(no recent errors)');
        // ...but the modal did NOT auto-open (the D-27 pane auto-expand was removed).
        await expect(dialog(page)).toBeHidden();
    });
});

test.describe('E2.3 AC-7/AC-8 — neutral chrome styling, focus, footer contract', () => {
    test('dialog has no drop shadow (scrim-only elevation) @fast', async ({ page }) => {
        await ready(page);
        await openModal(page);
        const shadow = await dialog(page).evaluate((el) => getComputedStyle(el).boxShadow);
        expect(shadow).toBe('none');
    });

    test('the reconnect hint doubles as the aria-live status region @fast', async ({ page }) => {
        await ready(page);
        await openModal(page);
        await expect(page.locator('#serial-reconnect-hint')).toHaveAttribute('aria-live', 'polite');
    });

    test('initial focus is the Baud select with the data-focused border @fast', async ({ page }) => {
        await ready(page);
        await openModal(page);
        expect(await page.evaluate(() => document.activeElement && document.activeElement.id)).toBe('serial-baud');
        await expect(page.locator('#serial-baud')).toHaveAttribute('data-focused', 'true');
    });

    test('footer has Reset + Close and NO in-modal Connect button @fast', async ({ page }) => {
        await ready(page);
        await openModal(page);
        const footer = dialog(page).locator('footer');
        await expect(footer.locator('#serial-reset-preset')).toBeVisible();
        await expect(footer.locator('button[value="close"]')).toBeVisible();
        // No Connect entry point inside the modal (epic AC = Reset + close only).
        expect(await dialog(page).getByText('Connect', { exact: true }).count()).toBe(0);
    });
});

test.describe('E2.3 AC-9 — legacy pane retired; exactly one serial-config surface', () => {
    test('the moved controls live in the modal, not the <details id="connection"> pane @fast', async ({ page }) => {
        await ready(page);
        // Exactly one of each moved control exists (no dual-chrome).
        for (const id of ['serial-baud', 'serial-reset-preset', 'show-all-serial-devices',
                          'serial-assert-rts-on-connect-checkbox', 'error-log', 'serial-reconnect-hint']) {
            expect(await page.locator(`#${id}`).count()).toBe(1);
            // And each is a descendant of the modal, not the pane.
            expect(await page.locator(`#serial-config-modal #${id}`).count()).toBe(1);
            expect(await page.locator(`#connection #${id}`).count()).toBe(0);
        }
        // The vestige pane keeps only #port-status + #download-log-button.
        await expect(page.locator('#connection')).toBeAttached();
        expect(await page.locator('#connection #port-status').count()).toBe(1);
        expect(await page.locator('#connection #download-log-button').count()).toBe(1);
        expect(await page.locator('#connection fieldset').count()).toBe(0);
    });
});

test.describe('E2.3 v1.1 polish — clean aligned-row layout (key-screen-chrome mock)', () => {
    test('settings render as aligned .field rows, not a fieldset form @fast', async ({ page }) => {
        await ready(page);
        await openModal(page);
        const d = dialog(page);
        // The old <fieldset><legend> column form is gone; each control sits on its own
        // label-left/control-right .field row.
        expect(await d.locator('fieldset').count()).toBe(0);
        expect(await d.locator('.field:not(.check)').count()).toBe(5);   // 5 select rows
        expect(await d.locator('.field.check').count()).toBe(2);         // 2 toggle rows
        for (const id of ['serial-baud', 'serial-databits', 'serial-stopbits', 'serial-parity', 'serial-flowctl']) {
            expect(await d.locator(`.field > select#${id}`).count()).toBe(1);
        }
        // Recent errors is the compact .errbox, and #error-log kept its id.
        expect(await d.locator('.errbox #error-log').count()).toBe(1);
    });

    test('hardware hints live in ⓘ tooltips — hidden by default, verbatim + revealed on focus @fast', async ({ page }) => {
        await ready(page);
        await openModal(page);
        const d = dialog(page);
        const tips = d.locator('.field-tip');
        expect(await tips.count()).toBe(2);
        // Uncluttered body: the tips are collapsed by default...
        await expect(tips.first()).toBeHidden();
        // ...yet the FULL hardware text stays verbatim in the DOM (EXPERIENCE.md:112 —
        // never dumbed down), so the AC-3/AC-4 verbatim-copy assertions above still hold.
        await expect(d).toContainText(HINT_ASSERT_RTS);
        await expect(d).toContainText(HINT_SHOW_ALL);
        // Focusing the ⓘ affordance reveals its tip with the verbatim text.
        const rtsInfo = d.locator('.field.check').first().locator('.field-info');
        await rtsInfo.focus();
        await expect(rtsInfo.locator('.field-tip')).toBeVisible();
        await expect(rtsInfo.locator('.field-tip')).toHaveText(HINT_ASSERT_RTS);
    });
});
