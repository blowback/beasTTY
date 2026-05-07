// BestialiTTY Phase 4 Plan 02 — TX byte ring buffer + observer fan-out.
//
// Module-scope Uint8Array(1024) ring — JS-owned memory, NOT a view over
// wasm.memory.buffer (so no memory-identity guard is needed; Phase 5 will
// keep the JS-owned allocation when it swaps pushTxBytes to Web Serial
// writer.write(bytes)).
//
// Sources:
//   - 04-CONTEXT.md D-07 (ring shape + public API).
//   - 04-UI-SPEC.md §"Format of TX hex strip content" (uppercase hex pairs,
//     newest-right, 64-byte default limit).
//   - Analog: www/renderer/canvas.js:37-51 (module-scope typed array) +
//     www/renderer/canvas.js:418-427 (single-consumer observer pattern) +
//     www/renderer/atlas.js:63-67 (evict → clear + notify).

const RING_CAP = 1024;
const ring = new Uint8Array(RING_CAP);
let writeIdx = 0;
let wrapped = false;

const observers = [];

// Phase 5 D-21 — when a writer is registered (serial.js does this on connect),
// every pushTxBytes call ALSO writes bytes to the wire synchronously after
// appending to the ring. Signature of pushTxBytes is preserved (04-CONTEXT D-07);
// keyboard.js is completely unaware of the coupling.
let registeredWriter = null;

// Phase 8 D-08 — wire-owner state for TX handoff during SLIDE sessions.
// During mode='recv', the dispatcher (transport/slide.js) calls
// setWireOwner('slide'); pushTxBytes early-returns (silent drop); SLIDE writes
// go via writeSlideFrame which bypasses the keystroke ring.
// Sources:
//   - 08-CONTEXT.md D-08 + D-09.
//   - 08-RESEARCH.md §"Pattern 2: TX Owner Handoff".
//   - ARCHITECTURE.md Anti-Pattern 5 (multi-KB binary frames don't belong in
//     the keystroke diagnostics ring).
//
// Default 'terminal'; flipped to 'slide' by transport/slide.js:dispatchInbound
// on successful 7-byte wakeup match (D-09); flipped back to 'terminal' on
// slide.state() === Done or Error (D-09).
let owner = 'terminal';

// --- Public API -----------------------------------------------------------

export function pushTxBytes(bytes) {
    // Phase 8 D-08 — silent drop during active SLIDE session. Chip messaging
    // ("Transfer in progress — cancel first") is Phase 11's concern. Here
    // we simply ensure keystrokes don't corrupt the wire mid-frame.
    if (owner === 'slide') return;

    // Accept Uint8Array or plain Array<number>. Fast path for typed arrays.
    const len = bytes.length;
    for (let i = 0; i < len; i++) {
        ring[writeIdx] = bytes[i] & 0xFF;
        writeIdx = (writeIdx + 1) % RING_CAP;
        if (writeIdx === 0) wrapped = true;
    }
    notify();

    // Phase 5 D-21 — send on the wire when connected. Fire-and-forget;
    // Streams API handles backpressure internally (writer.ready is a separate
    // concern — at 1.7 KB/s write rate, plain await is sufficient). A failed
    // write here does NOT unregister the writer; the serial.js teardown path
    // handles lifecycle on port-lost.
    if (registeredWriter) {
        registeredWriter.write(bytes).catch((err) => {
            console.error('[tx-sink] writer.write failed:', err);
        });
    }
}

export function formatHexStrip(limit = 64) {
    const totalWritten = wrapped ? RING_CAP : writeIdx;
    if (totalWritten === 0) return '';
    const take = Math.min(limit, totalWritten);
    // Compute read-start index for newest-right ordering.
    const startIdx = (writeIdx - take + RING_CAP) % RING_CAP;
    const pairs = new Array(take);
    for (let i = 0; i < take; i++) {
        const b = ring[(startIdx + i) % RING_CAP];
        pairs[i] = b.toString(16).padStart(2, '0').toUpperCase();
    }
    return pairs.join(' ');
}

export function registerTxObserver(fn) {
    observers.push(fn);
}

export function resetTx() {
    ring.fill(0);
    writeIdx = 0;
    wrapped = false;
    notify();
}

// Phase 5 D-21 — writer registration. serial.js calls registerWriter(writer)
// after port.open() succeeds; unregisterWriter() in teardown.
export function registerWriter(writer) { registeredWriter = writer; }
export function unregisterWriter()     { registeredWriter = null; }

// Phase 8 D-08 — wire-owner accessors. transport/slide.js calls these in
// lockstep with mode transitions (D-09 — synchronous handoff, no race window).
export function setWireOwner(o) {
    if (o !== 'terminal' && o !== 'slide') {
        throw new Error(`[tx-sink] invalid owner: ${o}`);
    }
    owner = o;
}
export function getWireOwner() { return owner; }

// Phase 8 D-08 — bypass the keystroke ring entirely for binary frames. SLIDE
// frame bytes (1024-byte payload + 6-byte header) are O(KB) per call; pushing
// them through the 1024-byte keystroke ring would clobber Phase 4 D-15
// hex-strip diagnostics for zero benefit. Mirror of the existing Phase 5 D-21
// writer.write(...).catch(...) shape inside pushTxBytes.
export function writeSlideFrame(bytes) {
    if (!registeredWriter) {
        console.error('[tx-sink] writeSlideFrame: no writer registered');
        return;
    }
    registeredWriter.write(bytes).catch((err) => {
        console.error('[tx-sink] writeSlideFrame failed:', err);
    });
}

// --- Internals ------------------------------------------------------------

function notify() {
    for (const fn of observers) fn();
}
