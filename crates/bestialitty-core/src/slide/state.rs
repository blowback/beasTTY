//! SLIDE sliding-window state machine — receiver-only in Phase 7.
//!
//! Phase 9 will extend this with sender-side transitions (the SLIDE-04
//! success criterion is satisfied by the receiver SM, which exercises every
//! control byte; see RESEARCH §SM Scope Recommendation lines 728-779).
//!
//! Mirrors terminal.rs:17-130 shape: a long-lived struct holding the
//! per-position state + a stable-pointer outbound ring buffer. Phase 8's
//! `lib.rs:wasm_boundary` will wrap this with `#[wasm_bindgen]` attributes;
//! Phase 7 leaves the wasm boundary untouched.
//!
//! Architectural rule (CLAUDE.md + CONTEXT D-20): NO `wasm_bindgen`,
//! NO `web_sys`, NO `js_sys`, NO `std::time`. All timing in JS;
//! Rust SM is purely event-driven. `cancel()` and `force_idle()` are the
//! D-06 idempotent + escape-hatch APIs JS uses to drive the v0.2.1 CAN
//! amendment without leaking time logic into Rust.
//!
use std::collections::VecDeque;

use super::framer::{
    Framer, EVT_NONE, EVT_RDY, EVT_ACK, EVT_NAK, EVT_FIN, EVT_CAN,
    EVT_DATA_FRAME, EVT_CRC_ERROR,
    EVT_FILE_COMPLETE, EVT_SESSION_COMPLETE, EVT_RETRANSMIT_NEEDED,
    CTRL_RDY, CTRL_ACK, CTRL_NAK, CTRL_FIN, CTRL_CAN,
    build_frame_into,
};

/// SLIDE v0.2 sliding window size (slide-rs/protocol.rs:12-13).
const WIN_SIZE: u8 = 4;

/// Maximum CRC-error retry count before SM transitions to Error
/// (slide-rs/recv.rs:142).
const NAK_BUDGET: u32 = 15;

/// Outbound buffer pre-reserve. Phase 7 sized this at 16 bytes for receiver
/// control bytes (RDY/ACK/NAK/CAN/FIN ≤ 7 bytes). Phase 9 sender extension
/// grows to 4128 bytes = 4 frames × (4 header + 1024 payload + 2 CRC = 1030
/// per frame, 4120 total) + 8 byte slack for control bytes mid-window.
/// The mirror `OUTBOUND_VIEW_CAP` constant in `www/transport/slide.js` MUST
/// grow in lockstep (Plan 09-02). Stable-pointer discipline preserved by
/// the `outbound_ptr_stable_across_sender_window_pushes` test below.
const OUTBOUND_RESERVE: usize = 4128;

const EVENT_RING_RESERVE: usize = 32;

/// Top-level SLIDE session state. `#[repr(u32)]` so Phase 8 can return it
/// across the wasm boundary as a plain u32 (RESEARCH §"Reusable Assets").
#[repr(u32)]
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum SlideState {
    Idle          = 0,
    WaitingRdy    = 1,
    HeaderPhase   = 2,
    DataPhase     = 3,
    FinPending    = 4,
    CancelPending = 5,
    Done          = 6,
    Error         = 7,
}

/// Direction role. Phase 7 only constructs Receiver via enter_recv_mode().
/// Phase 9 will add an enter_send_mode(metadata) constructor for Sender.
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum SlideRole {
    Receiver,
    Sender,
}

/// Per-file metadata parsed from the JS-supplied blob (CONTEXT D-09).
/// `name` is already CP/M-validated (ASCII subset, uppercased,
/// 8.3-truncated) by JS; Rust trusts the bytes.
struct FileMeta {
    name: Vec<u8>,
    size: u32,
}

/// Sender-mode session context. Populated by `enter_send_mode`;
/// remains None for receiver-mode sessions.
struct SendCtx {
    files: Vec<FileMeta>,
    /// Index into `files` of the file currently being sent.
    current_file_idx: usize,
    /// Next seq to assign for the next data frame within the current file.
    /// seq=0 is reserved for header; data frames start at 1
    /// (slide-rs/send.rs:107).
    current_seq: u8,
    /// EOF marker seq = (last_data_seq + 1), wrapping at u8.
    /// Filled in when `feed_send_chunk(payload, eof=true)` is called or
    /// when an empty file is auto-EOFed at HeaderPhase + ACK(0).
    /// Zero means "not yet set" — valid because seq=0 is reserved for header.
    eof_seq: u8,
}

/// SLIDE state machine. Receiver-only in Phase 7; Phase 9 adds sender role.
/// Mirror of terminal.rs:17-41 Terminal struct shape; outbound_buf is the
/// SLIDE analog of host_reply.
pub struct Slide {
    framer: Framer,
    sm_state: SlideState,
    role: SlideRole,
    /// Next-expected data-frame sequence number (incremented per accepted
    /// data frame, wrapping at u8). Receiver tracks this against incoming
    /// EVT_DATA_FRAME(seq).
    expected_seq: u8,
    /// CRC-error retry budget. Reset to 0 on a clean ACK; bounded at NAK_BUDGET
    /// (slide-rs/recv.rs:142). Exhaustion → SlideState::Error.
    nak_retry_count: u32,
    /// Pre-reserved OUTBOUND_RESERVE bytes. Vec::clear() preserves capacity;
    /// outbound_ptr() is stable across feed_byte calls in steady state.
    /// Phase 8 wraps this triple with #[wasm_bindgen] in lib.rs.
    outbound_buf: Vec<u8>,
    /// Event ring drained by JS via take_event_packed() after feed_chunk.
    /// Pre-reserved EVENT_RING_RESERVE entries.
    events: VecDeque<u32>,
    /// Sender-mode context — None when in Idle / receiver mode (Phase 9 D-08).
    send_ctx: Option<SendCtx>,
}

impl Slide {
    pub fn new() -> Self {
        Self {
            framer: Framer::new(),
            sm_state: SlideState::Idle,
            role: SlideRole::Receiver,
            expected_seq: 1,                 // first data frame is seq 1 (seq 0 is header)
            nak_retry_count: 0,
            outbound_buf: Vec::with_capacity(OUTBOUND_RESERVE),
            events: VecDeque::with_capacity(EVENT_RING_RESERVE),
            send_ctx: None,
        }
    }

    /// Transition Idle → WaitingRdy as receiver (Phase 8 dispatcher calls this
    /// after consuming the wakeup signature). Receiver-only in Phase 7.
    pub fn enter_recv_mode(&mut self) {
        self.role = SlideRole::Receiver;
        self.sm_state = SlideState::WaitingRdy;
    }

    /// Transition Idle → WaitingRdy as sender (Phase 9 D-08/D-09).
    ///
    /// JS calls this AFTER `B:SLIDE R\r` is auto-typed (D-13) and BEFORE
    /// the wakeup match consumes the Z80's ESC^SLIDE response. The metadata
    /// blob format is per CONTEXT D-09:
    ///
    /// ```text
    /// <u32 file_count>
    /// for each file:
    ///   <u32 name_len><name bytes (already CP/M-validated UTF-8 / ASCII)>
    ///   <u32 size>
    /// ```
    ///
    /// All u32 fields are little-endian. JS-side `validateCpmFilename` +
    /// `truncateCpm83` enforce the *filename character set* (ASCII + 8.3 +
    /// valid CP/M character set per D-06/D-07), but the **outer framing** of
    /// the length-prefixed blob is parsed defensively here. Phase 9 CR-01
    /// hardening: malformed metadata (truncated buffer, name_len overrunning
    /// `metadata.len()`, usize wrap on 32-bit targets, file_count larger than
    /// the buffer can support) transitions the SM to `SlideState::Error`
    /// without panicking. This mirrors the `encode_key_raw` boundary policy
    /// at lib.rs:312-320 (RESEARCH Pitfall #4 — never panic across the wasm
    /// FFI boundary; an abort-trap wedges the entire wasm instance until the
    /// page is reloaded).
    pub fn enter_send_mode(&mut self, metadata: &[u8]) {
        fn try_parse(metadata: &[u8]) -> Option<Vec<FileMeta>> {
            let mut cursor = 0usize;
            if metadata.len() < 4 { return None; }
            let file_count = u32::from_le_bytes(
                metadata[cursor..cursor + 4].try_into().ok()?
            ) as usize;
            cursor += 4;
            let mut files = Vec::with_capacity(file_count);
            for _ in 0..file_count {
                // u32 name_len.
                if cursor.checked_add(4)? > metadata.len() { return None; }
                let name_len = u32::from_le_bytes(
                    metadata[cursor..cursor + 4].try_into().ok()?
                ) as usize;
                cursor += 4;
                // name bytes + u32 size — guard usize add against 32-bit wrap.
                let name_end = cursor.checked_add(name_len)?;
                let after_size = name_end.checked_add(4)?;
                if after_size > metadata.len() { return None; }
                let name = metadata[cursor..name_end].to_vec();
                cursor = name_end;
                let size = u32::from_le_bytes(
                    metadata[cursor..cursor + 4].try_into().ok()?
                );
                cursor += 4;
                files.push(FileMeta { name, size });
            }
            Some(files)
        }

        let Some(files) = try_parse(metadata) else {
            // Defensive: malformed metadata transitions to Error with no
            // outbound bytes pushed and no role swap — JS observes the Error
            // state via slide.state() and constructs a new Slide for the next
            // session.
            self.sm_state = SlideState::Error;
            return;
        };
        self.send_ctx = Some(SendCtx {
            files,
            current_file_idx: 0,
            current_seq: 1,
            eof_seq: 0,
        });
        self.role = SlideRole::Sender;
        // Sender pushes CTRL_RDY first per spec §Startup Handshake.
        self.outbound_buf.push(CTRL_RDY);
        self.sm_state = SlideState::WaitingRdy;
    }

    /// Push the next data-frame payload onto outbound_buf (Phase 9 D-08).
    ///
    /// Called by JS from the sender dispatcher AFTER the SM has advanced into
    /// `DataPhase` (i.e., AFTER `EVT_ACK(0)` for the current file's header).
    /// `eof=true` signals "this is the last chunk of the current file" — the
    /// SM additionally pushes the zero-payload EOF marker frame at the next
    /// seq per slide-rs/send.rs:184-189.
    ///
    /// Must NOT be called outside `DataPhase` — debug_assert guards.
    pub fn feed_send_chunk(&mut self, payload: &[u8], eof: bool) {
        debug_assert!(self.role == SlideRole::Sender);
        debug_assert!(self.sm_state == SlideState::DataPhase);
        let ctx = self.send_ctx.as_mut().expect("send_ctx populated");
        let seq = ctx.current_seq;
        build_frame_into(&mut self.outbound_buf, seq, payload);
        ctx.current_seq = ctx.current_seq.wrapping_add(1);
        if eof {
            // EOF marker: zero-payload frame at next seq.
            ctx.eof_seq = ctx.current_seq;
            let eof_seq = ctx.eof_seq;
            build_frame_into(&mut self.outbound_buf, eof_seq, &[]);
            // current_seq now points past the EOF marker; SM stays in DataPhase
            // waiting for ACK(eof_seq).
            // Note: do not advance current_seq past EOF — the next file resets it.
        }
    }

    /// Build and push the per-file header frame onto outbound_buf
    /// (slide-rs/protocol.rs:47-56 payload shape: name + null + size_le_u32).
    fn push_header_frame(&mut self, file_idx: usize) {
        let ctx = self.send_ctx.as_ref().expect("send_ctx populated");
        let file = &ctx.files[file_idx];
        let mut payload = Vec::with_capacity(file.name.len() + 1 + 4);
        payload.extend_from_slice(&file.name);
        payload.push(0);
        payload.extend_from_slice(&file.size.to_le_bytes());
        build_frame_into(&mut self.outbound_buf, 0, &payload);
    }

    /// State accessor (returns SlideState as u32 for Phase 8 boundary).
    pub fn state(&self) -> u32 {
        self.sm_state as u32
    }

    /// Current sender-mode file index — Phase 9 WR-04 single source of truth.
    ///
    /// Returns the index into `send_ctx.files` of the file currently being
    /// transmitted. Returns 0 when no send context is active (receiver mode
    /// or pre-init); JS callers MUST gate on `state() == DataPhase` before
    /// trusting the value (which they already do at slide.js:582).
    ///
    /// Earlier the JS pump derived this from a JS-side `currentFileIdx`
    /// counter that mirrored the SM's `current_file_idx` only after
    /// EVT_FILE_COMPLETE drained from the events ring. With this accessor,
    /// `pumpNextDataChunkIfReady` reads the authoritative cursor directly
    /// from the SM and the JS-side counter becomes a defensive cache that
    /// the Rust SM no longer depends on.
    pub fn send_current_file_idx(&self) -> u32 {
        self.send_ctx
            .as_ref()
            .map(|ctx| ctx.current_file_idx as u32)
            .unwrap_or(0)
    }

    /// Per-byte feed step. Drives the framer; on framer events, drives the
    /// SM transition. Returns the most recent packed event from this byte
    /// (or EVT_NONE if no event). Events are also pushed into the ring
    /// for feed_chunk multi-event drain.
    pub fn feed_byte(&mut self, b: u8) -> u32 {
        // CancelPending: silent drain per D-07. Only CTRL_CAN echo wakes us.
        if self.sm_state == SlideState::CancelPending {
            if b == CTRL_CAN {
                self.sm_state = SlideState::Done;
                let evt = EVT_CAN;
                self.events.push_back(evt);
                return evt;
            }
            return EVT_NONE;
        }

        // Done / Error: ignore further bytes. JS should call Slide::new() for
        // the next session.
        if matches!(self.sm_state, SlideState::Done | SlideState::Error) {
            return EVT_NONE;
        }

        let evt = self.framer.step(b);
        if evt == EVT_NONE {
            return EVT_NONE;
        }

        // Drive the receiver SM on framer event.
        self.handle_framer_event(evt);

        // Push into ring for feed_chunk drain.
        self.events.push_back(evt);
        evt
    }

    /// Multi-byte hot path. Returns the count of events drained INTO the
    /// ring (JS calls take_event_packed repeatedly to consume).
    pub fn feed_chunk(&mut self, bytes: &[u8]) -> u32 {
        let before = self.events.len();
        for &b in bytes {
            let _ = self.feed_byte(b);
        }
        (self.events.len() - before) as u32
    }

    /// Drain one event from the ring. Returns EVT_NONE when empty.
    pub fn take_event_packed(&mut self) -> u32 {
        self.events.pop_front().unwrap_or(EVT_NONE)
    }

    /// D-06: fire-and-set-state cancel. Idempotent — calling cancel() while
    /// already in CancelPending or Done is a no-op. JS owns timing
    /// (200/500/100/2000 ms windows per PITFALLS §5).
    pub fn cancel(&mut self) {
        if matches!(self.sm_state, SlideState::CancelPending | SlideState::Done | SlideState::Error) {
            return;
        }
        // CTRL_CAN is a raw single byte (RESEARCH §CTRL_CAN Wire Format
        // Resolution lines 698-725; ADR-003 records this).
        self.outbound_buf.push(CTRL_CAN);
        self.sm_state = SlideState::CancelPending;
    }

    /// D-06: escape hatch for JS after the ~2 s no-echo timeout. Forcibly
    /// transitions to Done (NOT Idle — the session is over either way; JS
    /// constructs a new Slide for the next session).
    pub fn force_idle(&mut self) {
        self.sm_state = SlideState::Done;
        self.outbound_buf.clear();
    }

    // ===== Stable-pointer accessor triple (D-17 mirror) =====

    /// Pointer into outbound_buf. Stable across feed_byte/feed_chunk calls
    /// IN STEADY STATE (i.e., outbound_buf.len() ≤ OUTBOUND_RESERVE).
    /// Phase 8 wraps via wasm-bindgen.
    pub fn outbound_ptr(&self) -> *const u8 {
        self.outbound_buf.as_ptr()
    }

    pub fn outbound_len(&self) -> usize {
        self.outbound_buf.len()
    }

    /// Acknowledge outbound drain. Resets len to 0; preserves capacity per
    /// Vec::clear() contract.
    pub fn clear_outbound(&mut self) {
        self.outbound_buf.clear();
    }

    // ===== Internal: receiver SM transition driver =====

    fn handle_framer_event(&mut self, evt: u32) {
        // High 16 bits = kind; low 16 bits = aux (typically seq).
        let aux = (evt & 0xFFFF) as u8;

        // Peer-initiated CAN (D-05 strict bidirectional): from any non-Done state,
        // echo CTRL_CAN and transition to CancelPending. Applies to BOTH roles
        // (Phase 9 D-19 — sender mirrors receiver-side bidirectional CAN echo).
        if evt == EVT_CAN
            && !matches!(self.sm_state, SlideState::Done | SlideState::Error | SlideState::CancelPending)
        {
            self.outbound_buf.push(CTRL_CAN);
            self.sm_state = SlideState::CancelPending;
            return;
        }

        // Phase 9 sender role gate. Sender-mode arms below; receiver arms
        // (existing) run only when role == Receiver via the explicit return.
        if self.role == SlideRole::Sender {
            let kind = evt & 0xFFFF_0000;

            match (self.sm_state, kind) {
                (SlideState::WaitingRdy, k) if k == EVT_RDY => {
                    // Z80 echoed RDY → ship header for files[0].
                    self.push_header_frame(0);
                    self.sm_state = SlideState::HeaderPhase;
                }
                (SlideState::HeaderPhase, k) if k == EVT_ACK && aux == 0 => {
                    // Header acked → DataPhase (or immediate EOF if empty file).
                    let ctx = self.send_ctx.as_ref().unwrap();
                    let cur_idx = ctx.current_file_idx;
                    let cur_size = ctx.files[cur_idx].size;
                    if cur_size == 0 {
                        // SLIDE-21 empty file: skip data phase, push EOF at seq=1.
                        let eof_seq = 1u8;
                        self.sm_state = SlideState::DataPhase;
                        build_frame_into(&mut self.outbound_buf, eof_seq, &[]);
                        let ctx_mut = self.send_ctx.as_mut().unwrap();
                        ctx_mut.eof_seq = eof_seq;
                        ctx_mut.current_seq = 2;
                    } else {
                        self.sm_state = SlideState::DataPhase;
                        // JS drives feed_send_chunk from here.
                    }
                }
                (SlideState::DataPhase, k) if k == EVT_ACK => {
                    let ctx = self.send_ctx.as_ref().unwrap();
                    if aux == ctx.eof_seq && ctx.eof_seq != 0 {
                        // Current file complete — emit EVT_FILE_COMPLETE and advance.
                        let file_idx = ctx.current_file_idx;
                        let total_files = ctx.files.len();
                        self.events.push_back(EVT_FILE_COMPLETE | (file_idx as u32));
                        let next_idx = file_idx + 1;
                        if next_idx < total_files {
                            self.push_header_frame(next_idx);
                            let ctx_mut = self.send_ctx.as_mut().unwrap();
                            ctx_mut.current_file_idx = next_idx;
                            ctx_mut.current_seq = 1;
                            ctx_mut.eof_seq = 0;
                            self.sm_state = SlideState::HeaderPhase;
                        } else {
                            self.outbound_buf.push(CTRL_FIN);
                            self.sm_state = SlideState::FinPending;
                        }
                    }
                    // else: window-boundary ACK (intra-file). No state change;
                    // JS observes EVT_ACK in the events ring and pumps the next
                    // data chunk via feed_send_chunk on the next dispatcher tick.
                }
                (SlideState::DataPhase, k) if k == EVT_NAK => {
                    // Sender NAK retransmit (slide-rs/send.rs:194-208 mirror).
                    // The SM emits EVT_RETRANSMIT_NEEDED | seq so JS can call
                    // feed_send_chunk(buffered_payload[seq], is_eof) with the
                    // correctly-rebuilt payload bytes. JS holds the file bytes;
                    // Rust SM does not duplicate the buffer.
                    self.events.push_back(EVT_RETRANSMIT_NEEDED | (aux as u32));
                    let ctx_mut = self.send_ctx.as_mut().unwrap();
                    ctx_mut.current_seq = aux;
                }
                (SlideState::FinPending, k) if k == EVT_FIN => {
                    // Z80 echoed CTRL_FIN — session complete.
                    self.events.push_back(EVT_SESSION_COMPLETE);
                    self.sm_state = SlideState::Done;
                }
                _ => {
                    // Other (state, evt) combinations are no-ops for sender.
                    // EVT_DATA_FRAME / EVT_CRC_ERROR don't apply to sender flow.
                    // Suppress unused-aux warning when no arm uses it.
                    let _ = aux;
                }
            }
            return;
        }

        // Receiver role — Phase 7 logic continues unchanged below.

        match (self.sm_state, evt) {
            // ===== WaitingRdy =====
            (SlideState::WaitingRdy, EVT_RDY) => {
                // Echo CTRL_RDY back per spec §Startup Handshake.
                self.outbound_buf.push(CTRL_RDY);
                self.sm_state = SlideState::HeaderPhase;
            }
            (SlideState::WaitingRdy, EVT_FIN) => {
                // Empty session — sender had nothing to send.
                self.outbound_buf.push(CTRL_FIN);
                self.sm_state = SlideState::Done;
            }

            // ===== HeaderPhase =====
            (SlideState::HeaderPhase, e) if e & 0xFFFF_0000 == EVT_DATA_FRAME => {
                if aux == 0 {
                    // Header validated by application layer; for the SM,
                    // seq=0 marker is sufficient. ACK and advance to DataPhase.
                    self.outbound_buf.push(CTRL_ACK);
                    self.outbound_buf.push(0);
                    self.expected_seq = 1;
                    self.nak_retry_count = 0;
                    self.sm_state = SlideState::DataPhase;
                } else {
                    // Protocol violation — sender sent data before header.
                    self.sm_state = SlideState::Error;
                }
            }
            (SlideState::HeaderPhase, EVT_FIN) => {
                // Multi-file batch done — echo FIN.
                self.outbound_buf.push(CTRL_FIN);
                self.sm_state = SlideState::Done;
            }
            (SlideState::HeaderPhase, e) if e & 0xFFFF_0000 == EVT_CRC_ERROR => {
                self.outbound_buf.push(CTRL_NAK);
                self.outbound_buf.push(aux);
                self.nak_retry_count += 1;
                if self.nak_retry_count > NAK_BUDGET {
                    self.sm_state = SlideState::Error;
                }
            }

            // ===== DataPhase =====
            (SlideState::DataPhase, e) if e & 0xFFFF_0000 == EVT_DATA_FRAME => {
                // EOF marker: zero-payload data frame. Receiver ACKs and
                // loops back to HeaderPhase for the next file in the batch.
                // (slide-rs/recv.rs:172-180 — len==0 case.)
                let payload = self.framer.take_payload();
                if payload.is_empty() {
                    // EOF: ACK the EOF frame's seq, loop to HeaderPhase.
                    self.outbound_buf.push(CTRL_ACK);
                    self.outbound_buf.push(aux);
                    self.expected_seq = 1;
                    self.nak_retry_count = 0;
                    self.sm_state = SlideState::HeaderPhase;
                } else if aux == self.expected_seq {
                    // Match — accept frame; per-window ACK on WIN_SIZE boundary.
                    // slide-rs/recv.rs:206-212: send ACK every WIN_SIZE frames.
                    self.expected_seq = self.expected_seq.wrapping_add(1);
                    self.nak_retry_count = 0;
                    let last_acked = self.expected_seq.wrapping_sub(1);
                    if last_acked & (WIN_SIZE - 1) == 0 {
                        self.outbound_buf.push(CTRL_ACK);
                        self.outbound_buf.push(last_acked);
                    }
                } else {
                    // Sequence mismatch — NAK with expected_seq.
                    self.outbound_buf.push(CTRL_NAK);
                    self.outbound_buf.push(self.expected_seq);
                }
            }
            (SlideState::DataPhase, e) if e & 0xFFFF_0000 == EVT_CRC_ERROR => {
                self.outbound_buf.push(CTRL_NAK);
                self.outbound_buf.push(self.expected_seq);
                self.nak_retry_count += 1;
                if self.nak_retry_count > NAK_BUDGET {
                    self.sm_state = SlideState::Error;
                }
            }
            (SlideState::DataPhase, EVT_FIN) => {
                // Protocol violation — FIN mid-file.
                self.sm_state = SlideState::Error;
            }

            // Default: ignore irrelevant events (RDY/ACK/NAK during receive
            // are not semantically meaningful to the receiver SM since the
            // peer is the one sending data; and Idle/CancelPending/Done/Error
            // were handled above).
            _ => {}
        }
    }
}

impl Default for Slide {
    fn default() -> Self {
        Self::new()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::slide::tests_only::*;

    fn s_recv() -> Slide {
        let mut slide = Slide::new();
        slide.enter_recv_mode();
        slide
    }

    #[test]
    fn new_constructs_in_idle() {
        let slide = Slide::new();
        assert_eq!(slide.state(), SlideState::Idle as u32);
        assert_eq!(slide.outbound_len(), 0);
    }

    #[test]
    fn outbound_ptr_is_non_null_at_construction() {
        let slide = Slide::new();
        // Vec::with_capacity guarantees a valid pointer when capacity > 0.
        // Stable-pointer discipline: the same pointer must persist across
        // feed_byte calls in steady state.
        assert!(!slide.outbound_ptr().is_null());
    }

    #[test]
    fn enter_recv_mode_transitions_to_waiting_rdy() {
        let mut slide = Slide::new();
        slide.enter_recv_mode();
        assert_eq!(slide.state(), SlideState::WaitingRdy as u32);
    }

    #[test]
    fn recv_rdy_echoed() {
        let mut slide = s_recv();
        assert_eq!(slide.feed_byte(CTRL_RDY), EVT_RDY);
        assert_eq!(slide.state(), SlideState::HeaderPhase as u32);
        assert_eq!(slide.outbound_len(), 1);
        // SAFETY: outbound_ptr is non-null, len is 1.
        let buf = unsafe { std::slice::from_raw_parts(slide.outbound_ptr(), slide.outbound_len()) };
        assert_eq!(buf, &[CTRL_RDY]);
    }

    #[test]
    fn header_acks_seq_0() {
        let mut slide = s_recv();
        slide.feed_byte(CTRL_RDY);
        slide.clear_outbound();
        for &b in FIXTURE_HEADER_TEST_TXT {
            slide.feed_byte(b);
        }
        assert_eq!(slide.state(), SlideState::DataPhase as u32);
        // ACK with seq=0
        let buf = unsafe { std::slice::from_raw_parts(slide.outbound_ptr(), slide.outbound_len()) };
        assert_eq!(buf, &[CTRL_ACK, 0x00]);
    }

    #[test]
    fn data_phase_per_window_ack_at_win_size_4() {
        // Drive into DataPhase with expected_seq=1.
        let mut slide = s_recv();
        slide.feed_byte(CTRL_RDY);
        for &b in FIXTURE_HEADER_TEST_TXT {
            slide.feed_byte(b);
        }
        slide.clear_outbound();
        assert_eq!(slide.state(), SlideState::DataPhase as u32);
        // Now feed 4 frames seq 1..4 — slide-rs/recv.rs:206-212 says ACK
        // when (last_acked & (WIN_SIZE - 1)) == 0, i.e. when last_acked is
        // a multiple of 4. After accepting seq=4, last_acked == 4 → ACK.
        // Build 4 minimal valid data frames (1-byte payload each).
        for seq in 1u8..=4 {
            let mut frame = vec![0x01, seq, 0x00, 0x01, 0x00];   // SOF SEQ LEN_H LEN_L PAYLOAD(0x00)
            let crc = crc16_ccitt(&[seq, 0x00, 0x01, 0x00]);
            frame.push((crc >> 8) as u8);
            frame.push((crc & 0xFF) as u8);
            for &b in &frame {
                slide.feed_byte(b);
            }
        }
        // Outbound should contain exactly one ACK (after seq=4); no ACKs
        // for seqs 1, 2, 3 (within window).
        let buf = unsafe { std::slice::from_raw_parts(slide.outbound_ptr(), slide.outbound_len()) };
        assert_eq!(buf, &[CTRL_ACK, 0x04],
            "expected single window-boundary ACK at seq=4, got {:02X?}", buf);
    }

    #[test]
    fn seq_mismatch_naks_with_expected() {
        // Drive to DataPhase with expected_seq=1.
        let mut slide = s_recv();
        slide.feed_byte(CTRL_RDY);
        for &b in FIXTURE_HEADER_TEST_TXT { slide.feed_byte(b); }
        slide.clear_outbound();
        // Feed a frame with seq=5 instead of expected seq=1.
        let mut frame = vec![0x01, 0x05, 0x00, 0x01, 0xAA];
        let crc = crc16_ccitt(&[0x05, 0x00, 0x01, 0xAA]);
        frame.push((crc >> 8) as u8);
        frame.push((crc & 0xFF) as u8);
        for &b in &frame { slide.feed_byte(b); }
        let buf = unsafe { std::slice::from_raw_parts(slide.outbound_ptr(), slide.outbound_len()) };
        assert_eq!(buf, &[CTRL_NAK, 0x01],
            "NAK must carry expected_seq=1, not the received seq=5");
    }

    #[test]
    fn eof_frame_loops_to_header() {
        // Drive to DataPhase, then feed a zero-payload data frame (EOF marker).
        let mut slide = s_recv();
        slide.feed_byte(CTRL_RDY);
        for &b in FIXTURE_HEADER_TEST_TXT { slide.feed_byte(b); }
        slide.clear_outbound();
        // EOF frame with seq=4 (FIXTURE_EOF_SEQ_4 from tests_only).
        for &b in FIXTURE_EOF_SEQ_4 { slide.feed_byte(b); }
        assert_eq!(slide.state(), SlideState::HeaderPhase as u32,
            "EOF frame must loop back to HeaderPhase for next file in batch");
        let buf = unsafe { std::slice::from_raw_parts(slide.outbound_ptr(), slide.outbound_len()) };
        assert_eq!(buf, &[CTRL_ACK, 0x04]);
    }

    #[test]
    fn fin_in_header_phase_echoes_and_completes() {
        // Drive to HeaderPhase, then feed CTRL_FIN.
        let mut slide = s_recv();
        slide.feed_byte(CTRL_RDY);
        slide.clear_outbound();
        assert_eq!(slide.state(), SlideState::HeaderPhase as u32);
        assert_eq!(slide.feed_byte(CTRL_FIN), EVT_FIN);
        assert_eq!(slide.state(), SlideState::Done as u32);
        let buf = unsafe { std::slice::from_raw_parts(slide.outbound_ptr(), slide.outbound_len()) };
        assert_eq!(buf, &[CTRL_FIN]);
    }

    #[test]
    fn nak_budget_exhaustion_transitions_to_error() {
        // In DataPhase, 16 consecutive CRC errors should exhaust budget on
        // the 16th. (NAK_BUDGET=15 → 16th error transitions to Error.)
        let mut slide = s_recv();
        slide.feed_byte(CTRL_RDY);
        for &b in FIXTURE_HEADER_TEST_TXT { slide.feed_byte(b); }
        assert_eq!(slide.state(), SlideState::DataPhase as u32);
        // Build a frame with deliberately-wrong CRC.
        for _ in 0..16 {
            let frame: &[u8] = &[0x01, 0x01, 0x00, 0x01, 0xAA, 0xDE, 0xAD]; // bogus CRC
            for &b in frame { slide.feed_byte(b); }
        }
        assert_eq!(slide.state(), SlideState::Error as u32,
            "16 consecutive CRC errors must exhaust NAK_BUDGET=15 and transition to Error");
    }

    #[test]
    fn cancel_idempotent() {
        let mut slide = s_recv();
        slide.feed_byte(CTRL_RDY);
        slide.clear_outbound();
        slide.cancel();
        assert_eq!(slide.state(), SlideState::CancelPending as u32);
        let len_after_first = slide.outbound_len();
        assert_eq!(len_after_first, 1);
        // D-06 idempotent contract: second cancel() must not push another CAN.
        slide.cancel();
        assert_eq!(slide.outbound_len(), len_after_first,
            "second cancel() must not push another CTRL_CAN onto outbound");
        assert_eq!(slide.state(), SlideState::CancelPending as u32);
    }

    #[test]
    fn peer_can_during_data_phase_echoes_and_transitions() {
        // D-05 strict bidirectional: receiving CTRL_CAN must echo CTRL_CAN.
        let mut slide = s_recv();
        slide.feed_byte(CTRL_RDY);
        for &b in FIXTURE_HEADER_TEST_TXT { slide.feed_byte(b); }
        assert_eq!(slide.state(), SlideState::DataPhase as u32);
        slide.clear_outbound();
        assert_eq!(slide.feed_byte(CTRL_CAN), EVT_CAN);
        assert_eq!(slide.state(), SlideState::CancelPending as u32);
        let buf = unsafe { std::slice::from_raw_parts(slide.outbound_ptr(), slide.outbound_len()) };
        assert_eq!(buf, &[CTRL_CAN]);
    }

    #[test]
    fn force_idle_transitions_to_done() {
        let mut slide = s_recv();
        slide.feed_byte(CTRL_RDY);
        slide.cancel();
        assert_eq!(slide.state(), SlideState::CancelPending as u32);
        slide.force_idle();
        assert_eq!(slide.state(), SlideState::Done as u32);
        assert_eq!(slide.outbound_len(), 0);
    }

    #[test]
    fn cancel_pending_silent_drains_non_can_bytes() {
        // D-07: while in CancelPending, non-CAN bytes silently consumed.
        let mut slide = s_recv();
        slide.feed_byte(CTRL_RDY);
        slide.cancel();
        slide.clear_outbound();
        // Feed a partial frame's worth of bytes.
        for &b in FIXTURE_SLIDE_RS_HELLO {
            let evt = slide.feed_byte(b);
            assert_eq!(evt, EVT_NONE,
                "byte {:#X} during CancelPending must produce no events", b);
        }
        assert_eq!(slide.state(), SlideState::CancelPending as u32);
    }

    #[test]
    fn cancel_pending_can_completes_session() {
        // D-05 echo received: peer's CTRL_CAN during CancelPending → Done.
        let mut slide = s_recv();
        slide.feed_byte(CTRL_RDY);
        slide.cancel();
        slide.clear_outbound();
        // simulate JS drained CAN to wire
        assert_eq!(slide.feed_byte(CTRL_CAN), EVT_CAN);
        assert_eq!(slide.state(), SlideState::Done as u32);
    }

    #[test]
    fn outbound_ptr_stable_across_feed_byte() {
        // D-17 mirror: outbound_ptr is stable across feed_byte calls in
        // steady state (i.e., outbound_buf.len() ≤ OUTBOUND_RESERVE).
        let mut slide = s_recv();
        let ptr_before = slide.outbound_ptr();
        // Drive a couple of state transitions that push to outbound.
        slide.feed_byte(CTRL_RDY);
        let ptr_after_rdy = slide.outbound_ptr();
        assert_eq!(ptr_before, ptr_after_rdy,
            "outbound_ptr must be stable across feed_byte (D-17 mirror)");
    }

    // ===== Phase 9 sender SM tests =====

    fn s_send(metadata: &[u8]) -> Slide {
        let mut slide = Slide::new();
        slide.enter_send_mode(metadata);
        slide
    }

    /// Pack a 1-file metadata blob (D-09): name="A.TXT" (5 bytes), size=10.
    fn meta_one_file_a_txt_size_10() -> Vec<u8> {
        let mut m = Vec::new();
        m.extend_from_slice(&1u32.to_le_bytes());           // file_count
        m.extend_from_slice(&5u32.to_le_bytes());           // name_len
        m.extend_from_slice(b"A.TXT");
        m.extend_from_slice(&10u32.to_le_bytes());          // size = 10
        m
    }

    /// Pack a 1-file metadata blob with size=0 (empty file).
    fn meta_one_empty_file() -> Vec<u8> {
        let mut m = Vec::new();
        m.extend_from_slice(&1u32.to_le_bytes());
        m.extend_from_slice(&5u32.to_le_bytes());
        m.extend_from_slice(b"E.TXT");
        m.extend_from_slice(&0u32.to_le_bytes());
        m
    }

    /// Pack a 2-file metadata blob.
    fn meta_two_files() -> Vec<u8> {
        let mut m = Vec::new();
        m.extend_from_slice(&2u32.to_le_bytes());
        // file 0
        m.extend_from_slice(&5u32.to_le_bytes());
        m.extend_from_slice(b"A.TXT");
        m.extend_from_slice(&10u32.to_le_bytes());
        // file 1
        m.extend_from_slice(&5u32.to_le_bytes());
        m.extend_from_slice(b"B.TXT");
        m.extend_from_slice(&20u32.to_le_bytes());
        m
    }

    fn outbound_snapshot(slide: &Slide) -> Vec<u8> {
        let len = slide.outbound_len();
        if len == 0 { return Vec::new(); }
        unsafe { std::slice::from_raw_parts(slide.outbound_ptr(), len).to_vec() }
    }

    #[test]
    fn enter_send_mode_pushes_rdy_and_transitions_to_waiting_rdy() {
        let slide = s_send(&meta_one_file_a_txt_size_10());
        assert_eq!(slide.state(), SlideState::WaitingRdy as u32);
        assert_eq!(outbound_snapshot(&slide), vec![CTRL_RDY]);
    }

    #[test]
    fn sender_handshake_ships_header_after_rdy_echo() {
        let mut slide = s_send(&meta_one_file_a_txt_size_10());
        slide.clear_outbound();
        let evt = slide.feed_byte(CTRL_RDY);
        assert_eq!(evt & 0xFFFF_0000, EVT_RDY);
        assert_eq!(slide.state(), SlideState::HeaderPhase as u32);
        let buf = outbound_snapshot(&slide);
        // Header frame layout: SOF + seq=0 + LEN_H + LEN_L + payload(10 bytes:
        //   5 name + 1 null + 4 size_le) + CRC_H + CRC_L = 16 bytes total.
        assert_eq!(buf.len(), 16, "header frame total length: SOF+SEQ+LEN_H+LEN_L+10 payload+CRC_H+CRC_L");
        assert_eq!(buf[0], 0x01);              // SOF
        assert_eq!(buf[1], 0);                  // header seq
        assert_eq!(buf[2], 0);                  // LEN_H
        assert_eq!(buf[3], 10);                 // LEN_L = 10 (5 name + 1 null + 4 size)
        assert_eq!(&buf[4..9], b"A.TXT");
        assert_eq!(buf[9], 0);                  // null terminator
        assert_eq!(&buf[10..14], &10u32.to_le_bytes());
        // Trailing 2 bytes are the CRC.
    }

    #[test]
    fn sender_window_ack_advances_to_eof_and_completes_file() {
        let mut slide = s_send(&meta_one_file_a_txt_size_10());
        slide.clear_outbound();
        slide.feed_byte(CTRL_RDY);                    // → HeaderPhase, header frame pushed
        slide.clear_outbound();
        // ACK(0) → DataPhase
        slide.feed_byte(CTRL_ACK); slide.feed_byte(0);
        assert_eq!(slide.state(), SlideState::DataPhase as u32);
        // Push a 10-byte payload as one chunk with eof=true.
        slide.feed_send_chunk(&[1,2,3,4,5,6,7,8,9,10], true);
        // outbound_buf now contains: data frame (seq=1, len=10, ...) + EOF frame (seq=2, len=0).
        // ACK(eof_seq=2) → emit EVT_FILE_COMPLETE | 0 + push CTRL_FIN → FinPending.
        slide.clear_outbound();
        slide.feed_byte(CTRL_ACK); slide.feed_byte(2);
        // Drain events ring.
        let mut found_file_complete = false;
        loop {
            let e = slide.take_event_packed();
            if e == 0 { break; }
            if (e & 0xFFFF_0000) == EVT_FILE_COMPLETE && (e & 0xFFFF) == 0 {
                found_file_complete = true;
            }
        }
        assert!(found_file_complete, "EVT_FILE_COMPLETE | 0 must be in event ring");
        assert_eq!(slide.state(), SlideState::FinPending as u32);
        // Outbound should now contain CTRL_FIN.
        assert_eq!(outbound_snapshot(&slide), vec![CTRL_FIN]);
    }

    #[test]
    fn sender_nak_emits_retransmit_event() {
        let mut slide = s_send(&meta_one_file_a_txt_size_10());
        slide.clear_outbound();
        slide.feed_byte(CTRL_RDY);
        slide.feed_byte(CTRL_ACK); slide.feed_byte(0);
        // Now in DataPhase. Push one frame at seq=1.
        slide.feed_send_chunk(&[1,2,3,4,5], false);
        slide.clear_outbound();
        // Inbound NAK(seq=1) → emit EVT_RETRANSMIT_NEEDED | 1.
        slide.feed_byte(CTRL_NAK); slide.feed_byte(1);
        let mut found = false;
        loop {
            let e = slide.take_event_packed();
            if e == 0 { break; }
            if (e & 0xFFFF_0000) == EVT_RETRANSMIT_NEEDED && (e & 0xFFFF) == 1 {
                found = true;
            }
        }
        assert!(found, "EVT_RETRANSMIT_NEEDED | 1 must be in event ring");
    }

    #[test]
    fn sender_empty_file_skips_data_phase() {
        let mut slide = s_send(&meta_one_empty_file());
        slide.clear_outbound();
        slide.feed_byte(CTRL_RDY);
        slide.clear_outbound();
        // ACK(0) for header → SLIDE-21 empty-file fast path: push EOF at seq=1.
        slide.feed_byte(CTRL_ACK); slide.feed_byte(0);
        assert_eq!(slide.state(), SlideState::DataPhase as u32);
        let buf = outbound_snapshot(&slide);
        // EOF frame is zero-payload at seq=1: SOF + 1 + 0 + 0 + (no payload) + CRC_H + CRC_L = 6 bytes.
        assert_eq!(buf.len(), 6);
        assert_eq!(buf[0], 0x01);
        assert_eq!(buf[1], 1);
        assert_eq!(buf[2], 0);
        assert_eq!(buf[3], 0);
    }

    #[test]
    fn sender_inbound_can_echoes_and_transitions_to_cancel_pending() {
        let mut slide = s_send(&meta_one_file_a_txt_size_10());
        slide.clear_outbound();
        // Inbound CTRL_CAN from any non-Done sender state — D-19 / ADR-003.
        slide.feed_byte(CTRL_CAN);
        assert_eq!(slide.state(), SlideState::CancelPending as u32);
        assert_eq!(outbound_snapshot(&slide), vec![CTRL_CAN]);
    }

    #[test]
    fn sender_multi_file_batch_advances_through_files_then_fin() {
        let mut slide = s_send(&meta_two_files());
        slide.clear_outbound();
        slide.feed_byte(CTRL_RDY);                   // → HeaderPhase (file 0)
        slide.clear_outbound();
        slide.feed_byte(CTRL_ACK); slide.feed_byte(0);  // → DataPhase
        slide.feed_send_chunk(&[1; 10], true);       // 10-byte payload + EOF marker at seq=2
        slide.clear_outbound();
        // ACK(eof_seq=2) → EVT_FILE_COMPLETE | 0, push header for file 1, → HeaderPhase.
        slide.feed_byte(CTRL_ACK); slide.feed_byte(2);
        assert_eq!(slide.state(), SlideState::HeaderPhase as u32);
        // Drain EVT_FILE_COMPLETE | 0.
        let mut got_fc0 = false;
        loop {
            let e = slide.take_event_packed();
            if e == 0 { break; }
            if (e & 0xFFFF_0000) == EVT_FILE_COMPLETE && (e & 0xFFFF) == 0 {
                got_fc0 = true;
            }
        }
        assert!(got_fc0);
        // Continue: ACK(0) for file-1 header → DataPhase.
        slide.clear_outbound();
        slide.feed_byte(CTRL_ACK); slide.feed_byte(0);
        assert_eq!(slide.state(), SlideState::DataPhase as u32);
        slide.feed_send_chunk(&[2; 20], true);
        slide.clear_outbound();
        // ACK(eof) for file 1 → CTRL_FIN, FinPending.
        slide.feed_byte(CTRL_ACK); slide.feed_byte(2);
        assert_eq!(slide.state(), SlideState::FinPending as u32);
        assert_eq!(outbound_snapshot(&slide), vec![CTRL_FIN]);
        // Inbound CTRL_FIN echo → EVT_SESSION_COMPLETE → Done.
        slide.clear_outbound();
        slide.feed_byte(CTRL_FIN);
        let mut got_sc = false;
        loop {
            let e = slide.take_event_packed();
            if e == 0 { break; }
            if e == EVT_SESSION_COMPLETE {
                got_sc = true;
            }
        }
        assert!(got_sc, "EVT_SESSION_COMPLETE must be emitted on inbound FIN echo");
        assert_eq!(slide.state(), SlideState::Done as u32);
    }

    #[test]
    fn send_current_file_idx_tracks_sm_advance() {
        // WR-04 — Rust-side accessor reflects the SM's authoritative cursor.
        // Returns 0 on a fresh Slide (no send_ctx), 0 on first file, then
        // advances to 1 after EVT_FILE_COMPLETE for file 0 acks.
        let s_idle = Slide::new();
        assert_eq!(s_idle.send_current_file_idx(), 0,
            "no send_ctx → returns 0 (Idle / receiver mode)");

        let mut slide = s_send(&meta_two_files());
        assert_eq!(slide.send_current_file_idx(), 0,
            "first file → idx 0");
        slide.clear_outbound();
        slide.feed_byte(CTRL_RDY);                       // → HeaderPhase
        slide.feed_byte(CTRL_ACK); slide.feed_byte(0);   // → DataPhase
        slide.feed_send_chunk(&[1; 10], true);           // 10 bytes + EOF marker at seq=2
        slide.clear_outbound();
        // ACK(eof_seq=2) → EVT_FILE_COMPLETE | 0, advance to file 1.
        slide.feed_byte(CTRL_ACK); slide.feed_byte(2);
        assert_eq!(slide.send_current_file_idx(), 1,
            "after EVT_FILE_COMPLETE | 0 → idx advanced to 1");
    }

    #[test]
    fn outbound_ptr_stable_across_sender_window_pushes() {
        // Phase 9 OUTBOUND_RESERVE = 4128 bytes must absorb 4 max-size data
        // frames without reallocation. Stable-pointer discipline preserved
        // across role swap (Phase 1 D-17 + Phase 7 D-17 mirror).
        // Frame layout: SOF + SEQ + LEN_H + LEN_L + 1024 payload + CRC_H + CRC_L
        // = 1030 bytes per frame; 4 frames = 4120 bytes < OUTBOUND_RESERVE 4128.
        let mut slide = s_send(&meta_one_file_a_txt_size_10());
        let ptr_before = slide.outbound_ptr();
        slide.clear_outbound();
        slide.feed_byte(CTRL_RDY);
        slide.feed_byte(CTRL_ACK); slide.feed_byte(0);
        slide.clear_outbound();  // clear header bytes before the 4-frame window
        // Push 4 full FRAME_SIZE frames (payload = 1024 bytes each).
        let payload = vec![0xAA; 1024];
        slide.feed_send_chunk(&payload, false);
        slide.feed_send_chunk(&payload, false);
        slide.feed_send_chunk(&payload, false);
        slide.feed_send_chunk(&payload, false);
        assert_eq!(slide.outbound_ptr(), ptr_before,
            "OUTBOUND_RESERVE = 4128 must accommodate 4-frame window without reallocation");
    }
}
