// Epic E1 Story E1.3 (AC-3) — boot order & chord-priority regression pin.
//
// The AD-12 boot order is load-bearing: main.js wires the three
// #terminal-wrapper keydown listeners in the order chrome → menu-bar →
// keyboard, and each short-circuits on e.defaultPrevented. So chrome.js's
// theme/zoom chords are claimed FIRST and menu-bar's keyboard-nav layer can
// never swallow them. main.js also runs the polite-fail gate BEFORE wasm init
// (throw '__polite-fail__'), so a non-Chromium browser never loads the core.
//
// This story RELOCATES the two Clear handlers out of chrome.js and stands up a
// prefs re-projection seam in menu-bar.js — neither may disturb the ordering.
// These specs are a REGRESSION PIN: they pass today (the order is already
// correct) and are here so that a future reorder — or a menu-bar handler that
// starts consuming chords — fails loudly. [Source: main.js:19-22,239,259,450;
// chrome.js:167-205; ARCHITECTURE-SPINE.md#AD-12/#AD-13; FR-30/NFR-8]
import { test, expect } from '@playwright/test';

async function ready(page) {
  await page.goto('/');
  // Boot-race guard (E0.1/E1.1 pattern): wait for the menu-bar API AND the
  // canvas so the chord/nav chain is fully wired before we drive it.
  await page.waitForFunction(
    () => window.__menuBar && typeof window.__menuBar.__getStateForTests === 'function',
  );
  await page.waitForFunction(() => document.getElementById('terminal').width > 0);
  await page.locator('#terminal-wrapper').focus();
}

function cssWidth(page) {
  return page.evaluate(() => parseFloat(document.getElementById('terminal').style.width));
}

test.describe('E1.3 AC-3 — chords reach chrome.js first (menu-bar never swallows them)', () => {
  test('with all menus closed, Ctrl+Alt+T still toggles theme @fast', async ({ page }) => {
    await ready(page);
    expect(await page.evaluate(() => window.__menuBar.getOpenMenu())).toBeNull();
    await expect(page.locator('body')).toHaveAttribute('data-theme', 'crt');

    await page.keyboard.press('Control+Alt+KeyT');
    await expect(page.locator('body')).toHaveAttribute('data-theme', 'clean');
  });

  test('with all menus closed, Ctrl+= still zooms @fast', async ({ page }) => {
    await ready(page);
    expect(await page.evaluate(() => window.__menuBar.getOpenMenu())).toBeNull();
    const base = await cssWidth(page);

    await page.keyboard.press('Control+Equal');
    await page.waitForTimeout(60);
    expect(await cssWidth(page)).toBe(base * 2);
  });

  test('a chord wins even while a menu is OPEN — chrome.js claims it first @fast', async ({ page }) => {
    // The strongest ordering proof: open a menu, fire the theme chord. chrome.js
    // is attached ahead of menu-bar, so it preventDefaults and toggles the theme;
    // menu-bar's onMenuKeydown then sees defaultPrevented (and, defensively, lets
    // any modified chord through). A reorder that put menu-bar first would let a
    // future nav branch eat the chord — this test would then fail.
    await ready(page);
    await page.evaluate(() => window.__menuBar.open('view'));
    await expect(page.locator('#dropdown-view')).toBeVisible();
    await expect(page.locator('body')).toHaveAttribute('data-theme', 'crt');

    await page.keyboard.press('Control+Alt+KeyT');
    await expect(page.locator('body')).toHaveAttribute('data-theme', 'clean');
  });
});

// AC-3 (b) — polite-fail aborts BEFORE wasm (FR-30). Mirrors polite-fail.spec.js
// setup; asserted here too so the boot-order pin covers the whole gate, not just
// the chord chain. If a refactor moved the gate after init(), wasm would load and
// the Terminal global would appear — this fails loudly.
test.describe('E1.3 AC-3 — polite-fail gate runs first, before wasm', () => {
  async function politeFail(page) {
    page.on('pageerror', (err) => {
      if (err.message.includes('__polite-fail__')) return;   // expected abort
      throw err;
    });
    await page.addInitScript(() => {
      try {
        Object.defineProperty(Navigator.prototype, 'serial', { configurable: true, get: () => undefined });
      } catch (e) {
        Object.defineProperty(navigator, 'serial', { configurable: true, get: () => undefined });
      }
    });
    await page.goto('/');
  }

  test('navigator.serial undefined → polite-fail body and no wasm/menu-bar @fast', async ({ page }) => {
    await politeFail(page);
    await expect(page.locator('body.polite-fail')).toBeVisible();
    // wasm never initialised (boot aborted first) → no Terminal global, no menu bar.
    expect(await page.evaluate(() => typeof window.Terminal !== 'undefined')).toBe(false);
    expect(await page.evaluate(() => typeof window.__menuBar !== 'undefined')).toBe(false);
  });
});
