// Epic E2 Story E2.2 — Auto-connect toggle & Choose MicroBeast (menu-bar wiring).
//
// Covers the E2.2 ACs that the shared menu-bar.spec.js glyph test doesn't:
//   - AC-1/AC-4 : the Auto-connect checkable persists prefs.autoConnect (AD-4)
//                 and mirrors the coexisting legacy #auto-connect-checkbox.
//   - AC-3      : reset re-projection (projectPrefs) restores the row from prefs.
//   - AC-2/FR-13: "Choose MicroBeast…" is [hidden] with ≤1 granted CP2102N adapter
//                 and present with >1 (async count, no-throw, boot-race-guarded).
//   - AC-5      : clicking it invokes the injected picker (connectMicroBeast) and
//                 closes the menu (action semantics).
//   - AC-6      : both clicks retain terminal focus (NFR-1 "sacred").
//
// Idioms (E1 retro action #4): window.__menuBar.open() for deterministic open;
// boot-race guard on window.__menuBar; multi-adapter seeding via the mock's
// _grantedPorts (transport/errors.spec.js); prefs seeding via addInitScript.
import { test, expect } from '@playwright/test';
import { SERIAL_MOCK } from '../transport/mock-serial.js';

const MATCH_INFO = { usbVendorId: 0x10c4, usbProductId: 0xea60 };   // CP2102N (D-02)

function prefsBlob(autoConnect) {
    return JSON.stringify({
        version: 1,
        theme: 'crt', phosphor: 'green', fontZoom: 1,
        serial: { baud: 19200, dataBits: 8, stopBits: 1, parity: 'none', flowControl: 'none' },
        localEcho: false, crlfMode: 'cr', autoConnect,
    });
}

// Boot the page with the serial mock and, optionally, N pre-granted CP2102N
// adapters + a seeded prefs blob. Order matters: __preGrantPort must be set
// BEFORE SERIAL_MOCK (the IIFE reads it), and the extra-port seeding runs AFTER
// the mock installs navigator.serial. Focuses #terminal-wrapper so retainFocus
// assertions have a real starting focus to preserve.
async function setup(page, { grantedAdapters = 0, prefs } = {}) {
    await page.addInitScript((opts) => {
        if (opts.grantedAdapters > 0) window.__preGrantPort = true;   // seeds ONE matching port
        if (opts.prefs) localStorage.setItem('beastty.prefs', opts.prefs);
    }, { grantedAdapters, prefs });
    await page.addInitScript(SERIAL_MOCK);
    // Seed any adapters beyond the first (the mock's __preGrantPort only seeds 1).
    // addInitScript takes a SINGLE arg — pass one object, not positional args.
    if (grantedAdapters > 1) {
        await page.addInitScript((opts) => {
            const Ctor = navigator.serial._grantedPorts[0].constructor;
            for (let i = 0; i < opts.extra; i++) navigator.serial._grantedPorts.push(new Ctor(opts.info));
        }, { info: MATCH_INFO, extra: grantedAdapters - 1 });
    }
    await page.goto('/');
    await page.waitForFunction(
        () => window.__menuBar && typeof window.__menuBar.__getStateForTests === 'function',
    );
    await page.locator('#terminal-wrapper').focus();
}

test.describe('E2.2 AC-1/AC-4 — Auto-connect toggle persists + mirrors legacy checkbox', () => {
    test('toggle writes prefs.autoConnect and keeps the legacy checkbox in lockstep @fast', async ({ page }) => {
        await setup(page);
        await page.evaluate(() => window.__menuBar.open('connection'));
        const row = page.locator('#menu-autoconnect-item');
        // Fresh page: default false → unchecked, legacy checkbox unchecked.
        await expect(row).toHaveAttribute('data-checked', 'false');
        expect(await page.evaluate(() => document.getElementById('auto-connect-checkbox').checked)).toBe(false);

        // Toggle ON → pref persisted (getPrefs reflects savePrefs synchronously),
        // glyph on, menu stays open, legacy pane checkbox mirrors (AC-4 menu→pane).
        await row.click();
        expect(await page.evaluate(() => window.__prefs.getPrefs().autoConnect)).toBe(true);
        await expect(row).toHaveAttribute('data-checked', 'true');
        await expect(row.locator('.check')).toHaveText('✓');
        expect(await page.evaluate(() => window.__menuBar.getOpenMenu())).toBe('connection');
        expect(await page.evaluate(() => document.getElementById('auto-connect-checkbox').checked)).toBe(true);

        // Focus never left the terminal (AC-6 / NFR-1 "sacred").
        expect(await page.evaluate(() => document.activeElement && document.activeElement.id)).toBe('terminal-wrapper');

        // Toggle OFF → back to false on both surfaces.
        await row.click();
        expect(await page.evaluate(() => window.__prefs.getPrefs().autoConnect)).toBe(false);
        await expect(row).toHaveAttribute('data-checked', 'false');
        expect(await page.evaluate(() => document.getElementById('auto-connect-checkbox').checked)).toBe(false);
    });

    test('a legacy-checkbox toggle is reflected in the menu on the next open (pane→menu) @fast', async ({ page }) => {
        await setup(page);
        // Toggle the legacy pane checkbox directly (fires its change → savePrefs).
        await page.evaluate(() => {
            const cb = document.getElementById('auto-connect-checkbox');
            cb.checked = true;
            cb.dispatchEvent(new Event('change'));
        });
        expect(await page.evaluate(() => window.__prefs.getPrefs().autoConnect)).toBe(true);
        // Opening the Connection menu re-derives the row from prefs (AC-3 open re-derive).
        await page.evaluate(() => window.__menuBar.open('connection'));
        await expect(page.locator('#menu-autoconnect-item')).toHaveAttribute('data-checked', 'true');
    });
});

test.describe('E2.2 AC-3 — reset re-projection restores the row from prefs', () => {
    test('projectPrefs({autoConnect:false}) unchecks a checked row @fast', async ({ page }) => {
        // Seed autoConnect:true so the row paints checked at boot / on open.
        await setup(page, { prefs: prefsBlob(true) });
        await page.evaluate(() => window.__menuBar.open('connection'));
        const row = page.locator('#menu-autoconnect-item');
        await expect(row).toHaveAttribute('data-checked', 'true');
        await expect(row.locator('.check')).toHaveText('✓');

        // Simulate resetPrefs() fanning out the default blob to the subscriber.
        await page.evaluate(() => window.__menuBar.projectPrefs({ autoConnect: false }));
        await expect(row).toHaveAttribute('data-checked', 'false');
        await expect(row).toHaveAttribute('aria-checked', 'false');
        await expect(row.locator('.check')).toHaveText('');
    });
});

test.describe('E2.2 AC-2/FR-13 — Choose MicroBeast… tracks the live adapter count', () => {
    test('hidden with ≤1 granted CP2102N adapter @fast', async ({ page }) => {
        await setup(page, { grantedAdapters: 1 });
        await page.evaluate(() => window.__menuBar.open('connection'));
        // Count is async; wait for the resolved projection to settle on hidden.
        const row = page.locator('#menu-choose-microbeast-item');
        await expect(row).toBeHidden();
    });

    test('present (actionable) with >1 granted CP2102N adapter @fast', async ({ page }) => {
        await setup(page, { grantedAdapters: 2 });
        await page.evaluate(() => window.__menuBar.open('connection'));
        const row = page.locator('#menu-choose-microbeast-item');
        await expect(row).toBeVisible();   // async count resolved → present
        expect(await page.evaluate(() => document.getElementById('menu-choose-microbeast-item').hasAttribute('hidden'))).toBe(false);
    });

    test('AC-5/AC-6 — clicking it opens the filtered picker and closes the menu, retaining focus @fast', async ({ page }) => {
        await setup(page, { grantedAdapters: 2 });
        await page.evaluate(() => window.__menuBar.open('connection'));
        const row = page.locator('#menu-choose-microbeast-item');
        await expect(row).toBeVisible();

        const before = await page.evaluate(() => navigator.serial._grantedPorts.length);
        await row.click();
        // The injected chooser is connectMicroBeast() → the mock requestPort pushes
        // a fresh granted port, proving the CP2102N-filtered picker was invoked.
        await expect.poll(() => page.evaluate(() => navigator.serial._grantedPorts.length)).toBe(before + 1);
        // Action semantics — the menu closes.
        expect(await page.evaluate(() => window.__menuBar.getOpenMenu())).toBeNull();
        // Focus retained on the terminal (NFR-1 "sacred").
        expect(await page.evaluate(() => document.activeElement && document.activeElement.id)).toBe('terminal-wrapper');
    });
});
