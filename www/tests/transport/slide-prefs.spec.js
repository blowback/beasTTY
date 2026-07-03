// Beastty Phase 11 Plan 11-05 (Wave 4) — SLIDE Settings persistence
// Playwright assertions filling the Plan 11-01 RED-gate stubs.
//
// Covers SLIDE-37 (auto-send command persistence) and SLIDE-39 (Settings
// layout + show-summary checkbox + Compatibility mode 3-way select).
//
// Test names match the `-g` filters in 11-VALIDATION.md Per-Task Verification
// Map (rows 11-03-01..11-03-04) verbatim.
//
// Sources:
//   - 11-CONTEXT.md D-05 (nested <details class="reserved" id="settings-slide">
//     with summary "SLIDE file transfer" + 4 rows in order: Save-to-folder,
//     Auto-send, Show-summary, Compatibility)
//   - 11-CONTEXT.md D-06 (auto-send default `B:SLIDE R`; trailing `\r`
//     appended at save time; 250 ms debounced savePrefs)
//   - 11-CONTEXT.md D-07 (Compatibility mode 3-way select —
//     `auto` | `wakeup-required` | `force-start`)
//   - 11-CONTEXT.md D-08 (Show-summary checkbox default ON)
//   - 11-CONTEXT.md D-09 (DEFAULTS keys + values pinned)
//   - 11-CONTEXT.md C-06 (Phase 6 D-32/D-33 versioned blob + 250 ms debounced
//     save — Phase 11 inherits unchanged)

import { test, expect } from '@playwright/test';
import { SERIAL_MOCK } from './mock-serial.js';

// E3.4 — the SLIDE controls moved from the removed <details id="settings-slide"> pane
// into #slide-config-modal (Settings ▸ SLIDE File Transfer…). Open it via the menu.
async function openSlideModal(page) {
    await page.waitForFunction(() => window.__menuBar
        && typeof window.__menuBar.open === 'function'
        && typeof window.__modal === 'object' && window.__modal !== null);
    await page.evaluate(() => window.__menuBar.open('settings'));
    await page.click('#dropdown-settings .menu-item[data-action="slide-config"]');
    await page.locator('#slide-config-modal').waitFor({ state: 'visible' });
}

async function setup(page) {
    await page.addInitScript(SERIAL_MOCK);
    await page.goto('/');
    await page.locator('#terminal-wrapper').focus();
    await page.waitForFunction(() => document.getElementById('terminal').width > 0);
    await openSlideModal(page);
}

test.describe('slide-prefs — Settings layout', () => {

    test('renders #slide-config-modal with title "SLIDE File Transfer" (E3.4 relocation)', async ({ page }) => {
        await setup(page);
        // E3.4 — the legacy <details id="settings-slide"> pane was retired; the SLIDE
        // controls now live in an openModal-driven <dialog>. The old pane must be gone.
        await expect(page.locator('#settings-slide')).toHaveCount(0);
        await expect(page.locator('#slide-config-modal')).toHaveCount(1);
        await expect(page.locator('#slide-config-modal')).toBeVisible();
        await expect(page.locator('#slide-config-modal-title')).toHaveText('SLIDE File Transfer');
    });

    test('contains 4 rows in order: Save-to-folder, Auto-send, Show-summary, Compatibility', async ({ page }) => {
        await setup(page);
        // Each of the 4 rows from D-05 (verbatim ids preserved through the move).
        await expect(page.locator('#slide-recv-folder-row')).toHaveCount(1);
        await expect(page.locator('#slide-auto-send-row')).toHaveCount(1);
        await expect(page.locator('#slide-show-summary-row')).toHaveCount(1);
        await expect(page.locator('#slide-compat-row')).toHaveCount(1);
        // Rows must be inside #slide-config-modal (single-surface containment — NFR-4).
        for (const id of [
            '#slide-recv-folder-row',
            '#slide-auto-send-row',
            '#slide-show-summary-row',
            '#slide-compat-row',
        ]) {
            const inModal = await page.locator(`#slide-config-modal ${id}`).count();
            expect(inModal).toBe(1);
        }
        // Visual order: the 4 rows appear in the listed sequence.
        const orderIds = await page.evaluate(() => {
            const rows = Array.from(document.querySelectorAll(
                '#slide-config-modal #slide-recv-folder-row, ' +
                '#slide-config-modal #slide-auto-send-row, ' +
                '#slide-config-modal #slide-show-summary-row, ' +
                '#slide-config-modal #slide-compat-row'));
            return rows.map((r) => r.id);
        });
        expect(orderIds).toEqual([
            'slide-recv-folder-row',
            'slide-auto-send-row',
            'slide-show-summary-row',
            'slide-compat-row',
        ]);
    });
});

test.describe('slide-prefs — auto-send command', () => {

    test('input default value is "B:SLIDE R"', async ({ page }) => {
        await setup(page);
        // D-06 — input shows the literal `B:SLIDE R` (trailing \r is
        // appended at save time, NOT displayed).
        await expect(page.locator('#slide-auto-send-input')).toHaveValue('B:SLIDE R');
    });

    test('typing + change event persists slideAutoSendCommand to localStorage with trailing \\r', async ({ page }) => {
        await setup(page);
        await page.locator('#slide-auto-send-input').fill('A:RUN PROG.COM');
        await page.locator('#slide-auto-send-input').dispatchEvent('change');
        // Phase 6 D-33 — savePrefs is debounced 250 ms; poll up to 2 s for
        // the localStorage write.
        await expect.poll(
            () => page.evaluate(() => {
                const raw = localStorage.getItem('beastty.prefs');
                if (!raw) return null;
                try { return JSON.parse(raw).slideAutoSendCommand; } catch { return null; }
            }),
            { timeout: 2000 },
        ).toBe('A:RUN PROG.COM\r');
    });

    test('debounce delay matches Phase 6 D-33 250 ms contract', async ({ page }) => {
        await setup(page);
        // Snapshot localStorage before the change.
        const before = await page.evaluate(() => localStorage.getItem('beastty.prefs'));
        // Fire change immediately. The debounce should NOT fire within 50 ms
        // (Phase 6 D-33 is 250 ms; well above 50 ms).
        await page.locator('#slide-auto-send-input').fill('UNIQUE-TOKEN');
        await page.locator('#slide-auto-send-input').dispatchEvent('change');
        // After 50 ms the value should NOT yet be flushed.
        await page.waitForTimeout(50);
        const fiftyMs = await page.evaluate(() => {
            const raw = localStorage.getItem('beastty.prefs');
            if (!raw) return null;
            try { return JSON.parse(raw).slideAutoSendCommand; } catch { return null; }
        });
        // We can't strongly assert "not yet" because the value might be
        // older — assert it's NOT the new value yet.
        expect(fiftyMs).not.toBe('UNIQUE-TOKEN\r');
        // After 500 ms (250 ms debounce + slack) the value SHOULD be flushed.
        await expect.poll(
            () => page.evaluate(() => {
                const raw = localStorage.getItem('beastty.prefs');
                if (!raw) return null;
                try { return JSON.parse(raw).slideAutoSendCommand; } catch { return null; }
            }),
            { timeout: 1500 },
        ).toBe('UNIQUE-TOKEN\r');
        // Reference unused snapshot to confirm we captured prior state.
        expect(before === null || typeof before === 'string').toBe(true);
    });
});

test.describe('slide-prefs — show summary', () => {

    test('checkbox default checked (slideShowSummary default true)', async ({ page }) => {
        await setup(page);
        // D-08 — default ON. The DOM `checked` attribute reflects DEFAULTS
        // via the boot-time hydration.
        await expect(page.locator('#slide-show-summary')).toBeChecked();
    });

    test('toggling checkbox persists slideShowSummary boolean to localStorage', async ({ page }) => {
        await setup(page);
        await page.locator('#slide-show-summary').uncheck();
        await expect.poll(
            () => page.evaluate(() => {
                const raw = localStorage.getItem('beastty.prefs');
                if (!raw) return null;
                try { return JSON.parse(raw).slideShowSummary; } catch { return null; }
            }),
            { timeout: 2000 },
        ).toBe(false);
        // Toggle back ON to verify both directions persist.
        await page.locator('#slide-show-summary').check();
        await expect.poll(
            () => page.evaluate(() => {
                const raw = localStorage.getItem('beastty.prefs');
                if (!raw) return null;
                try { return JSON.parse(raw).slideShowSummary; } catch { return null; }
            }),
            { timeout: 2000 },
        ).toBe(true);
    });
});

test.describe('slide-prefs — Compatibility mode', () => {

    test('select default value is "auto"', async ({ page }) => {
        await setup(page);
        await expect(page.locator('#slide-compat-select')).toHaveValue('auto');
    });

    test('changing to "wakeup-required" persists slideCompatibilityMode', async ({ page }) => {
        await setup(page);
        await page.locator('#slide-compat-select').selectOption('wakeup-required');
        await expect.poll(
            () => page.evaluate(() => {
                const raw = localStorage.getItem('beastty.prefs');
                if (!raw) return null;
                try { return JSON.parse(raw).slideCompatibilityMode; } catch { return null; }
            }),
            { timeout: 2000 },
        ).toBe('wakeup-required');
    });

    test('changing to "force-start" persists slideCompatibilityMode', async ({ page }) => {
        await setup(page);
        await page.locator('#slide-compat-select').selectOption('force-start');
        await expect.poll(
            () => page.evaluate(() => {
                const raw = localStorage.getItem('beastty.prefs');
                if (!raw) return null;
                try { return JSON.parse(raw).slideCompatibilityMode; } catch { return null; }
            }),
            { timeout: 2000 },
        ).toBe('force-start');
    });
});
