// Epic E1 Story E1.4 — View ▸ Theme & Phosphor (radio-submenu mechanic).
//
// The NEW E1.4 slice on top of the retargeted incumbent oracles
// (theme-toggle.spec.js / phosphor.spec.js): the first real radio submenu
// (panels + open/close + keyboard + retainFocus), the neutral-shell guarantee
// (chrome byte-identical across Console↔CRT), Phosphor shown-but-disabled +
// announced off-CRT (AD-9), live mid-menu enable/disable (AC-3), the filled
// projectPrefs reset re-projection (AC-4), and the rehomed side-effects
// (#font-row gate, D-19 selection-clear).
//
// Boot-race guard (E0.1 learning): wait on window.__menuBar before driving it.
import { test, expect } from '@playwright/test';

const THEME = '#dropdown-view .submenu[data-submenu-panel="theme"]';
const PHOS  = '#dropdown-view .submenu[data-submenu-panel="phosphor"]';
const PHOS_PARENT = '#dropdown-view .menu-item[data-submenu="phosphor"]';

async function ready(page) {
  await page.goto('/');
  await page.waitForFunction(
    () => window.__menuBar && typeof window.__menuBar.__getStateForTests === 'function',
  );
  await page.locator('#terminal-wrapper').focus();
}

async function selectTheme(page, value) {
  await page.evaluate(() => window.__menuBar.open('view'));
  await page.click('#dropdown-view .menu-item[data-submenu="theme"]');
  await page.click(`${THEME} .menu-item[data-value="${value}"]`);
}

test.describe('E1.4 AC-1 — neutral shell: chrome byte-identical across Console↔CRT', () => {
  test('menu bar + open dropdown + open submenu render identically in both themes @fast', async ({ page }) => {
    await ready(page);

    // Capture chrome surfaces in CRT (default).
    await page.evaluate(() => window.__menuBar.open('view'));
    await page.click('#dropdown-view .menu-item[data-submenu="theme"]');
    const crt = await page.evaluate(() => ({
      bar: getComputedStyle(document.getElementById('menu-bar')).backgroundColor,
      dropdown: getComputedStyle(document.getElementById('dropdown-view')).backgroundColor,
      submenu: getComputedStyle(document.querySelector('.submenu[data-submenu-panel="theme"]')).backgroundColor,
    }));

    // Flip to Console via the chord (focus is on #terminal-wrapper).
    await page.keyboard.press('Control+Alt+KeyT');
    await expect(page.locator('body')).toHaveAttribute('data-theme', 'clean');

    await page.evaluate(() => window.__menuBar.open('view'));
    await page.click('#dropdown-view .menu-item[data-submenu="theme"]');
    const clean = await page.evaluate(() => ({
      bar: getComputedStyle(document.getElementById('menu-bar')).backgroundColor,
      dropdown: getComputedStyle(document.getElementById('dropdown-view')).backgroundColor,
      submenu: getComputedStyle(document.querySelector('.submenu[data-submenu-panel="theme"]')).backgroundColor,
    }));

    expect(clean.bar).toBe(crt.bar);
    expect(clean.dropdown).toBe(crt.dropdown);
    expect(clean.submenu).toBe(crt.submenu);
    // And they are the pinned neutral --chrome-bg (#1e242c), not a theme colour.
    expect(crt.submenu).toBe('rgb(30, 36, 44)');
  });
});

test.describe('E1.4 AC-2/AC-3 — Phosphor CRT-gating (disabled, announced, live)', () => {
  test('Console theme: Phosphor announced disabled + not enterable in keyboard nav @fast', async ({ page }) => {
    await ready(page);
    await selectTheme(page, 'clean');   // disables Phosphor

    // Re-open View and step onto the first row; Phosphor is the disabled
    // neighbour, so #menu-bar-live announces its reason.
    await page.evaluate(() => window.__menuBar.open('view'));
    await page.keyboard.press('ArrowDown');   // land on Theme (first focusable)
    await expect(page.locator('#menu-bar-live')).toHaveText('Phosphor — CRT theme only');

    // ↓ again SKIPS the disabled Phosphor AND the disabled Font (E1.5 — Font is
    // also CRT-gated per AD-9) and lands on Zoom In (not enterable).
    await page.keyboard.press('ArrowDown');
    const st = await page.evaluate(() => window.__menuBar.__getStateForTests());
    expect(st.focusedLabel).toBe('Zoom In');
    expect(st.openSubmenu).toBeNull();   // never entered the Phosphor submenu
  });

  test('clicking the disabled Phosphor parent is inert (submenu never opens) @fast', async ({ page }) => {
    await ready(page);
    await selectTheme(page, 'clean');
    await page.evaluate(() => window.__menuBar.open('view'));
    await page.click(PHOS_PARENT, { force: true });   // aria-disabled — force the physical click
    expect(await page.evaluate(() => window.__menuBar.__getStateForTests().openSubmenu)).toBeNull();
    await expect(page.locator(PHOS)).toBeHidden();
  });

  test('mid-menu Theme→CRT re-enables Phosphor live (no reload) @fast', async ({ page }) => {
    await ready(page);
    await selectTheme(page, 'clean');
    await page.evaluate(() => window.__menuBar.open('view'));
    await expect(page.locator(PHOS_PARENT)).toHaveAttribute('data-disabled', 'true');

    // Switch back to CRT inside the SAME open menu — Phosphor becomes live.
    await page.click('#dropdown-view .menu-item[data-submenu="theme"]');
    await page.click(`${THEME} .menu-item[data-value="crt"]`);
    await expect(page.locator(PHOS_PARENT)).not.toHaveAttribute('data-disabled', 'true');
    await expect(page.locator(PHOS_PARENT)).not.toHaveAttribute('aria-disabled', 'true');
  });

  test('Ctrl+Alt+T while menu closed → opening View shows Phosphor disabled (read-at-use) @fast', async ({ page }) => {
    await ready(page);   // focuses #terminal-wrapper for the chord
    // Chord to Console while the View menu is CLOSED — no chrome→menu notify edge.
    await page.keyboard.press('Control+Alt+KeyT');
    await expect(page.locator('body')).toHaveAttribute('data-theme', 'clean');

    // Opening View re-derives state from getPrefs() (updated synchronously by the
    // chord's savePrefs) — Phosphor disabled + Theme=clean checked, no reload.
    await page.evaluate(() => window.__menuBar.open('view'));
    await expect(page.locator(PHOS_PARENT)).toHaveAttribute('data-disabled', 'true');
    await expect(page.locator(`${THEME} .menu-item[data-value="clean"]`)).toHaveAttribute('aria-checked', 'true');
  });

  test('Ctrl+Alt+T while menu OPEN re-projects live (theme ✓ moves, Phosphor disables) @fast', async ({ page }) => {
    await ready(page);   // focuses #terminal-wrapper for the chord
    // Open View FIRST, then fire the chord. retainFocus keeps #terminal-wrapper
    // focused, so the chord still reaches chrome.js. savePrefs does not notify
    // subscribers, so the open menu must be re-projected by the shared
    // onThemeChange post-theme hook — else it goes stale (regression guard).
    await page.evaluate(() => window.__menuBar.open('view'));
    await expect(page.locator(`${THEME} .menu-item[data-value="crt"]`)).toHaveAttribute('aria-checked', 'true');
    await expect(page.locator(PHOS_PARENT)).not.toHaveAttribute('data-disabled', 'true');

    await page.keyboard.press('Control+Alt+KeyT');
    await expect(page.locator('body')).toHaveAttribute('data-theme', 'clean');

    // The STILL-OPEN menu reflects the new theme without a reopen: ✓ moved to
    // Console, CRT unchecked, and the Phosphor parent is now shown-but-disabled.
    await expect(page.locator(`${THEME} .menu-item[data-value="clean"]`)).toHaveAttribute('aria-checked', 'true');
    await expect(page.locator(`${THEME} .menu-item[data-value="crt"]`)).toHaveAttribute('aria-checked', 'false');
    await expect(page.locator(PHOS_PARENT)).toHaveAttribute('data-disabled', 'true');
    await expect(page.locator(PHOS_PARENT)).toHaveAttribute('aria-disabled', 'true');
  });

  test('picking Console while the Phosphor submenu is open collapses + disables it @fast', async ({ page }) => {
    await ready(page);
    // Open the Phosphor submenu under CRT.
    await page.evaluate(() => window.__menuBar.open('view'));
    await page.click(PHOS_PARENT);
    await expect(page.locator(PHOS)).toBeVisible();
    // Now pick Console via the Theme submenu — Phosphor submenu must collapse.
    await page.click('#dropdown-view .menu-item[data-submenu="theme"]');
    await page.click(`${THEME} .menu-item[data-value="clean"]`);
    await expect(page.locator(PHOS)).toBeHidden();
    await expect(page.locator(PHOS_PARENT)).toHaveAttribute('data-disabled', 'true');
  });
});

test.describe('E1.4 AC-4 — projectPrefs re-projects theme + phosphor + disabled on reset', () => {
  test('resetPrefs() re-projects the View menu to defaults (CRT / Green / enabled) @fast', async ({ page }) => {
    await ready(page);
    // Move away from defaults via the menu (Console + Amber would be disabled, so
    // set Amber first under CRT, then Console).
    await page.evaluate(() => window.__menuBar.open('view'));
    await page.click(PHOS_PARENT);
    await page.click(`${PHOS} .menu-item[data-value="amber"]`);
    await selectTheme(page, 'clean');
    await expect(page.locator(PHOS_PARENT)).toHaveAttribute('data-disabled', 'true');

    // Reset — projectPrefs re-projects theme=crt, phosphor=green, Phosphor enabled.
    await page.evaluate(() => window.__prefs.resetPrefs());
    await page.evaluate(() => window.__menuBar.open('view'));
    await expect(page.locator(`${THEME} .menu-item[data-value="crt"]`)).toHaveAttribute('aria-checked', 'true');
    await expect(page.locator(`${PHOS} .menu-item[data-value="green"]`)).toHaveAttribute('aria-checked', 'true');
    await expect(page.locator(PHOS_PARENT)).not.toHaveAttribute('data-disabled', 'true');
  });

  test('projectPrefs is idempotent with real theme/phosphor state @fast', async ({ page }) => {
    await ready(page);
    await page.evaluate(() => window.__menuBar.open('view'));
    const result = await page.evaluate(() => {
      const view = document.getElementById('dropdown-view');
      window.__menuBar.projectPrefs(window.__prefs.getPrefs());
      const once = view.innerHTML;
      window.__menuBar.projectPrefs(window.__prefs.getPrefs());
      return { changed: view.innerHTML !== once };
    });
    expect(result.changed).toBe(false);
  });
});

test.describe('E1.4 AC-6 — submenu keyboard + focus mechanic', () => {
  test('Enter opens, ↑/↓ navigate, ← collapses; terminal focus retained throughout @fast', async ({ page }) => {
    await ready(page);
    await page.evaluate(() => window.__menuBar.open('view'));

    // ↓ to Theme parent, Enter opens its submenu with focus on the active (CRT) radio.
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('Enter');
    let st = await page.evaluate(() => window.__menuBar.__getStateForTests());
    expect(st.openSubmenu).toBe('theme');
    expect(st.submenuFocusLabel).toBe('CRT');
    // retainFocus (D-16/AD-10) — terminal focus never stolen.
    expect(await page.evaluate(() => document.activeElement.id)).toBe('terminal-wrapper');

    // ↑ moves to the sibling radio (wraps to Console (Clean)).
    await page.keyboard.press('ArrowUp');
    st = await page.evaluate(() => window.__menuBar.__getStateForTests());
    expect(st.submenuFocusLabel).toBe('Console (Clean)');
    expect(await page.evaluate(() => document.activeElement.id)).toBe('terminal-wrapper');

    // ← collapses back to the parent level (submenu closed, menu still open).
    await page.keyboard.press('ArrowLeft');
    st = await page.evaluate(() => window.__menuBar.__getStateForTests());
    expect(st.openSubmenu).toBeNull();
    expect(st.openMenu).toBe('view');
  });

  test('→ opens the submenu and Enter selects (applies theme) @fast', async ({ page }) => {
    await ready(page);
    await page.evaluate(() => window.__menuBar.open('view'));
    await page.keyboard.press('ArrowDown');    // Theme parent
    await page.keyboard.press('ArrowRight');   // open submenu (focus on active CRT)
    await page.keyboard.press('ArrowDown');    // move to Console (Clean)
    await page.keyboard.press('Enter');        // select
    await expect(page.locator('body')).toHaveAttribute('data-theme', 'clean');
  });

  test('Esc with a submenu open collapses ONE level and does NOT reach the terminal @fast', async ({ page }) => {
    await ready(page);
    // Probe the final defaultPrevented for the Escape keydown (bubble phase).
    await page.evaluate(() => {
      window.__escPrevented = null;
      document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') window.__escPrevented = e.defaultPrevented;
      });
    });
    await page.evaluate(() => window.__menuBar.open('view'));
    await page.keyboard.press('ArrowDown');    // Theme parent
    await page.keyboard.press('Enter');        // open submenu
    await expect(page.locator(THEME)).toBeVisible();

    await page.keyboard.press('Escape');
    // Submenu collapsed, but the MENU stays open (one level only)…
    const st = await page.evaluate(() => window.__menuBar.__getStateForTests());
    expect(st.openSubmenu).toBeNull();
    expect(st.openMenu).toBe('view');
    // …and the menu-bar consumed the Esc (keyboard.js short-circuits — the E1.2
    // guard still holds through the submenu layer).
    expect(await page.evaluate(() => window.__escPrevented)).toBe(true);
  });
});

test.describe('E1.4 AC-5 — rehomed side-effects survive (font gate, D-19)', () => {
  test('Font submenu re-gates with theme (E1.5 replaced the #font-row hide) @fast', async ({ page }) => {
    await ready(page);
    // Epic E1 Story E1.5 — the incumbent #font-row hide became the Font submenu
    // parent's data-disabled (AD-9), re-derived by onThemeChange → projectPrefs.
    const FONT_PARENT = '#dropdown-view .menu-item[data-submenu="font"]';
    const fontDisabled = () => page.evaluate(
      (sel) => document.querySelector(sel).getAttribute('data-disabled'), FONT_PARENT);
    await selectTheme(page, 'crt');
    expect(await fontDisabled()).toBeNull();      // CRT — Font enabled
    await selectTheme(page, 'clean');
    expect(await fontDisabled()).toBe('true');    // Console — CRT-gate re-homed as data-disabled
    await selectTheme(page, 'crt');
    expect(await fontDisabled()).toBeNull();
  });

  test('D-19 — selecting a Phosphor clears the selection @fast', async ({ page }) => {
    await ready(page);
    await page.waitForFunction(() => window.__selection && typeof window.__selection.getSelection === 'function');
    await page.waitForFunction(() => document.getElementById('terminal').width > 0);
    const cell = await page.evaluate(() => window.__getActiveCellSize());
    const box = await page.locator('#terminal').boundingBox();
    const yMid = box.y + cell.cellH / 2;
    await page.mouse.move(box.x + cell.cellW / 2, yMid);
    await page.mouse.down();
    await page.mouse.move(box.x + cell.cellW * 5, yMid);
    await page.mouse.up();
    expect(await page.evaluate(() => window.__selection.getSelection())).not.toBeNull();

    // Select a phosphor via the menu — clearSelection is injected onto the action.
    await page.evaluate(() => window.__menuBar.open('view'));
    await page.click(PHOS_PARENT);
    await page.click(`${PHOS} .menu-item[data-value="amber"]`);
    expect(await page.evaluate(() => window.__selection.getSelection())).toBeNull();
  });
});
