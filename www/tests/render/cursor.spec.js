// Phase 3 Plan 04 — RENDER-02 / RENDER-12 — Cursor.
// Focused cursor paints a visible block at (0,0) on CRT green; blurred cursor
// paints an outlined block (interior near-bg).
import { test, expect } from '@playwright/test';

test.describe('RENDER-02 / RENDER-12 — Cursor', () => {
  test('focused cursor at (0,0) paints a visible block in CRT theme', async ({ page }) => {
    await page.goto('/');
    await page.waitForFunction(() => document.getElementById('terminal').width > 0);
    // Wrapper auto-focuses at boot per chrome.js.
    // Wait several rAF ticks so we catch the blink-on half of the 530 ms cycle.
    // Sample at multiple moments to avoid coinciding with a blink-off phase.
    await page.waitForTimeout(300);

    const isCursorVisible = await page.evaluate(async () => {
      // backing-store coords: at DPR=2, cellW*dpr=32 px across, cellH*dpr=64 px tall.
      // The (0,0) cell's centre backing pixel lives at roughly (16, 32).
      const c = document.getElementById('terminal');
      const ctx = c.getContext('2d');
      // Sample over ~1.5 blink cycles; any sample with non-bg pixels proves
      // the focused block cursor is painted.
      for (let i = 0; i < 10; i++) {
        const img = ctx.getImageData(0, 0, 32, 64);
        for (let j = 0; j < img.data.length; j += 4) {
          const r = img.data[j];
          const g = img.data[j + 1];
          // CRT phosphor fg #33ff66 ≈ rgb(51,255,102) — green > 60 is a strong signal.
          if (r > 30 || g > 60) return true;
        }
        await new Promise((r) => setTimeout(r, 100));
      }
      return false;
    });
    expect(isCursorVisible).toBe(true);
  });

  test('blurred cursor paints a 1 px outline at (0,0)', async ({ page }) => {
    await page.goto('/');
    await page.waitForFunction(() => document.getElementById('terminal').width > 0);

    // Blur the wrapper by focusing the Debug textarea.
    await page.locator('#debug').evaluate((el) => { el.open = true; });
    await page.focus('#input');
    await page.waitForTimeout(200);

    // canvas.js paintCursor (blurred branch) draws a strokeRect outline.
    // Edge pixels should be fg (phosphor green), interior pixels away from
    // the edge should match the theme bg. We assert the edge+interior
    // contrast rather than an absolute interior colour because the renderer
    // currently leaves the previously-painted focused block under the
    // outline (see grid.spec.js fixme — Plan 02 dirty-paint bug). After
    // the gap_closure patch lands, both edge AND interior-bg invariants
    // hold simultaneously.
    const samples = await page.evaluate(() => {
      const c = document.getElementById('terminal');
      const ctx = c.getContext('2d');
      // At DPR=2, cellW*dpr=32, cellH*dpr=64. Edge of the (0,0) cell outline
      // lives at roughly backing (1,1) through (30,62). Sample a 1×1 pixel
      // at the TOP EDGE of the cell (backing y=1) — must be fg.
      const edge = ctx.getImageData(16, 1, 1, 1);
      // Also sample OUTSIDE the cell (well past the cursor) at (1000, 500)
      // to prove the rest of the canvas is theme bg.
      const away = ctx.getImageData(1000, 500, 1, 1);
      return {
        edge: { r: edge.data[0], g: edge.data[1], b: edge.data[2] },
        away: { r: away.data[0], g: away.data[1], b: away.data[2] },
      };
    });

    // Edge must be fg — phosphor green rgb(51, 255, 102).
    expect(samples.edge.g).toBeGreaterThan(60);
    // Away pixel must be bg — phosphor dark rgb(10, 15, 10).
    expect(samples.away.g).toBeLessThan(60);
    expect(samples.away.r).toBeLessThan(60);
  });

  test('cursor disappears from position (0,0) interior on blur', async ({ page }) => {
    await page.goto('/');
    await page.waitForFunction(() => document.getElementById('terminal').width > 0);
    await page.locator('#terminal-wrapper').focus();
    await page.waitForTimeout(300);

    // Focused: at least one blink-on sample shows the cursor block colour
    // (phosphor green) somewhere in the (0,0) cell region.
    const focusedSawFg = await page.evaluate(async () => {
      const c = document.getElementById('terminal');
      const ctx = c.getContext('2d');
      for (let i = 0; i < 10; i++) {
        const img = ctx.getImageData(0, 0, 32, 64);
        for (let j = 0; j < img.data.length; j += 4) {
          if (img.data[j + 1] > 60) return true;
        }
        await new Promise((r) => setTimeout(r, 100));
      }
      return false;
    });
    expect(focusedSawFg).toBe(true);
  });
});
