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

// ── S10.2 (FR-6/8, NFR-2) — CSUM -V output parser + mismatch-pattern classifier ──

// The grammar is pinned by csumhost.c:80,86 — records print as
// printf("%04X: %04X\n", rec_no, fletcher16) and the whole-file CRC as
// printf("%08lX\n", crc) — confirmed by the real capture ../beast_csum/pc.txt.
// A terminal-grid selection wraps that output in noise (the echoed
// "A>CSUM -V FILE.COM" command line, bare "A>" prompts, blank lines,
// 80-column trailing spaces), so the rules stay narrow and everything
// unmatched flows past — the mergeDirColumns tolerance discipline.
const RECORD_LINE = /^([0-9A-Fa-f]{4}): +([0-9A-Fa-f]{4})$/;
const CRC_LINE = /^[0-9A-Fa-f]{8}$/;

// parseCsumV(text) → { records: Map<number,string>, count: number, crc: string|null }
//   records — sparse map of record index → 4-uppercase-hex Fletcher-16 (a
//             partial selection parses fine); duplicate indices: last wins.
//   count   — number of distinct record indices.
//   crc     — the LAST line that is exactly 8 hex digits, uppercase, or null.
export function parseCsumV(text) {
    const records = new Map();
    let crc = null;
    for (const raw of String(text ?? '').split(/\r?\n/)) {
        const line = raw.trim();
        const m = RECORD_LINE.exec(line);
        if (m) {
            records.set(parseInt(m[1], 16), m[2].toUpperCase());
            continue;
        }
        if (CRC_LINE.test(line)) crc = line.toUpperCase();
    }
    return { records, count: records.size, crc };
}

// classifyCsumDiff({ hostCount, deviceCount, mismatched }) →
//   { kind: 'count'|'tail'|'run'|'stride'|'none', n?: number }
// mismatched is the sorted array of differing compared indices (distinct).
// CONTRACT: only meaningful for an ALIGNED compare — the device records must be
// exactly 0..hostCount-1 (every host record compared, no extra/out-of-range
// device records). The caller (runDiffDrop) enforces this and passes 'count'
// itself otherwise; deviceCount alone can't detect a same-count-but-misaligned
// selection, so this function must not be trusted to.
// Precedence, first match wins (FR-8):
//   count  — device and host disagree on the record count; this IS the named
//            cause, so no pattern is looked for (a truncated device listing
//            "matching" the tail pattern would mislead).
//   none   — nothing differs.
//   tail   — exactly one mismatch, at the final record.
//   run    — one contiguous run of length ≥ 2.
//   stride — an arithmetic progression, stride n ≥ 2, ≥ 3 members.
//   none   — anything else (a single mid-file mismatch names no pattern; the
//            per-record results carry it).
export function classifyCsumDiff({ hostCount, deviceCount, mismatched }) {
    if (deviceCount !== hostCount) return { kind: 'count' };
    if (mismatched.length === 0) return { kind: 'none' };
    if (mismatched.length === 1 && mismatched[0] === hostCount - 1) return { kind: 'tail' };
    if (mismatched.length >= 2
            && mismatched[mismatched.length - 1] - mismatched[0] === mismatched.length - 1) {
        return { kind: 'run' };
    }
    if (mismatched.length >= 3) {
        const n = mismatched[1] - mismatched[0];
        if (n >= 2 && mismatched.every((v, i) => v === mismatched[0] + i * n)) {
            return { kind: 'stride', n };
        }
    }
    return { kind: 'none' };
}
