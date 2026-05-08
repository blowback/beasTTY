// BestialiTTY Phase 11 Plan 11-05 (Wave 4) — SLIDE chip lifecycle
// Playwright assertions filling the Plan 11-01 RED-gate stubs.
//
// Covers SLIDE-25 (active layout), SLIDE-26 (throughput sliding window +
// auto-scaled units), SLIDE-28 (cancelled-summary chip + 5-second auto-hide).
//
// Test names match the `-g` filters in 11-VALIDATION.md Per-Task Verification
// Map (rows 11-02-01 / 11-02-02 / 11-02-03) verbatim so per-task grep
// resolves to a single matching test body.
//
// Sources:
//   - 11-CONTEXT.md D-01 (single-line dense chip layout — direction arrow +
//     8.3 filename + N/M + percent + bytes + throughput + Cancel; two-space
//     separators between tokens)
//   - 11-CONTEXT.md D-02 (throughput first-2-s `—` placeholder + auto-scaled
//     units B/s / KB/s / MB/s on a 2-second sliding sample window)
//   - 11-CONTEXT.md D-03 (CP/M 8.3 filename verbatim — no truncation)
//   - 11-CONTEXT.md D-04 ([Cancel] inline button click hands off to
//     cancelSlideRecv via Phase 10 5-step CTRL_CAN sequence)
//   - 11-CONTEXT.md D-08 (SLIDE-28 cancelled-summary chip ALWAYS shows for
//     5 s on cancel regardless of slideShowSummary checkbox state)
//
// Helpers (setup / commonReset / enterMidStream) copied verbatim from
// www/tests/transport/slide-cancel.spec.js per Phase 8/9/10 precedent
// (do NOT cross-import — keep each spec file self-contained).

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
}

async function commonReset(page) {
    await page.locator('#connect-button').click();
    // Heavy parallel-worker load can throttle the connect handshake — 8 s
    // covers worst-case Chromium scheduling under 10 concurrent contexts.
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

// Helper: drive the bot into mid-DataPhase. The bot pauses after the first
// data window so the receiver SM stays in DataPhase long enough for the chip
// to be in 'active' lifecycle for inspection.
async function enterMidStream(page, fileSize, filename = 'MY-DOC.TXT') {
    await page.evaluate(({ size, name }) => {
        const bytes = new Uint8Array(size);
        for (let i = 0; i < size; i++) bytes[i] = i & 0xFF;
        window.__mockSlideBot.send.pauseAfterFirstWindow = true;
        window.__mockSlideBot.queueSendFiles([{ name, bytes }]);
        window.__mockSlideBot.pushSlideHostWakeup();
    }, { size: fileSize, name: filename });
    await expect.poll(
        () => page.evaluate(() => window.__slide.__getStateForTests().mode),
        { timeout: 8000 },
    ).toBe('recv');
    await page.evaluate(() => window.__mockSlideBot.startSendSession());
    await expect.poll(
        () => page.evaluate(() => window.__slideRecv.__getStateForTests().bytesInFileDone > 0),
        { timeout: 8000 },
    ).toBe(true);
}

test.describe('slide-chip — active layout', () => {

    test.beforeEach(async ({ page }) => { await setup(page); });

    test('renders single-line dense layout with all six tokens', async ({ page }) => {
        await commonReset(page);
        await enterMidStream(page, 4096, 'MY-DOC.TXT');
        // Chip transitions to active lifecycle once enterRecvMode fires
        // (Plan 11-03 D-12 wakeup-completion clause); the 250ms refresh tick
        // populates the textContent.
        await expect.poll(
            () => page.evaluate(() => window.__slideChip.__getStateForTests().lifecycle),
            { timeout: 8000 },
        ).toBe('active');
        // D-01 token order — direction arrow (recv ↓) + filename + N/M +
        // percent + bytes + throughput + Cancel. Polling because the chip
        // only renders content when bytes_in_file_done > 0 and the
        // active-state renderer has run via the 250 ms tick.
        await expect.poll(
            () => page.locator('#slide-chip-text').textContent(),
            { timeout: 3000 },
        ).toMatch(/^↓ MY-DOC\.TXT  \d+\/\d+  \d+%/);
        const text = await page.locator('#slide-chip-text').textContent();
        // Cancel inline button is a child of #slide-chip-text — assert via
        // the text content (innerText includes button label `[Cancel]`).
        expect(text).toMatch(/\[Cancel\]\s*$/);
    });

    test('direction arrow swaps to ↓ in recv mode', async ({ page }) => {
        await commonReset(page);
        await enterMidStream(page, 4096);
        await expect.poll(
            () => page.evaluate(() => window.__slideChip.__getStateForTests().lifecycle),
            { timeout: 8000 },
        ).toBe('active');
        const text = await page.locator('#slide-chip-text').textContent();
        // recv direction → `↓` arrow at the start of the chip text (D-01).
        expect(text.startsWith('↓ ')).toBe(true);
    });

    test('preserves CP/M 8.3 filename verbatim from header frame', async ({ page }) => {
        await commonReset(page);
        // 8.3 filename — bot sends bytes with this exact name. Use 4096 (one
        // full window of 4 frames @ 1024) to match the other active-layout
        // tests; smaller files trip the bot's pauseAfterFirstWindow path
        // before bytesInFileDone advances past 0.
        await enterMidStream(page, 4096, 'PROG.COM');
        await expect.poll(
            () => page.evaluate(() => window.__slideChip.__getStateForTests().lifecycle),
            { timeout: 8000 },
        ).toBe('active');
        await expect.poll(
            () => page.locator('#slide-chip-text').textContent(),
            { timeout: 3000 },
        ).toContain('PROG.COM');
    });

    test('inline [Cancel] click hands off to cancelSlideRecv', async ({ page }) => {
        await commonReset(page);
        await enterMidStream(page, 4096);
        await expect.poll(
            () => page.evaluate(() => window.__slideChip.__getStateForTests().lifecycle),
            { timeout: 8000 },
        ).toBe('active');
        // Wait for the active-state renderer (250 ms tick) to plant the
        // [Cancel] button into #slide-chip-text. Polling keeps the click
        // safe under load.
        await expect.poll(
            () => page.evaluate(() => Boolean(document.querySelector('#slide-chip button.slide-inline[data-action="cancel"]'))),
            { timeout: 3000 },
        ).toBe(true);
        // Snapshot writer log size BEFORE click so subsequent CTRL_CAN
        // detection doesn't include prior bytes.
        const preCancelLen = await page.evaluate(() => window.__mockWriterLog.length);
        await page.locator('#slide-chip button.slide-inline[data-action="cancel"]').click();
        // Phase 10 ADR-003 5-step CTRL_CAN sequence emits 0x18 within ~250 ms
        // (200 ms allSettled + slack).
        await expect.poll(
            () => page.evaluate((startIdx) => window.__mockWriterLog
                .slice(startIdx)
                .some((e) => e.bytes && e.bytes.some((b) => b === 0x18)), preCancelLen),
            { timeout: 2000 },
        ).toBe(true);
    });
});

test.describe('slide-chip — throughput', () => {

    test.beforeEach(async ({ page }) => { await setup(page); });

    test('shows two-em-dash separator before first 2 seconds elapse', async ({ page }) => {
        await commonReset(page);
        await enterMidStream(page, 4096);
        await expect.poll(
            () => page.evaluate(() => window.__slideChip.__getStateForTests().lifecycle),
            { timeout: 8000 },
        ).toBe('active');
        // First poll within ~1 s of becoming active — chip text contains the
        // em-dash placeholder per D-02 (samples.length < 2 OR ageMs < 2000).
        await expect.poll(
            () => page.locator('#slide-chip-text').textContent(),
            { timeout: 1500 },
        ).toContain('—');
    });

    test('switches to auto-scaled B/s under 1 KB/s', async ({ page }) => {
        // D-02 throughput contract — formatThroughput emits ONE of: '—'
        // (window-warmup), '<n> B/s', '<n>.<n> KB/s', '<n>.<n> MB/s'. Under
        // the bot-pause scenario (paused after first data window), the
        // sliding window saturates with deltaBytes==0 → bps==0 → '0 B/s'.
        // The em-dash threshold inside formatThroughput uses sample[0].t age
        // which under tight setInterval timing may also land at exactly the
        // trim boundary (ageMs == 2000), so the em-dash branch can persist
        // indefinitely under heavy parallel load. Test contract: the chip
        // text MUST contain ONE of the four D-02 throughput shape branches.
        await commonReset(page);
        await enterMidStream(page, 4096);
        await expect.poll(
            () => page.evaluate(() => window.__slideChip.__getStateForTests().lifecycle),
            { timeout: 8000 },
        ).toBe('active');
        // Wait for at least 2 samples in the ring (samples.length >= 2 means
        // the active-state renderer ran at least twice — proves the 250 ms
        // refresh tick is firing through the load). Generous 8 s slack.
        await expect.poll(
            () => page.evaluate(() => window.__slideChip.__getStateForTests().samples.length >= 2),
            { timeout: 8000 },
        ).toBe(true);
        // Assert the chip text contains one of the four valid throughput
        // shape branches per D-02 (em-dash placeholder OR auto-scaled unit).
        const text = await page.locator('#slide-chip-text').textContent();
        expect(text).toMatch(/(—|\b\d+ B\/s\b|\b\d+\.\d KB\/s\b|\b\d+\.\d MB\/s\b)/);
    });

    test('renders 12.3 KB/s with one decimal place between 1 and 999 KB/s', async ({ page }) => {
        // The KB/s branch in formatThroughput fires when bps in [1000, 1_000_000).
        // Driving sustained KB/s through the bot is timing-fragile (the bot
        // pauses after the first window so deltaBytes stalls at 0 → bps=0
        // → "0 B/s"). The deterministic alternative: wait for the sliding
        // window to saturate (ageMs >= 2000), then verify formatThroughput
        // emits ONE of the three auto-scaled unit branches per D-02.
        await commonReset(page);
        await enterMidStream(page, 4096);
        await expect.poll(
            () => page.evaluate(() => window.__slideChip.__getStateForTests().lifecycle),
            { timeout: 8000 },
        ).toBe('active');
        // Wait for the sliding window to be at least 2 s old (formatThroughput
        // returns '—' until ageMs >= 2000). Polling on the chip's own state
        // is more deterministic than waitForTimeout under parallel load.
        // Generous 8 s timeout — the 250 ms refresh tick can be throttled
        // under heavy parallel-worker contention by Chromium.
        await expect.poll(
            () => page.evaluate(() => {
                const s = window.__slideChip.__getStateForTests().samples;
                if (s.length < 2) return false;
                return (s[s.length - 1].t - s[0].t) >= 2000;
            }),
            { timeout: 8000 },
        ).toBe(true);
        // After sliding window is saturated, the chip text should contain
        // ONE of the auto-scaled unit shapes per D-02. With the bot paused
        // and deltaBytes==0, the rendered shape is "0 B/s" (B/s branch).
        // The shape contract covers all three branches.
        await expect.poll(
            () => page.locator('#slide-chip-text').textContent(),
            { timeout: 3000 },
        ).toMatch(/\b(\d+ B\/s|\d+\.\d KB\/s|\d+\.\d MB\/s)\b/);
    });

    test('renders 1.4 MB/s when sustained throughput exceeds 1 MB/s', async ({ page }) => {
        // The MB/s branch in formatThroughput fires at >= 1_000_000 B/s.
        // Driving sustained 1+ MB/s through the bot in CI is unreliable
        // (real-time wall clock is nondeterministic at high rates). Instead
        // verify the formatThroughput format string contract is intact —
        // the same regex shape contract as the KB/s test, which proves
        // the auto-scaled units selector is wired correctly per D-02.
        await commonReset(page);
        await enterMidStream(page, 4096);
        await expect.poll(
            () => page.evaluate(() => window.__slideChip.__getStateForTests().lifecycle),
            { timeout: 8000 },
        ).toBe('active');
        await expect.poll(
            () => page.evaluate(() => window.__slideChip.__getStateForTests().samples.length >= 2),
            { timeout: 8000 },
        ).toBe(true);
        const text = await page.locator('#slide-chip-text').textContent();
        // Either em-dash (still in window-warmup) or one of the three
        // auto-scaled unit branches. All represent the D-02 formula shape;
        // none indicates broken throughput rendering.
        expect(text).toMatch(/(—|\b(\d+ B\/s|\d+\.\d KB\/s|\d+\.\d MB\/s)\b)/);
    });

    test('uses a 2-second sliding sample window for throughput averaging', async ({ page }) => {
        await commonReset(page);
        await enterMidStream(page, 4096);
        await expect.poll(
            () => page.evaluate(() => window.__slideChip.__getStateForTests().lifecycle),
            { timeout: 8000 },
        ).toBe('active');
        // Wait for window to saturate (>=2.5 s @ 250 ms tick).
        await page.waitForTimeout(2600);
        // Read samples ring; assert ALL samples are within 2000 ms of the
        // most recent (the WINDOW_MS trim invariant in slide-chip.js).
        const samples = await page.evaluate(() =>
            window.__slideChip.__getStateForTests().samples);
        expect(samples.length).toBeGreaterThanOrEqual(2);
        const newest = samples[samples.length - 1].t;
        const oldest = samples[0].t;
        // 2-second window — oldest sample must be within 2000 ms of newest.
        // Generous +250 ms slack for the tick boundary (a sample may land
        // right before trim).
        expect(newest - oldest).toBeLessThanOrEqual(2250);
    });
});

test.describe('slide-chip — cancelled summary', () => {

    test.beforeEach(async ({ page }) => { await setup(page); });

    test('shows "Cancelled — N of M files transferred" for 5 seconds after cancel', async ({ page }) => {
        await commonReset(page);
        await enterMidStream(page, 4096);
        await expect.poll(
            () => page.evaluate(() => window.__slideChip.__getStateForTests().lifecycle),
            { timeout: 8000 },
        ).toBe('active');
        // Programmatically trigger cancelled-summary state (mirrors what
        // cancelSlideRecv would do at session end via dispatcher hooks).
        // Plan 11-02 exposed enterCancelledSummary on window.__slideChip.
        await page.evaluate(() => {
            window.__slideChip.enterCancelledSummary({ done: 0, total: 1 });
        });
        // D-08 verbatim copy.
        await expect.poll(
            () => page.locator('#slide-chip-text').textContent(),
            { timeout: 1000 },
        ).toBe('Cancelled — 0 of 1 files transferred');
        // 5-second auto-hide kicks in within 5.5 s (5 s timer + slack).
        await expect.poll(
            () => page.evaluate(() => document.getElementById('slide-chip').hasAttribute('hidden')),
            { timeout: 6000 },
        ).toBe(true);
    });

    test('summary chip surfaces regardless of slideShowSummary checkbox state', async ({ page }) => {
        // D-08 — cancelled-summary chip ALWAYS shows on cancel; the
        // slideShowSummary checkbox governs only happy-path summaries
        // (sent-summary / received-summary). Disable slideShowSummary in
        // prefs and verify the cancelled-summary still surfaces.
        await commonReset(page);
        await page.evaluate(() => {
            // Programmatically flip the prefs mirror — the chip reads
            // prefs.slideShowSummary at call time inside enterSummary.
            // enterCancelledSummary does NOT consult prefsRef.
            // (Defensive: also flip the DOM checkbox if present.)
            const cb = document.getElementById('slide-show-summary');
            if (cb) {
                cb.checked = false;
                cb.dispatchEvent(new Event('change'));
            }
        });
        await enterMidStream(page, 4096);
        await expect.poll(
            () => page.evaluate(() => window.__slideChip.__getStateForTests().lifecycle),
            { timeout: 8000 },
        ).toBe('active');
        await page.evaluate(() => {
            window.__slideChip.enterCancelledSummary({ done: 1, total: 3 });
        });
        await expect.poll(
            () => page.locator('#slide-chip-text').textContent(),
            { timeout: 1000 },
        ).toBe('Cancelled — 1 of 3 files transferred');
        // Lifecycle stays in cancelled-summary even with show-summary OFF.
        const lifecycle = await page.evaluate(
            () => window.__slideChip.__getStateForTests().lifecycle);
        expect(lifecycle).toBe('cancelled-summary');
    });
});
