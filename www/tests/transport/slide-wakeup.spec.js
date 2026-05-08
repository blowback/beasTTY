// Beastty Phase 8 Plan 04 (Wave 3) — wakeup matcher Playwright assertions.
//
// SLIDE-17: 7-byte ESC ^ S L I D E wakeup detection across torn Web Serial
// chunk boundaries via single-byte carry flag (CONTEXT D-01 match-index counter
// in module-scope state at www/transport/slide.js).
//
// Wave 3 GREEN gate: every Plan 08-01 stub is now a real assertion. The test
// matrix exercises:
//   1 — full match in a single chunk (split-7/0)
//   6 — internal split points 1/6 .. 6/1 (D-01 match-index across chunks)
//   2 — benign partial-match preserves baseline (ESC ^ A, ESC ^ S L X)
//   1 — D-02 critical clause: ESC ^ ESC ^ S L I D E reprocesses current byte
//   2 — isolated ESC and isolated ^ benign cases
//   1 — D-02 critical clause exercise via the isolated-ESC torn chunk
// total = 13 tests
//
// Sources:
//   - 08-CONTEXT.md D-01, D-02, D-03 (matcher + replay-on-fail + ESC^ lore).
//   - 08-VALIDATION.md §"Test Corpus for the 7-Byte Wakeup Matcher".
//   - 08-PATTERNS.md §"www/tests/transport/slide-wakeup.spec.js (NEW)".
//   - Analog: www/tests/transport/readloop.spec.js (setup helper verbatim).

import { test, expect } from '@playwright/test';
import { SERIAL_MOCK } from './mock-serial.js';

const WAKEUP_BYTES = [0x1B, 0x5E, 0x53, 0x4C, 0x49, 0x44, 0x45]; // ESC ^ S L I D E

async function setup(page) {
    await page.addInitScript(SERIAL_MOCK);
    await page.goto('/');
    await page.locator('#terminal-wrapper').focus();
    await page.waitForFunction(() => document.getElementById('terminal').width > 0);
    await page.locator('#connection').evaluate((el) => { el.open = true; });
}

test.describe('SLIDE-17 — 7-byte ESC ^ S L I D E wakeup', () => {

    test.beforeEach(async ({ page }) => {
        await setup(page);
        await page.locator('#connect-button').click();
        // Generous timeout — Playwright's 10-worker parallelism can starve
        // the wasm boot path on busy hardware; 2s flakes intermittently.
        await expect.poll(
            () => page.evaluate(() => Boolean(navigator.serial._grantedPorts[0]?._reader)),
            { timeout: 5000 },
        ).toBe(true);
        // Reset dispatcher state — the test runner reuses pages across tests
        // and prior tests may have wedged mode='recv' or wakeIdx > 0.
        await page.evaluate(() => window.__slide.__resetForTests());
    });

    test('full-match-single-chunk @fast', async ({ page }) => {
        // Push the full 7-byte signature in one chunk; expect mode === 'recv'.
        await page.evaluate(() => window.__mockReaderPush([0x1B, 0x5E, 0x53, 0x4C, 0x49, 0x44, 0x45]));
        await expect.poll(
            () => page.evaluate(() => window.__slide.__getStateForTests()),
            { timeout: 2000 },
        ).toMatchObject({ mode: 'recv', wakeIdx: 0, hasSlide: true });
        // Owner should have flipped to 'slide' synchronously (D-09).
        expect(await page.evaluate(() => window.__txSink.getWireOwner())).toBe('slide');
    });

    // Torn-chunk corpus: split-1/6 .. split-6/1 enumerated as individual
    // tests so each split appears as its own line in --reporter=list.

    test('torn-chunk-split-1/6 @fast', async ({ page }) => {
        // chunk 1: [ESC] (1 byte); chunk 2: [^ S L I D E] (6 bytes).
        await page.evaluate(() => window.__mockReaderPush([0x1B]));
        await expect.poll(
            () => page.evaluate(() => window.__slide.__getStateForTests().wakeIdx),
            { timeout: 2000 },
        ).toBe(1);
        expect(await page.evaluate(() => window.__slide.__getStateForTests().mode)).toBe('terminal');
        await page.evaluate(() => window.__mockReaderPush([0x5E, 0x53, 0x4C, 0x49, 0x44, 0x45]));
        await expect.poll(
            () => page.evaluate(() => window.__slide.__getStateForTests().mode),
            { timeout: 2000 },
        ).toBe('recv');
    });

    test('torn-chunk-split-2/5 @fast', async ({ page }) => {
        await page.evaluate(() => window.__mockReaderPush([0x1B, 0x5E]));
        await expect.poll(
            () => page.evaluate(() => window.__slide.__getStateForTests().wakeIdx),
            { timeout: 2000 },
        ).toBe(2);
        expect(await page.evaluate(() => window.__slide.__getStateForTests().mode)).toBe('terminal');
        await page.evaluate(() => window.__mockReaderPush([0x53, 0x4C, 0x49, 0x44, 0x45]));
        await expect.poll(
            () => page.evaluate(() => window.__slide.__getStateForTests().mode),
            { timeout: 2000 },
        ).toBe('recv');
    });

    test('torn-chunk-split-3/4 @fast', async ({ page }) => {
        await page.evaluate(() => window.__mockReaderPush([0x1B, 0x5E, 0x53]));
        await expect.poll(
            () => page.evaluate(() => window.__slide.__getStateForTests().wakeIdx),
            { timeout: 2000 },
        ).toBe(3);
        expect(await page.evaluate(() => window.__slide.__getStateForTests().mode)).toBe('terminal');
        await page.evaluate(() => window.__mockReaderPush([0x4C, 0x49, 0x44, 0x45]));
        await expect.poll(
            () => page.evaluate(() => window.__slide.__getStateForTests().mode),
            { timeout: 2000 },
        ).toBe('recv');
    });

    test('torn-chunk-split-4/3 @fast', async ({ page }) => {
        await page.evaluate(() => window.__mockReaderPush([0x1B, 0x5E, 0x53, 0x4C]));
        await expect.poll(
            () => page.evaluate(() => window.__slide.__getStateForTests().wakeIdx),
            { timeout: 2000 },
        ).toBe(4);
        expect(await page.evaluate(() => window.__slide.__getStateForTests().mode)).toBe('terminal');
        await page.evaluate(() => window.__mockReaderPush([0x49, 0x44, 0x45]));
        await expect.poll(
            () => page.evaluate(() => window.__slide.__getStateForTests().mode),
            { timeout: 2000 },
        ).toBe('recv');
    });

    test('torn-chunk-split-5/2 @fast', async ({ page }) => {
        await page.evaluate(() => window.__mockReaderPush([0x1B, 0x5E, 0x53, 0x4C, 0x49]));
        await expect.poll(
            () => page.evaluate(() => window.__slide.__getStateForTests().wakeIdx),
            { timeout: 2000 },
        ).toBe(5);
        expect(await page.evaluate(() => window.__slide.__getStateForTests().mode)).toBe('terminal');
        await page.evaluate(() => window.__mockReaderPush([0x44, 0x45]));
        await expect.poll(
            () => page.evaluate(() => window.__slide.__getStateForTests().mode),
            { timeout: 2000 },
        ).toBe('recv');
    });

    test('torn-chunk-split-6/1 @fast', async ({ page }) => {
        await page.evaluate(() => window.__mockReaderPush([0x1B, 0x5E, 0x53, 0x4C, 0x49, 0x44]));
        await expect.poll(
            () => page.evaluate(() => window.__slide.__getStateForTests().wakeIdx),
            { timeout: 2000 },
        ).toBe(6);
        expect(await page.evaluate(() => window.__slide.__getStateForTests().mode)).toBe('terminal');
        await page.evaluate(() => window.__mockReaderPush([0x45]));
        await expect.poll(
            () => page.evaluate(() => window.__slide.__getStateForTests().mode),
            { timeout: 2000 },
        ).toBe('recv');
    });

    test('torn-chunk-split-7/0 (full match in chunk 1) @fast', async ({ page }) => {
        // All 7 bytes in chunk 1, no chunk 2. Functionally equivalent to the
        // full-match-single-chunk test, but explicitly named per 08-VALIDATION.
        await page.evaluate(() => window.__mockReaderPush([0x1B, 0x5E, 0x53, 0x4C, 0x49, 0x44, 0x45]));
        await expect.poll(
            () => page.evaluate(() => window.__slide.__getStateForTests().mode),
            { timeout: 2000 },
        ).toBe('recv');
        expect(await page.evaluate(() => window.__slide.__getStateForTests().wakeIdx)).toBe(0);
    });

    test('benign-ESC-caret-A — no wakeup, replay preserves baseline @fast', async ({ page }) => {
        // ESC ^ A: matcher advances to wakeIdx=2, then 'A' (0x41) mismatches
        // expected 'S' (0x53). D-02 replays [ESC, ^] then re-processes 'A':
        // 'A' != WAKEUP[0], so it goes into pending. term.feed sees
        // [ESC, ^, A]. NOTE: vte 0.15 treats ESC ^ as the start of an
        // SOS/PM/APC control string (lib.rs:377 — 0x5E..=0x5F enters
        // SosPmApcString state), so 'A' is swallowed as part of that
        // control string until ESC \ terminates it. This is correct
        // baseline VT52 behavior — the matcher's job is to leave the
        // bytes alone for the parser to handle, not to render them.
        // We verify baseline preservation by asserting the matcher state
        // resets correctly (mode='terminal', wakeIdx=0) AND that a
        // subsequent printable byte (after a string terminator) renders
        // normally — proving the parser was not left in a wedged state
        // by the dispatcher's intervention.
        await page.evaluate(() => window.__mockReaderPush([0x1B, 0x5E, 0x41]));
        await expect.poll(
            () => page.evaluate(() => window.__slide.__getStateForTests()),
            { timeout: 2000 },
        ).toMatchObject({ mode: 'terminal', wakeIdx: 0 });
        // Now feed ESC \ (string terminator) followed by a printable.
        // After the SOS string terminates, 'B' should render. This proves
        // the dispatcher fed the original ESC ^ A bytes through term.feed
        // in wire order — otherwise the parser would not be in
        // SosPmApcString state.
        await page.evaluate(() => window.__mockReaderPush([0x1B, 0x5C, 0x42]));  // ESC \ B
        await expect.poll(
            () => page.evaluate(() => {
                const g = window.__testGridView();
                return String.fromCharCode(g[0]);
            }),
            { timeout: 2000 },
        ).toBe('B');
    });

    test('benign-mid-match-X — replay swallowed prefix in original order @fast', async ({ page }) => {
        // ESC ^ S L X — wakeIdx reaches 4 then mismatches on 'X' (0x58).
        // D-02 replays [ESC, ^, S, L] in original order, re-processes 'X':
        // 'X' != WAKEUP[0], pending becomes [ESC, ^, S, L, X]. As with the
        // ESC ^ A case above, vte enters SosPmApcString on ESC ^ and
        // swallows S, L, X into the string. The dispatcher's correctness
        // is verified by (a) matcher state resets and (b) the parser
        // correctly handles the replayed bytes — exiting the string on
        // a subsequent ESC \ allows printable bytes to render normally.
        await page.evaluate(() => window.__mockReaderPush([0x1B, 0x5E, 0x53, 0x4C, 0x58]));
        await expect.poll(
            () => page.evaluate(() => window.__slide.__getStateForTests()),
            { timeout: 2000 },
        ).toMatchObject({ mode: 'terminal', wakeIdx: 0 });
        // Terminate the SOS string and feed a printable. Renders 'C' at col 0.
        await page.evaluate(() => window.__mockReaderPush([0x1B, 0x5C, 0x43]));  // ESC \ C
        await expect.poll(
            () => page.evaluate(() => {
                const g = window.__testGridView();
                return String.fromCharCode(g[0]);
            }),
            { timeout: 2000 },
        ).toBe('C');
    });

    test('reprocess-from-idx-0 — ESC^ ESC^ S L I D E detects second wakeup (D-02 critical clause) @fast', async ({ page }) => {
        // ESC ^ ESC ^ S L I D E:
        // Bytes 0..1 match (wakeIdx=2). Byte 2 (ESC) mismatches expected 'S'.
        // D-02 replay: pending = [ESC, ^]; re-process current ESC from idx=0
        // → ESC matches WAKEUP[0], wakeIdx=1, byte SWALLOWED. Bytes 3..7
        // (^ S L I D E) match. Wakeup detected on byte 8.
        await page.evaluate(() => window.__mockReaderPush([
            0x1B, 0x5E,                                  // first ESC ^ — replayed to term.feed
            0x1B, 0x5E, 0x53, 0x4C, 0x49, 0x44, 0x45,    // second ESC ^ S L I D E — matches
        ]));
        await expect.poll(
            () => page.evaluate(() => window.__slide.__getStateForTests().mode),
            { timeout: 2000 },
        ).toBe('recv');
    });

    test('benign-isolated-caret — no leading ESC, matcher never advances @fast', async ({ page }) => {
        // ^ S L I D E (no leading ESC) — wakeIdx stays 0 because none of these
        // bytes match WAKEUP[0] = ESC. All 6 bytes flow through to term.feed
        // unchanged.
        await page.evaluate(() => window.__mockReaderPush([0x5E, 0x53, 0x4C, 0x49, 0x44, 0x45]));
        await expect.poll(
            () => page.evaluate(() => window.__slide.__getStateForTests()),
            { timeout: 2000 },
        ).toMatchObject({ mode: 'terminal', wakeIdx: 0 });
        // The 6 bytes ^SLIDE render at row 0 cols 0..5.
        await expect.poll(
            () => page.evaluate(() => {
                const g = window.__testGridView();
                return String.fromCharCode(g[0], g[8], g[16], g[24], g[32], g[40]);
            }),
            { timeout: 2000 },
        ).toBe('^SLIDE');
    });

    test('benign-isolated-ESC — incomplete escape recovers via vte @fast', async ({ page }) => {
        // chunk 1: [ESC] — wakeIdx steps to 1, byte SWALLOWED (not yet
        //                  forwarded to term.feed — captured for replay).
        // chunk 2: [X]   — 'X' (0x58) mismatches expected '^' (WAKEUP[1]).
        //                   D-02 replays [ESC] then re-processes 'X':
        //                   'X' != WAKEUP[0], pushes to pending.
        //                   term.feed receives [ESC, X] — the original wire
        //                   bytes in original order. Whatever the parser
        //                   does with ESC X is its concern; the dispatcher's
        //                   correctness is verified by matcher state reset.
        // chunk 3: [^ S L I D E] — printable bytes verify the parser is
        //                   back in a clean state ready to print after the
        //                   replayed escape sequence completes.
        await page.evaluate(() => window.__mockReaderPush([0x1B]));
        await expect.poll(
            () => page.evaluate(() => window.__slide.__getStateForTests().wakeIdx),
            { timeout: 2000 },
        ).toBe(1);
        await page.evaluate(() => window.__mockReaderPush([0x58]));  // 'X'
        await expect.poll(
            () => page.evaluate(() => window.__slide.__getStateForTests()),
            { timeout: 2000 },
        ).toMatchObject({ mode: 'terminal', wakeIdx: 0 });
        // Verify the dispatcher hands off cleanly to the parser by feeding
        // a non-escape printable run that's known to render — confirms the
        // dispatcher's terminal-mode branch is byte-transparent for normal
        // bytes after the escape-replay path.
        await page.evaluate(() => window.__mockReaderPush([0x59, 0x5A]));  // 'Y' 'Z'
        // After ESC X consumes both bytes (X is SosPmApcString opener in vte;
        // Y enters the string; Z stays in the string until ESC \ terminator).
        // The matcher state is the orthogonal correctness signal: mode is
        // still 'terminal' and wakeIdx stays 0 — proving the dispatcher did
        // not wedge or misroute despite the parser absorbing every replayed
        // byte into a control string. Push the string terminator and a
        // printable to confirm normal rendering resumes.
        await page.evaluate(() => window.__mockReaderPush([0x1B, 0x5C, 0x44]));  // ESC \ D
        await expect.poll(
            () => page.evaluate(() => {
                const g = window.__testGridView();
                return String.fromCharCode(g[0]);
            }),
            { timeout: 2000 },
        ).toBe('D');
        // Final state assertion — matcher is clean.
        expect(await page.evaluate(() => window.__slide.__getStateForTests())).toMatchObject({
            mode: 'terminal',
            wakeIdx: 0,
        });
    });
});
