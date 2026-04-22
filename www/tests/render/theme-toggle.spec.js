// Phase 3 Plan 04 — RENDER-06 / RENDER-07 — Theme toggle.
// Covers both click-based theme toggle (button) and keyboard shortcut
// Ctrl+Shift+T, plus the UI-SPEC copywriting contract (button label shows
// destination theme name).
import { test, expect } from '@playwright/test';

test.describe('RENDER-06 / RENDER-07 — Theme toggle', () => {
  test('click on #theme-toggle swaps body[data-theme] @fast', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('body')).toHaveAttribute('data-theme', 'crt');

    await page.click('#theme-toggle');
    await expect(page.locator('body')).toHaveAttribute('data-theme', 'clean');

    await page.click('#theme-toggle');
    await expect(page.locator('body')).toHaveAttribute('data-theme', 'crt');
  });

  test('Ctrl+Alt+T toggles theme — gap #4 remap @fast', async ({ page }) => {
    // Plan 03-06 remapped from Ctrl+Shift+T (Chromium-reserved for reopen-tab)
    // to Ctrl+Alt+T (GNOME/i3 open-terminal chord; hookable).
    await page.goto('/');
    await page.locator('#terminal-wrapper').focus();
    await expect(page.locator('body')).toHaveAttribute('data-theme', 'crt');

    await page.keyboard.press('Control+Alt+KeyT');
    await expect(page.locator('body')).toHaveAttribute('data-theme', 'clean');

    await page.keyboard.press('Control+Alt+KeyT');
    await expect(page.locator('body')).toHaveAttribute('data-theme', 'crt');
  });

  test('Ctrl+Shift+T does NOT toggle theme (chord released back to Chromium) — gap #4', async ({ page }) => {
    await page.goto('/');
    await page.locator('#terminal-wrapper').focus();
    await expect(page.locator('body')).toHaveAttribute('data-theme', 'crt');

    // Chromium intercepts Ctrl+Shift+T for "reopen closed tab" — our handler
    // no longer matches, so the data-theme attribute stays "crt".
    await page.keyboard.press('Control+Shift+KeyT');
    await page.waitForTimeout(100);
    await expect(page.locator('body')).toHaveAttribute('data-theme', 'crt');
  });

  test('theme-toggle button label shows destination theme name', async ({ page }) => {
    await page.goto('/');
    // CRT active → label shows destination "Clean" (UI-SPEC Copywriting Contract).
    await expect(page.locator('#theme-toggle')).toHaveText('Clean');

    await page.click('#theme-toggle');
    await expect(page.locator('#theme-toggle')).toHaveText('CRT');
  });
});

test.describe('Gap #3 (UAT Test 5) — Theme switch preserves canvas content', () => {
  test('glyphs painted before theme switch are still painted after — gap #3', async ({ page }) => {
    // Plan 03-05 Task 1 adds markAllRowsDirty() after atlas.evict() in
    // setTheme. Pre-fix the dirty-row optimisation left the canvas blank
    // after every theme swap because the evicted atlas had no cached tiles
    // AND no row was marked dirty to trigger a repaint.
    await page.goto('/');
    await page.waitForFunction(() => document.getElementById('terminal').width > 0);
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

    // Switch to clean theme. Wait enough rAF ticks for the theme swap
    // repaint to complete.
    await page.click('#theme-toggle');
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
