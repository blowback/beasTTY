// Settings ▸ Paste settings… — the Paste settings modal.
//
// A RELOCATION story. The three paste settings (line ending, chunk size, pause) and
// their throughput readout were radio submenus under Settings; they moved into
// #paste-config-modal, on the same openModal rails as #serial-config-modal /
// #slide-config-modal. Same values, same persist ≠ apply contract, same
// project-from-the-pump rule — only the home and the control type changed.
//
// The submenu cases that lived in tests/render/menu-bar-settings.spec.js are
// re-derived here: the defaults, each control applying AND persisting, the derived
// throughput and its flow-control state, focus retention, and reset.
//
// Idioms (E1/E2 retros): boot-race guard on window.__*; window.__menuBar.open for a
// deterministic dropdown open; menu-driven open → data-action dispatch; focus
// asserted via document.activeElement.id.
import { test, expect } from '@playwright/test';
import { SERIAL_MOCK } from '../transport/mock-serial.js';
import {
  PASTE_MODAL, PASTE_MENU_ITEM,
  PASTE_EOL_SELECT, PASTE_CHUNK_SELECT, PASTE_PAUSE_SELECT, PASTE_THROUGHPUT,
  openPasteSettings, closePasteSettings,
} from '../paste-settings.js';

async function ready(page, { prefs, serialMock } = {}) {
  if (serialMock) await page.addInitScript(SERIAL_MOCK);
  if (prefs) {
    await page.addInitScript(
      (blob) => localStorage.setItem('beastty.prefs', blob), JSON.stringify(prefs));
  }
  await page.goto('/');
  await page.waitForFunction(
    () => window.__menuBar && typeof window.__menuBar.__getStateForTests === 'function'
          && typeof window.__modal === 'object' && window.__modal !== null);
  // window.__pastePump is assigned LATE in main.js — every case here reads it.
  await page.waitForFunction(
    () => window.__pastePump && typeof window.__pastePump.getPasteChunk === 'function');
  await page.locator('#terminal-wrapper').focus();
  await page.waitForFunction(() => document.getElementById('terminal').width > 0);
}

const dialog = (page) => page.locator(PASTE_MODAL);

test.describe('Paste settings — opens from the Settings menu, closes, restores focus', () => {
  test('the Settings row opens the modal and closes the dropdown @fast', async ({ page }) => {
    await ready(page);
    await expect(page.locator(`${PASTE_MENU_ITEM} .lbl`)).toHaveText('Paste settings…');
    await openPasteSettings(page);
    await expect(dialog(page)).toBeVisible();
    expect(await page.evaluate(() => window.__menuBar.getOpenMenu())).toBe(null);
    expect(await page.evaluate(() => window.__modal.__getStateForTests().openDialogId))
      .toBe('paste-config-modal');
  });

  test('the three retired submenus are gone from the Settings dropdown @fast', async ({ page }) => {
    // The menu bar holds ONE open submenu panel at a time, so Settings ▸ Paste ▸ CR
    // would have needed a third level. The rows left; nothing may be left behind
    // that could still tick a value nobody projects any more.
    await ready(page);
    await page.evaluate(() => window.__menuBar.open('settings'));
    for (const panel of ['paste-eol', 'paste-chunk', 'paste-pause']) {
      expect(await page.locator(`#dropdown-settings [data-submenu="${panel}"]`).count()).toBe(0);
      expect(await page.locator(`#dropdown-settings [data-submenu-panel="${panel}"]`).count()).toBe(0);
    }
    expect(await page.locator('#menu-paste-throughput-item').count()).toBe(0);
    // Every OTHER radio submenu is untouched.
    for (const panel of ['crlf', 'cmdhistory-size']) {
      expect(await page.locator(`#dropdown-settings [data-submenu-panel="${panel}"]`).count()).toBe(1);
    }
    for (const panel of ['theme', 'phosphor', 'font']) {
      expect(await page.locator(`#dropdown-view [data-submenu-panel="${panel}"]`).count()).toBe(1);
    }
  });

  test('header title is verbatim "Paste settings" @fast', async ({ page }) => {
    await ready(page);
    await openPasteSettings(page);
    await expect(page.locator('#paste-config-modal-title')).toHaveText('Paste settings');
  });

  test('Close returns focus to #terminal-wrapper (restoreTo) @fast', async ({ page }) => {
    await ready(page);
    await openPasteSettings(page);
    await page.click('#paste-config-close');
    await expect(dialog(page)).toBeHidden();
    expect(await page.evaluate(() => document.activeElement && document.activeElement.id))
      .toBe('terminal-wrapper');
  });

  test('Esc closes and returns focus to #terminal-wrapper @fast', async ({ page }) => {
    await ready(page);
    await openPasteSettings(page);
    await page.keyboard.press('Escape');
    await expect(dialog(page)).toBeHidden();
    expect(await page.evaluate(() => document.activeElement && document.activeElement.id))
      .toBe('terminal-wrapper');
  });

  test('initial focus lands on the first control, with the visible focus border @fast', async ({ page }) => {
    await ready(page);
    await openPasteSettings(page);
    expect(await page.evaluate(() => document.activeElement && document.activeElement.id))
      .toBe('paste-line-ending-select');
    await expect(page.locator(PASTE_EOL_SELECT)).toHaveAttribute('data-focused', 'true');
  });
});

test.describe('Paste settings — the rows, and what they default to', () => {
  test('all three controls, the readout, and a ⓘ on every row @fast', async ({ page }) => {
    await ready(page);
    await openPasteSettings(page);
    // Aligned rows: a label on the left, the control on the right, one setting per
    // row (the key-screen-chrome.html look the other chrome modals share).
    await expect(dialog(page).locator('label[for="paste-line-ending-select"]')).toHaveText('Line ending');
    await expect(dialog(page).locator('label[for="paste-chunk-select"]')).toHaveText('Chunk size');
    await expect(dialog(page).locator('label[for="paste-pause-select"]')).toHaveText('Pause');
    // The verbose hardware explanations live in ⓘ tooltips, not in the body.
    expect(await dialog(page).locator('.field .field-info').count()).toBe(4);
    expect(await dialog(page).locator('.field .field-tip').count()).toBe(4);

    // Defaults — the measured hardware working point: CR, 1 byte every 200 ms.
    await expect(page.locator(PASTE_EOL_SELECT)).toHaveValue('cr');
    await expect(page.locator(PASTE_CHUNK_SELECT)).toHaveValue('1');
    await expect(page.locator(PASTE_PAUSE_SELECT)).toHaveValue('200');
    await expect(page.locator(PASTE_THROUGHPUT)).toHaveText('≈ 5 B/s');
  });

  test('chunk sizes are BYTES and pauses are MILLISECONDS, never a rate @fast', async ({ page }) => {
    await ready(page);
    await openPasteSettings(page);
    const chunkLabels = await page.locator(`${PASTE_CHUNK_SELECT} option`)
      .evaluateAll((els) => els.map((e) => [e.value, e.textContent]));
    expect(chunkLabels).toEqual([
      ['1', '1 byte'], ['2', '2 bytes'], ['4', '4 bytes'],
      ['8', '8 bytes'], ['16', '16 bytes'], ['32', '32 bytes'],
    ]);
    const pauseLabels = await page.locator(`${PASTE_PAUSE_SELECT} option`)
      .evaluateAll((els) => els.map((e) => [e.value, e.textContent]));
    // 150 ms — ≈ 6.7 B/s — joined the set after the ~800 B block was timed on real
    // hardware: 59 s over RTS/CTS against 148 s at the configured 5 B/s. It is the
    // gap between the 10 B/s that nearly worked and the 5 B/s that did.
    expect(pauseLabels).toEqual([
      ['0', 'None (wire speed)'], ['5', '5 ms'], ['10', '10 ms'], ['20', '20 ms'],
      ['50', '50 ms'], ['100', '100 ms'], ['150', '150 ms'], ['200', '200 ms'],
    ]);
  });

  test('line endings offer the four modes the pump accepts @fast', async ({ page }) => {
    await ready(page);
    await openPasteSettings(page);
    const opts = await page.locator(`${PASTE_EOL_SELECT} option`)
      .evaluateAll((els) => els.map((e) => [e.value, e.textContent]));
    expect(opts).toEqual([
      ['cr', 'CR (0x0D)'], ['lf', 'LF (0x0A)'],
      ['crlf', 'CRLF (0x0D 0x0A)'], ['raw', 'As-is (no change)'],
    ]);
  });
});

test.describe('Paste settings — persist ≠ apply', () => {
  for (const value of ['lf', 'crlf', 'raw']) {
    test(`line ending ${value} persists AND applies to the pump @fast`, async ({ page }) => {
      await ready(page);
      await openPasteSettings(page);
      await page.locator(PASTE_EOL_SELECT).selectOption(value);
      expect(await page.evaluate(() => window.__prefs.getPrefs().pasteLineEnding)).toBe(value);
      expect(await page.evaluate(() => window.__pastePump.getPasteLineEnding())).toBe(value);
      // Settings ▸ Enter key sends is untouched by any of it — separate settings.
      expect(await page.evaluate(() => window.__keyboardState.getCrlfMode())).toBe('cr');
      await closePasteSettings(page);
    });
  }

  for (const { value, chunk, throughput } of [
    { value: '1', chunk: 1, throughput: 5 },
    { value: '8', chunk: 8, throughput: 40 },
    { value: '32', chunk: 32, throughput: 160 },
  ]) {
    test(`chunk ${value} persists AND re-paces the pump @fast`, async ({ page }) => {
      await ready(page);
      await openPasteSettings(page);
      await page.locator(PASTE_CHUNK_SELECT).selectOption(value);
      expect(await page.evaluate(() => window.__prefs.getPrefs().pasteChunk)).toBe(chunk);
      expect(await page.evaluate(() => window.__pastePump.getPasteChunk())).toBe(chunk);
      expect(await page.evaluate(() => window.__pastePump.__getStateForTests()))
        .toMatchObject({ chunkSize: chunk, pauseMs: 200, throughput });
      await closePasteSettings(page);
    });
  }

  // 0 ("None") is included deliberately: it is a legal value, not the falsy "unset"
  // a `> 0` guard would reject. 150 is the new one.
  for (const { value, pauseMs, throughput } of [
    { value: '0', pauseMs: 0, throughput: null },
    { value: '5', pauseMs: 5, throughput: 200 },
    { value: '150', pauseMs: 150, throughput: 7 },
    { value: '20', pauseMs: 20, throughput: 50 },
  ]) {
    test(`pause ${value} ms persists AND re-paces the pump @fast`, async ({ page }) => {
      await ready(page);
      await openPasteSettings(page);
      await page.locator(PASTE_PAUSE_SELECT).selectOption(value);
      expect(await page.evaluate(() => window.__prefs.getPrefs().pastePauseMs)).toBe(pauseMs);
      expect(await page.evaluate(() => window.__pastePump.getPastePauseMs())).toBe(pauseMs);
      expect(await page.evaluate(() => window.__pastePump.__getStateForTests()))
        .toMatchObject({ chunkSize: 1, pauseMs, throughput });
      await closePasteSettings(page);
    });
  }

  test('a value picked in the modal survives a reload and the modal reopens showing it @fast', async ({ page }) => {
    await ready(page);
    await openPasteSettings(page);
    await page.locator(PASTE_CHUNK_SELECT).selectOption('16');
    await page.locator(PASTE_PAUSE_SELECT).selectOption('150');
    await page.locator(PASTE_EOL_SELECT).selectOption('crlf');
    await closePasteSettings(page);
    await page.waitForTimeout(300);   // > the 250 ms savePrefs debounce
    await page.reload();
    await ready(page);
    await openPasteSettings(page);
    await expect(page.locator(PASTE_CHUNK_SELECT)).toHaveValue('16');
    await expect(page.locator(PASTE_PAUSE_SELECT)).toHaveValue('150');
    await expect(page.locator(PASTE_EOL_SELECT)).toHaveValue('crlf');
    // 16 B every 150 ms is 106.67 B/s.
    await expect(page.locator(PASTE_THROUGHPUT)).toHaveText('≈ 107 B/s');
    await closePasteSettings(page);
  });
});

test.describe('Paste settings — throughput is shown, never set', () => {
  test('the readout follows both controls and has no control of its own @fast', async ({ page }) => {
    await ready(page);
    await openPasteSettings(page);
    await expect(page.locator(PASTE_THROUGHPUT)).toHaveText('≈ 5 B/s');      // 1 B / 200 ms
    await page.locator(PASTE_CHUNK_SELECT).selectOption('8');
    await expect(page.locator(PASTE_THROUGHPUT)).toHaveText('≈ 40 B/s');     // 8 B / 200 ms
    await page.locator(PASTE_PAUSE_SELECT).selectOption('100');
    await expect(page.locator(PASTE_THROUGHPUT)).toHaveText('≈ 80 B/s');     // 8 B / 100 ms
    // With no pause there is no pacing limit at all, and the pump does not know what
    // the wire carries — so it says so rather than inventing a number.
    await page.locator(PASTE_PAUSE_SELECT).selectOption('0');
    await expect(page.locator(PASTE_THROUGHPUT)).toHaveText('wire speed');
    // It is a readout: no input, no select, nothing focusable in the row.
    expect(await dialog(page).locator(`${PASTE_THROUGHPUT}`).evaluate((el) => el.tagName)).toBe('SPAN');
    await closePasteSettings(page);
  });

  test('a handshaking port makes the readout say pacing is off, and why @fast', async ({ page }) => {
    // The readout's third state, and the reason it exists. On a port opened with
    // hardware flow control the pump does not pace AT ALL — the receiver handshakes
    // per byte, which beats any fixed cadence — so the two rows above are simply not
    // in force. They keep their values, because they are still the user's settings
    // and they apply again the moment a bare port is opened; without this line the
    // modal would show a pause the next paste is going to ignore.
    await ready(page, {
      serialMock: true,
      prefs: {
        version: 2,
        serial: { baud: 19200, dataBits: 8, stopBits: 1, parity: 'none', flowControl: 'hardware' },
      },
    });
    // Before connecting, nothing is known about the port and the rows are in force.
    await openPasteSettings(page);
    await expect(page.locator(PASTE_THROUGHPUT)).toHaveText('≈ 5 B/s');
    await closePasteSettings(page);

    await page.evaluate(() => window.__menuBar.open('connection'));
    await page.click('#menu-connect-item');
    await expect(page.locator('#menu-connect-item')).toHaveAttribute('data-state', 'connected');

    await openPasteSettings(page);
    await expect(page.locator(PASTE_THROUGHPUT)).toHaveText('wire speed (flow control)');
    // The controls themselves are untouched — still set to what the user chose.
    await expect(page.locator(PASTE_CHUNK_SELECT)).toHaveValue('1');
    await expect(page.locator(PASTE_PAUSE_SELECT)).toHaveValue('200');
    await closePasteSettings(page);

    // Disconnect and the readout goes back to the derived figure — the projection
    // is taken fresh on each open, from the PUMP, so nothing stale can survive it.
    await page.evaluate(() => window.__menuBar.open('connection'));
    await page.click('#menu-connect-item');
    await expect(page.locator('#menu-connect-item')).toHaveAttribute('data-state', 'disconnected');
    await openPasteSettings(page);
    await expect(page.locator(PASTE_THROUGHPUT)).toHaveText('≈ 5 B/s');
    await closePasteSettings(page);
  });
});
