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

  test('numeric-keypad digits reach the mirror (Keypad* tag, not Char) @fast', async ({ page }) => {
    await ready(page);
    await page.waitForFunction(() => document.getElementById('terminal').width > 0);
    // Numpad keys encode to '0'-'9' off e.code (key.rs KeypadDigit) — a Keypad* tag,
    // not Char, and e.key reads 'End'/'Insert' under NumLock-off (Playwright's
    // default). The mirror must key off the wire byte or it desyncs from what was
    // actually sent: `GOTO 100` typed with the keypad must NOT store as `GOTO `.
    await page.keyboard.type('GOTO ');
    await page.keyboard.press('Numpad1');
    await page.keyboard.press('Numpad0');
    await page.keyboard.press('Numpad0');
    expect((await state(page)).mirror).toBe('GOTO 100');
    await page.keyboard.press('Enter');
    expect(await history(page)).toEqual(['GOTO 100']);
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

// ============================================================================
// E8 escape hatch (2026-08-06) — toggleEnabled() is the pref flip behind the
// Ctrl+Shift+Insert / Ctrl+Alt+H chord. It writes the SAME commandHistoryEnabled
// pref the Settings ▸ Command history checkbox drives, so there is one notion of
// "on"; these tests pin the round-trip, the persistence, and the two real chords.
test.describe('E8 escape hatch — toggleEnabled() + the chords that call it', () => {
  // ready() above waits only on window.__commandHistory (wired early in main.js).
  // The chord tests also read the toast and the TX sink, both exposed further down
  // the composition root, so wait for those too rather than assume the boot order.
  async function readyWithToast(page) {
    await ready(page);
    await page.waitForFunction(() => window.__toast && window.__txSink);
  }

  test('toggleEnabled() returns the NEW value and flips the pref @fast', async ({ page }) => {
    await ready(page);
    expect((await state(page)).enabled).toBe(true);            // default

    expect(await page.evaluate(() => window.__commandHistory.toggleEnabled())).toBe(false);
    expect(await page.evaluate(() => window.__prefs.getPrefs().commandHistoryEnabled)).toBe(false);
    expect((await state(page)).enabled).toBe(false);

    expect(await page.evaluate(() => window.__commandHistory.toggleEnabled())).toBe(true);
    expect(await page.evaluate(() => window.__prefs.getPrefs().commandHistoryEnabled)).toBe(true);
    expect((await state(page)).enabled).toBe(true);
  });

  test('an off-flip really disables capture (not just the pref) @fast', async ({ page }) => {
    await ready(page);
    await page.evaluate(() => window.__commandHistory.toggleEnabled());   // → off
    await typeStr(page, 'DIR');
    await pressKey(page, 'enter');
    expect(await history(page)).toEqual([]);
  });

  test('a chord-flipped off state survives reload @fast', async ({ page }) => {
    await ready(page);
    // Press the real chord, not toggleEnabled() — the acceptance criterion is about
    // what a keypress leaves behind, so going through the handler is the whole point.
    await page.keyboard.press('Control+Shift+Insert');   // → off
    await page.waitForTimeout(300);   // > the 250 ms savePrefs debounce
    await page.reload();
    await page.waitForFunction(() => window.__commandHistory);
    expect((await state(page)).enabled).toBe(false);
  });

  test('Ctrl+Shift+Insert flips the pref, toasts, and sends no bytes @fast', async ({ page }) => {
    await readyWithToast(page);
    await page.evaluate(() => {
      window.__toast.__resetForTests();
      window.__txSink.resetTx();
    });

    await page.keyboard.press('Control+Shift+Insert');

    expect(await page.evaluate(() => window.__prefs.getPrefs().commandHistoryEnabled)).toBe(false);
    expect(await page.evaluate(() => window.__toast.__getStateForTests()))
      .toMatchObject({ visible: true, text: 'Command history off' });
    expect(await page.evaluate(() => window.__txSink.formatHexStrip())).toBe('');
  });

  test('Ctrl+Alt+H flips it back on — the second chord is not a decoration @fast', async ({ page }) => {
    await readyWithToast(page);
    await page.evaluate(() => {
      window.__prefs.savePrefs({ commandHistoryEnabled: false });
      window.__toast.__resetForTests();
      window.__txSink.resetTx();
    });

    await page.keyboard.press('Control+Alt+KeyH');

    expect(await page.evaluate(() => window.__prefs.getPrefs().commandHistoryEnabled)).toBe(true);
    expect(await page.evaluate(() => window.__toast.__getStateForTests()))
      .toMatchObject({ visible: true, text: 'Command history on' });
    // Without the intercept this chord would encode 0x08 (Ctrl-H → backspace).
    expect(await page.evaluate(() => window.__txSink.formatHexStrip())).toBe('');
  });

  test('three chords inside the toast window leave the latest state only @fast', async ({ page }) => {
    await readyWithToast(page);
    await page.evaluate(() => window.__toast.__resetForTests());

    await page.keyboard.press('Control+Shift+Insert');   // → off
    await page.keyboard.press('Control+Shift+Insert');   // → on
    await page.keyboard.press('Control+Shift+Insert');   // → off

    expect(await page.evaluate(() => window.__prefs.getPrefs().commandHistoryEnabled)).toBe(false);
    const t = await page.evaluate(() => window.__toast.__getStateForTests());
    expect(t.text).toBe('Command history off');
    // Only proves a timer is pending — hasAutoHideTimer is a boolean, equally true for
    // one pending timer or three. The re-arm itself is pinned by the next test.
    expect(t.hasAutoHideTimer).toBe(true);
  });

  // Holding a chord down delivers a stream of keydowns with e.repeat === true. Without
  // the guard the pref flips once per repeat — tens of times a second — and where it
  // lands depends on when the operator lets go.
  test('holding the chord flips the pref once, not once per auto-repeat @fast', async ({ page }) => {
    await readyWithToast(page);
    await page.evaluate(() => window.__toast.__resetForTests());
    const before = await page.evaluate(() => window.__prefs.getPrefs().commandHistoryEnabled);

    await page.keyboard.press('Control+Shift+Insert');   // the press itself
    await page.evaluate(() => {                          // the repeats that follow it
      const wrap = document.getElementById('terminal-wrapper');
      // SEVEN, not an even count: press + 7 repeats = 8 flips, which lands back on the
      // ORIGINAL value if the guard is missing. An even repeat count makes the total
      // odd and the test passes whether or not the guard exists — decoration, not a pin.
      for (let i = 0; i < 7; i++) {
        wrap.dispatchEvent(new KeyboardEvent('keydown', {
          key: 'Insert', code: 'Insert', ctrlKey: true, shiftKey: true,
          repeat: true, bubbles: true, cancelable: true,
        }));
      }
    });

    expect(await page.evaluate(() => window.__prefs.getPrefs().commandHistoryEnabled)).toBe(!before);
    expect(await page.evaluate(() => window.__toast.__getStateForTests().text))
      .toBe('Command history off');
  });

  // The discriminating test for re-arm-vs-stack: space the presses so that a first,
  // uncleared timer would have hidden the toast while a correctly re-armed one is
  // still showing. Also the only assertion that reads the DOM rather than module
  // state, so renaming #toast / #toast-text can no longer leave the suite green.
  test('a second chord re-arms the hide timer rather than stacking behind the first @fast', async ({ page }) => {
    await readyWithToast(page);
    await page.evaluate(() => window.__toast.__resetForTests());

    await page.keyboard.press('Control+Shift+Insert');   // t=0     → would hide at 2.0 s
    await page.waitForTimeout(1500);
    await page.keyboard.press('Control+Shift+Insert');   // t=1.5 s → must hide at 3.5 s
    await page.waitForTimeout(900);                      // t=2.4 s

    // Re-armed: still up, 0.6 s to go. Stacked: the t=0 timer fired 0.4 s ago.
    expect(await page.evaluate(() => window.__toast.__getStateForTests().visible)).toBe(true);
    expect(await page.evaluate(() => ({
      hidden: document.getElementById('toast').hasAttribute('hidden'),
      text: document.getElementById('toast-text').textContent,
    }))).toEqual({ hidden: false, text: 'Command history on' });
  });
});
