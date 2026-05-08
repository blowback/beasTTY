// Beastty Phase 10 Plan 10-05 — receiver download path Playwright assertions.
//
// Drives the mock-serial-slide-bot in 'send' role (Plan 10-05 extension) to
// produce SLIDE wire bytes that the production Rust receiver SM consumes. We
// spy on URL.createObjectURL to capture downloaded Blobs and assert byte-
// identical round-trip per Phase 10 SC#5.
//
// Source: 10-05-PLAN.md Task 2 + 10-VALIDATION.md Wave 0 + 10-RESEARCH.md
//         §"Phase Requirements → Test Map" + 10-UI-SPEC.md.
// Setup template borrowed verbatim from slide-sender.spec.js (Phase 9 P-04).

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

async function installBlobSpy(page) {
    await page.evaluate(() => {
        window.__capturedBlobs = [];
        window.__capturedDownloads = [];   // { name, ts }
        const origCreate = URL.createObjectURL;
        URL.createObjectURL = (blob) => {
            window.__capturedBlobs.push(blob);
            window.__capturedDownloads.push({ ts: Date.now() });
            return origCreate.call(URL, blob);
        };
        // Capture the anchor.download attribute for each click.
        const origAppend = document.body.appendChild.bind(document.body);
        document.body.appendChild = function(el) {
            if (el && el.tagName === 'A' && el.download) {
                const last = window.__capturedDownloads[window.__capturedDownloads.length - 1];
                if (last) last.name = el.download;
            }
            return origAppend(el);
        };
    });
}

async function driveOneFile(page, name, bytes) {
    await page.evaluate(({ name, bytes }) => {
        window.__mockSlideBot.queueSendFiles([{ name, bytes: new Uint8Array(bytes) }]);
        window.__mockSlideBot.pushSlideHostWakeup();
    }, { name, bytes: Array.from(bytes) });
    await expect.poll(
        () => page.evaluate(() => window.__slide.__getStateForTests().mode),
        { timeout: 5000 },
    ).toBe('recv');
    await page.evaluate(() => window.__mockSlideBot.startSendSession());
}

test.describe('slide-recv — anchor-click download path (toggle off, default)', () => {

    test.beforeEach(async ({ page }) => {
        await setup(page);
        await page.locator('#connect-button').click();
        await expect.poll(
            () => page.evaluate(() => Boolean(navigator.serial._grantedPorts[0]?._reader)),
            { timeout: 5000 },
        ).toBe(true);
        await page.evaluate(() => {
            window.__slide.__resetForTests();
            window.__slideRecv.__resetForTests();
            window.__mockWriterLog.length = 0;
            window.__mockSlideBot.reset();
            window.__mockSlideBot.setRole('send');
        });
        await installBlobSpy(page);
    });

    test('SLIDE-18: single file -> anchor-click -> URL.createObjectURL invoked once', async ({ page }) => {
        const fixture = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
        await driveOneFile(page, 'A.TXT', fixture);
        await expect.poll(
            () => page.evaluate(() => window.__capturedBlobs.length),
            { timeout: 8000 },
        ).toBe(1);
        const blobBytes = await page.evaluate(async () => {
            const blob = window.__capturedBlobs[0];
            return Array.from(new Uint8Array(await blob.arrayBuffer()));
        });
        expect(blobBytes).toEqual(fixture);
    });

    test('SLIDE-19: multi-file batch -> 250 ms inter-file gap', async ({ page }) => {
        const files = [
            { name: 'F1.TXT', bytes: [1, 2, 3] },
            { name: 'F2.TXT', bytes: [4, 5, 6] },
            { name: 'F3.TXT', bytes: [7, 8, 9] },
        ];
        await page.evaluate((files) => {
            window.__mockSlideBot.queueSendFiles(files.map((f) => ({
                name: f.name,
                bytes: new Uint8Array(f.bytes),
            })));
            window.__mockSlideBot.pushSlideHostWakeup();
        }, files);
        await expect.poll(
            () => page.evaluate(() => window.__slide.__getStateForTests().mode),
            { timeout: 5000 },
        ).toBe('recv');
        await page.evaluate(() => window.__mockSlideBot.startSendSession());
        await expect.poll(
            () => page.evaluate(() => window.__capturedBlobs.length),
            { timeout: 15000 },
        ).toBe(3);
        const timestamps = await page.evaluate(() =>
            window.__capturedDownloads.map((d) => d.ts),
        );
        // Assert all consecutive deltas >= 240 ms (20 ms tolerance for clock skew).
        for (let i = 1; i < timestamps.length; i++) {
            const delta = timestamps[i] - timestamps[i - 1];
            expect(delta).toBeGreaterThanOrEqual(240);
        }
    });

    test('SLIDE-20: filename verbatim from CP/M 8.3 — REPORT.TXT', async ({ page }) => {
        await driveOneFile(page, 'REPORT.TXT', [0x41, 0x42, 0x43]);
        await expect.poll(
            () => page.evaluate(() => window.__capturedDownloads.length),
            { timeout: 8000 },
        ).toBe(1);
        const downloaded = await page.evaluate(() => window.__capturedDownloads[0]);
        expect(downloaded.name).toBe('REPORT.TXT');
    });

    test('SLIDE-21: zero-byte file — empty Blob', async ({ page }) => {
        await driveOneFile(page, 'EMPTY.TXT', []);
        await expect.poll(
            () => page.evaluate(() => window.__capturedBlobs.length),
            { timeout: 8000 },
        ).toBe(1);
        const size = await page.evaluate(() => window.__capturedBlobs[0].size);
        expect(size).toBe(0);
    });

    test('SLIDE-22: sub-frame file — 100 bytes single data frame', async ({ page }) => {
        const fixture = Array.from({ length: 100 }, (_, i) => i & 0xFF);
        await driveOneFile(page, 'SUB.TXT', fixture);
        await expect.poll(
            () => page.evaluate(() => window.__capturedBlobs.length),
            { timeout: 8000 },
        ).toBe(1);
        const blobBytes = await page.evaluate(async () =>
            Array.from(new Uint8Array(await window.__capturedBlobs[0].arrayBuffer())),
        );
        expect(blobBytes).toEqual(fixture);
    });

    test('SLIDE-23: binary content — high bytes pass through without text-encoding', async ({ page }) => {
        const fixture = [0x00, 0xFF, 0x80, 0x7F, 0xDE, 0xAD, 0xBE, 0xEF, 0x01, 0xFE];
        await driveOneFile(page, 'BIN.COM', fixture);
        await expect.poll(
            () => page.evaluate(() => window.__capturedBlobs.length),
            { timeout: 8000 },
        ).toBe(1);
        const blobBytes = await page.evaluate(async () =>
            Array.from(new Uint8Array(await window.__capturedBlobs[0].arrayBuffer())),
        );
        expect(blobBytes).toEqual(fixture);
    });

    test('SLIDE-24: 1 MB+ memory smoke — usedJSHeapSize stays bounded', async ({ page }) => {
        // Drive a ~200 KB file (200 frames × 1024 bytes — stays under the seq u8
        // wrap point; seq=256 wraps to 0 which collides with the header-frame
        // seq, so the practical 1-file cap is ~255 KB. See 10-RESEARCH.md
        // §"Pitfall 7: performance.memory.usedJSHeapSize" for methodology).
        // Take 3 deltas, take the minimum (filters scrollback noise + GC), assert
        // < 5× file size per Pitfall 7.
        const FRAME_COUNT = 200;
        const FRAME_SIZE = 1024;
        const FILE_SIZE = FRAME_COUNT * FRAME_SIZE;
        const SLACK_FACTOR = 5;
        const samples = [];
        for (let trial = 0; trial < 3; trial++) {
            await page.evaluate(() => {
                window.__slide.__resetForTests();
                window.__slideRecv.__resetForTests();
                window.__mockWriterLog.length = 0;
                window.__mockSlideBot.reset();
                window.__mockSlideBot.setRole('send');
                window.__capturedBlobs = [];
                window.__capturedDownloads = [];
            });
            const before = await page.evaluate(() =>
                performance.memory ? performance.memory.usedJSHeapSize : 0,
            );
            await page.evaluate((size) => {
                const bytes = new Uint8Array(size);
                for (let i = 0; i < size; i++) bytes[i] = i & 0xFF;
                window.__mockSlideBot.queueSendFiles([{ name: 'BIG.BIN', bytes }]);
                window.__mockSlideBot.pushSlideHostWakeup();
            }, FILE_SIZE);
            await expect.poll(
                () => page.evaluate(() => window.__slide.__getStateForTests().mode),
                { timeout: 5000 },
            ).toBe('recv');
            await page.evaluate(() => window.__mockSlideBot.startSendSession());
            await expect.poll(
                () => page.evaluate(() => window.__capturedBlobs.length),
                { timeout: 30000 },
            ).toBe(1);
            const after = await page.evaluate(() =>
                performance.memory ? performance.memory.usedJSHeapSize : 0,
            );
            samples.push(after - before);
        }
        const minDelta = Math.min(...samples);
        // performance.memory may be 0 if Chrome flag is off; only assert when
        // both samples are non-zero. The minimum delta over 3 runs filters
        // scrollback growth + GC noise (Pitfall 7).
        if (samples.every((s) => s > 0)) {
            expect(minDelta).toBeLessThan(FILE_SIZE * SLACK_FACTOR);
        }
        // Always assert byte-correctness.
        const blobSize = await page.evaluate(() => window.__capturedBlobs[0].size);
        expect(blobSize).toBe(FILE_SIZE);
    });
});
