// Beastty Phase 6 Plan 06 (Wave 5) — PREF-01/PREF-02/PLAT-05 prefs persistence.
//
// Wave 5 lands www/state/prefs.js, the boot-order reorder, and the Settings-pane
// rows. Plan 06-06 Task 1 un-fixmes the 8 round-trip stubs (defaults, theme,
// debounce, beforeunload, quota, migration, phosphor, serial config). Plan 06-06
// Task 2 un-fixmes the remaining 6 (Reset 2-click confirm, localEcho, crlfMode,
// fontZoom).
//
// Sources:
//   - 06-CONTEXT.md D-32 (single beastty.prefs versioned blob),
//                  D-33 (debounced 250 ms save / beforeunload flush),
//                  D-35 (Reset prefs 2-click confirm),
//                  D-36 (first-open defaults).
//   - 06-VALIDATION.md §Phase Requirements → Test Map (prefs row).
//   - Analog: www/tests/transport/connect.spec.js (localStorage assertions).
import { test, expect } from '@playwright/test';
import { SERIAL_MOCK } from '../transport/mock-serial.js';

async function setup(page) {
    await page.addInitScript(SERIAL_MOCK);
    await page.goto('/');
    await page.locator('#terminal-wrapper').focus();
    await page.waitForFunction(() => document.getElementById('terminal').width > 0);
}

// window.__pastePump is assigned late in main.js, after the handles setup()
// waits on — the paste cases need their own boot-race guard.
async function pumpReady(page) {
    await page.waitForFunction(
        () => window.__pastePump && typeof window.__pastePump.getPasteSpeed === 'function');
}

test.describe('PREF-01/PREF-02/PLAT-05 — Preferences persistence', () => {
    test('first load with no beastty.prefs applies D-36 defaults @fast', async ({ page }) => {
        await setup(page);
        const prefs = await page.evaluate(() => window.__prefs.getPrefs());
        expect(prefs.theme).toBe('crt');
        expect(prefs.phosphor).toBe('green');
        expect(prefs.fontZoom).toBe(1);
        expect(prefs.serial).toEqual({ baud: 19200, dataBits: 8, stopBits: 1, parity: 'none', flowControl: 'none' });
        expect(prefs.localEcho).toBe(false);
        expect(prefs.crlfMode).toBe('cr');
        // Paste has its own line-ending setting, separate from crlfMode above —
        // and it is paced by default, because pasting at wire speed loses text.
        expect(prefs.pasteLineEnding).toBe('cr');
        expect(prefs.pasteSpeed).toBe(240);
        expect(prefs.autoConnect).toBe(false);
        expect(prefs.version).toBe(2);
    });

    test('the pump boots on the same values DEFAULTS carries @fast', async ({ page }) => {
        // applyPrefs is the single writer of the pump's live settings, but it runs
        // AFTER wirePastePump — so if the pump's module-scope defaults ever drift
        // from DEFAULTS there is a window where a paste uses the wrong pacing, and
        // nothing else would notice. Pin them equal.
        await setup(page);
        await pumpReady(page);
        const { prefs, pump } = await page.evaluate(() => ({
            prefs: window.__prefs.getPrefs(),
            pump: {
                lineEnding: window.__pastePump.getPasteLineEnding(),
                speed: window.__pastePump.getPasteSpeed(),
            },
        }));
        expect(pump.lineEnding).toBe(prefs.pasteLineEnding);
        expect(pump.speed).toBe(prefs.pasteSpeed);
    });

    test('theme persists across reload (round-trip)', async ({ page }) => {
        // No addInitScript cleanup — Playwright provides a fresh browser context
        // per test so localStorage starts empty by default. addInitScript runs
        // on EVERY navigation including page.reload(), which would erase the
        // saved blob right before main.js's loadPrefs() reads it.
        await setup(page);
        // Toggle theme via savePrefs (the click handler also fires savePrefs in
        // production; here we drive savePrefs directly so the test does not
        // depend on whether the test-environment focus path runs the click).
        await page.evaluate(() => window.__prefs.savePrefs({ theme: 'clean' }));
        await page.waitForTimeout(300);   // > 250 ms debounce window
        await page.reload();
        await setup(page);
        const prefs = await page.evaluate(() => window.__prefs.getPrefs());
        expect(prefs.theme).toBe('clean');
    });

    test('phosphor persists across reload', async ({ page }) => {
        await setup(page);
        await page.evaluate(() => window.__prefs.savePrefs({ phosphor: 'amber' }));
        await page.waitForTimeout(300);
        await page.reload();
        await setup(page);
        const prefs = await page.evaluate(() => window.__prefs.getPrefs());
        expect(prefs.phosphor).toBe('amber');
    });

    test('serial config persists across reload (baud/dataBits/stopBits/parity/flowCtrl)', async ({ page }) => {
        await setup(page);
        await page.evaluate(() => window.__prefs.savePrefs({
            serial: { baud: 9600, dataBits: 7, stopBits: 2, parity: 'even', flowControl: 'hardware' },
        }));
        await page.waitForTimeout(300);
        await page.reload();
        await setup(page);
        const prefs = await page.evaluate(() => window.__prefs.getPrefs());
        expect(prefs.serial).toEqual({ baud: 9600, dataBits: 7, stopBits: 2, parity: 'even', flowControl: 'hardware' });
    });

    test('savePrefs is debounced 250 ms; burst of changes = one persist', async ({ page }) => {
        await page.addInitScript(() => localStorage.removeItem('beastty.prefs'));
        await setup(page);
        // Monkey-patch localStorage.setItem to count writes against the prefs key.
        await page.evaluate(() => {
            window.__prefsSetItemCount = 0;
            const orig = Storage.prototype.setItem;
            Storage.prototype.setItem = function (key, val) {
                if (key === 'beastty.prefs') window.__prefsSetItemCount++;
                return orig.call(this, key, val);
            };
        });
        await page.evaluate(() => {
            window.__prefs.savePrefs({ theme: 'crt' });
            window.__prefs.savePrefs({ phosphor: 'amber' });
            window.__prefs.savePrefs({ fontZoom: 2 });
        });
        // Before debounce expires, count should be 0.
        expect(await page.evaluate(() => window.__prefsSetItemCount)).toBe(0);
        // After > 250 ms debounce, count should be exactly 1.
        await page.waitForTimeout(350);
        expect(await page.evaluate(() => window.__prefsSetItemCount)).toBe(1);
    });

    test('beforeunload flushes pending debounced write', async ({ page }) => {
        await page.addInitScript(() => localStorage.removeItem('beastty.prefs'));
        await setup(page);
        await page.evaluate(() => {
            window.__prefs.savePrefs({ theme: 'clean' });
        });
        // Trigger beforeunload synchronously BEFORE the 250 ms debounce expires.
        // The flush handler must fire setItem immediately.
        await page.evaluate(() => window.dispatchEvent(new Event('beforeunload')));
        const stored = await page.evaluate(() => JSON.parse(localStorage.getItem('beastty.prefs')));
        expect(stored).not.toBeNull();
        expect(stored.theme).toBe('clean');
    });

    test('quota error swallowed silently; in-memory prefs preserved', async ({ page }) => {
        await page.addInitScript(() => localStorage.removeItem('beastty.prefs'));
        await setup(page);
        await page.evaluate(() => {
            // Stub setItem to throw QuotaExceededError ONLY for the prefs key
            // (other localStorage writers — e.g. beastty.port.preset — must
            // still work; the test only exercises the prefs.js failure path).
            const orig = Storage.prototype.setItem;
            Storage.prototype.setItem = function (key, val) {
                if (key === 'beastty.prefs') {
                    const err = new Error('quota');
                    err.name = 'QuotaExceededError';
                    throw err;
                }
                return orig.call(this, key, val);
            };
            window.__prefs.savePrefs({ theme: 'clean' });
        });
        await page.waitForTimeout(300);
        // In-memory prefs MUST reflect the change even though setItem threw.
        expect(await page.evaluate(() => window.__prefs.getPrefs().theme)).toBe('clean');
    });

    test('version migration: parsed.version > CURRENT_VERSION → fall back to defaults', async ({ page }) => {
        await page.addInitScript(() => {
            localStorage.setItem('beastty.prefs', JSON.stringify({ version: 999, theme: 'wat' }));
        });
        await setup(page);
        const prefs = await page.evaluate(() => window.__prefs.getPrefs());
        expect(prefs.version).toBe(2);
        expect(prefs.theme).toBe('crt');   // fallen back to D-36 default
    });

    test('localEcho persists across reload', async ({ page }) => {
        await setup(page);
        // E7.1 — toggle via the Settings menu row (the #local-echo checkbox retired).
        await page.evaluate(() => window.__menuBar.open('settings'));
        await page.click('#dropdown-settings .menu-item[data-pref="localEcho"]');
        await page.evaluate(() => window.__menuBar.close());
        await page.waitForTimeout(300);
        await page.reload();
        await setup(page);
        expect(await page.evaluate(() => window.__prefs.getPrefs().localEcho)).toBe(true);
    });

    test('crlfMode persists across reload', async ({ page }) => {
        await setup(page);
        // E7.1 — set via the Settings ▸ Enter key sends submenu (the #crlf-* radios retired).
        await page.evaluate(() => window.__menuBar.open('settings'));
        await page.click('#dropdown-settings .menu-item[data-submenu="crlf"]');
        await page.click('#dropdown-settings .submenu[data-submenu-panel="crlf"] .menu-item[data-value="lf"]');
        await page.evaluate(() => window.__menuBar.close());
        await page.waitForTimeout(300);
        await page.reload();
        await setup(page);
        expect(await page.evaluate(() => window.__prefs.getPrefs().crlfMode)).toBe('lf');
    });

    test('pasteLineEnding persists across reload and re-applies to the pump', async ({ page }) => {
        await setup(page);
        await page.evaluate(() => window.__menuBar.open('settings'));
        await page.click('#dropdown-settings .menu-item[data-submenu="paste-eol"]');
        await page.click('#dropdown-settings .submenu[data-submenu-panel="paste-eol"] .menu-item[data-value="crlf"]');
        await page.evaluate(() => window.__menuBar.close());
        await page.waitForTimeout(300);   // > 250 ms debounce window
        await page.reload();
        await setup(page);
        await pumpReady(page);
        expect(await page.evaluate(() => window.__prefs.getPrefs().pasteLineEnding)).toBe('crlf');
        // applyPrefs re-applied it on the boot path — the stored value governs the
        // next paste, not just the checkmark.
        expect(await page.evaluate(() => window.__pastePump.getPasteLineEnding())).toBe('crlf');
        await expect(page.locator('#dropdown-settings .submenu[data-submenu-panel="paste-eol"] .menu-item[data-value="crlf"]'))
            .toHaveAttribute('data-checked', 'true');
    });

    test('pasteSpeed persists across reload and re-applies to the pump', async ({ page }) => {
        await setup(page);
        await page.evaluate(() => window.__menuBar.open('settings'));
        await page.click('#dropdown-settings .menu-item[data-submenu="paste-speed"]');
        await page.click('#dropdown-settings .submenu[data-submenu-panel="paste-speed"] .menu-item[data-value="60"]');
        await page.evaluate(() => window.__menuBar.close());
        await page.waitForTimeout(300);
        await page.reload();
        await setup(page);
        await pumpReady(page);
        expect(await page.evaluate(() => window.__prefs.getPrefs().pasteSpeed)).toBe(60);
        expect(await page.evaluate(() => window.__pastePump.getPasteSpeed())).toBe(60);
        // A full 8-byte chunk owes round(8 / 60 × 1000) = 133 ms, and a break adds
        // max(50, 133 × 4) = 532 ms on top.
        expect(await page.evaluate(() => window.__pastePump.__getStateForTests()))
            .toMatchObject({ gapMs: 133, lineExtraMs: 532 });
    });

    test('an out-of-range stored pasteSpeed falls back to the default', async ({ page }) => {
        // prefs.js has no field validation (D-32) — the pump validates at its
        // consumer, as setCrlfMode does. A blob carrying 99999 must leave the pump
        // on its default rather than pacing at a nonsense rate or throwing.
        await page.addInitScript(() => localStorage.setItem(
            'beastty.prefs', JSON.stringify({ version: 2, pasteSpeed: 99999 })));
        await setup(page);
        await pumpReady(page);
        expect(await page.evaluate(() => window.__pastePump.getPasteSpeed())).toBe(240);
        expect(await page.evaluate(() => window.__pastePump.__getStateForTests().gapMs)).toBe(33);
    });

    // Number(null), Number(''), Number(false) and Number([]) are ALL 0, and 0 is
    // a legal pasteSpeed meaning Full speed — the one value that turns the pacing
    // fix off. A validator that coerced before testing would silently accept every
    // one of these from a stored blob. The setter rejects the TYPE first.
    for (const [label, stored] of [
        ['null', null],
        ['an empty string', ''],
        ['false', false],
        ['an empty array', []],
        ['a non-integer', 240.5],
    ]) {
        test(`a stored pasteSpeed of ${label} is rejected, not coerced to Full speed`, async ({ page }) => {
            await page.addInitScript(
                (blob) => localStorage.setItem('beastty.prefs', blob),
                JSON.stringify({ version: 2, pasteSpeed: stored }));
            await setup(page);
            await pumpReady(page);
            expect(await page.evaluate(() => window.__pastePump.getPasteSpeed())).toBe(240);
            expect(await page.evaluate(() => window.__pastePump.__getStateForTests().chunkSize)).toBe(8);
            // And the menu shows the default, not the rejected value.
            await page.evaluate(() => window.__menuBar.open('settings'));
            await page.click('#dropdown-settings .menu-item[data-submenu="paste-speed"]');
            await expect(page.locator('#dropdown-settings .submenu[data-submenu-panel="paste-speed"] .menu-item[data-value="240"]'))
                .toHaveAttribute('data-checked', 'true');
        });
    }

    test('fontZoom persists across reload', async ({ page }) => {
        await setup(page);
        // Use the savePrefs API directly — the keyboard-chord path is exercised
        // in the Phase 3 zoom suite; here we focus on the persistence contract.
        await page.evaluate(() => window.__prefs.savePrefs({ fontZoom: 2 }));
        await page.waitForTimeout(300);
        await page.reload();
        await setup(page);
        expect(await page.evaluate(() => window.__prefs.getPrefs().fontZoom)).toBe(2);
    });

    // E7.1 — the reset 2-click confirm moved wholly to the Settings ▸ Reset all
    // preferences menu row (the legacy #reset-prefs-button retired); same labels +
    // 3 s window (shared confirm-toggle.js). Menu-driven idioms below.
    const RESET_ROW = '#dropdown-settings .menu-item[data-action="reset-prefs"]';
    const RESET_LBL = `${RESET_ROW} .lbl`;

    test('Reset prefs row: first click changes label to "Click again to confirm (3 s)"', async ({ page }) => {
        await page.addInitScript(() => localStorage.removeItem('beastty.prefs'));
        await setup(page);
        await page.evaluate(() => window.__menuBar.open('settings'));
        await page.click(RESET_ROW);
        await expect(page.locator(RESET_LBL)).toHaveText('Click again to confirm (3 s)');
    });

    test('Reset prefs row: second click within 3s clears beastty.prefs and reloads defaults', async ({ page }) => {
        await page.addInitScript(() => localStorage.removeItem('beastty.prefs'));
        await setup(page);
        // First customize prefs.
        await page.evaluate(() => window.__prefs.savePrefs({ theme: 'clean' }));
        await page.waitForTimeout(300);
        expect(await page.evaluate(() => localStorage.getItem('beastty.prefs'))).not.toBeNull();
        await page.evaluate(() => window.__menuBar.open('settings'));
        await page.click(RESET_ROW);
        await page.click(RESET_ROW);
        // Defaults reloaded in-place (no page reload — D-35).
        expect(await page.evaluate(() => window.__prefs.getPrefs().theme)).toBe('crt');
        expect(await page.evaluate(() => localStorage.getItem('beastty.prefs'))).toBeNull();
        // Label restored to idle.
        await expect(page.locator(RESET_LBL)).toHaveText('Reset all preferences');
    });

    test('Reset prefs row: 3s timeout returns label to "Reset all preferences"', async ({ page }) => {
        await page.addInitScript(() => localStorage.removeItem('beastty.prefs'));
        await setup(page);
        await page.evaluate(() => window.__menuBar.open('settings'));
        await page.click(RESET_ROW);
        await expect(page.locator(RESET_LBL)).toHaveText('Click again to confirm (3 s)');
        await page.waitForTimeout(3500);   // wait > 3 s
        await expect(page.locator(RESET_LBL)).toHaveText('Reset all preferences');
    });

    // Phase 6 Plan 06-09 (gap closure) — no-revert regression suite.
    // Covers the structural fix in www/state/prefs.js: flushPrefs no longer
    // iterates subscribers, so a routine debounced savePrefs cannot re-fire
    // applyPrefs and racily revert any DOM state the user just mutated.
    // resetPrefs is preserved as the canonical subscriber fan-out path.
    test('flushPrefs does NOT fire subscribers — no DOM revert after debounce window @fast', async ({ page }) => {
        await setup(page);
        // Install a spy subscriber via the public API.
        await page.evaluate(() => {
            window.__prefsSpyCalls = 0;
            window.__prefsUnsub = window.__prefs.subscribe(() => { window.__prefsSpyCalls++; });
        });
        // Drive a routine savePrefs — debounce is 250 ms.
        await page.evaluate(() => window.__prefs.savePrefs({ phosphor: 'amber' }));
        // Wait > 250 ms so flushPrefs has run.
        await page.waitForTimeout(350);
        const spyCalls = await page.evaluate(() => window.__prefsSpyCalls);
        // Structural fix: flushPrefs no longer iterates subscribers.
        expect(spyCalls).toBe(0);
        // Sanity — resetPrefs still does fire subscribers.
        await page.evaluate(() => window.__prefs.resetPrefs());
        const spyAfterReset = await page.evaluate(() => window.__prefsSpyCalls);
        expect(spyAfterReset).toBe(1);
        // Cleanup — unsubscribe so we don't leak across tests.
        await page.evaluate(() => window.__prefsUnsub && window.__prefsUnsub());
    });

    test('phosphor DOM state survives the 250ms debounce window — no race-revert @fast', async ({ page }) => {
        await setup(page);
        await page.waitForFunction(() => window.__menuBar && typeof window.__menuBar.open === 'function');
        // Epic E1 Story E1.4 — select Amber via View ▸ Phosphor (real user path).
        const AMBER = '#dropdown-view .submenu[data-submenu-panel="phosphor"] .menu-item[data-value="amber"]';
        await page.evaluate(() => window.__menuBar.open('view'));
        await page.click('#dropdown-view .menu-item[data-submenu="phosphor"]');
        await page.click(AMBER);
        // aria-checked is the synchronous DOM update.
        expect(await page.locator(AMBER).getAttribute('aria-checked')).toBe('true');
        // Wait past the 250 ms debounce — flushPrefs does NOT fire subscribers
        // (AD-4), so the menu radio state must not revert. Same guarantee the
        // snapPreset fix pinned, now for the relocated phosphor control.
        await page.waitForTimeout(350);
        expect(await page.locator(AMBER).getAttribute('aria-checked')).toBe('true');
    });
});

// Epic E1 Story E1.3 (AC-5 / AD-14) — applyPrefs single-writer on reset.
// applyPrefs re-applies defaults in-place on resetPrefs() (no reload): each
// canvas setter fires from exactly one call site and the #top-bar/<details>
// mirrors re-project to the default. This pins that in-place reset behaviour.
test.describe('E1.3 AC-5 — applyPrefs re-applies defaults in-place on reset', () => {
    test('resetPrefs() restores defaults in-place with no throw @fast', async ({ page }) => {
        await page.addInitScript(() => localStorage.removeItem('beastty.prefs'));
        await setup(page);
        // Move state away from defaults, then reset.
        await page.evaluate(() => {
            window.__prefs.savePrefs({ theme: 'clean', phosphor: 'amber', fontZoom: 3 });
        });
        const threw = await page.evaluate(() => {
            try { window.__prefs.resetPrefs(); return false; } catch (e) { return true; }
        });
        expect(threw).toBe(false);
        // Defaults re-applied in-place (canvas single-writers fired).
        await expect(page.locator('body')).toHaveAttribute('data-theme', 'crt');
        expect(await page.evaluate(() => window.__prefs.getPrefs().theme)).toBe('crt');
        expect(await page.evaluate(() => window.__prefs.getPrefs().phosphor)).toBe('green');
        expect(await page.evaluate(() => window.__prefs.getPrefs().fontZoom)).toBe(1);
        // Epic E1 Story E1.4 — projectPrefs re-projects the View ▸ Theme active
        // radio to the default (CRT) on reset (replacing the retired #theme-toggle
        // label mirror).
        await page.evaluate(() => window.__menuBar.open('view'));
        await expect(page.locator('#dropdown-view .submenu[data-submenu-panel="theme"] .menu-item[data-value="crt"]'))
            .toHaveAttribute('aria-checked', 'true');
        await expect(page.locator('#dropdown-view .submenu[data-submenu-panel="theme"] .menu-item[data-value="clean"]'))
            .toHaveAttribute('aria-checked', 'false');
    });
});
