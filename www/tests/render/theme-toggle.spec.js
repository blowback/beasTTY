// Phase 3 Plan 04 — RENDER-06 / RENDER-07 — Theme toggle.
// Epic E1 Story E1.4 — the incumbent #theme-toggle button retired to the View
// menu (View ▸ Theme radio submenu). These oracles are RETARGETED onto the menu
// path; the Ctrl+Alt+T chord assertion STAYS (the chord lives in chrome.js,
// AD-13). Downstream effect asserted: body[data-theme] scanline attribute +
// persistence across reload + the active radio's ✓ check glyph.
import { test, expect } from '@playwright/test';

async function ready(page) {
  await page.goto('/');
  await page.waitForFunction(
    () => window.__menuBar && typeof window.__menuBar.__getStateForTests === 'function',
  );
}

// Open View ▸ Theme and select a value (clean | crt) via the menu path. Opens
// the View menu through the API (deterministic — a radio select keeps the menu
// open, so re-clicking the title would toggle it shut) then exercises the real
// click path for the submenu parent + radio.
async function selectTheme(page, value) {
  await page.evaluate(() => window.__menuBar.open('view'));
  await page.click('#dropdown-view .menu-item[data-submenu="theme"]');
  await page.click(`#dropdown-view .submenu[data-submenu-panel="theme"] .menu-item[data-value="${value}"]`);
}

test.describe('RENDER-06 / RENDER-07 — Theme via View ▸ Theme (E1.4)', () => {
  test('selecting a theme swaps body[data-theme] @fast', async ({ page }) => {
    await ready(page);
    await expect(page.locator('body')).toHaveAttribute('data-theme', 'crt');

    await selectTheme(page, 'clean');
    await expect(page.locator('body')).toHaveAttribute('data-theme', 'clean');

    await selectTheme(page, 'crt');
    await expect(page.locator('body')).toHaveAttribute('data-theme', 'crt');
  });

  test('theme choice persists across reload @fast', async ({ page }) => {
    await ready(page);
    await selectTheme(page, 'clean');
    await expect(page.locator('body')).toHaveAttribute('data-theme', 'clean');

    // beforeunload flushes the debounced savePrefs; reload reads it back.
    await page.reload();
    await expect(page.locator('body')).toHaveAttribute('data-theme', 'clean');
  });

  test('active theme radio carries the ✓ check glyph @fast', async ({ page }) => {
    await ready(page);
    await selectTheme(page, 'clean');
    // The chosen radio shows ✓ (chrome-accent); its sibling is blank.
    const cleanCheck = page.locator('#dropdown-view .submenu[data-submenu-panel="theme"] .menu-item[data-value="clean"] .check');
    const crtCheck = page.locator('#dropdown-view .submenu[data-submenu-panel="theme"] .menu-item[data-value="crt"] .check');
    await expect(cleanCheck).toHaveText('✓');
    await expect(crtCheck).toHaveText('');
    // aria-checked stays in lockstep with the glyph.
    await expect(page.locator('#dropdown-view .submenu[data-submenu-panel="theme"] .menu-item[data-value="clean"]'))
      .toHaveAttribute('aria-checked', 'true');
  });

  test('Ctrl+Alt+T toggles theme — chord stays in chrome.js (AD-13) @fast', async ({ page }) => {
    // Plan 03-06 remapped from Ctrl+Shift+T (Chromium-reserved for reopen-tab)
    // to Ctrl+Alt+T (GNOME/i3 open-terminal chord; hookable). E1.4 keeps it here.
    await ready(page);
    await page.locator('#terminal-wrapper').focus();
    await expect(page.locator('body')).toHaveAttribute('data-theme', 'crt');

    await page.keyboard.press('Control+Alt+KeyT');
    await expect(page.locator('body')).toHaveAttribute('data-theme', 'clean');

    await page.keyboard.press('Control+Alt+KeyT');
    await expect(page.locator('body')).toHaveAttribute('data-theme', 'crt');
  });

  test('Ctrl+Alt+T theme change persists across reload (chord persistence) @fast', async ({ page }) => {
    await ready(page);
    await page.locator('#terminal-wrapper').focus();
    await page.keyboard.press('Control+Alt+KeyT');
    await expect(page.locator('body')).toHaveAttribute('data-theme', 'clean');
    await page.reload();
    await expect(page.locator('body')).toHaveAttribute('data-theme', 'clean');
  });

  test('Ctrl+Shift+T does NOT toggle theme (chord released back to Chromium) — gap #4', async ({ page }) => {
    await ready(page);
    await page.locator('#terminal-wrapper').focus();
    await expect(page.locator('body')).toHaveAttribute('data-theme', 'crt');

    // Chromium intercepts Ctrl+Shift+T for "reopen closed tab" — our handler
    // no longer matches, so the data-theme attribute stays "crt".
    await page.keyboard.press('Control+Shift+KeyT');
    await page.waitForTimeout(100);
    await expect(page.locator('body')).toHaveAttribute('data-theme', 'crt');
  });
});

test.describe('Gap #3 (UAT Test 5) — Theme switch preserves canvas content', () => {
  test('glyphs painted before theme switch are still painted after — gap #3', async ({ page }) => {
    // Plan 03-05 Task 1 adds markAllRowsDirty() after atlas.evict() in
    // setTheme. Pre-fix the dirty-row optimisation left the canvas blank
    // after every theme swap. E1.4 drives the switch via the Ctrl+Alt+T chord.
    await page.goto('/');
    await page.waitForFunction(() => document.getElementById('terminal').width > 0);
    await page.waitForFunction(() => window.__menuBar && typeof window.__menuBar.open === 'function');
    await page.locator('#terminal-wrapper').focus();

    // Feed glyphs.
    await page.locator('#debug').evaluate((el) => { el.open = true; });
    await page.fill('#input', 'HELLO WORLD');
    await page.click('#feed');
    await page.waitForTimeout(150);

    // Verify glyphs present in CRT theme.
    const crtGlyphsVisible = await page.evaluate(() => {
      const c = document.getElementById('terminal');
      const ctx = c.getContext('2d');
      const img = ctx.getImageData(0, 0, Math.min(c.width, 640), 64);
      for (let i = 0; i < img.data.length; i += 4) {
        if (img.data[i + 1] > 60) return true;
      }
      return false;
    });
    expect(crtGlyphsVisible).toBe(true);

    // Switch to clean theme via View ▸ Theme (focus-independent — clicking #feed
    // above moved focus off #terminal-wrapper, so the chord path would not fire).
    // Wait enough rAF ticks for the theme swap repaint to complete.
    await page.evaluate(() => window.__menuBar.open('view'));
    await page.click('#dropdown-view .menu-item[data-submenu="theme"]');
    await page.click('#dropdown-view .submenu[data-submenu-panel="theme"] .menu-item[data-value="clean"]');
    await page.waitForTimeout(250);

    // Verify glyphs still painted (clean theme uses #e4e8ee on #0f1419 — RGB
    // ~(228,232,238) vs bg ~(15,20,25). Any pixel with r>100 is a glyph.
    const cleanGlyphsVisible = await page.evaluate(() => {
      const c = document.getElementById('terminal');
      const ctx = c.getContext('2d');
      const img = ctx.getImageData(0, 0, Math.min(c.width, 640), 64);
      for (let i = 0; i < img.data.length; i += 4) {
        if (img.data[i] > 100 && img.data[i + 1] > 100) return true;  // near-white glyph
      }
      return false;
    });
    expect(cleanGlyphsVisible).toBe(true);
  });
});
