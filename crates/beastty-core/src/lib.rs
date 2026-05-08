//! beastty-core: pure-Rust VT52 terminal logic with a wasm-bindgen boundary.
//!
//! Module-level structure:
//! - `dirty`, `grid`, `key`, `scrollback`, `terminal`, `vt52` — pure Rust,
//!   wasm-free (D-20). Exercised by native `cargo test` as an rlib.
//! - `wasm_boundary` — `#[cfg(target_arch = "wasm32")]`-gated thin façade
//!   wrapping `crate::terminal::Terminal` and `crate::key` with
//!   `#[wasm_bindgen]` attributes. Consumed by JS via
//!   `wasm-pack build --target web` (ADR-002, Phase 2 Plan 01).
//!
//! Architectural rule (CLAUDE.md + CONTEXT D-06 / D-20): `wasm_bindgen`
//! attributes live in THIS FILE ONLY. `web_sys` / `js_sys` / `gloo-*` are
//! forbidden everywhere (lib.rs included). `tests/core_02_no_browser_deps.rs`
//! enforces both rules via per-token, per-file exemption.

pub mod dirty;
pub mod grid;
pub mod key;
pub mod scrollback;
pub mod slide;
pub mod terminal;
pub mod vt52;

// ==== wasm boundary (wasm32 only) ====
//
// Entire façade is `#[cfg(target_arch = "wasm32")]`-gated per ADR-002
// (Candidate A: target-specific dep + module-level cfg). Native `cargo
// test` compiles this file down to just the `pub mod` tree above — no
// wasm-bindgen resolution, no proc-macro expansion, no compile cost.
//
// Every method in the façade is a one-line forward to an already-tested
// Phase 1 / Plan 02 method on the inner `crate::terminal::Terminal` or
// `crate::key::*`. No logic lives here — façade only.
#[cfg(target_arch = "wasm32")]
mod wasm_boundary {
    use wasm_bindgen::prelude::*;

    use crate::key::{self, KeyEvent, unpack_keycode, unpack_mods};
    use crate::slide::Slide as CoreSlide;
    use crate::terminal::Terminal as CoreTerminal;

    /// Wasm-exported VT52 terminal. Thin façade over `crate::terminal::Terminal`.
    ///
    /// JS-side shape (from `www/main.js`):
    ///
    /// ```js
    /// import init, { Terminal, encode_key_raw } from './pkg/beastty_core.js';
    /// const wasm = await init();
    /// const term = new Terminal(24, 80, 10_000);
    /// term.feed(bytes);                                          // one boundary call
    /// term.snapshot_grid();                                       // refresh pack_buf
    /// const grid = new Uint8Array(wasm.memory.buffer,
    ///                             term.grid_ptr(), term.grid_byte_len());
    /// ```
    #[wasm_bindgen]
    pub struct Terminal {
        inner: CoreTerminal,
    }

    #[wasm_bindgen]
    impl Terminal {
        /// JS `new Terminal(rows, cols, scrollback_cap)` constructor.
        #[wasm_bindgen(constructor)]
        pub fn new(rows: u32, cols: u32, scrollback_cap: usize) -> Terminal {
            Terminal {
                inner: CoreTerminal::new(rows, cols, scrollback_cap),
            }
        }

        /// Feed a byte chunk through the VT52 parser. ONE boundary call per
        /// chunk — never per-byte (RESEARCH Pitfall #4, SC-4).
        ///
        /// Returns nothing: any host-bound reply (ESC Z -> ESC / K) is
        /// accumulated in an internal buffer JS reads via `host_reply_ptr`
        /// / `host_reply_len` and acks via `clear_host_reply`. This shape
        /// keeps the JS-side allocation at zero in the common (empty-reply)
        /// case, closing the SC-3 sawtooth (02-06-PLAN.md).
        pub fn feed(&mut self, bytes: &[u8]) {
            self.inner.feed_silent(bytes);
        }

        /// Pointer into the host-reply buffer. Stable across `feed()` calls
        /// in steady state (D-03 mirror). JS re-derives the `Uint8Array`
        /// view only when `wasm.memory.buffer` changes.
        pub fn host_reply_ptr(&self) -> *const u8 {
            self.inner.host_reply_ptr()
        }

        /// Length of the currently-pending host reply. 0 in the common case.
        pub fn host_reply_len(&self) -> usize {
            self.inner.host_reply_len()
        }

        /// Ack a reply read; resets length to 0, preserves capacity.
        pub fn clear_host_reply(&mut self) {
            self.inner.clear_host_reply();
        }

        /// Refresh the pack buffer. Call once per frame before reading
        /// `grid_ptr()` / `grid_byte_len()` (D-02).
        pub fn snapshot_grid(&mut self) {
            self.inner.snapshot_grid();
        }

        /// Snapshot a scrollback window starting `row_offset` rows back from
        /// the live tail. row_offset = 0 → identical to snapshot_grid()
        /// (Phase 6 D-06). JS marshals u32 directly; internal cast to usize
        /// is free at wasm32. Out-of-range row_offset clamps to the oldest
        /// retained row — never panics.
        pub fn snapshot_grid_at(&mut self, row_offset: u32) {
            self.inner.snapshot_grid_at(row_offset as usize);
        }

        /// Pointer into the pack buffer — stable across `feed()` /
        /// `push_line` / `resize_scrollback` (D-03). Invalidated by
        /// `resize()` — JS must re-derive `Uint8Array` after.
        pub fn grid_ptr(&self) -> *const u8 {
            self.inner.pack_ptr()
        }

        /// Byte length of the pack buffer: `visible_rows * cols * 8`.
        pub fn grid_byte_len(&self) -> usize {
            self.inner.pack_byte_len()
        }

        /// Pointer into the dirty-row bitmap (1 byte per row; 1 = dirty).
        pub fn dirty_ptr(&self) -> *const u8 {
            self.inner.dirty_ptr()
        }

        pub fn rows(&self) -> u32 {
            self.inner.rows()
        }

        pub fn cols(&self) -> u32 {
            self.inner.cols()
        }

        pub fn clear_dirty(&mut self) {
            self.inner.clear_dirty();
        }

        pub fn bell_pending(&self) -> bool {
            self.inner.bell_pending()
        }

        pub fn clear_bell(&mut self) {
            self.inner.clear_bell();
        }

        /// Packed cursor: `(row << 16) | col`. JS decodes with
        /// `row = packed >>> 16; col = packed & 0xFFFF;`.
        /// Pinned by `terminal::tests::cursor_packed_convention_round_trips`.
        pub fn cursor_packed(&self) -> u32 {
            let (r, c) = self.inner.cursor();
            (r << 16) | c
        }

        pub fn resize(&mut self, rows: u32, cols: u32) {
            self.inner.resize(rows, cols);
        }

        pub fn resize_scrollback(&mut self, new_cap: usize) {
            self.inner.resize_scrollback(new_cap);
        }

        /// Phase 6 D-26 — direct grid mutation, NOT feeding ESC J. Parser
        /// state untouched. Wipes visible cells, marks rows dirty, homes
        /// cursor. JS top-bar Clear button calls this instead of feeding
        /// `\x1B\x4A` so the remote VT52 state machine never sees a
        /// fabricated escape.
        pub fn clear_visible(&mut self) {
            self.inner.clear_visible();
        }
    }

    /// Wasm-exported SLIDE receiver-side state machine. Thin façade over
    /// `crate::slide::Slide` (the Phase 7 receiver SM). One-line forwards to
    /// the inner type — every method body is `self.inner.METHOD(args)`.
    ///
    /// JS-side shape (from `www/transport/slide.js`):
    ///
    /// ```js
    /// import init, { Slide } from './pkg/beastty_core.js';
    /// const wasm = await init();
    /// const slide = new Slide();
    /// slide.enter_recv_mode();
    /// slide.feed_chunk(bytes);
    /// const out = new Uint8Array(wasm.memory.buffer,
    ///                            slide.outbound_ptr(), slide.outbound_len());
    /// const owned = out.slice();        // JS-owned copy (Pitfall 5)
    /// slide.clear_outbound();
    /// ```
    ///
    /// The inner-type alias `CoreSlide` resolves the name collision between
    /// the wasm-exported `Slide` and `crate::slide::Slide` (Pitfall 6;
    /// mirror of the existing `Terminal` / `CoreTerminal` pair at lib.rs:39).
    #[wasm_bindgen]
    pub struct Slide {
        inner: CoreSlide,
    }

    #[wasm_bindgen]
    impl Slide {
        /// JS `new Slide()` constructor — one Slide instance per recv session.
        /// Per-session lifecycle (per Phase 8 Claude's Discretion default) —
        /// no Slide::reset() singleton optimization; allocation cost is ~1 KB
        /// per session, irrelevant at SLIDE's session cadence.
        #[wasm_bindgen(constructor)]
        pub fn new() -> Slide {
            Slide { inner: CoreSlide::new() }
        }

        /// Enter receiver mode — call once per session after `new Slide()`.
        /// Phase 8 D-09: dispatcher calls this in the same tick as
        /// `setWireOwner('slide')` after the 7-byte wakeup match.
        pub fn enter_recv_mode(&mut self) {
            self.inner.enter_recv_mode();
        }

        /// Feed one byte through the framer (used for cargo tests + edge cases;
        /// JS hot path uses feed_chunk per RESEARCH §Pattern: "feed_chunk is
        /// the hot path").
        pub fn feed_byte(&mut self, b: u8) -> u32 {
            self.inner.feed_byte(b)
        }

        /// Feed a byte chunk through the framer. ONE boundary call per Web
        /// Serial chunk (RESEARCH Anti-Pattern: per-byte FFI through
        /// feed_byte in the recv hot path).
        pub fn feed_chunk(&mut self, bytes: &[u8]) -> u32 {
            self.inner.feed_chunk(bytes)
        }

        /// Drain one event from the ring. Returns EVT_NONE (0) when empty.
        /// Packed convention: `(kind << 16) | aux` — JS unpacks via
        /// `(evt >>> 16)` for kind and `evt & 0xFFFF` for aux. Authority for
        /// kind values: tests/slide_boundary_shape.rs:slide_event_constants_pinned.
        pub fn take_event_packed(&mut self) -> u32 {
            self.inner.take_event_packed()
        }

        /// Current state machine state — SlideState repr(u32). 0=Idle, 1=WaitingRdy,
        /// 2=HeaderPhase, 3=DataPhase, 4=FinPending, 5=CancelPending, 6=Done,
        /// 7=Error. Pinned by tests/slide_wasm_boundary_shape.rs.
        pub fn state(&self) -> u32 {
            self.inner.state()
        }

        /// Pointer into the outbound buffer (ACK / NAK / CTRL_CAN echo bytes
        /// the SM produces). Stable across feed_byte / feed_chunk in steady
        /// state (Phase 7 OUTBOUND_RESERVE = 16 bytes pre-reserved). JS
        /// re-derives the Uint8Array view only when wasm.memory.buffer
        /// changes (Pitfall 4 — mirror of host_reply pattern at lib.rs:84).
        pub fn outbound_ptr(&self) -> *const u8 {
            self.inner.outbound_ptr()
        }

        /// Length of pending outbound bytes; 0 when nothing to send.
        pub fn outbound_len(&self) -> usize {
            self.inner.outbound_len()
        }

        /// Ack outbound — resets length to 0, preserves capacity. JS calls
        /// this AFTER copying bytes via `view.slice()` and writing via
        /// `txSink.writeSlideFrame(owned)` (Pitfall 5 — slice before write).
        pub fn clear_outbound(&mut self) {
            self.inner.clear_outbound();
        }

        /// Initiate cancel sequence — emits CTRL_CAN per ADR-003 v0.2.1
        /// bidirectional CAN amendment. JS handles the 200/500/100 ms timing
        /// windows (Phase 10 wires the cancel chip; Phase 8 exposes the
        /// boundary so the contract is in place).
        pub fn cancel(&mut self) {
            self.inner.cancel();
        }

        /// Force the SM back to Idle without protocol exchange — the escape
        /// hatch for stock slide.com that doesn't yet support v0.2.1 CAN echo
        /// (per ADR-003 §Decision: tolerate-stock-slide.com path).
        pub fn force_idle(&mut self) {
            self.inner.force_idle();
        }

        /// Enter sender mode (Phase 9 D-08/D-09). Call once per session AFTER
        /// `new Slide()` and BEFORE the wakeup match. The metadata blob format
        /// is per CONTEXT D-09 (length-prefixed records: <u32 file_count>
        /// <for each: u32 name_len, name, u32 size>). JS's `packMetadataInline`
        /// in `www/transport/slide.js` produces the exact byte layout this
        /// method expects. Pushes CTRL_RDY onto outbound_buf and transitions
        /// to WaitingRdy.
        pub fn enter_send_mode(&mut self, metadata: &[u8]) {
            self.inner.enter_send_mode(metadata);
        }

        /// Push the next data-frame payload onto outbound_buf (Phase 9 D-08).
        /// ONE boundary call per send-loop iteration. `eof=true` triggers an
        /// additional zero-payload EOF frame at next seq per slide-rs/send.rs:184.
        /// Must be called only when state == DataPhase (debug_assert in inner SM).
        pub fn feed_send_chunk(&mut self, payload: &[u8], eof: bool) {
            self.inner.feed_send_chunk(payload, eof);
        }

        /// Sender-mode current file index (Phase 9 WR-04 — single source of
        /// truth for the JS pump). Returns 0 when no send context is active;
        /// JS callers gate on `state() == DataPhase` before reading. Mirrors
        /// the `state()` / `outbound_len()` shape — pure u32 across the wasm
        /// boundary, no allocation.
        pub fn send_current_file_idx(&self) -> u32 {
            self.inner.send_current_file_idx()
        }

        // ===== Phase 10 — recv-payload accessors =====
        //
        // Eight one-line forwards mirror the Phase 9 sender-extension shape
        // above. Plan 10-02 wires the JS-side consumers in
        // `www/transport/slide-recv.js`: sliceRecvBytesToOwned re-derives the
        // `Uint8Array(memory.buffer, recv_ptr(), RECV_VIEW_CAP)` view per
        // Pitfall 4, slices BEFORE clear_recv per Pitfall 5, and pushes the
        // owned copy onto the per-file `chunks: Uint8Array[]` accumulator.
        // readRecvFilenameOwned mirrors the same dance for the 16-byte
        // filename buffer.
        //
        // The eight methods come in two zero-copy triples (recv_ptr/recv_len/
        // clear_recv, recv_filename_ptr/recv_filename_len/clear_recv_filename)
        // and two scalars (recv_file_size, recv_current_file_idx) — pinned
        // by tests/slide_boundary_shape.rs (inner) +
        // tests/slide_wasm_boundary_shape.rs (façade-mirror).
        pub fn recv_ptr(&self) -> *const u8 {
            self.inner.recv_ptr()
        }

        pub fn recv_len(&self) -> usize {
            self.inner.recv_len()
        }

        pub fn clear_recv(&mut self) {
            self.inner.clear_recv();
        }

        pub fn recv_filename_ptr(&self) -> *const u8 {
            self.inner.recv_filename_ptr()
        }

        pub fn recv_filename_len(&self) -> usize {
            self.inner.recv_filename_len()
        }

        pub fn clear_recv_filename(&mut self) {
            self.inner.clear_recv_filename();
        }

        pub fn recv_file_size(&self) -> u32 {
            self.inner.recv_file_size()
        }

        pub fn recv_current_file_idx(&self) -> u32 {
            self.inner.recv_current_file_idx()
        }

        // ===== Phase 10 review CR-01 — per-frame payload queue =====
        //
        // `feed_chunk` may emit N back-to-back EVT_RECV_DATA events when the
        // OS-level USB read concatenates multiple SLIDE data frames. The
        // events ring already carries one entry per frame, but `recv_buf`
        // is single-frame-sized; without a per-frame queue, JS reads only
        // the LAST frame's bytes for every event drained after feed_chunk
        // returns (silent file corruption — no CRC error, no NAK).
        //
        // `pop_recv_payload` loads the next queued frame's payload into
        // recv_buf so the existing `recv_ptr` / `recv_len` / `clear_recv`
        // triple keeps working. JS-side slide-recv.js calls this BEFORE
        // reading recv_len for each EVT_RECV_DATA event; returns false
        // when the queue is empty (defensive — JS should not read recv_len
        // after a false return).
        pub fn pop_recv_payload(&mut self) -> bool {
            self.inner.pop_recv_payload()
        }

        /// Test introspection — number of pending payloads in the per-frame
        /// queue. Used by the W3 multi-frame regression test (extended in
        /// IN-04 / Phase 10 review fixup) to assert per-event recv_buf
        /// semantics. Returns 0 in steady state for receivers draining promptly.
        pub fn recv_payload_queue_len(&self) -> usize {
            self.inner.recv_payload_queue_len()
        }
    }

    /// Encode a packed (code, mods) u32 pair into the VT52 byte sequence.
    ///
    /// On unknown tag, returns an empty `Vec<u8>` rather than panicking
    /// across the wasm FFI boundary (RESEARCH Pitfall #4). The packing
    /// scheme is pinned by `key::tests::unpack_keycode_*`.
    #[wasm_bindgen]
    pub fn encode_key_raw(code: u32, mods: u32) -> Vec<u8> {
        match unpack_keycode(code) {
            Some(kc) => key::encode(KeyEvent {
                code: kc,
                mods: unpack_mods(mods),
            }),
            None => Vec::new(),
        }
    }
}
