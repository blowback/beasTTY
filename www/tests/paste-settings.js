// Shared helpers — drive the Paste settings modal.
//
// The three paste settings (line ending, chunk size, pause) were radio submenus
// under Settings until the paste-text-loss change grouped them into
// #paste-config-modal. Every spec that used to click
// `.submenu[data-submenu-panel="paste-eol"] .menu-item[data-value="…"]` now goes
// through here instead, so the modal's path is stated in ONE place (the
// tests/transport/mock-serial.js + menu-helpers.js cross-import precedent).
//
// Each setter opens the modal from the real Settings-menu row, picks the value on
// the select (which fires `change` → apply to the pump + persist), and closes via
// the Close button — so focus round-trips back to #terminal-wrapper the way it does
// for a user, which the specs that go on to press keys depend on.

export const PASTE_MODAL = '#paste-config-modal';
export const PASTE_MENU_ITEM = '#menu-paste-config-item';
export const PASTE_EOL_SELECT = '#paste-line-ending-select';
export const PASTE_CHUNK_SELECT = '#paste-chunk-select';
export const PASTE_PAUSE_SELECT = '#paste-pause-select';
export const PASTE_THROUGHPUT = '#paste-throughput-value';

// Open via the real menu path (open Settings → activate the row), so the projection
// that runs on open is exercised rather than bypassed.
export async function openPasteSettings(page) {
    await page.evaluate(() => window.__menuBar.open('settings'));
    await page.click(PASTE_MENU_ITEM);
    await page.waitForFunction(
        () => document.getElementById('paste-config-modal')?.open === true);
}

export async function closePasteSettings(page) {
    await page.click('#paste-config-close');
    await page.waitForFunction(
        () => document.getElementById('paste-config-modal')?.open !== true);
}

async function pick(page, selector, value) {
    await openPasteSettings(page);
    await page.locator(selector).selectOption(String(value));
    await closePasteSettings(page);
}

export const setPasteEol = (page, v) => pick(page, PASTE_EOL_SELECT, v);
export const setPasteChunk = (page, v) => pick(page, PASTE_CHUNK_SELECT, v);
export const setPastePause = (page, v) => pick(page, PASTE_PAUSE_SELECT, v);
