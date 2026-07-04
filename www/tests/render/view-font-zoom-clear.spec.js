// Epic E1 Story E1.5 — View ▸ Font, Zoom & Clear.
//
// The E1.5 slice on top of the retargeted incumbent oracles (clear-screen.spec.js
// drives Clear via the menu; zoom.spec.js keeps the SACRED chord oracle): the
// Font radio submenu (apply + persist + radio-check, reusing the E1.4 mechanic;
// shown-but-disabled off-CRT per AD-9), the View ▸ Zoom items (identical to the
// Ctrl+{=,-,0} chord, integer-clamped, persisted, D-19 selection-clear, status
// push), the Clear Scrollback… deliberate-friction confirm (FR-11), and the
// filled font half of projectPrefs (reset re-projection, AD-14).
//
// Boot-race guard (E0.1 learning): wait on window.__menuBar before driving it.
import { test, expect } from '@playwright/test';
import { SERIAL_MOCK } from '../transport/mock-serial.js';

const FONT = '#dropdown-view .submenu[data-submenu-panel="font"]';
const FONT_PARENT = '#dropdown-view .menu-item[data-submenu="font"]';
const FONT_IDS = ['modern', 'vt52', 'insigbyte', 'insigbyte-bold', 'you-squared', 'cushion',
                  'chit', 'orbiter', 'patrol', 'striker', 'zx-palm'];

async function ready(page) {
  await page.addInitScript(SERIAL_MOCK);
  await page.goto('/');
  await page.waitForFunction(
    () => window.__menuBar && typeof window.__menuBar.__getStateForTests === 'function',
  );
  await page.locator('#terminal-wrapper').focus();
  await page.waitForFunction(() => document.getElementById('terminal').width > 0);
}

async function selectTheme(page, value) {
  await page.evaluate(() => window.__menuBar.open('view'));
  await page.click('#dropdown-view .menu-item[data-submenu="theme"]');
  await page.click(`#dropdown-view .submenu[data-submenu-panel="theme"] .menu-item[data-value="${value}"]`);
}

async function selectFont(page, value) {
  await page.evaluate(() => window.__menuBar.open('view'));
  await page.click(FONT_PARENT);
  await page.click(`${FONT} .menu-item[data-value="${value}"]`);
}

async function clickAction(page, action, opts = {}) {
  await page.evaluate(() => window.__menuBar.open('view'));
  await page.click(`#dropdown-view .menu-item[data-action="${action}"]`, opts);
}

const radioChecked = (page, value) => page.evaluate(
  (v) => document.querySelector(
    `#dropdown-view .submenu[data-submenu-panel="font"] .menu-item[data-value="${v}"]`,
  ).getAttribute('data-checked'),
  value,
);

// ===== AC-1 — Font apply + persist + radio reflects active font =====
test.describe('E1.5 AC-1 — Font radio submenu applies + persists', () => {
  test('selecting each font applies it, persists it, and moves the check @fast', async ({ page }) => {
    await ready(page);
    await selectTheme(page, 'crt');            // Font is CRT-gated (AC-2) — ensure enabled
    for (const font of ['vt52', 'insigbyte', 'insigbyte-bold', 'you-squared', 'cushion',
                        'chit', 'orbiter', 'patrol', 'striker', 'zx-palm', 'modern']) {
      await selectFont(page, font);
      // Canvas applied (downstream effect, not just DOM state).
      expect(await page.evaluate(() => window.__canvasState.getActiveFont())).toBe(font);
      // Persisted.
      expect(await page.evaluate(() => window.__prefs.getPrefs().font)).toBe(font);
      // Radio reflects the active font, siblings deselected.
      expect(await radioChecked(page, font)).toBe('true');
      const others = await page.evaluate(({ active, ids }) => ids
        .filter((f) => f !== active)
        .every((f) => document.querySelector(
          `#dropdown-view .submenu[data-submenu-panel="font"] .menu-item[data-value="${f}"]`,
        ).getAttribute('data-checked') === 'false'), { active: font, ids: FONT_IDS });
      expect(others).toBe(true);
    }
  });

  test('the chosen font persists across reload and the radio re-projects @fast', async ({ page }) => {
    await ready(page);
    await selectTheme(page, 'crt');
    await selectFont(page, 'cushion');
    await page.waitForTimeout(300);            // > 250 ms savePrefs debounce
    await page.reload();
    await page.waitForFunction(() => window.__menuBar && window.__canvasState);
    expect(await page.evaluate(() => window.__canvasState.getActiveFont())).toBe('cushion');
    // Re-open View — projectViewOnOpen re-derives the radio from prefs (read-at-use).
    await page.evaluate(() => window.__menuBar.open('view'));
    expect(await radioChecked(page, 'cushion')).toBe('true');
    expect(await radioChecked(page, 'modern')).toBe('false');
  });
});

// ===== AC-2 — Font shown-but-disabled off-CRT (AD-9), live under CRT =====
test.describe('E1.5 AC-2 — Font CRT-gating (disabled, announced, live)', () => {
  test('Console theme: Font parent is data-disabled, announced, and not enterable @fast', async ({ page }) => {
    await ready(page);
    await selectTheme(page, 'clean');          // disables Font (and Phosphor)
    await page.evaluate(() => window.__menuBar.open('view'));
    await expect(page.locator(FONT_PARENT)).toHaveAttribute('data-disabled', 'true');
    await expect(page.locator(FONT_PARENT)).toHaveAttribute('aria-disabled', 'true');
    await expect(page.locator(FONT_PARENT)).toHaveAttribute('title', 'Font — CRT theme only');
    // Not enterable — clicking the disabled parent must not open the submenu.
    await page.click(FONT_PARENT, { force: true });   // aria-disabled — force the physical click
    expect(await page.evaluate(() => window.__menuBar.__getStateForTests().openSubmenu)).toBeNull();
    await expect(page.locator(FONT)).toBeHidden();
    // Announced when a focusable neighbour lands beside it. Under Console the
    // focusable rows are Theme, Zoom In, …; Zoom In's disabled neighbour is Font.
    await page.keyboard.press('ArrowDown');    // Theme (announces Phosphor)
    await page.keyboard.press('ArrowDown');    // Zoom In (Font is the disabled neighbour)
    await expect(page.locator('#menu-bar-live')).toHaveText('Font — CRT theme only');
  });

  test('switching Theme→CRT enables Font live; →Console disables it @fast', async ({ page }) => {
    await ready(page);
    await selectTheme(page, 'clean');
    await page.evaluate(() => window.__menuBar.open('view'));
    await expect(page.locator(FONT_PARENT)).toHaveAttribute('data-disabled', 'true');
    // Flip to CRT within the open menu (AC-3-style live re-derive).
    await page.click('#dropdown-view .menu-item[data-submenu="theme"]');
    await page.click('#dropdown-view .submenu[data-submenu-panel="theme"] .menu-item[data-value="crt"]');
    await expect(page.locator(FONT_PARENT)).not.toHaveAttribute('data-disabled');
    // Now Font opens and is selectable.
    await page.click(FONT_PARENT);
    await expect(page.locator(FONT)).toBeVisible();
  });
});

// ===== AC-3 — Zoom items identical to the chord; persisted; pushed =====
test.describe('E1.5 AC-3 — View ▸ Zoom items', () => {
  const width = (page) => page.evaluate(() => parseFloat(document.getElementById('terminal').style.width));

  test('Zoom In / Out / Actual Size change zoom in integer steps @fast', async ({ page }) => {
    await ready(page);
    const base = await width(page);
    expect(base).toBe(1280);                   // CRT 1×: cellW 16 × 80 cols
    await clickAction(page, 'zoom-in');  await page.waitForTimeout(60);
    expect(await width(page)).toBe(base * 2);
    await clickAction(page, 'zoom-in');  await page.waitForTimeout(60);
    expect(await width(page)).toBe(base * 3);
    await clickAction(page, 'zoom-out'); await page.waitForTimeout(60);
    expect(await width(page)).toBe(base * 2);
    await clickAction(page, 'zoom-actual'); await page.waitForTimeout(60);
    expect(await width(page)).toBe(base);
    // Persisted + pushed to the (E4) status-bar hook.
    expect(await page.evaluate(() => window.__prefs.getPrefs().fontZoom)).toBe(1);
    expect(await page.evaluate(() => window.__zoomPush.last)).toBe(1);
  });

  test('menu zoom clamps at 4× and 1× (matches the chord) @fast', async ({ page }) => {
    await ready(page);
    const base = await width(page);
    for (let i = 0; i < 6; i++) { await clickAction(page, 'zoom-in'); }
    await page.waitForTimeout(60);
    expect(await width(page)).toBe(base * 4);
    for (let i = 0; i < 6; i++) { await clickAction(page, 'zoom-out'); }
    await page.waitForTimeout(60);
    expect(await width(page)).toBe(base);
  });

  test('the Ctrl+= chord ALSO pushes to the status-bar hook (FR-27 either-way) @fast', async ({ page }) => {
    await ready(page);
    const before = await page.evaluate(() => window.__zoomPush.count);
    await page.keyboard.press('Control+Equal');
    await page.waitForTimeout(60);
    expect(await page.evaluate(() => window.__zoomPush.count)).toBeGreaterThan(before);
    expect(await page.evaluate(() => window.__zoomPush.last)).toBe(2);
  });

  test('D-19 — a menu Zoom clears an active selection @fast', async ({ page }) => {
    await ready(page);
    await page.waitForFunction(() => window.__selection && typeof window.__selection.getSelection === 'function');
    const cell = await page.evaluate(() => window.__getActiveCellSize());
    const box = await page.locator('#terminal').boundingBox();
    const yMid = box.y + cell.cellH / 2;
    await page.mouse.move(box.x + cell.cellW / 2, yMid);
    await page.mouse.down();
    await page.mouse.move(box.x + cell.cellW * 5, yMid);
    await page.mouse.up();
    expect(await page.evaluate(() => window.__selection.getSelection())).not.toBeNull();
    await clickAction(page, 'zoom-in');
    expect(await page.evaluate(() => window.__selection.getSelection())).toBeNull();
  });
});

// ===== AC-4 — Clear Scrollback… deliberate-friction confirm =====
// The observable fingerprint that clearScrollback RAN (vs was cancelled) is the
// D-04 snap-to-bottom: scroll up first (data-scrolled-back), then Confirm snaps
// while Cancel leaves it scrolled up. (The resize_scrollback(0)→(10000) flush
// itself is pinned by clear-screen.spec.js's Shift-variant oracle.)
test.describe('E1.5 AC-4 — Clear Scrollback… confirm', () => {
  async function feed100(page) {
    await page.evaluate(() => {
      const s = Array.from({ length: 100 }, (_, i) => `line ${i}\r\n`).join('');
      window.__term.feed(new TextEncoder().encode(s));
      window.__requestFrame();
    });
  }
  const gridBlank = (page) => page.evaluate(() => {
    window.__term.snapshot_grid();
    const view = window.__testGridView();
    for (let i = 0; i < view.length; i += 8) if (view[i] !== 0x20) return false;
    return true;
  });

  test('the confirm shows the verbatim copy and gates the wipe @fast', async ({ page }) => {
    await ready(page);
    await feed100(page);
    await clickAction(page, 'clear-scrollback');
    const dialog = page.locator('#clear-scrollback-confirm');
    await expect(dialog).toBeVisible();
    await expect(dialog).toContainText('Wipes the 10,000-line history.');
  });

  test('Cancel is a no-op — nothing is wiped or snapped @fast', async ({ page }) => {
    await ready(page);
    await page.waitForFunction(() => window.__scrollState);
    await feed100(page);
    await page.evaluate(() => window.__scrollState.scrollByLines(20));
    await expect(page.locator('#terminal-wrapper')).toHaveAttribute('data-scrolled-back', 'true');
    await clickAction(page, 'clear-scrollback');
    await page.click('#clear-scrollback-confirm-cancel');
    await page.waitForTimeout(50);
    // No clearScrollback → no D-04 snap: still scrolled into the (intact) history.
    await expect(page.locator('#terminal-wrapper')).toHaveAttribute('data-scrolled-back', 'true');
  });

  test('Confirm runs the wipe — snaps to the live tail (D-04); grid untouched @fast', async ({ page }) => {
    await ready(page);
    await page.waitForFunction(() => window.__scrollState);
    await feed100(page);
    await page.evaluate(() => window.__scrollState.scrollByLines(20));
    await expect(page.locator('#terminal-wrapper')).toHaveAttribute('data-scrolled-back', 'true');
    await clickAction(page, 'clear-scrollback');
    await page.click('#clear-scrollback-confirm-ok');
    await page.waitForTimeout(50);
    // clearScrollback ran → snapped to the live tail (D-04). Cancel (above) does NOT.
    await expect(page.locator('#terminal-wrapper')).not.toHaveAttribute('data-scrolled-back');
    // Visible 80x24 untouched (D-15) — the last-fed lines are still shown.
    expect(await gridBlank(page)).toBe(false);
  });
});

// ===== AC-5 — projectPrefs re-projects Font on reset, idempotent =====
test.describe('E1.5 AC-5 — projectPrefs font re-projection', () => {
  test('resetPrefs re-projects the Font radio + disabled state; idempotent @fast', async ({ page }) => {
    await ready(page);
    await selectTheme(page, 'crt');
    await selectFont(page, 'cushion');
    // Reset — defaults are theme=crt, font=modern.
    await page.evaluate(() => window.__prefs.resetPrefs());
    await page.evaluate(() => window.__menuBar.open('view'));
    expect(await radioChecked(page, 'modern')).toBe('true');
    expect(await radioChecked(page, 'cushion')).toBe('false');
    await expect(page.locator(FONT_PARENT)).not.toHaveAttribute('data-disabled');
    // Idempotent: a second projectPrefs yields identical DOM.
    const before = await page.evaluate(() => document.querySelector('#dropdown-view .submenu[data-submenu-panel="font"]').innerHTML);
    await page.evaluate(() => window.__menuBar.projectPrefs());
    const after = await page.evaluate(() => document.querySelector('#dropdown-view .submenu[data-submenu-panel="font"]').innerHTML);
    expect(after).toBe(before);
  });
});
