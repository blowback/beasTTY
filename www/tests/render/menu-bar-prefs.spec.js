// Epic E1 Story E1.3 (AC-4 / AD-14) — menu-bar reset re-projection seam.
//
// menu-bar.js exposes projectPrefs(prefs) and is registered as a second
// prefsSubscribe subscriber (alongside main.js applyPrefs). resetPrefs() is the
// ONLY trigger that fans out prefs subscribers, so it re-projects the View
// submenu's menu DOM on reset. The View submenus are placeholders today
// (E1.4/E1.5 fill the body), so projectPrefs is a SAFE no-op — but the
// subscription + the idempotent/no-throw contract land NOW so the moment
// E1.4/E1.5 add real View state, resetPrefs() already re-projects it cleanly.
//
// These specs pin exactly that contract, honest to the no-op reality: reachable
// on the API, idempotent (twice → identical DOM), never throws, and resetPrefs()
// drives it without error or open/close-state corruption. [Source:
// menu-bar.js projectPrefs; main.js prefsSubscribe(menuBar.projectPrefs);
// state/prefs.js resetPrefs fan-out; ARCHITECTURE-SPINE.md#AD-14]
import { test, expect } from '@playwright/test';

async function ready(page) {
  await page.goto('/');
  await page.waitForFunction(
    () => window.__menuBar && typeof window.__menuBar.projectPrefs === 'function',
  );
  await page.waitForFunction(
    () => window.__prefs && typeof window.__prefs.resetPrefs === 'function',
  );
}

test.describe('E1.3 AC-4 — projectPrefs reset re-projection seam', () => {
  test('projectPrefs is reachable on the menu-bar API @fast', async ({ page }) => {
    await ready(page);
    expect(await page.evaluate(() => typeof window.__menuBar.projectPrefs)).toBe('function');
  });

  test('projectPrefs is idempotent and never throws (reads prefs at use-time) @fast', async ({ page }) => {
    await ready(page);
    const result = await page.evaluate(() => {
      const view = document.getElementById('dropdown-view');
      const before = view.outerHTML;
      let threw = false;
      try {
        // Twice with the blob → must yield identical DOM (idempotent).
        window.__menuBar.projectPrefs(window.__prefs.getPrefs());
        window.__menuBar.projectPrefs(window.__prefs.getPrefs());
        // Bare call → getPrefs() use-time fallback, still no throw / no change.
        window.__menuBar.projectPrefs();
      } catch (e) { threw = true; }
      return { threw, changed: view.outerHTML !== before };
    });
    expect(result.threw).toBe(false);
    expect(result.changed).toBe(false);
  });

  test('resetPrefs() drives projectPrefs without throwing; View open/close state intact @fast', async ({ page }) => {
    await ready(page);
    // Open the View menu first — projectPrefs must NOT fight render()'s
    // ownership of open/close state (it may only touch View item check/label).
    await page.evaluate(() => window.__menuBar.open('view'));
    await expect(page.locator('#dropdown-view')).toBeVisible();

    const result = await page.evaluate(() => {
      let threw = false;
      try { window.__prefs.resetPrefs(); } catch (e) { threw = true; }
      return { threw, openMenu: window.__menuBar.getOpenMenu() };
    });
    expect(result.threw).toBe(false);
    // render() still owns open/close — resetPrefs()'s projectPrefs did not close it.
    expect(result.openMenu).toBe('view');
    await expect(page.locator('#dropdown-view')).toBeVisible();
  });
});
