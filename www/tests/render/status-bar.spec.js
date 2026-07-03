// Epic E4 Story E4.1 — bottom status bar: connection & device/baud readout.
//
// The NEW E4.1 slice: a permanent #status-bar footer whose connection group is
// projected by www/renderer/status-bar.js — a subscriber fed by serial.js's
// state machine (AD-6, fed never owned) and the sole writer of #status-conn-dot
// (discrete colour) + #port-status (aria-live device/baud line). #port-status is
// relocated OUT of the vestigial <details id="connection"> into the bar.
//
// This spec proves: (AC-2) the four discrete dot colours per state, snapped not
// animated, red reserved for port-lost; (AC-3) the #port-status text per state —
// the composed connected line + Not connected + the three transitional labels —
// and aria-live=polite; (AC-4) exactly one #port-status, living in #status-bar
// and NOT in #connection. Discrete states are driven through the sole writer
// (window.__statusBar.projectConnection) so the transient connecting/reconnecting
// labels are catchable without racing a live handshake; a real mock-serial cycle
// additionally proves the subscription re-projects the bar end-to-end.
//
// Boot-race guard (E0.1 learning): wait on window.__statusBar before driving it.
import { test, expect } from '@playwright/test';
import { SERIAL_MOCK } from '../transport/mock-serial.js';

const BAR  = '#status-bar';
const DOT  = '#status-conn-dot';
const TEXT = '#port-status';

// Boot the full app with the Web Serial mock installed BEFORE any module loads,
// then wait for the status-bar API + size the canvas.
async function ready(page) {
  await page.addInitScript(SERIAL_MOCK);
  await page.goto('/');
  await page.waitForFunction(
    () => window.__statusBar && typeof window.__statusBar.__getStateForTests === 'function',
  );
  await page.locator('#terminal-wrapper').focus();
  await page.waitForFunction(() => document.getElementById('terminal').width > 0);
}

// Drive a discrete state through the SOLE writer (no serial handshake) so the
// transient connecting/reconnecting labels are catchable deterministically.
async function project(page, state) {
  await page.evaluate((s) => window.__statusBar.projectConnection(s), state);
}

// The per-state #port-status oracle. `connected` is the composed device/baud line
// (default prefs → 19200 8N1); the em-dash is U+2014, ellipsis U+2026. The four
// non-connected values are IDENTICAL to menu-bar.js CONN_STATUS_LABELS (AD-6).
const CONNECTED_LINE = 'MicroBeast (CP2102N 10c4:ea60) — 19200 8N1';
const STATUS_TEXT = {
  disconnected: 'Not connected',
  connecting: 'Connecting…',
  connected: CONNECTED_LINE,
  reconnecting: 'Reconnecting…',
  'port-lost': 'Connection lost',
};

test.describe('E4.1 AC-3 — #port-status text per state (aria-live, single writer)', () => {
  test('initial paint is disconnected: "Not connected", polite aria-live @fast', async ({ page }) => {
    await ready(page);
    await expect(page.locator(TEXT)).toHaveText('Not connected');
    await expect(page.locator(TEXT)).toHaveAttribute('aria-live', 'polite');
    await expect(page.locator(DOT)).toHaveAttribute('data-state', 'disconnected');
  });

  test('every state paints the exact #port-status text + dot data-state in lockstep @fast', async ({ page }) => {
    await ready(page);
    for (const state of ['connecting', 'connected', 'reconnecting', 'port-lost', 'disconnected']) {
      await project(page, state);
      await expect(page.locator(TEXT)).toHaveText(STATUS_TEXT[state]);
      await expect(page.locator(DOT)).toHaveAttribute('data-state', state);
    }
  });

  test('the connected line composes baud/framing from prefs.serial @fast', async ({ page }) => {
    await ready(page);
    // Default prefs → 19200 8N1. Change the baud in prefs; the NEXT connected
    // projection reflects it (read-at-use, not cached — AD-4 savePrefs no fan-out).
    await project(page, 'connected');
    await expect(page.locator(TEXT)).toHaveText('MicroBeast (CP2102N 10c4:ea60) — 19200 8N1');
    await page.evaluate(() => {
      const p = window.__prefs.getPrefs();
      window.__prefs.savePrefs({ ...p, serial: { ...p.serial, baud: 115200 } });
    });
    // Re-project connected → picks up the new baud.
    await project(page, 'connected');
    await expect(page.locator(TEXT)).toHaveText('MicroBeast (CP2102N 10c4:ea60) — 115200 8N1');
  });
});

test.describe('E4.1 review fixes — connected framing + connect-error readout', () => {
  // Fix #2 — the connected line must report the framing the LIVE port was ACTUALLY
  // opened with (serial.js lastConfig), NOT getPrefs().serial. A mid-session
  // serial-config change persists to prefs immediately but only takes effect on the
  // next open (the "Disconnect and Connect to apply" hint); a prefs-derived readout
  // would misreport the wire framing after a reconnect re-opens with the old config.
  test('connected line reports live open-config framing, not unapplied prefs (fix #2)', async ({ page }) => {
    await ready(page);
    // Real connect through the serial path → opened at the default 19200 8N1.
    await page.click('#connect-button');
    await expect(page.locator(TEXT)).toHaveText(CONNECTED_LINE);
    // Persist a NEW baud to prefs WITHOUT re-opening the port (the live port stays
    // 19200 — exactly the scenario the reconnect-required hint covers).
    await page.evaluate(() => {
      const p = window.__prefs.getPrefs();
      window.__prefs.savePrefs({ ...p, serial: { ...p.serial, baud: 115200 } });
    });
    // Unplug → port-lost, then replug → the reconnect re-opens with lastConfig
    // (19200) and re-projects 'connected'. The bar must still read 19200, not the
    // unapplied 115200 sitting in prefs. (Pre-fix, formatFraming() read prefs → 115200.)
    await page.evaluate(() => window.__simulateUnplug());
    await expect(page.locator(DOT)).toHaveAttribute('data-state', 'port-lost');
    await page.evaluate(() => window.__simulateReplug());
    await expect(page.locator(DOT)).toHaveAttribute('data-state', 'connected');
    await expect(page.locator(TEXT)).toHaveText('MicroBeast (CP2102N 10c4:ea60) — 19200 8N1');
  });

  // Fix #4 — a connect-TIME failure (open-failed / port-in-use) lands in state
  // 'disconnected', whose dot is gray by design (red reserved for port-lost). Once
  // the D-27 pane auto-expand was removed, nothing visibly distinguished a failed
  // Connect from idle; the bar must surface the error message in its readout.
  test('a connect-time open failure surfaces its message in the bar, then clears on retry (fix #4)', async ({ page }) => {
    await ready(page);
    await expect(page.locator(TEXT)).toHaveText('Not connected');
    // Force the next open() to reject → 'Could not open port: boom'.
    await page.evaluate(() => { window.__forceOpenReject = 'boom'; });
    await page.click('#connect-button');
    // Back to 'disconnected' (gray dot) BUT the readout shows the failure, not idle.
    await expect(page.locator(DOT)).toHaveAttribute('data-state', 'disconnected');
    await expect(page.locator(TEXT)).toHaveText('Could not open port: boom');
    // A fresh, successful attempt clears the cue and shows the connected line.
    await page.evaluate(() => { window.__forceOpenReject = undefined; });
    await page.click('#connect-button');
    await expect(page.locator(DOT)).toHaveAttribute('data-state', 'connected');
    await expect(page.locator(TEXT)).toHaveText(CONNECTED_LINE);
  });
});

test.describe('E4.1 AC-2 — discrete dot colours, snap not animate, red reserved', () => {
  test('each state maps to its discrete --status token; red only for port-lost', async ({ page }) => {
    await ready(page);
    const bgFor = async (state) => {
      await project(page, state);
      return page.$eval(DOT, (el) => getComputedStyle(el).backgroundColor);
    };
    expect(await bgFor('disconnected')).toBe('rgba(255, 255, 255, 0.4)'); // --status-gray
    expect(await bgFor('connecting')).toBe('rgb(224, 176, 48)');          // --status-amber
    expect(await bgFor('reconnecting')).toBe('rgb(224, 176, 48)');        // amber (same)
    expect(await bgFor('connected')).toBe('rgb(51, 255, 102)');           // --status-green
    expect(await bgFor('port-lost')).toBe('rgb(224, 64, 64)');            // --status-red (reserved)
    // No CSS transition on the dot — the state change is a discrete snap (UX-DR3).
    const transition = await page.$eval(DOT, (el) => getComputedStyle(el).transitionProperty);
    expect(transition === 'all' || transition === 'none' || transition === '').toBeTruthy();
    // No glow — DESIGN.md's no-shadow rule overrides the mockup box-shadow.
    const shadow = await page.$eval(DOT, (el) => getComputedStyle(el).boxShadow);
    expect(shadow === 'none' || shadow === '').toBeTruthy();
  });

  test('the bar renders identically under CRT and Console (neutral shell, AD-9)', async ({ page }) => {
    await ready(page);
    await project(page, 'connected');
    const read = () => page.$eval(DOT, (el) => getComputedStyle(el).backgroundColor);
    const barBg = () => page.$eval(BAR, (el) => getComputedStyle(el).backgroundColor);
    const crtDot = await read();
    const crtBar = await barBg();
    // Flip to the clean/Console theme — data-theme lives on <body> (set by
    // setTheme). The bar pins --chrome-bg, so its background must not budge.
    await page.evaluate(() => document.body.setAttribute('data-theme', 'clean'));
    expect(await read()).toBe(crtDot);
    expect(await barBg()).toBe(crtBar);
  });
});

test.describe('E4.1 AC-4 — #port-status relocated: exactly one, in the bar', () => {
  test('exactly one #port-status exists, inside #status-bar and not in #connection @fast', async ({ page }) => {
    await ready(page);
    expect(await page.locator(TEXT).count()).toBe(1);
    expect(await page.locator(`${BAR} ${TEXT}`).count()).toBe(1);
    expect(await page.locator(`#connection ${TEXT}`).count()).toBe(0);
    // The decorative dot is hidden from the a11y tree.
    await expect(page.locator(DOT)).toHaveAttribute('aria-hidden', 'true');
  });
});

test.describe('E4.1 AC-1 — fed by the subscription end-to-end (mock-serial cycle)', () => {
  test('a real connect/unplug/replug cycle re-projects the bar via onStateChange', async ({ page }) => {
    await ready(page);
    // Connect through the unchanged serial path (the legacy button drives the toggle).
    await page.click('#connect-button');
    await expect(page.locator(DOT)).toHaveAttribute('data-state', 'connected');
    await expect(page.locator(TEXT)).toHaveText(CONNECTED_LINE);
    // Unplug → port-lost (red / "Connection lost").
    await page.evaluate(() => window.__simulateUnplug());
    await expect(page.locator(DOT)).toHaveAttribute('data-state', 'port-lost');
    await expect(page.locator(TEXT)).toHaveText('Connection lost');
    // Replug with matching VID/PID → silent auto-reconnect back to connected.
    await page.evaluate(() => window.__simulateReplug());
    await expect(page.locator(DOT)).toHaveAttribute('data-state', 'connected');
    await expect(page.locator(TEXT)).toHaveText(CONNECTED_LINE);
  });

  test('dispose() unsubscribes — later transitions no longer re-project the bar', async ({ page }) => {
    await ready(page);
    await page.click('#connect-button');
    await expect(page.locator(DOT)).toHaveAttribute('data-state', 'connected');
    await page.evaluate(() => window.__statusBar.dispose());
    await page.evaluate(() => window.__simulateUnplug());
    await page.waitForTimeout(200);
    // Unsubscribed projector leaves the dot at its last painted state.
    await expect(page.locator(DOT)).toHaveAttribute('data-state', 'connected');
  });
});
