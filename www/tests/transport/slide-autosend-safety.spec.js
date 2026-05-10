// Beastty Phase 12 Plan 12-03 (SLIDE-38) — auto-send command safety.
//
// 15 Playwright tests covering use-time gate + first-use confirmation chip
// + Settings input visual cue + flag re-arm. Test names match the -g
// filters in 12-VALIDATION.md slots 12-XX-12..12-XX-17 verbatim:
//   - "isAutoSendSafe accepts: ..." × 5 (SAFE_CASES locked table)
//   - "isAutoSendSafe rejects: ..." × 5 (UNSAFE_CASES locked table)
//   - "Settings input invalid value sets data-invalid attribute"
//   - "Settings input invalid value still persists to localStorage (save not blocked)"
//   - "use-time gate blocks unsafe auto-type at session start"
//   - "first-use confirmation chip surfaces for non-default value"
//   - "confirmation flag re-arms when user changes auto-send command"
//
// Sources:
//   - 12-CONTEXT.md §Claude's Discretion (validate at use, defense-in-depth at save)
//   - 12-RESEARCH.md §SLIDE-38 (locked SAFE_CASES + UNSAFE_CASES + Pitfall 5
//     `*` not `+` so bare \r is admitted)
//   - 12-UI-SPEC.md §C/§D/§E (locked first-use-confirm chip lifecycle +
//     validation hint copy + invalid-state CSS)
//   - 12-PATTERNS.md §slide-autosend-safety.spec.js
//
// Helpers (setup/setupConnected) copied verbatim from slide-prefs.spec.js +
// slide-sender.spec.js per Phase 8/9/10/11 spec-isolation precedent — DO
// NOT cross-import.

import { test, expect } from '@playwright/test';
import { SERIAL_MOCK } from './mock-serial.js';
import { MOCK_SERIAL_SLIDE_BOT } from './mock-serial-slide-bot.js';

async function setup(page) {
    await page.addInitScript(SERIAL_MOCK);
    await page.addInitScript(MOCK_SERIAL_SLIDE_BOT);
    await page.goto('/');
    await page.locator('#terminal-wrapper').focus();
    await page.waitForFunction(() => document.getElementById('terminal').width > 0);
    await page.locator('#settings').evaluate((el) => { el.open = true; });
    await page.locator('#settings-slide').evaluate((el) => { el.open = true; });
}

async function setupConnected(page) {
    await setup(page);
    await page.locator('#connect-button').click();
    // Generous timeout — Playwright's 10-worker parallelism can starve
    // the wasm boot path on busy hardware (Phase 11 5s precedent — 8s
    // covers worst-case Chromium scheduling under heavy load).
    await expect.poll(
        () => page.evaluate(() => Boolean(navigator.serial._grantedPorts[0]?._reader)),
        { timeout: 8000 },
    ).toBe(true);
    await page.evaluate(() => {
        window.__slide && window.__slide.__resetForTests && window.__slide.__resetForTests();
        window.__fileSource && window.__fileSource.__resetForTests && window.__fileSource.__resetForTests();
        window.__slideChip && window.__slideChip.__resetForTests && window.__slideChip.__resetForTests();
        if (window.__mockWriterLog) window.__mockWriterLog.length = 0;
        window.__mockSlideBot && window.__mockSlideBot.reset && window.__mockSlideBot.reset();
    });
}

// SAFE_CASES — locked verbatim per 12-UI-SPEC.md §SLIDE-38 + 12-RESEARCH.md
// SAFE_CASES table. The default value contains a space; Plan 12-03 Rule 1
// fix widened the regex character class from [A-Za-z0-9:] to [A-Za-z0-9: ].
const SAFE_CASES = [
    { input: '',                  label: 'empty (SLIDE-13 disabled)' },
    { input: 'B:SLIDE R\r',        label: 'default' },
    { input: 'A:SLIDE R\r',        label: 'drive switch' },
    { input: 'B:DIR\r',            label: 'alternate command' },
    { input: '\r',                 label: 'bare CR' },
];
// UNSAFE_CASES — locked verbatim. The 5 cases collectively exercise the
// T-12-03 threat surface: missing CR, LF instead of CR, semicolon
// injection, multiple CR, control char (BEL).
const UNSAFE_CASES = [
    { input: 'B:SLIDE R',                label: 'missing CR' },
    { input: 'B:SLIDE R\n',              label: 'LF instead of CR' },
    { input: 'B:SLIDE R; rm -rf /\r',    label: 'semicolon injection' },
    { input: 'B:SLIDE R\rB:DIR\r',       label: 'multiple CR' },
    { input: 'B:SLIDE\x07R\r',           label: 'control char BEL' },
];

for (const tc of SAFE_CASES) {
    test(`SLIDE-38 — isAutoSendSafe accepts: ${tc.label}`, async ({ page }) => {
        await setup(page);
        const ok = await page.evaluate(
            (s) => window.__slide.__isAutoSendSafeForTests(s),
            tc.input,
        );
        expect(ok).toBe(true);
    });
}

for (const tc of UNSAFE_CASES) {
    test(`SLIDE-38 — isAutoSendSafe rejects: ${tc.label}`, async ({ page }) => {
        await setup(page);
        const ok = await page.evaluate(
            (s) => window.__slide.__isAutoSendSafeForTests(s),
            tc.input,
        );
        expect(ok).toBe(false);
    });
}

test('SLIDE-38 — Settings input invalid value sets data-invalid attribute', async ({ page }) => {
    await setup(page);
    // Type an unsafe value (semicolon injection) and dispatch the change
    // event. The Phase 12 Settings handler computes value + '\r' then
    // calls isAutoSendSafe; on failure it sets data-invalid + aria-invalid
    // (visual cue ONLY — does NOT block savePrefs).
    await page.locator('#slide-auto-send-input').fill('B:RM *.* ;');
    await page.locator('#slide-auto-send-input').dispatchEvent('change');
    await expect.poll(
        () => page.locator('#slide-auto-send-input').getAttribute('data-invalid'),
        { timeout: 2000 },
    ).toBe('true');
});

test('Phase 12 UAT Gap A — validation-hint sub-row appears on blur with unsafe value', async ({ page }) => {
    await setup(page);
    // Hint starts hidden.
    await expect(page.locator('#slide-auto-send-validation-hint')).toBeHidden();
    // Type unsafe value, dispatch change (blur) — hint MUST become visible.
    await page.locator('#slide-auto-send-input').fill('B:RM *.* ; SLIDE R');
    await page.locator('#slide-auto-send-input').dispatchEvent('change');
    await expect(page.locator('#slide-auto-send-validation-hint')).toBeVisible();
    // Hint copy matches UI-SPEC §D (verbatim).
    await expect(page.locator('#slide-auto-send-validation-hint'))
        .toHaveText('Auto-send command unsafe — disabled.');
    // Now switch to a safe value — hint hides again.
    await page.locator('#slide-auto-send-input').fill('B:SLIDE R');
    await page.locator('#slide-auto-send-input').dispatchEvent('change');
    await expect(page.locator('#slide-auto-send-validation-hint')).toBeHidden();
});

test('SLIDE-38 — Settings input invalid value still persists to localStorage (save not blocked)', async ({ page }) => {
    await setup(page);
    // Same unsafe value — the SAVE must still happen even though the input
    // is visually marked invalid (UI-SPEC §Anti-Patterns: save-time
    // validation forbidden; use-time hard gate is the wire-safety boundary).
    // This guarantees the user can iterate on the value without losing
    // their typed text.
    await page.locator('#slide-auto-send-input').fill('B:RM *.* ;');
    await page.locator('#slide-auto-send-input').dispatchEvent('change');
    await expect.poll(
        () => page.evaluate(() => {
            const raw = localStorage.getItem('beastty.prefs');
            if (!raw) return null;
            try { return JSON.parse(raw).slideAutoSendCommand; } catch { return null; }
        }),
        { timeout: 2000 },
    ).toBe('B:RM *.* ;\r');
});

test('SLIDE-38 — use-time gate blocks unsafe auto-type at session start', async ({ page }) => {
    await setupConnected(page);
    // Plant an unsafe value into the LIVE prefs ref (Phase 11 Plan 11-05
    // D-3 deviation — savePrefs reassigns the cached blob to a new object,
    // so wireSlideDispatcher's prefsRef snapshot is bound to the boot-time
    // reference. Mutating the live ref bypasses the Settings handler so
    // we exercise the slide.js use-time gate alone).
    await page.evaluate(() => {
        window.__prefs.live.slideAutoSendCommand = 'B:SLIDE R; rm\r';
    });
    // Drive enterSendMode via the file picker (matches the user-facing
    // flow): set input files, click Send button on modal.
    await page.setInputFiles('#send-file-input', {
        name: 'hello.txt', mimeType: 'text/plain', buffer: Buffer.from('hi'),
    });
    await expect(page.locator('#send-modal')).toBeVisible();
    await page.locator('#send-modal-send').click();
    // Allow the dispatcher to fire (or fail to fire) auto-type.
    await page.waitForTimeout(500);
    // Hard-gate assertion: NO auto-type bytes contain a semicolon (0x3B).
    // The unsafe-value path returns a zero-length Uint8Array from
    // readAutoSendCommandBytes; pushTxBytes is skipped entirely.
    const writerHasSemicolon = await page.evaluate(() => {
        const log = window.__mockWriterLog || [];
        for (const entry of log) {
            const bytes = entry.bytes || entry;
            for (let i = 0; i < bytes.length; i++) {
                if (bytes[i] === 0x3B) return true;   // ASCII ';'
            }
        }
        return false;
    });
    expect(writerHasSemicolon).toBe(false);
    // Defensive cross-check: chip transitioned to error state OR remained
    // hidden (the use-time gate fires slideChipRef.enterError when wired).
    const chipState = await page.evaluate(() =>
        window.__slideChip && window.__slideChip.__getStateForTests
            ? window.__slideChip.__getStateForTests().lifecycle
            : null,
    );
    expect(['error', 'hidden', 'first-use-confirm', 'awaiting-wakeup']).toContain(chipState);
});

test('SLIDE-38 — first-use confirmation chip surfaces for non-default value', async ({ page }) => {
    await setupConnected(page);
    // Plant a SAFE non-default value and ensure not previously confirmed.
    // The first-use-confirm chip should surface BEFORE any auto-type bytes
    // hit the wire (Pitfall 6 — gate runs at session start).
    await page.evaluate(() => {
        window.__prefs.live.slideAutoSendCommand = 'A:SLIDE R\r';
        window.__prefs.live.slideAutoSendCommandConfirmed = '';
    });
    await page.setInputFiles('#send-file-input', {
        name: 'hello.txt', mimeType: 'text/plain', buffer: Buffer.from('hi'),
    });
    await expect(page.locator('#send-modal')).toBeVisible();
    await page.locator('#send-modal-send').click();
    // Poll for the chip to enter first-use-confirm. The async path in
    // enterSendModeAfterFirstUseConfirm fires the chip + awaits — the
    // chip's lifecycle should be 'first-use-confirm' until the user clicks
    // [Confirm] or [Reset to default].
    await expect.poll(
        () => page.evaluate(() =>
            window.__slideChip && window.__slideChip.__getStateForTests
                ? window.__slideChip.__getStateForTests().lifecycle
                : null,
        ),
        { timeout: 8000 },
    ).toBe('first-use-confirm');
});

test('SLIDE-38 — confirmation flag re-arms when user changes auto-send command', async ({ page }) => {
    await setup(page);
    // Initial change — Settings handler writes slideAutoSendCommandConfirmed
    // = '' (re-armed) alongside the new command.
    await page.locator('#slide-auto-send-input').fill('A:SLIDE R');
    await page.locator('#slide-auto-send-input').dispatchEvent('change');
    await expect.poll(
        () => page.evaluate(() => {
            const raw = localStorage.getItem('beastty.prefs');
            if (!raw) return null;
            try { return JSON.parse(raw).slideAutoSendCommandConfirmed; } catch { return null; }
        }),
        { timeout: 2000 },
    ).toBe('');

    // Manually mark as confirmed (simulating the [Confirm] click writing
    // the value back to slideAutoSendCommandConfirmed via savePrefs).
    await page.evaluate(() => {
        window.__prefs.live.slideAutoSendCommandConfirmed = 'A:SLIDE R\r';
    });

    // Change the command again — confirmation must re-arm to '' so the
    // next session-start surfaces the chip per UI-SPEC §C transition table.
    await page.locator('#slide-auto-send-input').fill('B:DIR');
    await page.locator('#slide-auto-send-input').dispatchEvent('change');
    await expect.poll(
        () => page.evaluate(() => {
            const raw = localStorage.getItem('beastty.prefs');
            if (!raw) return null;
            try { return JSON.parse(raw).slideAutoSendCommandConfirmed; } catch { return null; }
        }),
        { timeout: 2000 },
    ).toBe('');
});

// ===== Phase 12 Plan 12-06 (Gap 2 — UAT Test 7) appended tests =====
// Closes the gap diagnosed at .planning/debug/12-uat-no-red-border.md:
// CSS specificity collision suppressed the data-invalid border indicator.
// Plan 12-06 fixes via [data-theme] + #settings-slide ancestors
// (specificity 0,2,2,0 — beats both base 0,2,0,0 AND :focus-visible
// 0,2,1,0 on specificity alone, no source-order trap) and switches the
// color to var(--chrome-invalid-strong) = #e04040 per the user's
// 2026-05-09 design call (deliberate exception to the muted/destructive
// policy for this security-relevant control).
//
// BLURRED-STATE CONTRACT: tests blur the input before reading borderColor.
// The :focus-visible rule at index.html line 227 has specificity (0,2,1,0)
// and would paint var(--chrome-accent) on a focused input regardless of
// valid/invalid state. The realistic UX moment when the user sees the
// invalid cue is AFTER they type and tab/click away. Pinning the blurred
// state makes the contract under test unambiguous and test-stable.

test('Plan 12-06 — Settings input invalid value paints red border (specificity + token fix)', async ({ page }) => {
    await setup(page);
    await page.locator('#slide-auto-send-input').fill('B:RM *.* ; SLIDE R');
    await page.locator('#slide-auto-send-input').dispatchEvent('change');
    // Wait for the data-invalid attribute write (existing contract).
    await expect.poll(
        () => page.locator('#slide-auto-send-input').getAttribute('data-invalid'),
        { timeout: 2000 },
    ).toBe('true');
    // Blur the input so the :focus-visible rule (0,2,1,0) no longer paints
    // var(--chrome-accent). After blur, the (0,2,2,0) invalid rule wins.
    await page.locator('#slide-auto-send-input').blur();
    // Plan 12-06 contract — bumped-specificity rule + --chrome-invalid-strong
    // resolves to rgb(224, 64, 64) = #e04040.
    const borderColor = await page.locator('#slide-auto-send-input').evaluate((el) =>
        window.getComputedStyle(el).borderColor
    );
    expect(borderColor).toBe('rgb(224, 64, 64)');
});

// ===== Phase 12 UAT Gap C/B regression — slide.js getPrefs() live-read =====
// Closes .planning/debug/slide-stale-auto-send-cmd.md: slide.js previously
// captured a boot-time prefsRef snapshot in wireSlideDispatcher; savePrefs()
// reassigns the cached blob in prefs.js, so the snapshot went stale and the
// next ↑ Send file sent the OLD command on the wire. A page reload masked
// the bug. The fix mirrors Plan 12-08's serial.js getPrefs()-live pattern.
//
// This regression specifically exercises the savePrefs() path (NOT the
// in-place __prefs.live mutation that earlier tests use), because savePrefs
// is what the Settings change handler in main.js actually calls.

test('Phase 12 UAT Gap C — savePrefs(slideAutoSendCommand) updates wire bytes without page reload', async ({ page }) => {
    await setupConnected(page);
    // Pre-confirm the value so first-use-confirm chip does NOT surface and
    // gate the wire-byte path under test (Gap B has its own regression below).
    await page.evaluate(() => {
        window.__prefs.savePrefs({
            slideAutoSendCommand: 'A:DIFFER R\r',
            slideAutoSendCommandConfirmed: 'A:DIFFER R\r',
        });
    });
    // Drive enterSendMode via the file picker (matches the user-facing flow).
    await page.setInputFiles('#send-file-input', {
        name: 'hello.txt', mimeType: 'text/plain', buffer: Buffer.from('hi'),
    });
    await expect(page.locator('#send-modal')).toBeVisible();
    await page.locator('#send-modal-send').click();
    // Allow auto-type to flush.
    await expect.poll(
        () => page.evaluate(() => {
            const log = window.__mockWriterLog || [];
            const decoder = new TextDecoder();
            for (const entry of log) {
                const raw = entry.bytes || entry;
                const u8 = raw instanceof Uint8Array ? raw : new Uint8Array(raw);
                const text = decoder.decode(u8);
                if (text.includes('A:DIFFER R\r')) return 'new';
                if (text.includes('B:SLIDE R\r')) return 'stale';
            }
            return null;
        }),
        { timeout: 4000 },
    ).toBe('new');
});

test('Phase 12 UAT Gap B — savePrefs(slideAutoSendCommandConfirmed) re-arms first-use-confirm chip without reload', async ({ page }) => {
    await setupConnected(page);
    // Step 1 — savePrefs flow: change the command AND clear the confirmed
    // flag. With the live-read fix, slide.js's shouldSurfaceFirstUseConfirm
    // must see the cleared flag and surface the chip on the next send.
    await page.evaluate(() => {
        window.__prefs.savePrefs({
            slideAutoSendCommand: 'A:OTHER R\r',
            slideAutoSendCommandConfirmed: '',
        });
    });
    // Drive enterSendMode.
    await page.setInputFiles('#send-file-input', {
        name: 'hello.txt', mimeType: 'text/plain', buffer: Buffer.from('hi'),
    });
    await expect(page.locator('#send-modal')).toBeVisible();
    await page.locator('#send-modal-send').click();
    // Chip MUST enter first-use-confirm — pre-fix this would skip and the
    // wire would receive the bytes immediately (Gap B reproduction).
    await expect.poll(
        () => page.evaluate(() =>
            window.__slideChip && window.__slideChip.__getStateForTests
                ? window.__slideChip.__getStateForTests().lifecycle
                : null,
        ),
        { timeout: 8000 },
    ).toBe('first-use-confirm');
    // No bytes on wire yet (chip is gating).
    const wireBytesSent = await page.evaluate(() => {
        const log = window.__mockWriterLog || [];
        const decoder = new TextDecoder();
        for (const entry of log) {
            const raw = entry.bytes || entry;
            const u8 = raw instanceof Uint8Array ? raw : new Uint8Array(raw);
            if (decoder.decode(u8).includes('OTHER')) return true;
        }
        return false;
    });
    expect(wireBytesSent).toBe(false);
});

test('Plan 12-06 — Settings input safe value returns border to base muted token', async ({ page }) => {
    await setup(page);
    // Warm-up: type unsafe → assert red (sanity), then type safe → assert
    // border returns to base. This pins the round-trip so a future
    // regression that pins data-invalid="true" permanently surfaces.
    await page.locator('#slide-auto-send-input').fill('B:RM *.* ; SLIDE R');
    await page.locator('#slide-auto-send-input').dispatchEvent('change');
    await expect.poll(
        () => page.locator('#slide-auto-send-input').getAttribute('data-invalid'),
        { timeout: 2000 },
    ).toBe('true');
    // Now switch to a safe value (default — already in SAFE_CASES).
    await page.locator('#slide-auto-send-input').fill('B:SLIDE R');
    await page.locator('#slide-auto-send-input').dispatchEvent('change');
    // The change handler removes data-invalid on safe values.
    await expect.poll(
        () => page.locator('#slide-auto-send-input').getAttribute('data-invalid'),
        { timeout: 2000 },
    ).not.toBe('true');
    // Blur the input so the :focus-visible rule (0,2,1,0) no longer paints
    // var(--chrome-accent). After blur, the base rule (0,2,0,0) wins
    // (no more invalid rule to override; the safe-value path leaves only
    // the base #settings-slide #slide-auto-send-input rule painting).
    await page.locator('#slide-auto-send-input').blur();
    // Border returns to the base rule (--chrome-border = rgba(255,255,255,0.08)).
    const borderColor = await page.locator('#slide-auto-send-input').evaluate((el) =>
        window.getComputedStyle(el).borderColor
    );
    expect(borderColor).toBe('rgba(255, 255, 255, 0.08)');
});
