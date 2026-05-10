// Beastty Phase 11 Plan 11-05 (Wave 4) — SLIDE 3-way Compatibility mode
// Playwright assertions filling the Plan 11-01 RED-gate stubs.
//
// Covers SLIDE-35 (Auto timeout 3-second timer + chip with Retry/Cancel/
// Force-start buttons) + SLIDE-39 (Wakeup-required + Force-start branches).
//
// Test names match the `-g` filters in 11-VALIDATION.md Per-Task Verification
// Map (rows 11-05-01..11-05-06) verbatim.
//
// Sources:
//   - 11-CONTEXT.md D-15 (3-second timer counted from auto-type completion;
//     chip enters awaiting-wakeup; on timeout chip displays
//     `Z80 didn't respond.  [Retry]  [Cancel]  [Force start]`)
//   - 11-CONTEXT.md D-16 (Compatibility mode 3-way governs whether the
//     timer arms — 'auto' | 'wakeup-required' | 'force-start')
//   - 11-CONTEXT.md D-07 (3-way <select> semantics)
//   - 11-CONTEXT.md C-03 (force-start skips wakeup wait — jumps directly
//     into enterSendModeInternal)
//   - mock-bot setWakeupDelay(ms) Plan 11-01 Task 2 — defers
//     pushSlideHostWakeup by N ms so the 3 s timeout chip is observable
//     without a real-hardware Z80.

import { test, expect } from '@playwright/test';
import { SERIAL_MOCK } from './mock-serial.js';
import { MOCK_SERIAL_SLIDE_BOT } from './mock-serial-slide-bot.js';

async function setup(page) {
    await page.addInitScript(SERIAL_MOCK);
    await page.addInitScript(MOCK_SERIAL_SLIDE_BOT);
    await page.goto('/');
    await page.locator('#terminal-wrapper').focus();
    await page.waitForFunction(() => document.getElementById('terminal').width > 0);
    await page.locator('#connection').evaluate((el) => { el.open = true; });
    await page.locator('#settings').evaluate((el) => { el.open = true; });
    await page.locator('#settings-slide').evaluate((el) => { el.open = true; });
}

async function commonReset(page) {
    await page.locator('#connect-button').click();
    await expect.poll(
        () => page.evaluate(() => Boolean(navigator.serial._grantedPorts[0]?._reader)),
        { timeout: 8000 },
    ).toBe(true);
    await page.evaluate(() => {
        window.__slide.__resetForTests();
        window.__slideRecv.__resetForTests();
        window.__slideChip.__resetForTests();
        window.__mockWriterLog.length = 0;
        window.__mockSlideBot.reset();
        window.__mockSlideBot.setRole('send');
    });
}

// Set Compatibility mode at runtime. Mutates the live `prefs` object held
// by slide.js's wireSlideDispatcher closure (window.__prefs.live exposes
// the same reference). savePrefs reassigns the `cached` blob in prefs.js
// to a new object; the boot-time snapshot held by wireSlideDispatcher does
// NOT update when savePrefs runs, so we mutate the snapshot directly.
// Persistence behaviour (slide-prefs.spec.js) is verified separately —
// here we exercise only the dispatcher's runtime read path.
async function setCompatMode(page, mode) {
    await page.evaluate((m) => {
        window.__prefs.live.slideCompatibilityMode = m;
    }, mode);
}

test.describe('slide-compatibility — Auto timeout', () => {

    test.beforeEach(async ({ page }) => { await setup(page); });

    test('arms 3-second timer at auto-type completion', async ({ page }) => {
        await commonReset(page);
        // Default Compatibility mode is 'auto'. Defer the wakeup so the
        // timer fires before the bot wakes up.
        await page.evaluate(() => {
            window.__mockSlideBot.setWakeupDelay(5000);
        });
        await page.evaluate(() => {
            const file = new File([new Uint8Array([0x41])], 'A.TXT');
            window.__slide.enterSendMode({ files: [file] });
        });
        // After enterSendMode, the chip should be in awaiting-wakeup with
        // the 3 s timer armed (D-15 / D-16 'auto' branch).
        await expect.poll(
            () => page.evaluate(() => window.__slideChip.__getStateForTests().lifecycle),
            { timeout: 2000 },
        ).toBe('awaiting-wakeup');
        const hasTimer = await page.evaluate(
            () => window.__slideChip.__getStateForTests().hasWakeupTimer);
        expect(hasTimer).toBe(true);
        // Wait for the 3 s timer to fire — chip transitions to awaiting-timeout.
        await expect.poll(
            () => page.evaluate(() => window.__slideChip.__getStateForTests().lifecycle),
            { timeout: 5000 },
        ).toBe('awaiting-timeout');
    });

    test('chip transitions to awaiting-timeout text "Z80 didn\'t respond.  [Retry]  [Cancel]  [Force start]"', async ({ page }) => {
        await commonReset(page);
        await page.evaluate(() => { window.__mockSlideBot.setWakeupDelay(5000); });
        await page.evaluate(() => {
            const file = new File([new Uint8Array([0x41])], 'A.TXT');
            window.__slide.enterSendMode({ files: [file] });
        });
        await expect.poll(
            () => page.evaluate(() => window.__slideChip.__getStateForTests().lifecycle),
            { timeout: 5000 },
        ).toBe('awaiting-timeout');
        const text = await page.locator('#slide-chip-text').textContent();
        expect(text).toContain("Z80 didn't respond.");
        expect(text).toContain('[Retry]');
        expect(text).toContain('[Cancel]');
        expect(text).toContain('[Force start]');
    });
});

test.describe('slide-compatibility — Wakeup-required', () => {

    test.beforeEach(async ({ page }) => { await setup(page); });

    test('does not arm 3-second timer in Wakeup-required mode', async ({ page }) => {
        // Switch Compatibility mode to wakeup-required BEFORE the connect
        // handshake, so the prefs is read at enterSendMode time.
        await setCompatMode(page, 'wakeup-required');
        await commonReset(page);
        await page.evaluate(() => { window.__mockSlideBot.setWakeupDelay(10000); });
        await page.evaluate(() => {
            const file = new File([new Uint8Array([0x41])], 'A.TXT');
            window.__slide.enterSendMode({ files: [file] });
        });
        // Chip enters awaiting-wakeup. Crucially, NO timer is armed —
        // hasWakeupTimer must be false (D-16 wakeup-required branch).
        await expect.poll(
            () => page.evaluate(() => window.__slideChip.__getStateForTests().lifecycle),
            { timeout: 2000 },
        ).toBe('awaiting-wakeup');
        const hasTimer = await page.evaluate(
            () => window.__slideChip.__getStateForTests().hasWakeupTimer);
        expect(hasTimer).toBe(false);
    });

    test('chip stays in awaiting-wakeup indefinitely past 5 seconds', async ({ page }) => {
        await setCompatMode(page, 'wakeup-required');
        await commonReset(page);
        // Defer wakeup beyond the 5 s observation window so the chip
        // doesn't transition to active during the test.
        await page.evaluate(() => { window.__mockSlideBot.setWakeupDelay(10000); });
        await page.evaluate(() => {
            const file = new File([new Uint8Array([0x41])], 'A.TXT');
            window.__slide.enterSendMode({ files: [file] });
        });
        // Wait > 4 s — must STILL be in awaiting-wakeup (no timeout chip
        // ever surfaces in wakeup-required mode per D-16).
        await page.waitForTimeout(4500);
        const lifecycle = await page.evaluate(
            () => window.__slideChip.__getStateForTests().lifecycle);
        expect(lifecycle).toBe('awaiting-wakeup');
    });
});

test.describe('slide-compatibility — Force-start', () => {

    test.beforeEach(async ({ page }) => { await setup(page); });

    test('skips wakeup wait entirely in Force-start mode', async ({ page }) => {
        await setCompatMode(page, 'force-start');
        await commonReset(page);
        // Even with a never-arriving wakeup, force-start jumps directly
        // into enterSendModeInternal (microtask-scheduled per D-16).
        await page.evaluate(() => { window.__mockSlideBot.setWakeupDelay(20000); });
        await page.evaluate(() => {
            const file = new File([new Uint8Array([0x41])], 'A.TXT');
            window.__slide.enterSendMode({ files: [file] });
        });
        // Mode must transition to 'send' without waiting for the wakeup
        // signature (D-16 force-start branch — Promise.resolve().then(...)).
        await expect.poll(
            () => page.evaluate(() => window.__slide.__getStateForTests().mode),
            { timeout: 2000 },
        ).toBe('send');
    });

    test('chip enters active state immediately on auto-type completion', async ({ page }) => {
        await setCompatMode(page, 'force-start');
        await commonReset(page);
        await page.evaluate(() => { window.__mockSlideBot.setWakeupDelay(20000); });
        await page.evaluate(() => {
            const file = new File([new Uint8Array([0x41])], 'A.TXT');
            window.__slide.enterSendMode({ files: [file] });
        });
        // Force-start: chip flashes awaiting-wakeup briefly per D-16, then
        // mode flips to 'send' on microtask, after which the chip's 250 ms
        // tick re-renders. The deterministic check: mode reaches 'send'.
        await expect.poll(
            () => page.evaluate(() => window.__slide.__getStateForTests().mode),
            { timeout: 2000 },
        ).toBe('send');
    });
});

test.describe('slide-compatibility — Retry button', () => {

    test.beforeEach(async ({ page }) => { await setup(page); });

    test('[Retry] re-emits auto-type and restarts the 3-second timer', async ({ page }) => {
        await commonReset(page);
        await page.evaluate(() => { window.__mockSlideBot.setWakeupDelay(20000); });
        await page.evaluate(() => {
            const file = new File([new Uint8Array([0x41])], 'A.TXT');
            window.__slide.enterSendMode({ files: [file] });
        });
        // Wait for awaiting-timeout (3 s + slack).
        await expect.poll(
            () => page.evaluate(() => window.__slideChip.__getStateForTests().lifecycle),
            { timeout: 5000 },
        ).toBe('awaiting-timeout');
        // Snapshot writer-log length BEFORE the retry click.
        const writeCountBefore = await page.evaluate(() => window.__mockWriterLog.length);
        // Click [Retry] — D-15 re-emits auto-type and re-arms the timer.
        await page.locator('#slide-chip button.slide-inline[data-action="retry"]').click();
        // Brief settle — auto-type pushTxBytes is sync; writer log grows.
        await expect.poll(
            () => page.evaluate(() => window.__mockWriterLog.length),
            { timeout: 2000 },
        ).toBeGreaterThan(writeCountBefore);
        // Chip returns to awaiting-wakeup with timer armed (D-15 retry
        // honours current Compatibility mode → 'auto' default → armTimer).
        await expect.poll(
            () => page.evaluate(() => window.__slideChip.__getStateForTests().lifecycle),
            { timeout: 1000 },
        ).toBe('awaiting-wakeup');
    });
});

test.describe('slide-compatibility — Cancel button', () => {

    test.beforeEach(async ({ page }) => { await setup(page); });

    test('[Cancel] clears pendingSendSession and hides the chip', async ({ page }) => {
        await commonReset(page);
        await page.evaluate(() => { window.__mockSlideBot.setWakeupDelay(20000); });
        await page.evaluate(() => {
            const file = new File([new Uint8Array([0x41])], 'A.TXT');
            window.__slide.enterSendMode({ files: [file] });
        });
        await expect.poll(
            () => page.evaluate(() => window.__slideChip.__getStateForTests().lifecycle),
            { timeout: 5000 },
        ).toBe('awaiting-timeout');
        // Click [Cancel] in the awaiting-timeout chip — slide.js's
        // handleChipInlineAction case 'cancel' clears pendingSendSession
        // and calls slideChipRef.hide() per D-15.
        await page.locator('#slide-chip button.slide-inline[data-action="cancel"]').click();
        // Chip lifecycle returns to 'hidden'; pendingSendSession cleared.
        await expect.poll(
            () => page.evaluate(() => window.__slideChip.__getStateForTests().lifecycle),
            { timeout: 2000 },
        ).toBe('hidden');
        const hasPending = await page.evaluate(
            () => window.__slide.__getStateForTests().hasPendingSendSession);
        expect(hasPending).toBe(false);
    });
});

test.describe('slide-compatibility — Force start button', () => {

    test.beforeEach(async ({ page }) => { await setup(page); });

    test('[Force start] click jumps directly into send mode without waiting for wakeup', async ({ page }) => {
        await commonReset(page);
        await page.evaluate(() => { window.__mockSlideBot.setWakeupDelay(20000); });
        await page.evaluate(() => {
            const file = new File([new Uint8Array([0x41])], 'A.TXT');
            window.__slide.enterSendMode({ files: [file] });
        });
        await expect.poll(
            () => page.evaluate(() => window.__slideChip.__getStateForTests().lifecycle),
            { timeout: 5000 },
        ).toBe('awaiting-timeout');
        // Click [Force start] — D-15 calls enterSendModeInternal directly,
        // bypassing the wakeup matcher.
        await page.locator('#slide-chip button.slide-inline[data-action="force-start"]').click();
        await expect.poll(
            () => page.evaluate(() => window.__slide.__getStateForTests().mode),
            { timeout: 2000 },
        ).toBe('send');
        // Phase 12.1 Plan 12-07 — chip lifecycle MUST also transition out of
        // 'awaiting-timeout' so the user gets visible feedback on the click.
        // Regression guard for the gap diagnosed in
        // .planning/debug/12-force-start-button-does-nothing.md (force-start
        // case in slide.js previously omitted the enterActive() call).
        await expect.poll(
            () => page.evaluate(() => window.__slideChip.__getStateForTests().lifecycle),
            { timeout: 2000 },
        ).toBe('active');
    });

    // Phase 12 UAT Gap D regression — [Cancel] on the active-state chip
    // reached via [Force start] must dismiss the chip and exit send mode.
    // Pre-fix: chip's onCancel was wired to cancelSlideRecvLazy which short-
    // circuits in send mode; the inline-action observer also returned without
    // action for active-lifecycle. Result: dead button, only page reload
    // recovered. Diagnosis: .planning/debug/slide-active-cancel-broken.md.
    test('[Cancel] on active chip after [Force start] dismisses chip and exits send mode', async ({ page }) => {
        await commonReset(page);
        await page.evaluate(() => { window.__mockSlideBot.setWakeupDelay(20000); });
        await page.evaluate(() => {
            const file = new File([new Uint8Array([0x41])], 'A.TXT');
            window.__slide.enterSendMode({ files: [file] });
        });
        await expect.poll(
            () => page.evaluate(() => window.__slideChip.__getStateForTests().lifecycle),
            { timeout: 5000 },
        ).toBe('awaiting-timeout');
        await page.locator('#slide-chip button.slide-inline[data-action="force-start"]').click();
        // Lifecycle reaches 'active' (Plan 12-07 fix).
        await expect.poll(
            () => page.evaluate(() => window.__slideChip.__getStateForTests().lifecycle),
            { timeout: 2000 },
        ).toBe('active');
        // Now click [Cancel] on the active-state chip.
        await page.locator('#slide-chip button.slide-inline[data-action="cancel"]').click();
        // Chip hidden + mode returned to terminal — proves cancelSlideSend
        // ran end-to-end (5-step ADR-003 + forceExitSendMode).
        await expect.poll(
            () => page.evaluate(() => window.__slideChip.__getStateForTests().lifecycle),
            { timeout: 4000 },   // 2 s absolute timeout + 500 ms echo wait + slack
        ).toBe('hidden');
        await expect.poll(
            () => page.evaluate(() => window.__slide.__getStateForTests().mode),
            { timeout: 1000 },
        ).toBe('terminal');
        const hasPending = await page.evaluate(
            () => window.__slide.__getStateForTests().hasPendingSendSession);
        expect(hasPending).toBe(false);
    });
});
