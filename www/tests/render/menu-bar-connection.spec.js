// Epic E2 Story E2.1 — Connect/Disconnect single-writer menu item.
//
// The NEW E2.1 slice: the connect-button DOM projection is injected OUT of
// serial.js and menu-bar.js becomes the SOLE writer of every Connect surface —
// the Connect menu item (label + data-state), the right-aligned status dot
// (discrete colour) + label, and — during coexistence — the legacy
// #connect-button. serial.js still owns the state MACHINE (onStateChange /
// getState / toggleConnection); menu-bar subscribes and projects.
//
// This spec proves: (1) the frozen 5-state label map + label↔dot↔button lockstep
// across ALL states incl. the transient connecting/reconnecting (driven
// deterministically via window.__menuBar.projectConnection — no serial race);
// (2) discrete, never-animated dot colours (AC-3); (3) the menu item + legacy
// button actually drive the serial toggle end-to-end over a mock-serial cycle
// (AC-2); (4) focus retention on the Connect click (AC-5 "Sacred"); (5) the
// out-of-band "Choose MicroBeast…" override (AC-4); (6) dispose() unsubscribes
// (AC-6). The transport/session #connect-button oracles stay green unchanged
// (Task 3 coexistence mirror) — verified by the existing transport suite.
//
// Boot-race guard (E0.1 learning): wait on window.__menuBar before driving it.
import { test, expect } from '@playwright/test';
import { SERIAL_MOCK } from '../transport/mock-serial.js';

const ITEM  = '#menu-connect-item';
const LBL   = '#menu-connect-item .lbl';
const DOT   = '#menu-conn-dot';
const CLBL  = '#menu-conn-label';
const LEGACY = '#connect-button';

// Boot the full app with the Web Serial mock installed BEFORE any module loads,
// then wait for the menu bar API + focus the terminal (the retainFocus target).
async function ready(page) {
  await page.addInitScript(SERIAL_MOCK);
  await page.goto('/');
  await page.waitForFunction(
    () => window.__menuBar && typeof window.__menuBar.__getStateForTests === 'function',
  );
  await page.locator('#terminal-wrapper').focus();
  await page.waitForFunction(() => document.getElementById('terminal').width > 0);
}

// Drive a discrete state through the SOLE writer (no serial handshake), so the
// transient connecting/reconnecting labels are catchable deterministically.
async function project(page, state) {
  await page.evaluate((s) => window.__menuBar.projectConnection(s), state);
}

// The frozen maps, mirrored here as the test oracle (verbatim incl. U+2026).
const CONNECT_LABELS = {
  disconnected: 'Connect',
  connecting: 'Connecting…',
  connected: 'Disconnect',
  reconnecting: 'Reconnecting…',
  'port-lost': 'Reconnect',
};
const STATUS_LABELS = {
  disconnected: 'Not connected',
  connecting: 'Connecting…',
  connected: 'Connected',
  reconnecting: 'Reconnecting…',
  'port-lost': 'Connection lost',
};

test.describe('E2.1 AC-1/AC-3 — sole writer: label ↔ dot ↔ button lockstep', () => {
  test('initial paint is disconnected: Connect / gray / "Not connected" @fast', async ({ page }) => {
    await ready(page);
    await expect(page.locator(ITEM)).toHaveAttribute('data-state', 'disconnected');
    await expect(page.locator(LBL)).toHaveText('Connect');
    await expect(page.locator(DOT)).toHaveAttribute('data-state', 'disconnected');
    await expect(page.locator(CLBL)).toHaveText('Not connected');
    await expect(page.locator(LEGACY)).toHaveText('Connect');
    await expect(page.locator(LEGACY)).toHaveAttribute('data-state', 'disconnected');
    // Gray disconnected token on the dot.
    const bg = await page.$eval(DOT, (el) => getComputedStyle(el).backgroundColor);
    expect(bg).toBe('rgba(255, 255, 255, 0.4)');
  });

  test('every state moves item label + item data-state + dot + status label + legacy button in lockstep @fast', async ({ page }) => {
    await ready(page);
    for (const state of ['connecting', 'connected', 'reconnecting', 'port-lost', 'disconnected']) {
      await project(page, state);
      // Connect ACTION label (item + legacy button) = the frozen CONNECT_LABELS.
      await expect(page.locator(LBL)).toHaveText(CONNECT_LABELS[state]);
      await expect(page.locator(LEGACY)).toHaveText(CONNECT_LABELS[state]);
      // data-state snaps together on item, dot, and legacy button.
      await expect(page.locator(ITEM)).toHaveAttribute('data-state', state);
      await expect(page.locator(DOT)).toHaveAttribute('data-state', state);
      await expect(page.locator(LEGACY)).toHaveAttribute('data-state', state);
      // Status label DESCRIBES the state (distinct from the action label).
      await expect(page.locator(CLBL)).toHaveText(STATUS_LABELS[state]);
    }
  });

  test('dot colours are discrete per state — amber transient, green connected, red port-lost only', async ({ page }) => {
    await ready(page);
    const bgFor = async (state) => {
      await project(page, state);
      return page.$eval(DOT, (el) => getComputedStyle(el).backgroundColor);
    };
    expect(await bgFor('connecting')).toBe('rgb(224, 176, 48)');    // --status-amber
    expect(await bgFor('reconnecting')).toBe('rgb(224, 176, 48)');  // amber (same as connecting)
    expect(await bgFor('connected')).toBe('rgb(51, 255, 102)');     // --status-green
    expect(await bgFor('port-lost')).toBe('rgb(224, 64, 64)');      // --status-red (reserved)
    expect(await bgFor('disconnected')).toBe('rgba(255, 255, 255, 0.4)'); // --status-gray
    // No CSS transition on the dot — the state change is a discrete snap (UX-DR3).
    const transition = await page.$eval(DOT, (el) => getComputedStyle(el).transitionProperty);
    expect(transition === 'all' || transition === 'none' || transition === '').toBeTruthy();
  });
});

test.describe('E2.1 AC-2 — the Connect item drives the unchanged serial path', () => {
  test('clicking the Connect menu item connects, then Disconnect disconnects (mock-serial cycle)', async ({ page }) => {
    await ready(page);
    // Open the Connection menu deterministically and click the Connect item.
    await page.evaluate(() => window.__menuBar.open('connection'));
    await page.click(ITEM);
    // The end state is stable 'connected' (the 'connecting' transient is fast).
    await expect(page.locator(DOT)).toHaveAttribute('data-state', 'connected');
    await expect(page.locator(LBL)).toHaveText('Disconnect');
    await expect(page.locator(CLBL)).toHaveText('Connected');
    // Menu closed after the action (action semantics).
    expect(await page.evaluate(() => window.__menuBar.getOpenMenu())).toBeNull();
    // Re-open + click again → disconnect.
    await page.evaluate(() => window.__menuBar.open('connection'));
    await page.click(ITEM);
    await expect(page.locator(DOT)).toHaveAttribute('data-state', 'disconnected');
    await expect(page.locator(LBL)).toHaveText('Connect');
  });

  test('port-lost → replug re-projects the menu surfaces via the subscription', async ({ page }) => {
    await ready(page);
    await page.evaluate(() => window.__menuBar.open('connection'));
    await page.click(ITEM);
    await expect(page.locator(DOT)).toHaveAttribute('data-state', 'connected');
    // Unplug → port-lost (red / Reconnect / Connection lost) across all surfaces.
    await page.evaluate(() => window.__simulateUnplug());
    await expect(page.locator(DOT)).toHaveAttribute('data-state', 'port-lost');
    await expect(page.locator(LBL)).toHaveText('Reconnect');
    await expect(page.locator(CLBL)).toHaveText('Connection lost');
    await expect(page.locator(LEGACY)).toHaveText('Reconnect');
    // Replug with matching VID/PID → silent auto-reconnect back to connected.
    await page.evaluate(() => window.__simulateReplug());
    await expect(page.locator(DOT)).toHaveAttribute('data-state', 'connected');
    await expect(page.locator(LBL)).toHaveText('Disconnect');
  });
});

test.describe('E2.1 AC-5 — focus retention (Sacred)', () => {
  test('clicking the Connect item never steals terminal focus', async ({ page }) => {
    await ready(page);
    await page.evaluate(() => window.__menuBar.open('connection'));
    await page.click(ITEM);
    await expect(page.locator(DOT)).toHaveAttribute('data-state', 'connected');
    expect(await page.evaluate(() => document.activeElement.id)).toBe('terminal-wrapper');
  });

  test('clicking the legacy #connect-button also retains focus + drives the toggle', async ({ page }) => {
    await ready(page);
    await page.click(LEGACY);
    await expect(page.locator(LEGACY)).toHaveAttribute('data-state', 'connected');
    // The menu item mirrors the same state (single source of truth).
    await expect(page.locator(ITEM)).toHaveAttribute('data-state', 'connected');
    expect(await page.evaluate(() => document.activeElement.id)).toBe('terminal-wrapper');
  });
});

test.describe('E2.1 AC-4 — "Choose MicroBeast…" out-of-band override', () => {
  test('signalConnectLabel paints the override onto the Connect item + legacy button', async ({ page }) => {
    await ready(page);
    // Simulate the multi-adapter guard handing the label to the sole writer.
    await page.evaluate(() => window.__menuBar.signalConnectLabel('Choose MicroBeast…'));
    await expect(page.locator(LBL)).toHaveText('Choose MicroBeast…');
    await expect(page.locator(LEGACY)).toHaveText('Choose MicroBeast…');
    // The next state projection re-takes the surfaces (override is transient).
    await project(page, 'disconnected');
    await expect(page.locator(LBL)).toHaveText('Connect');
    await expect(page.locator(LEGACY)).toHaveText('Connect');
  });
});

test.describe('E2.1 AC-6 — dispose() unsubscribes the state subscriber', () => {
  test('after dispose, serial transitions no longer re-project the menu surfaces', async ({ page }) => {
    await ready(page);
    await page.click(LEGACY);
    await expect(page.locator(DOT)).toHaveAttribute('data-state', 'connected');
    // Dispose the bar, then unplug: the machine transitions to port-lost but the
    // unsubscribed projector must NOT touch the dot — it stays 'connected'.
    await page.evaluate(() => window.__menuBar.dispose());
    await page.evaluate(() => window.__simulateUnplug());
    // Give any (erroneous) async projection a beat to land, then assert no change:
    // an unsubscribed projector leaves the dot at its last painted state.
    await page.waitForTimeout(200);
    await expect(page.locator(DOT)).toHaveAttribute('data-state', 'connected');
  });
});
