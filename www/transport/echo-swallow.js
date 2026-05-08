// BestialiTTY Phase 11 Plan 11-04 — auto-type echo swallow filter (SLIDE-14).
//
// CONTEXT C-03 / PITFALLS §11. Sits BEFORE the wakeup matcher in
// dispatchTerminalMode's byte loop. After the host auto-types a command (e.g.
// "B:SLIDE R\r"), CP/M echoes those bytes back. The local echo (Phase 4 D-12)
// already painted them on screen, so the CP/M echo is a duplicate that would
// double-print without this filter.
//
// Behaviour:
//   - For each inbound byte during mode === 'terminal':
//     - if swallow buffer non-empty AND first byte matches buffer head:
//         shift buffer, swallow byte (do NOT forward to term.feed)
//     - on mismatch OR 500 ms expiry:
//         flush remaining buffer to term.feed (preserves any echo that didn't
//         fully match — no byte loss) and resume normal forwarding
//
// CR/LF mode (Phase 4 D-13): TX bytes go through CR/LF rewrite; CP/M echoes
// what it received; the swallow buffer compares against post-rewrite TX bytes
// (what actually went on the wire), so CR/LF mode is transparent.
//
// Sources:
//   - 11-CONTEXT.md C-03 (byte-for-byte match; 500 ms timeout; mismatch OR
//     expiry flushes remaining buffer to term.feed; preserves CR/LF mode
//     through Phase 4 D-13 rewrite).
//   - 11-PATTERNS.md §www/transport/echo-swallow.js (NEW — inbound byte filter).
//
// Analog: www/transport/slide.js:317-415 (wakeup matcher in dispatchTerminalMode
// — same byte-loop shape with module-scope state). www/input/paste-pump.js
// + www/transport/session-log.js (simplest wireXxx + reset shape).

const SWALLOW_TIMEOUT_MS = 500;

// Module-scope state.
const swallowBuf = [];           // FIFO of bytes still waiting to be matched
let expiryHandle = null;          // setTimeout id for 500 ms timeout

// Injected deps (set by wireEchoSwallow).
let termRef = null;

export function wireEchoSwallow(opts) {
    termRef = opts.term;
    return {
        pushAutoTypedBytes,
        consumeIfMatch,
        flushPending,
        __resetForTests,
        __getStateForTests,
    };
}

/**
 * Push a Uint8Array of TX bytes into the swallow buffer; arms the 500 ms timer.
 * Called from slide.js enterSendMode immediately after pushTxBytes(autoSendBytes).
 * Bytes are the post-rewrite (CR/LF transformed) bytes — CP/M echoes what it
 * received, which is what went on the wire, so the swallow buffer compares
 * against post-rewrite TX bytes and CR/LF mode is transparent.
 */
export function pushAutoTypedBytes(bytes) {
    for (let i = 0; i < bytes.length; i++) swallowBuf.push(bytes[i]);
    rearmTimer();
}

/**
 * For each inbound terminal-mode byte, the dispatcher calls this BEFORE the
 * wakeup matcher (CONTEXT C-03 — swallow filter sits at a strictly earlier
 * point in the byte loop and is orthogonal to the wakeup matcher).
 *
 * @returns true if the byte was swallowed (do NOT forward); false if the byte
 *          should continue through the dispatcher (wakeup matcher → term.feed).
 */
export function consumeIfMatch(byte) {
    if (swallowBuf.length === 0) return false;
    if (swallowBuf[0] === byte) {
        swallowBuf.shift();
        if (swallowBuf.length === 0 && expiryHandle) {
            clearTimeout(expiryHandle);
            expiryHandle = null;
        }
        return true;   // swallow this byte
    }
    // Mismatch — flush remaining swallow buffer (which won't match anyway) and
    // let the caller forward this byte through the normal path.
    flushPending();
    return false;
}

/**
 * Flush the remaining swallow buffer to term.feed and clear the timer.
 * Called on mismatch (above) AND on 500 ms expiry.
 */
export function flushPending() {
    if (expiryHandle) {
        clearTimeout(expiryHandle);
        expiryHandle = null;
    }
    if (swallowBuf.length === 0) return;
    const buf = new Uint8Array(swallowBuf);
    swallowBuf.length = 0;
    try { if (termRef) termRef.feed(buf); } catch {}
}

function rearmTimer() {
    if (expiryHandle) clearTimeout(expiryHandle);
    expiryHandle = setTimeout(() => {
        // 500 ms elapsed without match — flush whatever is left.
        flushPending();
    }, SWALLOW_TIMEOUT_MS);
}

export function __resetForTests() {
    swallowBuf.length = 0;
    if (expiryHandle) {
        clearTimeout(expiryHandle);
        expiryHandle = null;
    }
}

export function __getStateForTests() {
    return {
        bufferLength: swallowBuf.length,
        buffer: swallowBuf.slice(),
        hasTimer: expiryHandle !== null,
    };
}
