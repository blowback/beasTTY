// Phase 3 Plan 04 — RENDER-08 — Phosphor radio-group (CRT only).
// Epic E1 Story E1.4 — the incumbent #phosphor-group retired to View ▸ Phosphor.
// Oracles RETARGETED onto the menu path. AD-9: off-CRT the Phosphor is SHOWN but
// data-disabled (NOT hidden as the old group was). Downstream effect asserted:
// active radio ✓/aria-checked + the --phosphor-fg CSS var.
import { test, expect } from '@playwright/test';

const PALETTE = {
  green: '#33ff66',
  amber: '#ffb000',
  white: '#e8e8d8',
  blue:  '#4da6ff',
  red:   '#ff1d1d',
};

const P = '#dropdown-view .submenu[data-submenu-panel="phosphor"]';

async function ready(page) {
  await page.goto('/');
  await page.waitForFunction(
    () => window.__menuBar && typeof window.__menuBar.__getStateForTests === 'function',
  );
}

// Open View ▸ Phosphor and click a colour radio. Opens via the API (a radio
// select keeps the menu open) then clicks the parent + radio (real path).
async function selectPhosphor(page, color) {
  await page.evaluate(() => window.__menuBar.open('view'));
  await page.click('#dropdown-view .menu-item[data-submenu="phosphor"]');
  await page.click(`${P} .menu-item[data-value="${color}"]`);
}

async function selectTheme(page, value) {
  await page.evaluate(() => window.__menuBar.open('view'));
  await page.click('#dropdown-view .menu-item[data-submenu="theme"]');
  await page.click(`#dropdown-view .submenu[data-submenu-panel="theme"] .menu-item[data-value="${value}"]`);
}

test.describe('RENDER-08 — Phosphor via View ▸ Phosphor (CRT only, E1.4)', () => {
  test('each phosphor radio updates aria-checked exclusively @fast', async ({ page }) => {
    await ready(page);
    // Default: green checked, others not.
    await page.evaluate(() => window.__menuBar.open('view'));
    await page.click('#dropdown-view .menu-item[data-submenu="phosphor"]');
    await expect(page.locator(`${P} .menu-item[data-value="green"]`)).toHaveAttribute('aria-checked', 'true');
    await expect(page.locator(`${P} .menu-item[data-value="amber"]`)).toHaveAttribute('aria-checked', 'false');
    await expect(page.locator(`${P} .menu-item[data-value="white"]`)).toHaveAttribute('aria-checked', 'false');

    await selectPhosphor(page, 'amber');
    await expect(page.locator(`${P} .menu-item[data-value="amber"]`)).toHaveAttribute('aria-checked', 'true');
    await expect(page.locator(`${P} .menu-item[data-value="green"]`)).toHaveAttribute('aria-checked', 'false');
    await expect(page.locator(`${P} .menu-item[data-value="white"]`)).toHaveAttribute('aria-checked', 'false');

    await selectPhosphor(page, 'white');
    await expect(page.locator(`${P} .menu-item[data-value="white"]`)).toHaveAttribute('aria-checked', 'true');
    await expect(page.locator(`${P} .menu-item[data-value="amber"]`)).toHaveAttribute('aria-checked', 'false');
    await expect(page.locator(`${P} .menu-item[data-value="green"]`)).toHaveAttribute('aria-checked', 'false');
  });

  test('CSS var --phosphor-fg matches selected palette @fast', async ({ page }) => {
    await ready(page);
    for (const [color, hex] of Object.entries(PALETTE)) {
      await selectPhosphor(page, color);
      const cssFg = await page.evaluate(() =>
        getComputedStyle(document.documentElement).getPropertyValue('--phosphor-fg').trim(),
      );
      expect(cssFg.toLowerCase()).toBe(hex.toLowerCase());
    }
  });

  test('phosphor choice persists across reload @fast', async ({ page }) => {
    await ready(page);
    await selectPhosphor(page, 'amber');
    await page.reload();
    await page.evaluate(() => window.__menuBar.open('view'));
    await page.click('#dropdown-view .menu-item[data-submenu="phosphor"]');
    await expect(page.locator(`${P} .menu-item[data-value="amber"]`)).toHaveAttribute('aria-checked', 'true');
  });

  test('Phosphor parent is shown-but-disabled in Console theme (AD-9, NOT hidden) @fast', async ({ page }) => {
    await ready(page);
    const parent = page.locator('#dropdown-view .menu-item[data-submenu="phosphor"]');
    // CRT (default): enabled.
    await page.evaluate(() => window.__menuBar.open('view'));
    await expect(parent).toBeVisible();
    await expect(parent).not.toHaveAttribute('data-disabled', 'true');

    // Switch to Console (Clean) — the row stays VISIBLE but goes data-disabled.
    await selectTheme(page, 'clean');
    await page.evaluate(() => window.__menuBar.open('view'));
    await expect(parent).toBeVisible();                                   // shown, not hidden (AD-9)
    await expect(parent).toHaveAttribute('data-disabled', 'true');
    await expect(parent).toHaveAttribute('aria-disabled', 'true');

    // Back to CRT — enabled again.
    await selectTheme(page, 'crt');
    await page.evaluate(() => window.__menuBar.open('view'));
    await expect(parent).not.toHaveAttribute('data-disabled', 'true');
  });
});

test.describe('Gap #5 (UAT Test 7) — Phosphor switch recolours rendered glyphs', () => {
  test('existing glyphs recolour on phosphor change (green → amber) — gap #5', async ({ page }) => {
    // Plan 03-05 Task 1 adds markAllRowsDirty() in setPhosphor. E1.4 drives the
    // change via View ▸ Phosphor.
    await page.goto('/');
    await page.waitForFunction(() => document.getElementById('terminal').width > 0);
    await page.waitForFunction(() => window.__menuBar && typeof window.__menuBar.open === 'function');
    await page.locator('#terminal-wrapper').focus();

    // Feed a glyph string in green.
    await page.locator('#debug').evaluate((el) => { el.open = true; });
    await page.fill('#input', 'HELLO');
    await page.click('#feed');
    await page.waitForTimeout(150);

    // Switch to amber via the menu and wait for repaint.
    await selectPhosphor(page, 'amber');
    await page.waitForTimeout(250);

    // Amber fg is #ffb000 → rgb(255, 176, 0). After phosphor change every
    // previously-rendered glyph pixel must be amber, NOT green.
    const sampled = await page.evaluate(() => {
      const c = document.getElementById('terminal');
      const ctx = c.getContext('2d');
      const img = ctx.getImageData(0, 0, Math.min(c.width, 640), 64);
      let greenCount = 0;
      let amberCount = 0;
      for (let i = 0; i < img.data.length; i += 4) {
        const r = img.data[i];
        const g = img.data[i + 1];
        const b = img.data[i + 2];
        if (g > 150 && r < 100 && b > 50) greenCount++;
        if (r > 200 && g > 100 && g < 220 && b < 80) amberCount++;
      }
      return { greenCount, amberCount };
    });
    expect(sampled.amberCount).toBeGreaterThan(0);
    expect(sampled.greenCount).toBe(0);
  });
});
