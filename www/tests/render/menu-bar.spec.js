// Epic E1 Story E1.1 — menu-bar shell + dropdown mechanics.
// Covers ACs 1-3 (shell render, open/move/click-away, four variants) plus the
// AC-5 non-adaptive-shell check (the menu bar must render identically across
// Console↔CRT even though the global [data-theme] block flips --chrome-* for
// the incumbent #top-bar).
//
// Boot-race guard (E0.1 learning): every test waits on window.__menuBar before
// driving it, to dodge the known window.__* boot race.
import { test, expect } from '@playwright/test';

const TITLES = [
  ['#menu-file', 'File'],
  ['#menu-connection', 'Connection'],
  ['#menu-view', 'View'],
  ['#menu-settings', 'Settings'],
  ['#menu-debug', 'Debug'],
  ['#menu-help', 'Help'],
];

const ACCENT_RGB = 'rgb(127, 219, 202)';   // --chrome-accent #7fdbca
const NEUTRAL_BG_RGB = 'rgb(30, 36, 44)';  // --chrome-bg #1e242c (neutral, pinned)

async function ready(page) {
  await page.goto('/');
  await page.waitForFunction(
    () => window.__menuBar && typeof window.__menuBar.__getStateForTests === 'function',
  );
}

test.describe('E1.1 AC-1 — menu-bar shell renders', () => {
  test('six titles render left-to-right + status placeholder @fast', async ({ page }) => {
    await ready(page);

    const bar = page.locator('#menu-bar');
    await expect(bar).toBeVisible();

    // Sticky full-width bar at the very top (AC-1) — <body> is a centering flex
    // column, so the bar must stretch to fill it or the right-aligned status
    // region collapses. Guard against a shrink-wrap regression.
    const geo = await page.evaluate(() => {
      const b = document.getElementById('menu-bar').getBoundingClientRect();
      const s = document.getElementById('menu-status')?.getBoundingClientRect()
             || document.querySelector('#menu-bar .menu-status').getBoundingClientRect();
      return { barX: b.x, barW: b.width, barTop: b.y, bodyW: document.body.clientWidth, statusRight: s.right };
    });
    expect(geo.barTop).toBe(0);
    expect(Math.round(geo.barX)).toBe(0);
    expect(Math.abs(geo.barW - geo.bodyW)).toBeLessThan(2);
    // Status sits hard against the right edge of the full-width bar.
    expect(geo.barW - geo.statusRight).toBeLessThan(16);

    for (const [sel, label] of TITLES) {
      await expect(page.locator(sel)).toHaveText(label);
    }

    // Titles appear in the documented order.
    const order = await page.$$eval('#menu-bar .menu-title', (els) => els.map((e) => e.textContent.trim()));
    expect(order).toEqual(['File', 'Connection', 'View', 'Settings', 'Debug', 'Help']);

    // Right-aligned connection-status placeholder: gray dot + "Not connected".
    await expect(page.locator('#menu-conn-dot')).toBeVisible();
    await expect(page.locator('#menu-conn-label')).toHaveText('Not connected');
    // The dot is the single intentional circle.
    const radius = await page.$eval('#menu-conn-dot', (el) => getComputedStyle(el).borderTopLeftRadius);
    expect(radius === '50%' || radius === '4.5px').toBeTruthy();
    // Gray disconnected token.
    const dotBg = await page.$eval('#menu-conn-dot', (el) => getComputedStyle(el).backgroundColor);
    expect(dotBg).toBe('rgba(255, 255, 255, 0.4)');
  });

  test('test hooks are exposed (AC-6) @fast', async ({ page }) => {
    await ready(page);
    const shape = await page.evaluate(() => ({
      hasGet: typeof window.__menuBar.__getStateForTests === 'function',
      hasReset: typeof window.__menuBar.__resetForTests === 'function',
      state: window.__menuBar.__getStateForTests(),
    }));
    expect(shape.hasGet).toBe(true);
    expect(shape.hasReset).toBe(true);
    expect(shape.state.wired).toBe(true);
    expect(shape.state.openMenu).toBeNull();
    expect(shape.state.menus).toEqual(['file', 'connection', 'view', 'settings', 'debug', 'help']);
  });

  test('incumbent #top-bar + <details> panes still present (coexist, AC-1/AC-4) @fast', async ({ page }) => {
    await ready(page);
    await expect(page.locator('#top-bar')).toBeAttached();
    await expect(page.locator('#connection')).toBeAttached();
    await expect(page.locator('#settings')).toBeAttached();
    await expect(page.locator('#debug')).toBeAttached();
    // A representative incumbent control is still wired.
    await expect(page.locator('#connect-button')).toBeVisible();
  });
});

test.describe('E1.1 AC-2 — dropdown open / move / click-away', () => {
  test('click opens; second title moves; click-away closes @fast', async ({ page }) => {
    await ready(page);

    // First click opens File.
    await page.click('#menu-file');
    await expect(page.locator('#dropdown-file')).toBeVisible();
    await expect(page.locator('#menu-file')).toHaveAttribute('data-open', 'true');
    await expect(page.locator('#menu-bar')).toHaveAttribute('data-active-menu', 'file');

    // Second click MOVES the open menu to View — only one panel visible.
    await page.click('#menu-view');
    await expect(page.locator('#dropdown-view')).toBeVisible();
    await expect(page.locator('#dropdown-file')).toBeHidden();
    await expect(page.locator('#menu-file')).not.toHaveAttribute('data-open', 'true');
    await expect(page.locator('#menu-bar')).toHaveAttribute('data-active-menu', 'view');

    // Click-away (outside the bar) closes everything.
    await page.click('#terminal-wrapper');
    await expect(page.locator('#dropdown-view')).toBeHidden();
    await expect(page.locator('#menu-bar')).not.toHaveAttribute('data-active-menu');
  });

  test('open/close is expressed via [hidden] + data-* only — never inline styles @fast', async ({ page }) => {
    await ready(page);
    await page.click('#menu-file');
    await page.click('#menu-connection');
    await page.click('#terminal-wrapper');

    // No element the module touches ever carries an inline style attribute.
    const styledCount = await page.$$eval(
      '#menu-bar, #menu-bar .menu-title, #menu-bar .dropdown',
      (els) => els.filter((e) => e.getAttribute('style')).length,
    );
    expect(styledCount).toBe(0);
  });

  test('clicking a title again toggles it closed @fast', async ({ page }) => {
    await ready(page);
    await page.click('#menu-settings');
    await expect(page.locator('#dropdown-settings')).toBeVisible();
    await page.click('#menu-settings');
    await expect(page.locator('#dropdown-settings')).toBeHidden();
  });

  test('checkable item keeps the menu open; action item closes it @fast', async ({ page }) => {
    await ready(page);

    // Settings ▸ Local echo is checkable — clicking keeps the menu open + toggles.
    // E3.2 — the row is now pref-backed (data-pref="localEcho"): clicking must ALSO
    // persist prefs.localEcho AND apply it to live keyboard.js state (persist ≠ apply).
    await page.click('#menu-settings');
    const localEcho = page.locator('#dropdown-settings .menu-item[data-variant="checkable"]');
    await expect(localEcho).toHaveAttribute('data-checked', 'false');
    await localEcho.click();
    await expect(localEcho).toHaveAttribute('data-checked', 'true');
    await expect(page.locator('#dropdown-settings')).toBeVisible();   // stays open
    // E3.2 (AC-1) — persisted (savePrefs) AND applied live (setLocalEcho ran, not just
    // the glyph flip). The two together are the "persist ≠ apply" correctness point.
    expect(await page.evaluate(() => window.__prefs.getPrefs().localEcho)).toBe(true);
    expect(await page.evaluate(() => window.__keyboardState.getLocalEcho())).toBe(true);

    // An action item closes the menu. E3.3 gave Settings two action rows: Reset all
    // preferences is now a 2-click confirm that STAYS open on the first activation
    // (its own dedicated behaviour — see menu-bar-settings-reset.spec.js), so the plain
    // action-closes contract is asserted here against Browser-reserved Ctrl combinations…
    // (closeMenu() then opens its modal).
    await page.locator('#dropdown-settings .menu-item[data-action="reserved-ctrl"]').click();
    await expect(page.locator('#dropdown-settings')).toBeHidden();
  });

  test('opening a menu retains terminal focus (retainFocus, AD-10) @fast', async ({ page }) => {
    await ready(page);
    await page.locator('#terminal-wrapper').focus();
    // Confirm the precondition took before driving the click — under heavy
    // parallel-boot load focus() can land late (E0 flake protocol).
    await expect
      .poll(() => page.evaluate(() => document.activeElement && document.activeElement.id))
      .toBe('terminal-wrapper');
    await page.click('#menu-view');
    await expect(page.locator('#dropdown-view')).toBeVisible();
    const active = await page.evaluate(() => document.activeElement && document.activeElement.id);
    expect(active).toBe('terminal-wrapper');
  });
});

test.describe('E1.1 AC-3 — four menu-item variants', () => {
  test('action row highlights with solid accent fill on [data-focused] @fast', async ({ page }) => {
    await ready(page);
    await page.click('#menu-view');
    const action = page.locator('#dropdown-view .menu-item[data-variant="action"]').first();

    // Base state: not filled.
    let bg = await action.evaluate((el) => getComputedStyle(el).backgroundColor);
    expect(bg).not.toBe(ACCENT_RGB);

    // Highlight is attribute-driven (NOT :focus-visible).
    await action.evaluate((el) => el.setAttribute('data-focused', 'true'));
    bg = await action.evaluate((el) => getComputedStyle(el).backgroundColor);
    expect(bg).toBe(ACCENT_RGB);
    const fg = await action.evaluate((el) => getComputedStyle(el).color);
    expect(fg).toBe(NEUTRAL_BG_RGB);   // chrome-bg text on accent fill
  });

  test('with-shortcut-hint shows a muted shortcut on the right @fast', async ({ page }) => {
    await ready(page);
    await page.click('#menu-view');
    const hint = page.locator('#dropdown-view .menu-item .hint').first();
    await expect(hint).toHaveText('Ctrl+=');
    const color = await hint.evaluate((el) => getComputedStyle(el).color);
    expect(color).toBe('rgba(255, 255, 255, 0.6)');   // chrome-muted
  });

  test('checkable shows a leading check glyph only when on @fast', async ({ page }) => {
    await ready(page);
    // E2.2 — Connection ▸ Auto-connect is now bound to prefs.autoConnect (default
    // false), so a fresh page starts UNCHECKED → no glyph.
    await page.click('#menu-connection');
    const auto = page.locator('#menu-autoconnect-item');
    await expect(auto).toHaveAttribute('data-checked', 'false');
    await expect(auto.locator('.check')).toHaveText('');
    // Toggle on → glyph present, aria in lockstep, and the menu STAYS OPEN
    // (checkable semantics — AC-1) with prefs.autoConnect persisted (AD-4).
    await auto.click();
    await expect(auto).toHaveAttribute('data-checked', 'true');
    await expect(auto).toHaveAttribute('aria-checked', 'true');
    await expect(auto.locator('.check')).toHaveText('✓');
    expect(await page.evaluate(() => window.__menuBar.getOpenMenu())).toBe('connection');
    expect(await page.evaluate(() => window.__prefs.getPrefs().autoConnect)).toBe(true);
    // Toggle off → glyph gone.
    await auto.click();
    await expect(auto).toHaveAttribute('data-checked', 'false');
    await expect(auto.locator('.check')).toHaveText('');
    expect(await page.evaluate(() => window.__prefs.getPrefs().autoConnect)).toBe(false);
  });

  test('radio-submenu uses the ▸ caret @fast', async ({ page }) => {
    await ready(page);
    await page.click('#menu-view');
    const theme = page.locator('#dropdown-view .menu-item[data-variant="radio-submenu"]').first();
    await expect(theme.locator('.caret')).toHaveText('▸');
  });

  test('disabled is muted, has a title tooltip, and no hover fill + inert @fast', async ({ page }) => {
    await ready(page);
    // E2.2 — the former Connection ▸ Choose MicroBeast… disabled placeholder is
    // now a live, count-gated action row, so this exercises the File ▸ Download
    // Session Log row (disabled until the first RX byte). Target it by id: the File
    // menu now has TWO disabled rows pre-Connect (Send File… mirrors the send gate
    // too — E3.1 follow-up), so a bare [data-disabled] locator is no longer unique.
    await page.click('#menu-file');
    const disabled = page.locator('#dropdown-file #menu-download-log-item[data-disabled="true"]');
    await expect(disabled).toHaveAttribute('title', /.+/);
    const color = await disabled.evaluate((el) => getComputedStyle(el).color);
    expect(color).toBe('rgba(255, 255, 255, 0.6)');   // chrome-muted

    // Hover sets no background fill.
    await disabled.hover();
    const bg = await disabled.evaluate((el) => getComputedStyle(el).backgroundColor);
    expect(bg).toBe('rgba(0, 0, 0, 0)');

    // Correct ARIA disabled state (exposed to AT, unlike data-* alone).
    await expect(disabled).toHaveAttribute('aria-disabled', 'true');

    // Inert — clicking it neither closes the menu nor throws. force:true
    // bypasses Playwright's actionability guard (which honours aria-disabled),
    // simulating the physical click a real user can still perform on this
    // aria-disabled-but-not-natively-disabled <button>; the onItemClick
    // data-disabled guard is what keeps it inert.
    await disabled.click({ force: true });
    await expect(page.locator('#dropdown-file')).toBeVisible();
  });
});

test.describe('E1.1 AC-5 — neutral, non-adaptive shell', () => {
  test('menu bar renders identically across CRT↔Console @fast', async ({ page }) => {
    await ready(page);

    // Default theme is CRT. Capture the bar background + an open-title accent.
    await page.click('#menu-file');
    const crtBarBg = await page.$eval('#menu-bar', (el) => getComputedStyle(el).backgroundColor);
    const crtTitleBg = await page.$eval('#menu-file', (el) => getComputedStyle(el).backgroundColor);
    expect(crtBarBg).toBe(NEUTRAL_BG_RGB);
    expect(crtTitleBg).toBe(ACCENT_RGB);
    await page.click('#terminal-wrapper');   // close (also focuses wrapper for the chord)

    // Toggle to Console (clean) via the Ctrl+Alt+T chord (E1.4 retired
    // #theme-toggle). The theme flips the canvas; the menu bar must NOT change.
    await page.keyboard.press('Control+Alt+KeyT');
    await expect(page.locator('body')).toHaveAttribute('data-theme', 'clean');

    await page.click('#menu-file');
    const cleanBarBg = await page.$eval('#menu-bar', (el) => getComputedStyle(el).backgroundColor);
    const cleanTitleBg = await page.$eval('#menu-file', (el) => getComputedStyle(el).backgroundColor);
    expect(cleanBarBg).toBe(crtBarBg);
    expect(cleanTitleBg).toBe(crtTitleBg);
  });
});

test.describe('E1.1 ARIA state — roles carry their required state attributes', () => {
  test('aria-expanded on a title mirrors open/closed @fast', async ({ page }) => {
    await ready(page);
    const view = page.locator('#menu-view');
    await expect(view).toHaveAttribute('aria-expanded', 'false');
    await view.click();
    await expect(view).toHaveAttribute('aria-expanded', 'true');
    await page.click('#terminal-wrapper');   // click-away closes
    await expect(view).toHaveAttribute('aria-expanded', 'false');
  });

  test('aria-checked on a menuitemcheckbox tracks data-checked and toggles @fast', async ({ page }) => {
    await ready(page);
    // E2.2 — Connection ▸ Auto-connect is prefs-bound (default false) → starts unchecked.
    await page.click('#menu-connection');
    const auto = page.locator('#menu-autoconnect-item');
    await expect(auto).toHaveAttribute('aria-checked', 'false');
    await auto.click();
    await expect(auto).toHaveAttribute('aria-checked', 'true');    // toggled + conveyed to AT
    await expect(auto).toHaveAttribute('data-checked', 'true');    // stays in lockstep
  });

  test('disabled items expose aria-disabled to assistive tech @fast', async ({ page }) => {
    await ready(page);
    // E2.2 — Connection's disabled placeholder is gone; File ▸ Download Session Log
    // is the disabled-by-default row (dynamic since E3.1 — enables on first RX byte).
    // Target it by id: Send File… is also disabled pre-Connect (mirrors the send gate),
    // so a bare [data-disabled] locator matches two rows.
    await page.click('#menu-file');
    const disabled = page.locator('#dropdown-file #menu-download-log-item[data-disabled="true"]');
    await expect(disabled).toHaveAttribute('aria-disabled', 'true');
  });
});

// Epic E3 Story E3.1 — File ▸ Send File… + Download Session Log wiring.
// The two inert File rows are now live action items driving the existing
// picker→#send-modal path and session-log download() via injected opts (AD-3).
// Covers AC-1 (Send File… action semantics + retainFocus), AC-4 (disabled-until-
// bytes + inert), AC-5/AC-7 (enable transition via the session-log onStateChange
// hook + the projectSessionLog projector). The menu-triggered picker→modal and
// the menu-triggered download live in file-source.spec.js / log-download.spec.js
// (transport-adjacent), leaving the pure render/projection assertions here.
const SESSION_LOG_ENABLED_TIP = 'Download all bytes received this connection (.bin)';
const SESSION_LOG_DISABLED_TIP = 'No bytes received yet';

test.describe('E3.1 — File menu Send File… + Download Session Log', () => {
  test('Send File… mirrors the send gate — disabled + inert pre-Connect, retains focus @fast', async ({ page }) => {
    await ready(page);
    await page.locator('#terminal-wrapper').focus();
    // E3.1 follow-up — Send File… now mirrors #send-file-button's gate: pre-Connect the
    // writer isn't ready, so the row is disabled + inert (like Download Session Log
    // below it), not a menu-closing action. Its enabled action-semantics + picker-open
    // are covered by the connected path in file-source.spec.js.
    await expect(page.locator('#send-file-button')).toBeDisabled();
    await page.evaluate(() => window.__menuBar.open('file'));
    const row = page.locator('#dropdown-file .menu-item[data-action="send-file"]');
    await expect(row).toHaveAttribute('data-disabled', 'true');
    await expect(row).toHaveAttribute('aria-disabled', 'true');
    await expect(row).toHaveAttribute('title', 'Connect to a serial port first');
    // force:true bypasses the aria-disabled actionability guard, simulating the physical
    // click a user can still land; the onItemClick data-disabled guard keeps it inert —
    // the menu stays open, nothing throws, and retainFocus leaves focus on the wrapper.
    await row.click({ force: true });
    await expect(page.locator('#dropdown-file')).toBeVisible();
    expect(await page.evaluate(() => document.activeElement.id)).toBe('terminal-wrapper');
  });

  test('Download Session Log is disabled + inert with no bytes (AC-4) @fast', async ({ page }) => {
    await ready(page);
    await page.evaluate(() => window.__menuBar.open('file'));
    const row = page.locator('#menu-download-log-item');
    await expect(row).toHaveAttribute('data-disabled', 'true');
    await expect(row).toHaveAttribute('aria-disabled', 'true');
    await expect(row).toHaveAttribute('title', SESSION_LOG_DISABLED_TIP);
    // force:true bypasses Playwright's aria-disabled actionability guard, simulating
    // the physical click a user can still land; the onItemClick data-disabled guard
    // must keep it inert — the menu stays open and nothing throws.
    await row.click({ force: true });
    await expect(page.locator('#dropdown-file')).toBeVisible();
  });

  test('Download Session Log enables on first RX byte via the onStateChange hook (AC-5/AC-7) @fast', async ({ page }) => {
    await ready(page);
    // Push a byte through the real session-log accumulator; its onStateChange hook
    // re-projects the menu row to enabled without the menu being reopened.
    await page.evaluate(() => window.__sessionLog.append(new Uint8Array([0x41])));
    const row = page.locator('#menu-download-log-item');
    await expect(row).not.toHaveAttribute('data-disabled', 'true');
    await expect(row).not.toHaveAttribute('aria-disabled', 'true');
    await expect(row).toHaveAttribute('title', SESSION_LOG_ENABLED_TIP);
    // The now-enabled row is a live action (open-time projection agrees).
    await page.evaluate(() => window.__menuBar.open('file'));
    await expect(row).not.toHaveAttribute('data-disabled', 'true');
  });

  test('projectSessionLog drives the row from the live byte count directly @fast', async ({ page }) => {
    await ready(page);
    await page.evaluate(() => window.__sessionLog.append(new Uint8Array([1, 2, 3])));
    // Drive the projector directly (mirrors projectConnection in the E2 specs).
    await page.evaluate(() => window.__menuBar.projectSessionLog());
    const row = page.locator('#menu-download-log-item');
    await expect(row).not.toHaveAttribute('data-disabled', 'true');
    await expect(row).toHaveAttribute('title', SESSION_LOG_ENABLED_TIP);
  });
});
