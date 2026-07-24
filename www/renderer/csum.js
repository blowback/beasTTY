// Beastty Epic E10 Story S10.1 (FR-1, NFR-1/2) — CSUM-compatible checksums.
//
// Pure logic, no DOM, no I/O, no imports (AD-3: pull-pane.js receives
// analyzeCsum as a wirePullPane opt injected by main.js — never imported).
// The external contract is the sibling beast_csum repo: CSUM.COM (Z80/CP/M)
// and csumhost (PC) print byte-identical checksums, and this module is the
// third byte-identical implementation. Semantics match csumhost.c exactly:
//   - crc32_update (csumhost.c:25-33): CRC-32 zip/zlib flavour — poly
//     0xEDB88320 reflected, init 0xFFFFFFFF, final XOR 0xFFFFFFFF.
//   - fletcher16 (csumhost.c:36-44): sums mod 255, result (s2<<8)|s1.
//   - record loop (csumhost.c:73-83): one Fletcher-16 per 128-byte CP/M
//     record, the final short record zero-padded to a whole record; the
//     CRC-32 runs over the PADDED content.
// Conformance oracle: the ground-truth vectors embedded in story e10-1
// (generated 2026-07-24 with the real csumhost) — pull-pane-csum.spec.js
// asserts every one, including the empty file (no records, CRC 00000000).

const RECORD_SIZE = 128;

export function fletcher16(bytes) {
    let s1 = 0, s2 = 0;
    for (let i = 0; i < bytes.length; i++) {
        s1 = (s1 + bytes[i]) % 255;
        s2 = (s2 + s1) % 255;
    }
    return (s2 << 8) | s1;
}

// Standard 256-entry table (built lazily, 1 KB) — same output as the
// csumhost.c bit-loop, ~8x fewer main-thread operations per byte. Files are
// usually CP/M-sized, but the bound folder is any host directory, so a large
// stray file shouldn't stall the UI longer than it must.
let CRC_TABLE = null;

function buildCrcTable() {
    const table = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
        let c = n;
        for (let b = 0; b < 8; b++) {
            c = (c >>> 1) ^ (0xEDB88320 & -(c & 1));
        }
        table[n] = c >>> 0;
    }
    return table;
}

export function crc32(bytes) {
    if (!CRC_TABLE) CRC_TABLE = buildCrcTable();
    let crc = 0xFFFFFFFF;
    for (let i = 0; i < bytes.length; i++) {
        crc = (crc >>> 8) ^ CRC_TABLE[(crc ^ bytes[i]) & 0xFF];
    }
    return (crc ^ 0xFFFFFFFF) >>> 0;
}

function hex(value, digits) {
    return value.toString(16).toUpperCase().padStart(digits, '0');
}

// analyzeCsum(bytes: Uint8Array) → { records: string[], crc: string }
//   records[i] — 4-uppercase-hex Fletcher-16 of 128-byte record i
//   crc        — 8-uppercase-hex CRC-32 over the zero-padded content
// Empty input → { records: [], crc: '00000000' } (csumhost.c:75 — the read
// loop never executes; CRC of zero bytes is init^final = 0).
export function analyzeCsum(bytes) {
    const recordCount = Math.ceil(bytes.length / RECORD_SIZE);
    const padded = new Uint8Array(recordCount * RECORD_SIZE);
    padded.set(bytes);
    const records = [];
    for (let i = 0; i < recordCount; i++) {
        records.push(hex(fletcher16(padded.subarray(i * RECORD_SIZE, (i + 1) * RECORD_SIZE)), 4));
    }
    return { records, crc: hex(crc32(padded), 8) };
}
