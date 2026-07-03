// Phase 5 Plan 04 (Wave 3) — XPORT-05 + D-08 serial-config form contract.
// Source: 05-RESEARCH.md §Validation Architecture; 05-CONTEXT.md D-08;
//         05-UI-SPEC.md §Copywriting Contract; 05-04-PLAN.md Task 3.
//
// 5 tests — baud default, preset-default quartet, reset button snap, connected-
// mutation hint, connect-honors-form-values (via mock port _config capture).
//
// E2.3 (FR-15) — the serial-config form MOVED from the <details id="connection">
// pane into #serial-config-modal. The five selects / Reset / reconnect-hint keep
// their ids, so serial.js's injected serialConfigEls refs (and these assertions by
// id) still resolve. Value-read assertions (.toHaveValue) work while the dialog is
// closed (display:none doesn't hide .value); interactions (.selectOption / .click)
// need it OPEN — openForm() shows it directly (native showModal — this spec tests
// serial behavior, not the menu wiring; the menu path is covered by
// render/serial-config-modal.spec.js). connect() clicks the legacy top-bar
// #connect-button, which lives OUTSIDE the modal, so the modal is closed first.
import { test, expect } from '@playwright/test';
import { SERIAL_MOCK } from './mock-serial.js';

async function setup(page) {
    await page.addInitScript(SERIAL_MOCK);
    await page.goto('/');
    await page.locator('#terminal-wrapper').focus();
    await page.waitForFunction(() => document.getElementById('terminal').width > 0);
}

// Open the serial-config form (the <dialog>) so its selects are actionable.
async function openForm(page) {
    await page.evaluate(() => document.getElementById('serial-config-modal').showModal());
    await expect(page.locator('#serial-config-modal')).toBeVisible();
}

async function closeForm(page) {
    await page.evaluate(() => document.getElementById('serial-config-modal').close());
    await expect(page.locator('#serial-config-modal')).toBeHidden();
}

test.describe('XPORT-05 + D-08 — Serial config form', () => {
    test('baud select defaults to 19200 @fast', async ({ page }) => {
        await setup(page);
        await expect(page.locator('#serial-baud')).toHaveValue('19200');
    });

    test('databits/stopbits/parity/flowctl defaults match MicroBeast preset @fast', async ({ page }) => {
        await setup(page);
        await expect(page.locator('#serial-databits')).toHaveValue('8');
        await expect(page.locator('#serial-stopbits')).toHaveValue('1');
        await expect(page.locator('#serial-parity')).toHaveValue('none');
        await expect(page.locator('#serial-flowctl')).toHaveValue('none');
    });

    test('Reset to MicroBeast preset button snaps all five selects to defaults', async ({ page }) => {
        await setup(page);
        await openForm(page);
        // Move all 5 away from preset.
        await page.locator('#serial-baud').selectOption('9600');
        await page.locator('#serial-databits').selectOption('7');
        await page.locator('#serial-stopbits').selectOption('2');
        await page.locator('#serial-parity').selectOption('even');
        await page.locator('#serial-flowctl').selectOption('hardware');
        // Click the reset button (in the modal footer).
        await page.locator('#serial-reset-preset').click();
        // All 5 must snap back to the MicroBeast preset (19200 / 8 / 1 / none / none).
        await expect(page.locator('#serial-baud')).toHaveValue('19200');
        await expect(page.locator('#serial-databits')).toHaveValue('8');
        await expect(page.locator('#serial-stopbits')).toHaveValue('1');
        await expect(page.locator('#serial-parity')).toHaveValue('none');
        await expect(page.locator('#serial-flowctl')).toHaveValue('none');
        // Reset does NOT close the modal (AC-8 — type="button").
        await expect(page.locator('#serial-config-modal')).toBeVisible();
    });

    test('changing baud while connected shows Config changed hint', async ({ page }) => {
        await setup(page);
        // Connect so state === 'connected' before we mutate the form. #connect-button
        // is the legacy top-bar mirror (outside the modal) — click it with the modal
        // closed, then open the form to mutate baud.
        await page.locator('#connect-button').click();
        await expect(page.locator('#connect-button')).toHaveAttribute('data-state', 'connected');
        await openForm(page);
        // Hint must start hidden.
        await expect(page.locator('#serial-reconnect-hint')).toBeHidden();
        // Mutate baud — readFormConfig differs from lastConfig → showReconnectHint fires.
        await page.locator('#serial-baud').selectOption('9600');
        await expect(page.locator('#serial-reconnect-hint')).toBeVisible();
        await expect(page.locator('#serial-reconnect-hint'))
            .toHaveText('Config changed — Disconnect and Connect to apply');
    });

    test('connect honors non-default config values', async ({ page }) => {
        await setup(page);
        // Change baud + parity BEFORE clicking Connect. Set them in the form, then
        // close it so the top-bar #connect-button (outside the modal) is clickable.
        await openForm(page);
        await page.locator('#serial-baud').selectOption('9600');
        await page.locator('#serial-parity').selectOption('even');
        await closeForm(page);
        await page.locator('#connect-button').click();
        await expect(page.locator('#connect-button')).toHaveAttribute('data-state', 'connected');
        // Spec introspection — the mock port records the config passed to open().
        const cfg = await page.evaluate(() => navigator.serial._grantedPorts[0]._config);
        expect(cfg.baudRate).toBe(9600);
        expect(cfg.parity).toBe('even');
        expect(cfg.dataBits).toBe(8);
        expect(cfg.stopBits).toBe(1);
        expect(cfg.flowControl).toBe('none');
    });
});
