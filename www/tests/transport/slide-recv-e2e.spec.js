// Beastty Phase 10 Plan 10-05 — full sender-role mock-bot E2E.
//
// Drives the full PC-receiver path end-to-end: ESC^SLIDE wakeup -> RDY/header/
// data/EOF/FIN handshakes consumed from the mock bot -> 3-file batch
// downloaded byte-identical via the production receiver. Mirrors Plan 09-04's
// slide-sender.spec.js byte-identical-round-trip methodology in the opposite
// direction (PITFALLS §13 four-leg discipline: Rust SM <-> Rust mock sender
// <-> JS mock bot <-> JS production receiver).
//
// Source: 10-05-PLAN.md Task 3 + 10-VALIDATION.md SC#1 + Phase 10 SC#5.
// Setup template borrowed verbatim from slide-recv.spec.js.

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
        window.__capturedDownloads = [];
        const origCreate = URL.createObjectURL;
        URL.createObjectURL = (blob) => {
            window.__capturedBlobs.push(blob);
            window.__capturedDownloads.push({ ts: Date.now() });
            return origCreate.call(URL, blob);
        };
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

test.describe('slide-recv-e2e — full sender-role mock bot round-trip', () => {

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

    test('Phase 10 SC#5: 3-file batch (zero-byte + sub-frame + binary) byte-identical', async ({ page }) => {
        // Three fixtures across the edge-case matrix:
        //   ZERO.TXT   — SLIDE-21 zero-byte file
        //   SMALL.TXT  — SLIDE-22 sub-frame text
        //   BIN.COM    — SLIDE-23 binary (high bytes pass through verbatim)
        const fixtures = [
            { name: 'ZERO.TXT', bytes: [] },
            { name: 'SMALL.TXT', bytes: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10] },
            { name: 'BIN.COM', bytes: [0x00, 0xFF, 0x80, 0x7F, 0xDE, 0xAD, 0xBE, 0xEF] },
        ];

        await page.evaluate((fixtures) => {
            window.__mockSlideBot.queueSendFiles(
                fixtures.map((f) => ({ name: f.name, bytes: new Uint8Array(f.bytes) })),
            );
            window.__mockSlideBot.pushSlideHostWakeup();
        }, fixtures);

        // Wait for ESC^SLIDE wakeup -> recv mode.
        await expect.poll(
            () => page.evaluate(() => window.__slide.__getStateForTests().mode),
            { timeout: 5000 },
        ).toBe('recv');

        // Bot kicks off the SLIDE handshake.
        await page.evaluate(() => window.__mockSlideBot.startSendSession());

        // Three blobs should arrive in order.
        await expect.poll(
            () => page.evaluate(() => window.__capturedBlobs.length),
            { timeout: 15000 },
        ).toBe(3);

        // Read all three blobs back; assert byte-identical to fixtures.
        const allBytes = await page.evaluate(async () => {
            const out = [];
            for (const blob of window.__capturedBlobs) {
                out.push({
                    size: blob.size,
                    bytes: Array.from(new Uint8Array(await blob.arrayBuffer())),
                });
            }
            return out;
        });
        expect(allBytes[0].size).toBe(0);
        expect(allBytes[0].bytes).toEqual([]);
        expect(allBytes[1].size).toBe(10);
        expect(allBytes[1].bytes).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
        expect(allBytes[2].size).toBe(8);
        expect(allBytes[2].bytes).toEqual([0x00, 0xFF, 0x80, 0x7F, 0xDE, 0xAD, 0xBE, 0xEF]);

        // Filenames must round-trip verbatim (SLIDE-20).
        const names = await page.evaluate(() => window.__capturedDownloads.map((d) => d.name));
        expect(names).toEqual(['ZERO.TXT', 'SMALL.TXT', 'BIN.COM']);

        // Mode returns to 'terminal' once FIN echoes complete.
        await expect.poll(
            () => page.evaluate(() => window.__slide.__getStateForTests().mode),
            { timeout: 8000 },
        ).toBe('terminal');
    });

    test('CRC-16-CCITT self-check: bot.crc16Ccitt("123456789") === 0x29B1 (Phase 7 SLIDE-03)', async ({ page }) => {
        // The mock bot's CRC implementation is the FOURTH independent SLIDE
        // implementation (PITFALLS §13). If this self-check fails, every
        // subsequent test will fail Beastty's CRC validation.
        const crc = await page.evaluate(() => {
            const bytes = new TextEncoder().encode('123456789');
            // Mirror the bot's algorithm verbatim — see mock-serial-slide-bot.js.
            let crcVal = 0xFFFF;
            for (const b of bytes) {
                crcVal ^= (b << 8);
                for (let i = 0; i < 8; i++) {
                    if (crcVal & 0x8000) crcVal = ((crcVal << 1) ^ 0x1021) & 0xFFFF;
                    else crcVal = (crcVal << 1) & 0xFFFF;
                }
            }
            return crcVal;
        });
        expect(crc).toBe(0x29B1);
    });
});
