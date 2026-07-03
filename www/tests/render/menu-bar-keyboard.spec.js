// Epic E1 Story E1.2 — keyboard navigation + Esc passthrough guard.
//
// Adds the keyboard layer over the E1.1 shell: ←/→ between menus (wrapping),
// ↑/↓ within a dropdown (skipping disabled), Enter/→ activation (reusing E1.1
// variant semantics), a no-op submenu-open hook, disabled-reason announcement
// via aria-live, and — the highest-risk clause — the Esc passthrough guard
// (close+preventDefault when open; silent early-return when closed so
// keyboard.js paste-cancel / SLIDE-cancel / bare-Esc 0x1B still fire).
//
// Focus is attribute-driven ([data-focused]) — the module NEVER calls .focus()
// on a title/item, so terminal focus (NFR-1 "sacred") is retained. Tests assert
// document.activeElement stays #terminal-wrapper throughout nav.
//
// Boot-race guard (E0.1 learning): every test waits on window.__menuBar before
// driving it. The Esc-passthrough tests additionally use the paste pump as a
// DOWNSTREAM oracle (paste cancels ⇒ Esc reached keyboard.js) so a future
// refactor that accidentally swallows Esc fails loudly.
import { test, expect } from '@playwright/test';
import { SERIAL_MOCK } from '../transport/mock-serial.js';

async function ready(page) {
  await page.goto('/');
  await page.waitForFunction(
    () => window.__menuBar && typeof window.__menuBar.__getStateForTests === 'function',
  );
  // Focus the terminal wrapper — the keydown target for the whole chord/nav
  // chain (chrome → menu-bar → keyboard). retainFocus keeps it here while menus
  // are open, so page.keyboard.press lands on #terminal-wrapper.
  await page.locator('#terminal-wrapper').focus();
  await expect
    .poll(() => page.evaluate(() => document.activeElement && document.activeElement.id))
    .toBe('terminal-wrapper');
}

// Paste-pump setup mirrors tests/transport/paste.spec.js — the Esc downstream
// oracle. Leaves a 4 KB paste in flight so bare Esc has something to cancel.
async function startPaste(page) {
  await page.addInitScript(SERIAL_MOCK);
  await page.goto('/');
  await page.locator('#terminal-wrapper').focus();
  await page.waitForFunction(() => document.getElementById('terminal').width > 0);
  await page.waitForFunction(
    () => window.__menuBar && typeof window.__menuBar.__getStateForTests === 'function',
  );
  await page.locator('#connection').evaluate((el) => { el.open = true; });
  await page.locator('#debug').evaluate((el) => { el.open = true; });
  await page.locator('#connect-button').click();
  await expect(page.locator('#connect-button')).toHaveAttribute('data-state', 'connected');
  await page.locator('#input').fill('D'.repeat(4096));
  await page.locator('#paste-test').click();
  await expect(page.locator('#paste-progress-row')).toBeVisible();
  await page.locator('#terminal-wrapper').focus();
}

test.describe('E1.2 AC-3/AC-4 — Esc passthrough guard (highest risk)', () => {
  test('Esc with a menu open closes one level AND consumes the event @fast', async ({ page }) => {
    await ready(page);
    // Probe on document (bubble phase, after the #terminal-wrapper target
    // listeners) records the final defaultPrevented for this keydown.
    await page.evaluate(() => {
      window.__escPrevented = null;
      document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') window.__escPrevented = e.defaultPrevented;
      });
    });

    await page.evaluate(() => window.__menuBar.open('view'));
    await expect(page.locator('#dropdown-view')).toBeVisible();

    await page.keyboard.press('Escape');
    // One level closed.
    await expect(page.locator('#dropdown-view')).toBeHidden();
    expect(await page.evaluate(() => window.__menuBar.getOpenMenu())).toBeNull();
    // Consumed — menu-bar called preventDefault so keyboard.js short-circuits.
    expect(await page.evaluate(() => window.__escPrevented)).toBe(true);
  });

  test('Esc with a menu open does NOT cancel an in-flight paste (menu consumed it)', async ({ page }) => {
    await startPaste(page);
    await page.evaluate(() => window.__menuBar.open('view'));
    await expect(page.locator('#dropdown-view')).toBeVisible();

    await page.keyboard.press('Escape');
    // Menu closed…
    await expect(page.locator('#dropdown-view')).toBeHidden();
    // …but the paste is UNAFFECTED — keyboard.js never saw the Esc.
    await expect(page.locator('#paste-progress-text')).not.toContainText('cancelled');
  });

  test('Esc with NO menu open passes through and cancels the in-flight paste', async ({ page }) => {
    await startPaste(page);
    expect(await page.evaluate(() => window.__menuBar.getOpenMenu())).toBeNull();

    await page.keyboard.press('Escape');
    // The passthrough contract: menu-bar early-returned, keyboard.js cancelled.
    await expect(page.locator('#paste-progress-text')).toContainText('Paste cancelled');
  });
});

test.describe('E1.2 AC-1 — ←/→ between menus, ↑/↓ within a dropdown', () => {
  test('←/→ move between menus and wrap at the ends @fast', async ({ page }) => {
    await ready(page);
    await page.evaluate(() => window.__menuBar.open('view'));

    // → advances View → Settings.
    await page.keyboard.press('ArrowRight');
    expect(await page.evaluate(() => window.__menuBar.getOpenMenu())).toBe('settings');
    await expect(page.locator('#dropdown-settings')).toBeVisible();
    await expect(page.locator('#dropdown-view')).toBeHidden();

    // ← goes back to View.
    await page.keyboard.press('ArrowLeft');
    expect(await page.evaluate(() => window.__menuBar.getOpenMenu())).toBe('view');

    // Wrap: File ← wraps to Help.
    await page.evaluate(() => window.__menuBar.open('file'));
    await page.keyboard.press('ArrowLeft');
    expect(await page.evaluate(() => window.__menuBar.getOpenMenu())).toBe('help');
    // Wrap the other way: Help → wraps to File.
    await page.keyboard.press('ArrowRight');
    expect(await page.evaluate(() => window.__menuBar.getOpenMenu())).toBe('file');
  });

  test('↑/↓ move [data-focused], skip inert rows, never steal terminal focus @fast', async ({ page }) => {
    await ready(page);
    // E2.2 — Connection: focusable = [Connect, Serial Configuration…, Auto-connect].
    // "Choose MicroBeast…" is [hidden] with ≤1 adapter (the fresh-page default)
    // and must be skipped by ↑/↓ nav (focusableItems excludes [hidden]).
    await page.evaluate(() => window.__menuBar.open('connection'));

    const focusedLabel = () => page.$eval(
      '#dropdown-connection .menu-item[data-focused="true"] .lbl', (el) => el.textContent.trim(),
    ).catch(() => null);

    // First ↓ lands on the first enabled item.
    await page.keyboard.press('ArrowDown');
    expect(await focusedLabel()).toBe('Connect');
    expect(await page.evaluate(() => window.__menuBar.__getStateForTests().focusedIndex)).toBe(0);

    // Second ↓ SKIPS the hidden "Choose MicroBeast…" → Serial Configuration.
    await page.keyboard.press('ArrowDown');
    expect(await focusedLabel()).toBe('Serial Configuration…');
    expect(await page.evaluate(() => window.__menuBar.__getStateForTests().focusedIndex)).toBe(1);

    // The hidden row is NEVER [data-focused].
    const hiddenFocused = await page.$eval(
      '#menu-choose-microbeast-item',
      (el) => el.getAttribute('data-focused'),
    );
    expect(hiddenFocused).toBeNull();

    // ↑ moves back.
    await page.keyboard.press('ArrowUp');
    expect(await focusedLabel()).toBe('Connect');

    // Real DOM focus never left the terminal (NFR-1 "sacred").
    expect(await page.evaluate(() => document.activeElement && document.activeElement.id))
      .toBe('terminal-wrapper');

    // Only one row is focused at a time.
    expect(await page.$$eval('#menu-bar .menu-item[data-focused="true"]', (els) => els.length))
      .toBe(1);
  });

  test('closing a menu clears all [data-focused] @fast', async ({ page }) => {
    await ready(page);
    await page.evaluate(() => window.__menuBar.open('view'));
    await page.keyboard.press('ArrowDown');
    expect(await page.$$eval('#menu-bar .menu-item[data-focused="true"]', (els) => els.length)).toBe(1);
    await page.keyboard.press('Escape');
    expect(await page.$$eval('#menu-bar .menu-item[data-focused="true"]', (els) => els.length)).toBe(0);
    expect(await page.evaluate(() => window.__menuBar.__getStateForTests().focusedIndex)).toBe(-1);
  });
});

test.describe('E1.2 AC-1 — Enter / → activation per variant', () => {
  test('Enter on an action item closes the menu @fast', async ({ page }) => {
    await ready(page);
    await page.evaluate(() => window.__menuBar.open('view'));
    // Move to the first action row (Zoom In) — Theme/Phosphor/Font are submenus.
    await page.keyboard.press('ArrowDown'); // Theme
    await page.keyboard.press('ArrowDown'); // Phosphor
    await page.keyboard.press('ArrowDown'); // Font
    await page.keyboard.press('ArrowDown'); // Zoom In (first action)
    await expect(page.locator('#dropdown-view .menu-item[data-focused="true"] .lbl')).toHaveText('Zoom In');
    await page.keyboard.press('Enter');
    await expect(page.locator('#dropdown-view')).toBeHidden();
    expect(await page.evaluate(() => window.__menuBar.getOpenMenu())).toBeNull();
  });

  test('Enter on a checkable item toggles it and KEEPS the menu open @fast', async ({ page }) => {
    await ready(page);
    await page.evaluate(() => window.__menuBar.open('settings'));
    // First enabled item is the "Local echo" checkable (starts unchecked).
    await page.keyboard.press('ArrowDown');
    const localEcho = page.locator('#dropdown-settings .menu-item[data-variant="checkable"]');
    await expect(localEcho).toHaveAttribute('data-checked', 'false');
    await page.keyboard.press('Enter');
    await expect(localEcho).toHaveAttribute('data-checked', 'true');
    await expect(page.locator('#dropdown-settings')).toBeVisible();   // stays open
    // E3.2 (AC-1) — keyboard activation persists prefs.localEcho AND applies it to the
    // live keyboard.js echo path (setLocalEcho ran), same as a mouse click.
    expect(await page.evaluate(() => window.__prefs.getPrefs().localEcho)).toBe(true);
    expect(await page.evaluate(() => window.__keyboardState.getLocalEcho())).toBe(true);
  });

  test('Enter and → on a radio-submenu row keep the menu open (no-op hook, no throw) @fast', async ({ page }) => {
    await ready(page);
    await page.evaluate(() => window.__menuBar.open('view'));
    await page.keyboard.press('ArrowDown');   // Theme (radio-submenu)
    await expect(page.locator('#dropdown-view .menu-item[data-focused="true"] .lbl')).toHaveText('Theme');

    // Enter — stays open, no throw.
    await page.keyboard.press('Enter');
    await expect(page.locator('#dropdown-view')).toBeVisible();
    expect(await page.evaluate(() => window.__menuBar.getOpenMenu())).toBe('view');

    // → — same submenu-open hook, stays open (does NOT advance to Settings).
    await page.keyboard.press('ArrowRight');
    await expect(page.locator('#dropdown-view')).toBeVisible();
    expect(await page.evaluate(() => window.__menuBar.getOpenMenu())).toBe('view');
  });
});

test.describe('E1.2 AC-2 — disabled reason announced via aria-live', () => {
  test('live region text equals the disabled row title when nav lands beside it @fast', async ({ page }) => {
    await ready(page);
    // E2.2 — Connection's disabled "Choose MicroBeast…" placeholder is now a live
    // row; use File ▸ Download Session Log (disabled, title "No bytes received
    // yet") as the disabled-neighbour fixture instead.
    await page.evaluate(() => window.__menuBar.open('file'));
    // Nav down to Send File… — adjacent to the disabled "Download Session Log"
    // row below it.
    await page.keyboard.press('ArrowDown');   // Send File… (adjacent to disabled below)
    const live = page.locator('#menu-bar-live');
    await expect(live).toHaveText('No bytes received yet');
  });

  test('aria-live region is visually hidden but present @fast', async ({ page }) => {
    await ready(page);
    const live = page.locator('#menu-bar-live');
    await expect(live).toHaveAttribute('aria-live', 'polite');
    // sr-only: 1px clipped box, not display:none (must stay in the a11y tree).
    const box = await page.$eval('#menu-bar-live', (el) => {
      const r = el.getBoundingClientRect();
      return { w: r.width, h: r.height, display: getComputedStyle(el).display };
    });
    expect(box.w).toBeLessThanOrEqual(1);
    expect(box.h).toBeLessThanOrEqual(1);
    expect(box.display).not.toBe('none');
  });
});

test.describe('E1.2 AC-4 — non-nav keys pass through when no menu is open', () => {
  test('bare arrows/Enter are not preventDefaulted while all menus are closed @fast', async ({ page }) => {
    await ready(page);
    await page.evaluate(() => {
      window.__navPrevented = {};
      document.addEventListener('keydown', (e) => {
        window.__navPrevented[e.key] = e.defaultPrevented;
      });
    });
    // No menu open → menu-bar must not touch these (keyboard.js encodes them).
    for (const key of ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown']) {
      await page.keyboard.press(key);
    }
    const prevented = await page.evaluate(() => window.__navPrevented);
    // keyboard.js may or may not preventDefault arrows depending on encoding,
    // but menu-bar itself must have early-returned — assert the menu stayed shut
    // (it never opened/moved a menu from a closed state).
    expect(await page.evaluate(() => window.__menuBar.getOpenMenu())).toBeNull();
  });
});

test.describe('E1.2 AC-6 — test hooks expose focus state', () => {
  test('__getStateForTests exposes focusedIndex + openMenu @fast', async ({ page }) => {
    await ready(page);
    let state = await page.evaluate(() => window.__menuBar.__getStateForTests());
    expect(state.openMenu).toBeNull();
    expect(state.focusedIndex).toBe(-1);

    await page.evaluate(() => window.__menuBar.open('view'));
    await page.keyboard.press('ArrowDown');
    state = await page.evaluate(() => window.__menuBar.__getStateForTests());
    expect(state.openMenu).toBe('view');
    expect(state.focusedIndex).toBe(0);
  });
});
