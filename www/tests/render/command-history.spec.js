// Epic E8 Story E8.1 — command capture engine (line mirror + history store).
//
// The invisible capture engine: www/input/command-history.js reconstructs the
// typed input line from outbound keystrokes (a JS-shell "line mirror") and commits
// it to a prefs-persisted, newest-first history store on each Enter. It is pure
// observation — it never emits a byte (NFR-2). This story ships NO visible surface;
// the engine is exercised through window.__commandHistory (mirrors window.__statusBar
// / window.__menuBar) and its __getStateForTests hook.
//
// This spec proves, via programmatic window.__commandHistory.capture({...}) feeds
// plus a real-keyboard wiring check:
//   AC-1 commit-on-Enter (+ mirror reset) and the choke-point hook is actually wired
//   AC-2 Backspace pops / Ctrl-U / Ctrl-X clear / non-editing keys are inert
//   AC-3 empty Enter stores nothing; duplicates collapse to newest
//   AC-4 SLIDE-owner suspends capture; disabled early-returns (inert)
//   AC-5 size cap enforced, oldest (tail) dropped
//   AC-6 persistence across reload; corrupt/predate-feature blobs degrade safely
//
// Boot-race guard (E0.1 learning): wait on window.__commandHistory before driving it.
import { test, expect } from '@playwright/test';

// Boot the app and wait for the engine hook. No serial mock needed — the engine
// touches neither serial nor wasm (NFR-1); the real-keyboard test additionally
// waits on the canvas so the wasm encoder is ready.
async function ready(page) {
  await page.goto('/');
  await page.waitForFunction(
    () => window.__commandHistory
      && typeof window.__commandHistory.__getStateForTests === 'function',
  );
  await page.locator('#terminal-wrapper').focus();
}

// --- Programmatic keystroke feeds (mirror keyboard.js's { e, code, mods, bytes,
// wasEnter } info shape at the choke point). ---------------------------------

// Feed each printable char of `str` as a Char-tag keystroke (low byte of code is
// the KEY_TAG.Char=0 tag; byte is the ASCII code; no modifiers).
async function typeStr(page, str) {
  await page.evaluate((s) => {
    for (const ch of s) {
      const b = ch.charCodeAt(0);
      window.__commandHistory.capture({
        e: { key: ch }, code: (b << 8), mods: 0,
        bytes: new Uint8Array([b]), wasEnter: false,
      });
    }
  }, str);
}

// Feed one named control keystroke.
async function pressKey(page, name) {
  await page.evaluate((n) => {
    const B = (arr) => new Uint8Array(arr);
    const map = {
      enter:     { e: { key: 'Enter' },     code: 5,          mods: 0,      bytes: B([0x0D]),       wasEnter: true },
      backspace: { e: { key: 'Backspace' }, code: 7,          mods: 0,      bytes: B([0x08]),       wasEnter: false },
      ctrlu:     { e: { key: 'u' },         code: (0x75 << 8), mods: 0b0001, bytes: B([0x15]),      wasEnter: false },
      ctrlx:     { e: { key: 'x' },         code: (0x78 << 8), mods: 0b0001, bytes: B([0x18]),      wasEnter: false },
      tab:       { e: { key: 'Tab' },       code: 6,          mods: 0,      bytes: B([0x09]),       wasEnter: false },
      esc:       { e: { key: 'Escape' },    code: 8,          mods: 0,      bytes: B([0x1B]),       wasEnter: false },
      arrowup:   { e: { key: 'ArrowUp' },   code: 1,          mods: 0,      bytes: B([0x1B, 0x41]), wasEnter: false },
    };
    window.__commandHistory.capture(map[n]);
  }, name);
}

const state   = (page) => page.evaluate(() => window.__commandHistory.__getStateForTests());
const history = (page) => page.evaluate(() => window.__commandHistory.getHistory());

// ============================================================================
test.describe('E8.1 AC-1 — line mirror reconstructs + commits on Enter', () => {
  test('type DIR then Enter → stores DIR (newest), mirror resets @fast', async ({ page }) => {
    await ready(page);
    await typeStr(page, 'DIR');
    expect((await state(page)).mirror).toBe('DIR');
    expect(await page.evaluate(() => window.__commandHistory.isLineEmpty())).toBe(false);

    await pressKey(page, 'enter');
    expect(await history(page)).toEqual(['DIR']);
    expect((await state(page)).mirror).toBe('');
    expect(await page.evaluate(() => window.__commandHistory.isLineEmpty())).toBe(true);
  });

  test('Enter commits regardless of crlfMode (commit keys off wasEnter) @fast', async ({ page }) => {
    await ready(page);
    // crlfMode only rewrites the wire byte in forwardBytes; it never reaches
    // capture, which commits on the wasEnter terminator. Prove it under 'crlf'.
    await page.evaluate(() => window.__prefs.savePrefs({ crlfMode: 'crlf' }));
    await typeStr(page, 'LIST');
    await pressKey(page, 'enter');
    expect(await history(page)).toEqual(['LIST']);
  });

  test('real typed keystrokes reach the mirror (choke-point hook wired) @fast', async ({ page }) => {
    await ready(page);
    // Wait for the wasm encoder (canvas sized) so real keydowns encode to bytes.
    await page.waitForFunction(() => document.getElementById('terminal').width > 0);
    await page.keyboard.type('DIR');
    expect((await state(page)).mirror).toBe('DIR');
    await page.keyboard.press('Enter');
    expect(await history(page)).toEqual(['DIR']);
    expect((await state(page)).mirror).toBe('');
  });
});

// ============================================================================
test.describe('E8.1 AC-2 — corrections + inert keys', () => {
  test('Backspace pops the last char @fast', async ({ page }) => {
    await ready(page);
    await typeStr(page, 'DIRR');
    await pressKey(page, 'backspace');
    await pressKey(page, 'enter');
    expect(await history(page)).toEqual(['DIR']);
  });

  test('Ctrl-U clears the whole line @fast', async ({ page }) => {
    await ready(page);
    await typeStr(page, 'MISTAKE');
    await pressKey(page, 'ctrlu');
    await typeStr(page, 'DIR');
    await pressKey(page, 'enter');
    expect(await history(page)).toEqual(['DIR']);
  });

  test('Ctrl-X clears the whole line @fast', async ({ page }) => {
    await ready(page);
    await typeStr(page, 'JUNK');
    await pressKey(page, 'ctrlx');
    expect((await state(page)).mirror).toBe('');
  });

  test('Backspace on empty mirror is a no-op (no underflow) @fast', async ({ page }) => {
    await ready(page);
    await pressKey(page, 'backspace');
    expect((await state(page)).mirror).toBe('');
  });

  test('arrows / Esc / Tab leave the mirror unchanged @fast', async ({ page }) => {
    await ready(page);
    await typeStr(page, 'DIR');
    await pressKey(page, 'arrowup');
    await pressKey(page, 'esc');
    await pressKey(page, 'tab');
    expect((await state(page)).mirror).toBe('DIR');
    await pressKey(page, 'enter');
    expect(await history(page)).toEqual(['DIR']);
  });
});

// ============================================================================
test.describe('E8.1 AC-3 — empty guard + dedup-to-newest', () => {
  test('Enter on an empty mirror stores nothing @fast', async ({ page }) => {
    await ready(page);
    await pressKey(page, 'enter');
    expect(await history(page)).toEqual([]);
  });

  test('duplicate command collapses to a single newest entry @fast', async ({ page }) => {
    await ready(page);
    for (const cmd of ['DIR', 'LIST', 'DIR']) {
      await typeStr(page, cmd);
      await pressKey(page, 'enter');
    }
    // DIR re-sorts to newest; LIST retained once — not [DIR, LIST, DIR].
    expect(await history(page)).toEqual(['DIR', 'LIST']);
  });

  test('dedup is exact-string / case-sensitive @fast', async ({ page }) => {
    await ready(page);
    for (const cmd of ['dir', 'DIR']) {
      await typeStr(page, cmd);
      await pressKey(page, 'enter');
    }
    expect(await history(page)).toEqual(['DIR', 'dir']);
  });
});

// ============================================================================
test.describe('E8.1 AC-4 — SLIDE-suspend + disabled-inert', () => {
  test('no capture while a SLIDE transfer owns the wire @fast', async ({ page }) => {
    await ready(page);
    await page.evaluate(() => window.__txSink.setWireOwner('slide'));
    await typeStr(page, 'DIR');
    await pressKey(page, 'enter');
    expect((await state(page)).mirror).toBe('');
    expect(await history(page)).toEqual([]);
    // Restore for hygiene, then confirm capture resumes.
    await page.evaluate(() => window.__txSink.setWireOwner('terminal'));
    await typeStr(page, 'LIST');
    await pressKey(page, 'enter');
    expect(await history(page)).toEqual(['LIST']);
  });

  test('disabled engine early-returns doing no work @fast', async ({ page }) => {
    await ready(page);
    await page.evaluate(() => window.__prefs.savePrefs({ commandHistoryEnabled: false }));
    await typeStr(page, 'DIR');
    await pressKey(page, 'enter');
    expect((await state(page)).mirror).toBe('');
    expect(await history(page)).toEqual([]);
  });
});

// ============================================================================
test.describe('E8.1 AC-5 — size cap', () => {
  test('oldest (tail) dropped when the cap is exceeded @fast', async ({ page }) => {
    await ready(page);
    await page.evaluate(() => window.__prefs.savePrefs({ commandHistorySize: 3 }));
    for (const cmd of ['A', 'B', 'C', 'D']) {
      await typeStr(page, cmd);
      await pressKey(page, 'enter');
    }
    // Newest-first, capped at 3: D,C,B kept; A (oldest tail) evicted.
    expect(await history(page)).toEqual(['D', 'C', 'B']);
  });
});

// ============================================================================
test.describe('E8.1 AC-6 — persistence + safe degrade', () => {
  test('history restores from persisted prefs after reload @fast', async ({ page }) => {
    await ready(page);
    // Seed the blob directly, then reload so loadPrefs restores it (AC-8 recipe).
    await page.evaluate(() =>
      localStorage.setItem('beastty.prefs',
        JSON.stringify({ version: 1, commandHistory: ['ALPHA', 'BETA'] })));
    await page.reload();
    await page.waitForFunction(() => window.__commandHistory);
    expect(await history(page)).toEqual(['ALPHA', 'BETA']);
  });

  test('corrupt prefs blob degrades to empty history (never throws) @fast', async ({ page }) => {
    await ready(page);
    await page.evaluate(() => localStorage.setItem('beastty.prefs', '{not valid json'));
    await page.reload();
    await page.waitForFunction(() => window.__commandHistory);
    expect(await history(page)).toEqual([]);
  });

  test('pre-feature blob loads with the three new keys defaulted @fast', async ({ page }) => {
    await ready(page);
    // A stored blob predating E8.1 carries none of the command-history keys.
    await page.evaluate(() =>
      localStorage.setItem('beastty.prefs', JSON.stringify({ version: 1, theme: 'crt' })));
    await page.reload();
    await page.waitForFunction(() => window.__commandHistory);
    const s = await state(page);
    expect(s.enabled).toBe(true);
    expect(s.size).toBe(100);
    expect(s.history).toEqual([]);
  });
});
