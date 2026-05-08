//! SLIDE sender end-to-end corpus — Phase 9 SC#5 byte-identical round-trip.
//!
//! This file verifies the Phase 9 sender SM extension in `slide::state.rs` against
//! an in-process Rust mock receiver bot. The mock bot mirrors slide-rs/src/recv.rs
//! control flow: emit CTRL_RDY (echo of sender's RDY) → parse incoming SLIDE
//! frames → emit CTRL_ACK(seq) per accepted frame → on CTRL_FIN, emit CTRL_FIN
//! echo. The bot also supports test-driven NAK / CAN injection.
//!
//! Cross-validation gate: any byte drift between the production Rust sender and
//! a hand-written reference receiver is caught here. `tests/slide_sender.rs` and
//! `www/tests/transport/mock-serial-slide-bot.js` (Plan 09-04) are intentionally
//! parallel implementations of the receiver side so SLIDE protocol drift cannot
//! mask itself in a sympathetic mock peer (PITFALLS §13).

use bestialitty_core::slide::tests_only::*;

// ===== Test helpers =====

fn outbound_snapshot(slide: &Slide) -> Vec<u8> {
    let len = slide.outbound_len();
    if len == 0 { return Vec::new(); }
    unsafe { std::slice::from_raw_parts(slide.outbound_ptr(), len).to_vec() }
}

fn pack_metadata(files: &[(&str, u32)]) -> Vec<u8> {
    let mut m = Vec::new();
    m.extend_from_slice(&(files.len() as u32).to_le_bytes());
    for (name, size) in files {
        let nb = name.as_bytes();
        m.extend_from_slice(&(nb.len() as u32).to_le_bytes());
        m.extend_from_slice(nb);
        m.extend_from_slice(&size.to_le_bytes());
    }
    m
}

fn pseudo_random_bytes(len: usize) -> Vec<u8> {
    // Deterministic pseudo-random — xorshift32 seeded with fixed seed so the
    // test is byte-stable across runs.
    let mut out = Vec::with_capacity(len);
    let mut state: u32 = 0xdeadbeef;
    for _ in 0..len {
        state ^= state << 13;
        state ^= state >> 17;
        state ^= state << 5;
        out.push((state & 0xFF) as u8);
    }
    out
}

const FRAME_SIZE: usize = 1024;

// ===== Mock receiver bot — mirrors slide-rs/recv.rs =====

#[derive(Clone, Copy, PartialEq, Eq)]
enum BotInjectMode {
    None,
    NakOnFirstFrame,    // emits NAK(1) once on the first data frame, then resumes ACKing normally
    CanMidStream,       // emits CTRL_CAN on the first data frame instead of ACK
}

struct MockReceiver {
    mode: BotInjectMode,
    /// Per-file received bytes, ordered by file index; appended on every
    /// non-empty data-frame payload.
    received_files: Vec<Vec<u8>>,
    received_filenames: Vec<Vec<u8>>,
    /// Internal frame parser buffer. We append sender bytes here and scan from
    /// offset 0 each call until we hit a partial frame.
    parse_buf: Vec<u8>,
    /// One-shot injection latches.
    nak_already_injected: bool,
    can_already_injected: bool,
    fin_observed: bool,
    rdy_emitted: bool,
    /// After a NAK, the bot expects the sender to retransmit this seq before
    /// accepting any other data frames. Mirrors slide-rs/recv.rs window-rewind
    /// semantics: NAK rejects the window from `expected_seq` and silently
    /// discards subsequent frames until the retransmit arrives.
    awaiting_retransmit: Option<u8>,
}

impl MockReceiver {
    fn new(mode: BotInjectMode) -> Self {
        Self {
            mode,
            received_files: Vec::new(),
            received_filenames: Vec::new(),
            parse_buf: Vec::with_capacity(8192),
            nak_already_injected: false,
            can_already_injected: false,
            fin_observed: false,
            rdy_emitted: false,
            awaiting_retransmit: None,
        }
    }

    /// Feed sender outbound bytes; return bot's response bytes (RDY echo / ACK / NAK / CAN / FIN echo).
    fn feed_sender_bytes(&mut self, sender_bytes: &[u8]) -> Vec<u8> {
        self.parse_buf.extend_from_slice(sender_bytes);
        let mut response = Vec::new();

        // Sender's first push is always CTRL_RDY — emit RDY echo and consume it.
        if !self.rdy_emitted && !self.parse_buf.is_empty() && self.parse_buf[0] == 0x11 {
            self.parse_buf.remove(0);
            response.push(0x11); // CTRL_RDY echo
            self.rdy_emitted = true;
        }

        // Parse complete frames / control bytes from parse_buf. Restart
        // scanning from index 0 each loop iteration; consume from the front.
        loop {
            if self.parse_buf.is_empty() { break; }
            let b = self.parse_buf[0];
            match b {
                0x01 => {
                    // SOF — try to parse a complete frame.
                    if self.parse_buf.len() < 4 { break; }
                    let seq = self.parse_buf[1];
                    let len_hi = self.parse_buf[2];
                    let len_lo = self.parse_buf[3];
                    let payload_len = ((len_hi as usize) << 8) | (len_lo as usize);
                    let frame_total = 4 + payload_len + 2;
                    if self.parse_buf.len() < frame_total { break; }
                    let payload: Vec<u8> = self.parse_buf[4..4 + payload_len].to_vec();
                    self.handle_frame(seq, &payload, &mut response);
                    self.parse_buf.drain(0..frame_total);
                }
                0x04 => {
                    // CTRL_FIN from sender → FIN echo back.
                    self.fin_observed = true;
                    response.push(0x04);
                    self.parse_buf.drain(0..1);
                }
                0x18 => {
                    // sender CTRL_CAN echo (D-19) — bot doesn't re-echo.
                    self.parse_buf.drain(0..1);
                }
                _ => {
                    // Skip stray byte (defensive — production sender should not
                    // emit anything other than SOF/FIN/CAN at frame boundaries).
                    self.parse_buf.drain(0..1);
                }
            }
        }
        response
    }

    fn handle_frame(&mut self, seq: u8, payload: &[u8], response: &mut Vec<u8>) {
        if seq == 0 {
            // Header frame: payload = name + null + size_le_u32.
            let null_pos = payload.iter().position(|&b| b == 0).expect("header has null");
            let name = payload[..null_pos].to_vec();
            self.received_filenames.push(name);
            self.received_files.push(Vec::new());
            response.push(0x06); response.push(0); // CTRL_ACK + seq=0
            return;
        }

        // After a NAK, silently drop frames until the requested retransmit
        // arrives. Mirrors slide-rs/recv.rs window-rewind: receiver discards
        // post-NAK frames; sender re-feeds from the NAKed seq onward.
        if let Some(expected) = self.awaiting_retransmit {
            if seq != expected {
                // Silently drop. Sender will eventually retransmit; do not ACK
                // and do not append the payload — bytes are duplicates.
                return;
            }
            // Retransmit arrived — clear the latch and fall through to ACK.
            self.awaiting_retransmit = None;
        }

        // Inject CAN before processing if requested.
        if self.mode == BotInjectMode::CanMidStream && !self.can_already_injected {
            response.push(0x18); // CTRL_CAN
            self.can_already_injected = true;
            return;
        }
        // Inject NAK on first data frame (seq=1) if requested.
        if self.mode == BotInjectMode::NakOnFirstFrame
            && !self.nak_already_injected
            && seq == 1
        {
            response.push(0x15); response.push(seq); // CTRL_NAK + seq=1
            self.nak_already_injected = true;
            // Latch: drop subsequent frames until the sender retransmits seq=1.
            self.awaiting_retransmit = Some(1);
            return;
        }
        if payload.is_empty() {
            // EOF marker — ACK the EOF seq.
            response.push(0x06); response.push(seq);
        } else {
            // Append payload to current file.
            let cur = self.received_files.last_mut().expect("header seen first");
            cur.extend_from_slice(payload);
            response.push(0x06); response.push(seq);
        }
    }

    fn received_bytes(&self, file_idx: usize) -> &[u8] {
        &self.received_files[file_idx]
    }

    fn fin_observed(&self) -> bool {
        self.fin_observed
    }
}

/// Drive a sender Slide through its lifecycle against `bot` until the sender
/// reaches Done | Error | CancelPending or `max_iter` iterations elapse.
///
/// `file_payloads` is indexed by file; the test caller pre-builds the bytes
/// they expect to send (which the sender SM transmits via feed_send_chunk).
/// On EVT_RETRANSMIT_NEEDED the helper rewinds the per-file offset to the
/// requested seq's payload window and re-feeds the chunk.
fn drive_session(
    sender: &mut Slide,
    bot: &mut MockReceiver,
    file_payloads: &[Vec<u8>],
    max_iter: usize,
) {
    // For each file, track how many bytes the sender has already framed.
    // current_file_idx is inferred by counting EVT_FILE_COMPLETE events.
    let mut file_offsets = vec![0usize; file_payloads.len()];
    let mut current_file: usize = 0;
    let mut eof_pushed_for_current_file: bool = false;

    for _ in 0..max_iter {
        // 1) Drain sender outbound to bot; bot replies; feed reply into sender.
        let out = outbound_snapshot(sender);
        if !out.is_empty() {
            sender.clear_outbound();
            let response = bot.feed_sender_bytes(&out);
            if !response.is_empty() {
                sender.feed_chunk(&response);
            }
        }

        // 2) Drain sender events. Track FILE_COMPLETE / RETRANSMIT_NEEDED /
        //    SESSION_COMPLETE.
        let mut retransmit_seq: Option<u8> = None;
        loop {
            let e = sender.take_event_packed();
            if e == 0 { break; }
            let kind = e & 0xFFFF_0000;
            let aux = (e & 0xFFFF) as u8;
            if kind == EVT_FILE_COMPLETE {
                // Move to next file; reset progress flags.
                current_file = (aux as usize) + 1;
                eof_pushed_for_current_file = false;
            }
            if kind == EVT_RETRANSMIT_NEEDED {
                retransmit_seq = Some(aux);
            }
            if kind == EVT_SESSION_COMPLETE {
                return;
            }
        }

        // 3) If we got a retransmit request, rewind the current file's offset
        //    to the seq's payload window and re-feed the chunk.
        if let Some(_seq) = retransmit_seq {
            // Simplification matching the test corpus: NAK injection is
            // one-shot on the first data frame (seq=1, offset=0). Rewind to
            // offset=0 and re-send the same chunk. eof flag re-derived below.
            file_offsets[current_file] = 0;
            eof_pushed_for_current_file = false;
        }

        // 4) State-driven progress.
        let st = sender.state();
        if st == SlideState::Done as u32
            || st == SlideState::Error as u32
            || st == SlideState::CancelPending as u32
        {
            return;
        }

        if st == SlideState::DataPhase as u32 {
            // Check if there's more payload for the current file to feed.
            if current_file < file_payloads.len() && !eof_pushed_for_current_file {
                let payload = &file_payloads[current_file];
                let off = file_offsets[current_file];
                if off < payload.len() {
                    let remaining = &payload[off..];
                    let chunk_len = remaining.len().min(FRAME_SIZE);
                    let is_eof = chunk_len == remaining.len();
                    let chunk: Vec<u8> = remaining[..chunk_len].to_vec();
                    sender.feed_send_chunk(&chunk, is_eof);
                    file_offsets[current_file] += chunk_len;
                    if is_eof {
                        eof_pushed_for_current_file = true;
                    }
                } else if payload.is_empty() && !eof_pushed_for_current_file {
                    // Empty file: the sender SM auto-pushed the EOF frame in
                    // handle_framer_event's HeaderPhase + ACK(0) fast-path.
                    // Mark as eof-pushed so we don't re-enter this branch.
                    eof_pushed_for_current_file = true;
                }
            }
        }
    }
    panic!(
        "drive_session reached max_iter without terminating; sender state = {}",
        sender.state()
    );
}

// ===== Tests =====

#[test]
fn end_to_end_single_file() {
    let payload = pseudo_random_bytes(3000);
    let metadata = pack_metadata(&[("TEST.BIN", payload.len() as u32)]);
    let mut sender = Slide::new();
    sender.enter_send_mode(&metadata);
    let mut bot = MockReceiver::new(BotInjectMode::None);
    drive_session(&mut sender, &mut bot, &[payload.clone()], 10_000);
    assert_eq!(
        bot.received_bytes(0),
        payload.as_slice(),
        "Phase 9 SC#5: byte-identical round-trip"
    );
    assert!(bot.fin_observed(), "Bot must have observed CTRL_FIN");
    assert_eq!(sender.state(), SlideState::Done as u32);
}

#[test]
fn end_to_end_multi_file() {
    let payload_a = pseudo_random_bytes(800);
    let payload_b = pseudo_random_bytes(1500);
    let metadata = pack_metadata(&[
        ("A.BIN", payload_a.len() as u32),
        ("B.BIN", payload_b.len() as u32),
    ]);
    let mut sender = Slide::new();
    sender.enter_send_mode(&metadata);
    let mut bot = MockReceiver::new(BotInjectMode::None);
    drive_session(
        &mut sender,
        &mut bot,
        &[payload_a.clone(), payload_b.clone()],
        10_000,
    );
    assert_eq!(bot.received_bytes(0), payload_a.as_slice());
    assert_eq!(bot.received_bytes(1), payload_b.as_slice());
    assert!(bot.fin_observed());
    assert_eq!(sender.state(), SlideState::Done as u32);
}

#[test]
fn end_to_end_zero_byte_file() {
    let metadata = pack_metadata(&[("EMPTY.TXT", 0u32)]);
    let mut sender = Slide::new();
    sender.enter_send_mode(&metadata);
    let mut bot = MockReceiver::new(BotInjectMode::None);
    drive_session(&mut sender, &mut bot, &[Vec::new()], 1000);
    assert_eq!(bot.received_bytes(0), Vec::<u8>::new().as_slice());
    assert!(bot.fin_observed());
    assert_eq!(sender.state(), SlideState::Done as u32);
}

#[test]
fn nak_triggers_retransmit() {
    let payload = vec![0x42u8; 500];
    let metadata = pack_metadata(&[("R.BIN", payload.len() as u32)]);
    let mut sender = Slide::new();
    sender.enter_send_mode(&metadata);
    let mut bot = MockReceiver::new(BotInjectMode::NakOnFirstFrame);
    drive_session(&mut sender, &mut bot, &[payload.clone()], 10_000);
    // After NAK retransmit completes, byte-identical round-trip preserved.
    assert_eq!(
        bot.received_bytes(0),
        payload.as_slice(),
        "After NAK retransmit, byte-identical round-trip preserved"
    );
}

#[test]
fn mid_send_can_echoes_and_aborts() {
    let payload = vec![0xCCu8; 200];
    let metadata = pack_metadata(&[("X.BIN", payload.len() as u32)]);
    let mut sender = Slide::new();
    sender.enter_send_mode(&metadata);
    let mut bot = MockReceiver::new(BotInjectMode::CanMidStream);
    // Drive session — bot will inject CTRL_CAN after first data frame; sender
    // echoes CAN + transitions to CancelPending; drive_session terminates.
    drive_session(&mut sender, &mut bot, &[payload.clone()], 1000);
    assert_eq!(
        sender.state(),
        SlideState::CancelPending as u32,
        "D-19: inbound CTRL_CAN must transition sender to CancelPending"
    );
}

#[test]
fn fin_after_all_files_acks_session_complete() {
    let payload = pseudo_random_bytes(300);
    let metadata = pack_metadata(&[("S.BIN", payload.len() as u32)]);
    let mut sender = Slide::new();
    sender.enter_send_mode(&metadata);
    let mut bot = MockReceiver::new(BotInjectMode::None);
    drive_session(&mut sender, &mut bot, &[payload.clone()], 10_000);
    assert_eq!(sender.state(), SlideState::Done as u32);
    assert!(bot.fin_observed());
}
