// Replay of the exact wire behavior of Z80 SLIDE v0.5.2 (slide.asm) for
// `SLIDE S SLIDE.COM`, reconstructed from the failed 2026-07-23 hardware
// session. v0.5.2 differs from the mock bot in three ways the e2e suite
// never covered:
//   1. Console messages go out the UART mid-session (SLIDE repo commit
//      c397b07): "Sending: SLIDE   COM\r\n" arrives between the RDY echo
//      and the header frame.
//   2. Data is streamed as a blind burst — a full window (up to 4×1024B)
//      plus the EOF frame in one go, with a single ACK wait at the end.
//      The e2e fixtures (0/10/8 bytes) never exercised 1024-byte frames.
//   3. On an ACK timeout the Z80 rewinds and RETRANSMITS the whole window
//      (slide.asm .tx_timeout) — the receiver must tolerate re-seen data
//      frames after it already ACKed the EOF, not hard-error.
//
// Raw bytes are pushed via window.__mockReaderPush (deliberately NO slide
// bot — the bot's reactive roles would answer the PC's bytes; here the spec
// itself scripts the Z80 exactly); the PC-side control bytes are read from
// window.__mockWriterLog ({ bytes, ts } entries).

import { test, expect } from '@playwright/test';
import { SERIAL_MOCK } from './mock-serial.js';

const SOF = 0x01;
const CTRL_FIN = 0x04;
const CTRL_ACK = 0x06;
const CTRL_RDY = 0x11;

function crc16(bytes) {
    let crc = 0xFFFF;
    for (const b of bytes) {
        crc ^= (b << 8);
        for (let i = 0; i < 8; i++) {
            crc = (crc & 0x8000) ? ((crc << 1) ^ 0x1021) & 0xFFFF : (crc << 1) & 0xFFFF;
        }
    }
    return crc;
}

// Mirror of slide.asm send_frame: SOF SEQ LEN_H LEN_L PAYLOAD CRC_H CRC_L.
function frame(seq, payload) {
    const scope = [seq, (payload.length >> 8) & 0xFF, payload.length & 0xFF, ...payload];
    const crc = crc16(scope);
    return [SOF, ...scope, (crc >> 8) & 0xFF, crc & 0xFF];
}

function ascii(s) {
    return [...s].map((c) => c.charCodeAt(0));
}

// The 2845-byte fixture (slide.com's size on the real hardware) split the
// way slide.asm send_window_from_buf does: 1024 + 1024 + 797, EOF at seq 4.
// A distinctive ASCII marker is embedded so "payload never reached the
// terminal parser" is provable via a packed-grid search.
//
// CRITICAL fixture trait: the payload CONTAINS the ESC^SLIDE wakeup
// signature at offset 0x1F8 — exactly like the real slide.com (its own
// `wakeup_sig` table). The recv dispatcher's mid-session re-entry matcher
// must NOT mistake payload content for a Z80 reset (the 2026-07-24
// hardware failure: session torn down mid-frame-1, stream dumped to the
// terminal, wire owner stranded on 'slide').
const PAYLOAD_MARKER = 'V052PAYLOADMARKER';
const FILE_BYTES = Array.from({ length: 2845 }, (_, i) => i % 251);
for (let i = 0; i < PAYLOAD_MARKER.length; i++) {
    FILE_BYTES[100 + i] = PAYLOAD_MARKER.charCodeAt(i);       // frame 1
    FILE_BYTES[2100 + i] = PAYLOAD_MARKER.charCodeAt(i);      // frame 3
}
const WAKEUP_SIG = [0x1B, 0x5E, ...'SLIDE'.split('').map((c) => c.charCodeAt(0))];
FILE_BYTES.splice(0x1F8, WAKEUP_SIG.length, ...WAKEUP_SIG);   // frame 1, like slide.com
FILE_BYTES.splice(2500, WAKEUP_SIG.length, ...WAKEUP_SIG);    // frame 3 too
const HEADER_PAYLOAD = [...ascii('SLIDE.COM'), 0,
    2845 & 0xFF, (2845 >> 8) & 0xFF, 0, 0];
const BURST = [
    ...frame(1, FILE_BYTES.slice(0, 1024)),
    ...frame(2, FILE_BYTES.slice(1024, 2048)),
    ...frame(3, FILE_BYTES.slice(2048)),
    ...frame(4, []),
];

async function setup(page) {
    await page.addInitScript(SERIAL_MOCK);
    await page.goto('/');
    await page.locator('#terminal-wrapper').focus();
    await page.waitForFunction(() => document.getElementById('terminal').width > 0);
    await page.evaluate(() => window.__menuBar.open('connection'));
    await page.click('#menu-connect-item');
    await expect.poll(
        () => page.evaluate(() => Boolean(navigator.serial._grantedPorts[0]?._reader)),
        { timeout: 5000 },
    ).toBe(true);
    await page.evaluate(() => {
        window.__slide.__resetForTests();
        window.__slideRecv.__resetForTests();
        window.__mockWriterLog.length = 0;
    });
}

const push = (page, bytes) => page.evaluate((b) => {
    window.__mockReaderPush(new Uint8Array(b));
}, bytes);

const writerBytes = (page) => page.evaluate(() =>
    window.__mockWriterLog.flatMap((w) => Array.from(w.bytes)));

const mode = (page) => page.evaluate(() => window.__slide.__getStateForTests().mode);

// Packed-grid text search (slide-post-fin-forward.spec.js pattern —
// __testGridView is 8 bytes per cell, glyph byte first).
const gridContains = (page, needle) => page.evaluate((needle) => {
    const view = window.__testGridView();
    const stride = 8;
    for (let start = 0; start + needle.length * stride <= view.length; start += stride) {
        let ok = true;
        for (let j = 0; j < needle.length; j++) {
            if (view[start + j * stride] !== needle.charCodeAt(j)) { ok = false; break; }
        }
        if (ok) return true;
    }
    return false;
}, needle);

test.describe('slide-recv — v0.5.2 hardware replay', () => {
    test.beforeEach(async ({ page }) => { await setup(page); });

    test('blind burst with mid-session console text lands the file, ACKs EOF, no terminal dump', async ({ page }) => {
        // Z80: banner (pre-wakeup, should render), wakeup, first RDY.
        await push(page, [...ascii('SLIDE v0.5.2 - Send mode\r\n'),
            0x1B, 0x5E, ...ascii('SLIDE'), CTRL_RDY]);
        await expect.poll(() => mode(page)).toBe('recv');
        await expect.poll(() => writerBytes(page)).toContain(CTRL_RDY);

        // Z80: console text + header frame in one chunk (post-handshake print).
        await push(page, [...ascii('Sending: SLIDE   COM\r\n'), ...frame(0, HEADER_PAYLOAD)]);
        await expect.poll(async () => {
            const w = await writerBytes(page);
            for (let i = 0; i < w.length - 1; i++) {
                if (w[i] === CTRL_ACK && w[i + 1] === 0) return true;
            }
            return false;
        }, { timeout: 3000 }).toBe(true);

        // Z80: the full blind burst — 3 data frames + EOF, one chunk.
        await push(page, BURST);
        await expect.poll(async () => {
            const w = await writerBytes(page);
            for (let i = 0; i < w.length - 1; i++) {
                if (w[i] === CTRL_ACK && w[i + 1] === 4) return true;
            }
            return false;
        }, { timeout: 3000 }).toBe(true);

        // Z80: session done — FIN; Beastty echoes FIN and returns to terminal.
        await push(page, [CTRL_FIN]);
        await expect.poll(() => mode(page)).toBe('terminal');
        await expect.poll(async () => (await writerBytes(page)).filter((b) => b === CTRL_FIN).length,
            { timeout: 3000 }).toBeGreaterThan(0);

        // The banner rendered; the payload must NOT have (no VT52 garbage);
        // the mid-session console text was swallowed by recv mode.
        expect(await gridContains(page, 'Send mode')).toBe(true);
        expect(await gridContains(page, PAYLOAD_MARKER)).toBe(false);
        expect(await gridContains(page, 'Sending:')).toBe(false);
    });

    test('pull-pane batch hint labels the session total and clears at exit', async ({ page }) => {
        // main.js routes pull-pane confirm → setExpectedRecvFiles(n); here the
        // hook is driven directly (the pane-side call is asserted in
        // pull-pane.spec.js). total_files feeds the chip's "N/M".
        await page.evaluate(() => window.__slide.setExpectedRecvFiles(3));
        await push(page, [0x1B, 0x5E, ...ascii('SLIDE'), CTRL_RDY]);
        await expect.poll(() => mode(page)).toBe('recv');
        await push(page, frame(0, HEADER_PAYLOAD));
        await push(page, BURST);
        const st = await page.evaluate(() => window.__slide.__getStateForTests());
        expect(st.total_files).toBe(3);
        expect(st.file_idx).toBe(0);   // first file, 0-based (chip renders 1/3)
        // Session end clears the hint — a later device-typed session shows
        // the bare index again.
        await push(page, [CTRL_FIN]);
        await expect.poll(() => mode(page)).toBe('terminal');
        expect((await page.evaluate(() => window.__slide.__getStateForTests())).expectedRecvFiles).toBe(0);
    });

    test('window retransmit after EOF-ACK loss is tolerated — re-ACK, no Error, no dump', async ({ page }) => {
        await push(page, [0x1B, 0x5E, ...ascii('SLIDE'), CTRL_RDY]);
        await expect.poll(() => mode(page)).toBe('recv');
        await push(page, frame(0, HEADER_PAYLOAD));
        await push(page, BURST);
        await expect.poll(async () => {
            const w = await writerBytes(page);
            for (let i = 0; i < w.length - 1; i++) {
                if (w[i] === CTRL_ACK && w[i + 1] === 4) return true;
            }
            return false;
        }, { timeout: 3000 }).toBe(true);

        // The Z80 never saw the ACK (line hiccup): .tx_timeout rewinds to the
        // window start and re-sends the identical burst. The receiver must
        // re-ACK (or at minimum stay out of Error) so the retry converges.
        await page.evaluate(() => { window.__mockWriterLog.length = 0; });
        await push(page, BURST);
        await expect.poll(async () => {
            const w = await writerBytes(page);
            for (let i = 0; i < w.length - 1; i++) {
                if (w[i] === CTRL_ACK && w[i + 1] === 4) return true;
            }
            return false;
        }, { timeout: 3000 }).toBe(true);

        // Still in recv mode with no payload dumped to the terminal — the
        // retransmit must not have hard-errored the session.
        expect(await gridContains(page, PAYLOAD_MARKER)).toBe(false);
        expect(await mode(page)).toBe('recv');
        // FIN still completes the session.
        await push(page, [CTRL_FIN]);
        await expect.poll(() => mode(page)).toBe('terminal');
    });
});
