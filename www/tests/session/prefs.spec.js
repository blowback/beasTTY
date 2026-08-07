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
// Settings ▸ Paste settings… — the three paste controls moved out of the Settings
// menu's radio submenus into #paste-config-modal.
import {
    setPasteEol, setPasteChunk, setPastePause,
    openPasteSettings, closePasteSettings,
    PASTE_EOL_SELECT, PASTE_CHUNK_SELECT, PASTE_PAUSE_SELECT, PASTE_THROUGHPUT,
} from '../paste-settings.js';
import { SERIAL_MOCK } from '../transport/mock-serial.js';

async function setup(page) {
    await page.addInitScript(SERIAL_MOCK);
    await page.goto('/');
    await page.locator('#terminal-wrapper').focus();
    await page.waitForFunction(() => document.getElementById('terminal').width > 0);
    // The canvas has a width well before wireMenuBar assigns window.__menuBar, and
    // most cases here drive the Settings menu straight after setup(). Observed
    // failing once as "Cannot read properties of undefined (reading 'open')" and
    // passing on retry — the boot-race guard the other suites already use.
    await page.waitForFunction(
        () => window.__menuBar && typeof window.__menuBar.open === 'function');
}

// window.__pastePump is assigned late in main.js, after the handles setup()
// waits on — the paste cases need their own boot-race guard.
async function pumpReady(page) {
    await page.waitForFunction(
        () => window.__pastePump && typeof window.__pastePump.getPasteChunk === 'function');
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
        // and it is paced by default, because pasting at wire speed loses text on
        // a port with no flow control. 1 byte every 200 ms is 5 B/s, the cadence
        // measured to deliver an 800 B block into VIBE intact on real hardware.
        expect(prefs.pasteLineEnding).toBe('cr');
        expect(prefs.pasteChunk).toBe(1);
        expect(prefs.pastePauseMs).toBe(200);
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
                chunk: window.__pastePump.getPasteChunk(),
                pauseMs: window.__pastePump.getPastePauseMs(),
            },
        }));
        expect(pump.lineEnding).toBe(prefs.pasteLineEnding);
        expect(pump.chunk).toBe(prefs.pasteChunk);
        expect(pump.pauseMs).toBe(prefs.pastePauseMs);
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
        await setPasteEol(page, 'crlf');
        await page.waitForTimeout(300);   // > 250 ms debounce window
        await page.reload();
        await setup(page);
        await pumpReady(page);
        expect(await page.evaluate(() => window.__prefs.getPrefs().pasteLineEnding)).toBe('crlf');
        // applyPrefs re-applied it on the boot path — the stored value governs the
        // next paste, not just the checkmark.
        expect(await page.evaluate(() => window.__pastePump.getPasteLineEnding())).toBe('crlf');
        // …and the modal re-projects it from the pump the next time it opens.
        await openPasteSettings(page);
        await expect(page.locator(PASTE_EOL_SELECT)).toHaveValue('crlf');
        await closePasteSettings(page);
    });

    test('the paste cadence persists across reload and re-applies to the pump', async ({ page }) => {
        await setup(page);
        await setPasteChunk(page, 8);
        await setPastePause(page, 100);
        await page.waitForTimeout(300);
        await page.reload();
        await setup(page);
        await pumpReady(page);
        expect(await page.evaluate(() => window.__prefs.getPrefs().pasteChunk)).toBe(8);
        expect(await page.evaluate(() => window.__prefs.getPrefs().pastePauseMs)).toBe(100);
        expect(await page.evaluate(() => window.__pastePump.getPasteChunk())).toBe(8);
        expect(await page.evaluate(() => window.__pastePump.getPastePauseMs())).toBe(100);
        // And the throughput they add up to: 8 B every 100 ms is 80 B/s.
        expect(await page.evaluate(() => window.__pastePump.__getStateForTests()))
            .toMatchObject({ chunkSize: 8, pauseMs: 100, throughput: 80 });
    });

    test('a stored blob carrying the retired pasteSpeed is simply ignored', async ({ page }) => {
        // CURRENT_VERSION was deliberately NOT bumped when the rate model was
        // replaced: the defensive spread-merge fills in the two new fields and the
        // old one has no consumer left, so an existing blob needs no migration.
        await page.addInitScript(() => localStorage.setItem(
            'beastty.prefs', JSON.stringify({ version: 2, pasteSpeed: 60, theme: 'clean' })));
        await setup(page);
        await pumpReady(page);
        expect(await page.evaluate(() => window.__prefs.getPrefs().theme)).toBe('clean');
        expect(await page.evaluate(() => window.__pastePump.getPasteChunk())).toBe(1);
        expect(await page.evaluate(() => window.__pastePump.getPastePauseMs())).toBe(200);
    });

    for (const [label, stored, chunk, pause] of [
        ['an out-of-range chunk', { pasteChunk: 99999 }, 1, 200],
        ['a chunk of 0', { pasteChunk: 0 }, 1, 200],
        ['a negative pause', { pastePauseMs: -1 }, 1, 200],
    ]) {
        test(`${label} falls back to the default`, async ({ page }) => {
            // prefs.js has no field validation (D-32) — the pump validates at its
            // consumer, as setCrlfMode does. A blob carrying nonsense must leave the
            // pump on its defaults rather than pacing absurdly or throwing.
            await page.addInitScript(
                (blob) => localStorage.setItem('beastty.prefs', blob),
                JSON.stringify({ version: 2, ...stored }));
            await setup(page);
            await pumpReady(page);
            expect(await page.evaluate(() => window.__pastePump.getPasteChunk())).toBe(chunk);
            expect(await page.evaluate(() => window.__pastePump.getPastePauseMs())).toBe(pause);
        });
    }

    // Number(null), Number(''), Number(false) and Number([]) are ALL 0, and 0 is a
    // legal pastePauseMs meaning "no pause at all" — the one value that turns the
    // pacing off. A validator that coerced before testing would silently accept
    // every one of these from a stored blob. Both setters reject the TYPE first.
    for (const [label, stored] of [
        ['null', null],
        ['an empty string', ''],
        ['false', false],
        ['an empty array', []],
        ['a non-integer', 20.5],
    ]) {
        test(`a stored paste cadence of ${label} is rejected, not coerced`, async ({ page }) => {
            await page.addInitScript(
                (blob) => localStorage.setItem('beastty.prefs', blob),
                JSON.stringify({ version: 2, pasteChunk: stored, pastePauseMs: stored }));
            await setup(page);
            await pumpReady(page);
            expect(await page.evaluate(() => window.__pastePump.getPasteChunk())).toBe(1);
            expect(await page.evaluate(() => window.__pastePump.getPastePauseMs())).toBe(200);
            // And the modal shows the defaults, not the rejected values.
            await openPasteSettings(page);
            await expect(page.locator(PASTE_CHUNK_SELECT)).toHaveValue('1');
            await expect(page.locator(PASTE_PAUSE_SELECT)).toHaveValue('200');
            await closePasteSettings(page);
        });
    }

    // The modal's controls are projected from what the pump ACCEPTED, not from the
    // stored pref. These are the two ways those disagree.

    test('a stored pasteChunk the pump ACCEPTS but the modal does not offer selects nothing', async ({ page }) => {
        // setPasteChunk takes any integer in 1..4096; the select offers six values.
        // A stored 3 therefore runs the pump at 3 bytes. Selecting 1 because 3 does
        // not match an option would put the control on a value that is not live —
        // the one thing it must never do. A blank select says, accurately, "the live
        // chunk size is not on this menu".
        await page.addInitScript(() => localStorage.setItem(
            'beastty.prefs', JSON.stringify({ version: 2, pasteChunk: 3 })));
        await setup(page);
        await pumpReady(page);
        expect(await page.evaluate(() => window.__pastePump.getPasteChunk())).toBe(3);
        await openPasteSettings(page);
        await expect(page.locator(PASTE_CHUNK_SELECT)).toHaveValue('');
        expect(await page.locator(PASTE_CHUNK_SELECT).evaluate((el) => el.selectedIndex)).toBe(-1);
        // The throughput readout still tells the truth about it: 3 B / 200 ms.
        await expect(page.locator(PASTE_THROUGHPUT)).toHaveText('≈ 15 B/s');
        await closePasteSettings(page);
    });

    test('a stored pasteChunk of the STRING "8" is rejected and the modal still shows 1', async ({ page }) => {
        // '8' matches an option's value, so projecting the raw pref would show 8.
        // setPasteChunk rejects the type before the value, so the pump stays at 1 —
        // the control would have been a straight lie about the next paste. This is
        // the case that proves the modal reads the PUMP and not the stored pref.
        await page.addInitScript(() => localStorage.setItem(
            'beastty.prefs', JSON.stringify({ version: 2, pasteChunk: '8' })));
        await setup(page);
        await pumpReady(page);
        expect(await page.evaluate(() => window.__pastePump.getPasteChunk())).toBe(1);
        expect(await page.evaluate(() => window.__prefs.getPrefs().pasteChunk)).toBe('8');
        await openPasteSettings(page);
        await expect(page.locator(PASTE_CHUNK_SELECT)).toHaveValue('1');
        await closePasteSettings(page);
    });

    test('a stored pasteLineEnding of the STRING-shaped nonsense leaves CR selected', async ({ page }) => {
        // Same contract on the other control: setPasteLineEnding validates by
        // hasOwnProperty against the terminator table, so 'toString' (a prototype
        // key) is rejected and the pump stays on CR. The modal must agree.
        await page.addInitScript(() => localStorage.setItem(
            'beastty.prefs', JSON.stringify({ version: 2, pasteLineEnding: 'toString' })));
        await setup(page);
        await pumpReady(page);
        expect(await page.evaluate(() => window.__pastePump.getPasteLineEnding())).toBe('cr');
        await openPasteSettings(page);
        await expect(page.locator(PASTE_EOL_SELECT)).toHaveValue('cr');
        await closePasteSettings(page);
    });

    test('a stored pause of 150 ms round-trips through the modal and the pump', async ({ page }) => {
        // 150 ms — about 6.7 B/s — joined the offered pauses after the ~800 B block
        // was timed on hardware: 59 s over RTS/CTS (so the handshake settles near
        // 13.5 B/s) against 148 s at the configured 5 B/s. It sits between the
        // 10 B/s that nearly worked and the 5 B/s that did.
        await setup(page);
        await pumpReady(page);
        await setPastePause(page, 150);
        expect(await page.evaluate(() => window.__prefs.getPrefs().pastePauseMs)).toBe(150);
        expect(await page.evaluate(() => window.__pastePump.getPastePauseMs())).toBe(150);
        await page.waitForTimeout(300);   // > 250 ms debounce window
        await page.reload();
        await setup(page);
        await pumpReady(page);
        expect(await page.evaluate(() => window.__pastePump.getPastePauseMs())).toBe(150);
        await openPasteSettings(page);
        await expect(page.locator(PASTE_PAUSE_SELECT)).toHaveValue('150');
        // 1 byte every 150 ms is 6.67 B/s, rounded to 7 for the readout.
        await expect(page.locator(PASTE_THROUGHPUT)).toHaveText('≈ 7 B/s');
        await closePasteSettings(page);
    });

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
