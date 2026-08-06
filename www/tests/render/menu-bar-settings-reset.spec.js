// Epic E3 Story E3.3 (FR-22) — Settings ▸ Reset all preferences.
//
// A RELOCATION + TRIGGER story: the inert Reset stub row now runs an inline 2-click
// confirm (verbatim labels + 3s window from the legacy chrome.js:274-284 machine)
// AGAINST THE ROW's own .lbl, committing the injected resetPrefs() on the second
// activation. It is a THIRD menu-item behaviour: unlike a normal action row it stays
// OPEN on the first activation so the confirm prompt shows, and it disarms on EVERY
// path that hides the Settings dropdown mid-confirm (Esc / click-away / menu switch).
// resetPrefs() re-projects every prefs-driven menu row via the existing projectPrefs
// subscriber (already implemented — E1.3..E3.2). These specs pin AC-1..AC-3, AC-6.
//
// Idioms (E1 retro action #4 / E2 retro action #1): boot-race guard on window.__*;
// window.__menuBar.open('settings') for a deterministic open (NOT a title click for
// the OPEN; a real title CLICK is used only where the switch-path IS the assertion);
// row click via [data-action]; retainFocus via activeElement.id.
import { test, expect } from '@playwright/test';

const RESET = '#dropdown-settings .menu-item[data-action="reset-prefs"]';
const RESET_LBL = `${RESET} .lbl`;
const IDLE = 'Reset all preferences';
const CONFIRM = 'Click again to confirm (3 s)';

const LOCAL_ECHO = '#dropdown-settings .menu-item[data-pref="localEcho"]';
const AUTO_CONNECT = '#menu-autoconnect-item';
const crlfRadio = (v) =>
  `#dropdown-settings .submenu[data-submenu-panel="crlf"] .menu-item[data-value="${v}"]`;
const pasteEolRadio = (v) =>
  `#dropdown-settings .submenu[data-submenu-panel="paste-eol"] .menu-item[data-value="${v}"]`;
const pasteSpeedRadio = (v) =>
  `#dropdown-settings .submenu[data-submenu-panel="paste-speed"] .menu-item[data-value="${v}"]`;

// Boot with an optional seeded prefs blob (the reset re-projection oracle). loadPrefs()
// runs at boot (main.js:36), so a seeded blob flows into the initial menu projection.
async function ready(page, { prefs } = {}) {
  if (prefs) {
    await page.addInitScript((p) => localStorage.setItem('beastty.prefs', p), JSON.stringify(prefs));
  }
  await page.goto('/');
  await page.waitForFunction(
    () => window.__menuBar && typeof window.__menuBar.__getStateForTests === 'function',
  );
  await page.waitForFunction(
    () => window.__prefs && typeof window.__prefs.getPrefs === 'function',
  );
  await page.locator('#terminal-wrapper').focus();
  await expect
    .poll(() => page.evaluate(() => document.activeElement && document.activeElement.id))
    .toBe('terminal-wrapper');
}

test.describe('E3.3 AC-1 — arm on first activation, commit on the second', () => {
  test('first click arms (label swaps, menu STAYS open, focus retained) @fast', async ({ page }) => {
    await ready(page);
    await page.evaluate(() => window.__menuBar.open('settings'));
    await expect(page.locator(RESET_LBL)).toHaveText(IDLE);

    await page.click(RESET);

    // The row's label swaps to the confirm prompt and the menu STAYS OPEN (unlike a
    // normal action row) so the prompt is visible for the second click.
    await expect(page.locator(RESET_LBL)).toHaveText(CONFIRM);
    expect(await page.evaluate(() => window.__menuBar.getOpenMenu())).toBe('settings');
    // retainFocus (AC-6) — arming never stole keyboard focus from the terminal.
    expect(await page.evaluate(() => document.activeElement && document.activeElement.id))
      .toBe('terminal-wrapper');
  });

  test('second click within the window commits resetPrefs() and closes the menu @fast', async ({ page }) => {
    // Seed a non-default pref so a committed reset is observable in getPrefs().
    await ready(page, { prefs: { version: 1, localEcho: true } });
    expect(await page.evaluate(() => window.__prefs.getPrefs().localEcho)).toBe(true);

    await page.evaluate(() => window.__menuBar.open('settings'));
    await page.click(RESET);                       // arm
    await expect(page.locator(RESET_LBL)).toHaveText(CONFIRM);
    await page.click(RESET);                        // commit

    // resetPrefs() ran (prefs back to DEFAULTS) and the menu closed (action semantics).
    expect(await page.evaluate(() => window.__prefs.getPrefs().localEcho)).toBe(false);
    expect(await page.evaluate(() => window.__menuBar.getOpenMenu())).toBe(null);
    // retainFocus held across both activations.
    expect(await page.evaluate(() => document.activeElement && document.activeElement.id))
      .toBe('terminal-wrapper');
  });

  test('the 3s timer elapses with no second click → label reverts, re-arm works @fast', async ({ page }) => {
    // The single real-timeout case (bounds wall-clock — all other disarm paths below
    // avoid waiting by using a close path instead of the timer).
    await ready(page);
    await page.evaluate(() => window.__menuBar.open('settings'));
    await page.click(RESET);
    await expect(page.locator(RESET_LBL)).toHaveText(CONFIRM);

    await page.waitForTimeout(3100);                // let the disarm timer fire
    await expect(page.locator(RESET_LBL)).toHaveText(IDLE);
    // Menu is still open; re-arming works cleanly (idempotent).
    expect(await page.evaluate(() => window.__menuBar.getOpenMenu())).toBe('settings');
    await page.click(RESET);
    await expect(page.locator(RESET_LBL)).toHaveText(CONFIRM);
  });
});

test.describe('E3.3 AC-3 — disarm on EVERY Settings-dropdown-hide path', () => {
  // Each: arm, hide the dropdown WITHOUT a second click, re-open, assert the idle
  // label — so re-opening never shows a stale confirm prompt (and no leaked timer
  // re-labels a closed row).
  test('Esc disarms @fast', async ({ page }) => {
    await ready(page);
    await page.evaluate(() => window.__menuBar.open('settings'));
    await page.click(RESET);
    await expect(page.locator(RESET_LBL)).toHaveText(CONFIRM);

    await page.keyboard.press('Escape');
    expect(await page.evaluate(() => window.__menuBar.getOpenMenu())).toBe(null);
    await page.evaluate(() => window.__menuBar.open('settings'));
    await expect(page.locator(RESET_LBL)).toHaveText(IDLE);
  });

  test('click-away disarms @fast', async ({ page }) => {
    await ready(page);
    await page.evaluate(() => window.__menuBar.open('settings'));
    await page.click(RESET);
    await expect(page.locator(RESET_LBL)).toHaveText(CONFIRM);

    // Click outside the menu bar (the terminal) → document click-away → closeMenu.
    await page.locator('#terminal-wrapper').click();
    expect(await page.evaluate(() => window.__menuBar.getOpenMenu())).toBe(null);
    await page.evaluate(() => window.__menuBar.open('settings'));
    await expect(page.locator(RESET_LBL)).toHaveText(IDLE);
  });

  test('switching to another menu title disarms (toggleMenu bypasses closeMenu) @fast', async ({ page }) => {
    await ready(page);
    await page.evaluate(() => window.__menuBar.open('settings'));
    await page.click(RESET);
    await expect(page.locator(RESET_LBL)).toHaveText(CONFIRM);

    // A real title CLICK routes through toggleMenu, which sets openMenu directly and
    // bypasses closeMenu — the exact path the disarm hook must also cover.
    await page.click('#menu-view');
    expect(await page.evaluate(() => window.__menuBar.getOpenMenu())).toBe('view');
    await page.evaluate(() => window.__menuBar.open('settings'));
    await expect(page.locator(RESET_LBL)).toHaveText(IDLE);
  });

  test('keyboard menu switch disarms (openMenuNamed path) @fast', async ({ page }) => {
    await ready(page);
    await page.evaluate(() => window.__menuBar.open('settings'));
    await page.click(RESET);
    await expect(page.locator(RESET_LBL)).toHaveText(CONFIRM);

    // window.__menuBar.open() IS openMenuNamed — the keyboard ←/→ switch path.
    await page.evaluate(() => window.__menuBar.open('view'));
    await page.evaluate(() => window.__menuBar.open('settings'));
    await expect(page.locator(RESET_LBL)).toHaveText(IDLE);
  });
});

test.describe('E3.3 AC-2 — reset re-projects every prefs-driven menu row', () => {
  test('committed reset restores DEFAULTS and re-projects local-echo / auto-connect / crlf @fast', async ({ page }) => {
    // Seed non-default prefs across the three menu-projected rows.
    await ready(page, { prefs: { version: 1, localEcho: true, autoConnect: true, crlfMode: 'lf' } });

    // The wire-time projection reflects the seed (local-echo + auto-connect checked).
    await expect(page.locator(LOCAL_ECHO)).toHaveAttribute('data-checked', 'true');
    await expect(page.locator(AUTO_CONNECT)).toHaveAttribute('data-checked', 'true');

    // Open Settings + the crlf submenu so its active radio derives from prefs (lf).
    await page.evaluate(() => window.__menuBar.open('settings'));
    await page.click('#dropdown-settings .menu-item[data-submenu="crlf"]');
    await expect(page.locator(crlfRadio('lf'))).toHaveAttribute('data-checked', 'true');

    // Arm + commit the reset from the menu.
    await page.click(RESET);
    await expect(page.locator(RESET_LBL)).toHaveText(CONFIRM);
    await page.click(RESET);

    // getPrefs() is back to DEFAULTS...
    const p = await page.evaluate(() => window.__prefs.getPrefs());
    expect(p.localEcho).toBe(false);
    expect(p.autoConnect).toBe(false);
    expect(p.crlfMode).toBe('cr');
    // ...AND the projectPrefs subscriber re-projected the menu DOM (fired from the
    // menu-triggered reset). local-echo + auto-connect re-project regardless of which
    // menu is open; re-open Settings for the crlf radio.
    await expect(page.locator(LOCAL_ECHO)).toHaveAttribute('data-checked', 'false');
    await expect(page.locator(AUTO_CONNECT)).toHaveAttribute('data-checked', 'false');
    await page.evaluate(() => window.__menuBar.open('settings'));
    await page.click('#dropdown-settings .menu-item[data-submenu="crlf"]');
    await expect(page.locator(crlfRadio('cr'))).toHaveAttribute('data-checked', 'true');
    await expect(page.locator(crlfRadio('lf'))).toHaveAttribute('data-checked', 'false');
  });

  test('committed reset re-projects the two paste rows too @fast', async ({ page }) => {
    // The paste settings ride the same projectPrefs subscriber as the rows above.
    // Seeded non-default so a reset is observable in BOTH radios; pasteSpeed 0 is
    // seeded deliberately, being the value a truthy projector guard would skip.
    await ready(page, { prefs: { version: 2, pasteLineEnding: 'raw', pasteSpeed: 0 } });

    await page.evaluate(() => window.__menuBar.open('settings'));
    await page.click('#dropdown-settings .menu-item[data-submenu="paste-eol"]');
    await expect(page.locator(pasteEolRadio('raw'))).toHaveAttribute('data-checked', 'true');
    await page.click('#dropdown-settings .menu-item[data-submenu="paste-speed"]');
    await expect(page.locator(pasteSpeedRadio('0'))).toHaveAttribute('data-checked', 'true');

    await page.click(RESET);
    await expect(page.locator(RESET_LBL)).toHaveText(CONFIRM);
    await page.click(RESET);

    const p = await page.evaluate(() => window.__prefs.getPrefs());
    expect(p.pasteLineEnding).toBe('cr');
    expect(p.pasteSpeed).toBe(240);
    await page.evaluate(() => window.__menuBar.open('settings'));
    await page.click('#dropdown-settings .menu-item[data-submenu="paste-eol"]');
    await expect(page.locator(pasteEolRadio('cr'))).toHaveAttribute('data-checked', 'true');
    await expect(page.locator(pasteEolRadio('raw'))).toHaveAttribute('data-checked', 'false');
    await page.click('#dropdown-settings .menu-item[data-submenu="paste-speed"]');
    await expect(page.locator(pasteSpeedRadio('240'))).toHaveAttribute('data-checked', 'true');
    await expect(page.locator(pasteSpeedRadio('0'))).toHaveAttribute('data-checked', 'false');
    // applyPrefs is the single writer of the live pump state on the reset path.
    expect(await page.evaluate(() => window.__pastePump.getPasteLineEnding())).toBe('cr');
    expect(await page.evaluate(() => window.__pastePump.getPasteSpeed())).toBe(240);
  });
});
