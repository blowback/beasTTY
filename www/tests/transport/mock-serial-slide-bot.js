// BestialiTTY Phase 9/10 — SLIDE-receiver/sender mock bot.
//
// TEST-ONLY. Never imported from www/main.js or production modules.
// Loaded via page.addInitScript(MOCK_SERIAL_SLIDE_BOT) AFTER page.addInitScript(SERIAL_MOCK).
//
// Mirrors slide-rs/src/recv.rs (recv role) and slide-rs/src/send.rs (send role)
// control flow as a hand-written JS parallel implementation — PITFALLS §13
// explicitly mandates this divergence so a SLIDE protocol drift in the
// production Rust core CANNOT be masked by a sympathetic bug in the mock
// peer. The Plan 09-01 Rust mock receiver
// (crates/bestialitty-core/tests/slide_sender.rs) and Plan 10-01 Rust
// receiver corpus (slide_recv_corpus.rs) are OTHER independent
// implementations; together they form the FOUR-LEG cross-validation of the
// SLIDE wire contract (production Rust SM ↔ Rust mock receiver ↔ Rust
// recv corpus ↔ JS mock bot in BOTH roles).
//
// Hooks into navigator.serial._grantedPorts (installed by SERIAL_MOCK) +
// window.__mockWriterLog (push monkey-patch) + window.__mockReaderPush
// (existing Phase 5 reader-injection hook).
//
// Test-public API on window.__mockSlideBot:
//   - reset()                              — clear all state, ready for next test
//   - setRole('recv' | 'send')             — Plan 10-05 — switch bot role
//   - enable() / disable()                 — gate the bot's response generator
//   - setInjectNakOnSeq(seq)               — one-shot NAK injection at seq (recv role)
//   - setInjectCanAfterFirstDataFrame()    — one-shot CAN injection after first data frame (recv role)
//   - pushSlideWakeup()                    — push 7-byte ESC^SLIDE via __mockReaderPush
//   - pushSlideHostWakeup()                — alias for pushSlideWakeup (Plan 10-05 send-role usage)
//   - getReceivedBytes(fileIdx)            — Array<number> of bytes received for file (recv role)
//   - getReceivedFilenames()               — Array<string> of filenames received (recv role)
//   - finObserved()                        — true if CTRL_FIN observed from sender (recv role)
//   - framesObservedCount()                — count of complete frames parsed (recv role)
//   - queueSendFiles(files)                — Plan 10-05 — queue files for send role
//   - startSendSession()                   — Plan 10-05 — emit CTRL_RDY to drive recv handshake
//   - send                                 — Plan 10-05 — send-role state object (test introspection)

export const MOCK_SERIAL_SLIDE_BOT = `
(() => {
  if (!navigator.serial || !navigator.serial._grantedPorts) {
    console.error('[mock-slide-bot] SERIAL_MOCK must run first');
    return;
  }

  // ===== SLIDE wire constants (mirror crates/bestialitty-core/src/slide/framer.rs) =====
  const SOF      = 0x01;
  const CTRL_FIN = 0x04;
  const CTRL_ACK = 0x06;
  const CTRL_RDY = 0x11;
  const CTRL_NAK = 0x15;
  const CTRL_CAN = 0x18;

  // SLIDE wire frame size — slide-rs/protocol.rs FRAME_SIZE.
  const FRAME_SIZE = 1024;
  const WIN_SIZE = 4;

  // ===== CRC-16-CCITT mirror (slide-rs/src/protocol.rs:16-30) =====
  // Reference vector: crc16_ccitt(b"123456789") === 0x29B1 (D-04(a) non-negotiable).
  function crc16_ccitt(bytes) {
    let crc = 0xFFFF;
    for (const b of bytes) {
      crc ^= (b << 8);
      for (let i = 0; i < 8; i++) {
        if (crc & 0x8000) {
          crc = ((crc << 1) ^ 0x1021) & 0xFFFF;
        } else {
          crc = (crc << 1) & 0xFFFF;
        }
      }
    }
    return crc;
  }

  // Plan 10-05 — Phase 7 SLIDE-03 reference vector self-check. Asserting at
  // load time means a CRC drift can NEVER silently produce green tests.
  (function crcSelfTest() {
    const crc = crc16_ccitt(new TextEncoder().encode('123456789'));
    if (crc !== 0x29B1) {
      console.error('[mock-slide-bot] CRC self-test FAILED:', crc.toString(16));
      throw new Error('CRC self-test failed: expected 0x29B1, got 0x' + crc.toString(16));
    }
  })();

  // ===== Frame builders (mirror slide-rs/src/protocol.rs:33-44) =====
  // Build a SLIDE frame: SOF + SEQ + LEN_HI + LEN_LO + PAYLOAD + CRC_HI + CRC_LO.
  // CRC scope: SEQ + LEN_HI + LEN_LO + PAYLOAD (NOT including SOF) — matches
  // build_frame in slide-rs/src/protocol.rs and Phase 7 framer.rs.
  function buildSlideFrame(seq, payload) {
    const len = payload.length;
    const lenHi = (len >> 8) & 0xFF;
    const lenLo = len & 0xFF;
    const crcInput = new Uint8Array(3 + len);
    crcInput[0] = seq;
    crcInput[1] = lenHi;
    crcInput[2] = lenLo;
    crcInput.set(payload, 3);
    const crc = crc16_ccitt(crcInput);
    const frame = new Uint8Array(6 + len);
    frame[0] = SOF;
    frame[1] = seq;
    frame[2] = lenHi;
    frame[3] = lenLo;
    frame.set(payload, 4);
    frame[4 + len]     = (crc >> 8) & 0xFF;
    frame[4 + len + 1] = crc & 0xFF;
    return frame;
  }

  // Build SLIDE header frame (seq=0): payload = name bytes + 0x00 + LE u32 size.
  // Mirrors slide-rs/src/protocol.rs:47-56 build_header_frame.
  function buildSlideHeaderFrame(name, size) {
    const nameBytes = new TextEncoder().encode(name);
    const payload = new Uint8Array(nameBytes.length + 1 + 4);
    payload.set(nameBytes, 0);
    payload[nameBytes.length] = 0;     // null terminator
    const dv = new DataView(payload.buffer);
    dv.setUint32(nameBytes.length + 1, size, true /* LE */);
    return buildSlideFrame(0, payload);    // header is seq=0
  }

  // ===== Bot state =====
  const bot = {
    role: 'recv',                  // Plan 10-05 — 'recv' (Phase 9 default) | 'send' (NEW)
    enabled: true,
    received_files: [],            // [Uint8Array, ...]                    (recv role)
    received_filenames: [],        // [string, ...]                        (recv role)
    parse_buf: [],                 // accumulator (Array<number> for splice ops) (recv role)
    rdy_emitted: false,            // recv role
    fin_observed: false,           // recv role

    // Injection hooks (test-controlled, recv role).
    injectNakOnSeq: null,
    nak_already_injected: false,
    injectCanAfterFirstDataFrame: false,
    can_already_injected: false,
    first_data_frame_seen: false,

    framesObserved: 0,             // recv role

    // Plan 10-05 — send-role state.
    send: {
      queuedFiles: [],             // [{ name: string, bytes: Uint8Array }]
      currentFileIdx: 0,
      currentSeq: 1,               // data frames start at seq=1; header is seq=0
      eofSeq: 0,                   // seq of EOF marker for the current file (0 = unset)
      awaitingAck: 0,              // expected next ACK
      awaitingRetransmit: null,    // seq to rewind to on NAK
      rdyEmitted: false,
      rdyAcknowledged: false,      // BestialiTTY's enter_recv_mode echoed CTRL_RDY back
      finEmitted: false,
      sessionDone: false,

      // Test-controlled injection hooks for cancel / NAK / no-echo tests.
      injectNakOnSeq: null,
      injectCanAfterFirstDataFrame: false,
      injectNoEchoOnCancel: false,
      // Plan 10-05 cancel-tests — when set, the bot stops shipping data
      // windows after the first one so the receiver SM stays mid-DataPhase
      // long enough for a Playwright poll to observe + a cancel to fire.
      // Set externally between startSendSession() and the cancel.
      pauseAfterFirstWindow: false,
      _firstWindowShipped: false,

      // Plan 11-01 Task 2 — async wakeup delay for Compatibility-mode timeout
      // tests. Default 0 preserves Phase 9/10 synchronous-wakeup behavior.
      // Plan 11-05 sets values < 5000 ms via setWakeupDelay(ms) to drive the
      // 3-second wakeup-timeout chip (SLIDE-35 / D-15) on miss.
      wakeupDelayMs: 0,
    },

    // ===== Test-public API =====
    reset() {
      bot.role = 'recv';
      bot.enabled = true;
      bot.received_files = [];
      bot.received_filenames = [];
      bot.parse_buf = [];
      bot.rdy_emitted = false;
      bot.fin_observed = false;
      bot.injectNakOnSeq = null;
      bot.nak_already_injected = false;
      bot.injectCanAfterFirstDataFrame = false;
      bot.can_already_injected = false;
      bot.first_data_frame_seen = false;
      bot.framesObserved = 0;
      // Plan 10-05 — also clear send-role state.
      bot.send.queuedFiles = [];
      bot.send.currentFileIdx = 0;
      bot.send.currentSeq = 1;
      bot.send.eofSeq = 0;
      bot.send.awaitingAck = 0;
      bot.send.awaitingRetransmit = null;
      bot.send.rdyEmitted = false;
      bot.send.rdyAcknowledged = false;
      bot.send.finEmitted = false;
      bot.send.sessionDone = false;
      bot.send.injectNakOnSeq = null;
      bot.send.injectCanAfterFirstDataFrame = false;
      bot.send.injectNoEchoOnCancel = false;
      bot.send.pauseAfterFirstWindow = false;
      bot.send._firstWindowShipped = false;
      // Plan 11-01 Task 2 — clear wakeup delay so test isolation is preserved.
      bot.send.wakeupDelayMs = 0;
      sendInboundBuf.length = 0;
    },
    setRole(r) { bot.role = r; },
    enable()  { bot.enabled = true; },
    disable() { bot.enabled = false; },
    setInjectNakOnSeq(seq) {
      bot.injectNakOnSeq = seq;
      bot.nak_already_injected = false;
    },
    setInjectCanAfterFirstDataFrame() {
      bot.injectCanAfterFirstDataFrame = true;
      bot.can_already_injected = false;
    },
    // Plan 11-01 Task 2 — defer the host-side wakeup signature by N ms so the
    // 3-second SLIDE-35 / D-15 wakeup-timeout chip can be exercised. Applies
    // only to pushSlideHostWakeup (send-direction); pushSlideWakeup (recv role)
    // is unaffected. Default 0 preserves Phase 9/10 synchronous behavior so
    // existing tests are not impacted (D-09 / D-15 plan-locked).
    setWakeupDelay(ms) { bot.send.wakeupDelayMs = ms | 0; },
    pushSlideWakeup() {
      // 7-byte ESC ^ S L I D E sequence — wakes the dispatcher.
      const wakeBytes = new Uint8Array([0x1B, 0x5E, 0x53, 0x4C, 0x49, 0x44, 0x45]);
      window.__mockReaderPush(wakeBytes);
    },
    pushSlideHostWakeup() {
      // Plan 10-05 send-role alias — same 7-byte signature drives BestialiTTY
      // into recv mode when the bot is acting as the sender (Z80 → PC).
      // Plan 11-01 Task 2 — when bot.send.wakeupDelayMs > 0, defer the push
      // by that many milliseconds so Plan 11-05 timeout-chip tests can drive
      // the auto-type → 3 s timeout → "Z80 didn't respond" UI flow without
      // a real-hardware Z80.
      const wakeBytes = new Uint8Array([0x1B, 0x5E, 0x53, 0x4C, 0x49, 0x44, 0x45]);
      if (bot.send.wakeupDelayMs > 0) {
        setTimeout(() => window.__mockReaderPush(wakeBytes), bot.send.wakeupDelayMs);
      } else {
        window.__mockReaderPush(wakeBytes);
      }
    },
    queueSendFiles(files) {
      bot.send.queuedFiles = files.map((f) => ({
        name: f.name,
        bytes: f.bytes instanceof Uint8Array ? f.bytes : new Uint8Array(f.bytes),
      }));
      bot.send.currentFileIdx = 0;
      bot.send.currentSeq = 1;
      bot.send.eofSeq = 0;
    },
    startSendSession() {
      // Plan 10-05 — emit CTRL_RDY to wake BestialiTTY's recv handshake.
      // (BestialiTTY's enter_recv_mode is triggered by the wakeup matcher
      //  in dispatchTerminalMode; CTRL_RDY here arrives AFTER the wakeup
      //  has put us in recv mode.)
      window.__mockReaderPush(new Uint8Array([CTRL_RDY]));
      bot.send.rdyEmitted = true;
    },
    getReceivedBytes(fileIdx) {
      return bot.received_files[fileIdx] ? Array.from(bot.received_files[fileIdx]) : null;
    },
    getReceivedFilenames() {
      return bot.received_filenames.slice();
    },
    finObserved() { return bot.fin_observed; },
    framesObservedCount() { return bot.framesObserved; },
  };
  window.__mockSlideBot = bot;

  // ===== Hook into the writer log =====
  // SERIAL_MOCK's MockWriter.write pushes every entry into __mockWriterLog.
  // We piggyback by monkey-patching Array.prototype.push on the log array;
  // whenever the page writes bytes, we feed them through the bot's frame
  // parser (recv role) or sender-role inbound parser. Production code never
  // sees the patch (loaded only in Playwright).
  //
  // NOTE: tx-sink.spec.js / dispatcher tests sometimes assign window.__mockWriterLog = [];
  // to clear the log between tests. That replaces the array reference, which
  // breaks our push-patch. Re-install the patch via a setter trap so any
  // reassignment of __mockWriterLog re-applies the bot hook.
  function installLogHook(log) {
    if (!log || log._slideBotPatched) return log;
    const origPush = Array.prototype.push.bind(log);
    log.push = function(entry) {
      const r = origPush(entry);
      try {
        if (bot.enabled && entry && entry.bytes) {
          const arr = entry.bytes instanceof Uint8Array
              ? entry.bytes
              : new Uint8Array(entry.bytes);
          feedBytes(arr);
        }
      } catch (err) {
        console.error('[mock-slide-bot] feedBytes error:', err);
      }
      return r;
    };
    log._slideBotPatched = true;
    return log;
  }

  // Install on the existing log; re-install on reassignment.
  let _logRef = window.__mockWriterLog || [];
  installLogHook(_logRef);
  window.__mockWriterLog = _logRef;
  Object.defineProperty(window, '__mockWriterLog', {
    configurable: true,
    get() { return _logRef; },
    set(v) { _logRef = installLogHook(v || []); },
  });

  // ===== Top-level inbound-byte router (role gate) =====
  function feedBytes(bytes) {
    if (bot.role === 'send') {
      for (const b of bytes) onInboundByteSendRole(b);
      return;
    }
    // 'recv' role (default — Phase 9 receiver-role bot behavior).
    for (const b of bytes) bot.parse_buf.push(b);
    drainBuf();
  }

  // ===== Recv-role frame parser (Phase 9 default — UNCHANGED behavior) =====

  function drainBuf() {
    while (bot.parse_buf.length > 0) {
      const head = bot.parse_buf[0];

      // Sender's first push is CTRL_RDY — bot emits RDY echo + strips it.
      if (!bot.rdy_emitted && head === CTRL_RDY) {
        bot.parse_buf.shift();
        bot.rdy_emitted = true;
        window.__mockReaderPush(new Uint8Array([CTRL_RDY]));
        continue;
      }

      // Subsequent CTRL_RDY (e.g., re-sync) — silently consume.
      if (head === CTRL_RDY) {
        bot.parse_buf.shift();
        continue;
      }

      // CTRL_FIN: sender end-of-session.
      if (head === CTRL_FIN) {
        bot.parse_buf.shift();
        bot.fin_observed = true;
        window.__mockReaderPush(new Uint8Array([CTRL_FIN]));
        continue;
      }

      // CTRL_CAN echo from sender (D-19 bidirectional).
      if (head === CTRL_CAN) {
        bot.parse_buf.shift();
        continue;
      }

      // SOF: try to parse a complete frame.
      if (head === SOF) {
        if (bot.parse_buf.length < 4) return;   // need SOF + SEQ + LEN_HI + LEN_LO
        const seq = bot.parse_buf[1];
        const len = (bot.parse_buf[2] << 8) | bot.parse_buf[3];
        const totalFrameLen = 4 + len + 2;
        if (bot.parse_buf.length < totalFrameLen) return;   // wait for more bytes

        const payload = bot.parse_buf.slice(4, 4 + len);
        const crcHi = bot.parse_buf[4 + len];
        const crcLo = bot.parse_buf[4 + len + 1];

        // CRC verify mirror (slide-rs/protocol.rs build_frame uses
        // [seq, len_hi, len_lo, ...payload] as CRC input).
        const crcInput = [seq, (len >> 8) & 0xFF, len & 0xFF, ...payload];
        const expectedCrc = crc16_ccitt(crcInput);
        const observedCrc = (crcHi << 8) | crcLo;
        if (expectedCrc !== observedCrc) {
          // Bot rejects the frame with CTRL_NAK — sender SM is the SUT for
          // CRC correctness; this branch fires only if drift exists.
          window.__mockReaderPush(new Uint8Array([CTRL_NAK, seq]));
          bot.parse_buf.splice(0, totalFrameLen);
          continue;
        }

        bot.parse_buf.splice(0, totalFrameLen);
        bot.framesObserved += 1;
        handleFrame(seq, payload);
        continue;
      }

      // Unknown byte — skip (defensive; should not happen in normal flow).
      console.warn('[mock-slide-bot] unexpected byte:', head.toString(16));
      bot.parse_buf.shift();
    }
  }

  function handleFrame(seq, payload) {
    // NAK injection (one-shot).
    if (bot.injectNakOnSeq !== null && !bot.nak_already_injected && seq === bot.injectNakOnSeq) {
      bot.nak_already_injected = true;
      window.__mockReaderPush(new Uint8Array([CTRL_NAK, seq]));
      return;
    }

    if (seq === 0) {
      // Header frame: payload = [name bytes ... 0x00 LE_size_u32 (4 bytes)]
      const nullPos = payload.indexOf(0);
      if (nullPos < 0) {
        // Malformed — ACK anyway to avoid stalling the test, but log.
        console.warn('[mock-slide-bot] header missing null terminator');
        window.__mockReaderPush(new Uint8Array([CTRL_ACK, 0]));
        return;
      }
      const nameBytes = payload.slice(0, nullPos);
      const name = String.fromCharCode(...nameBytes);
      bot.received_filenames.push(name);
      bot.received_files.push(new Uint8Array(0));
      window.__mockReaderPush(new Uint8Array([CTRL_ACK, 0]));
      return;
    }

    // Data frame.
    bot.first_data_frame_seen = true;

    // CAN injection (one-shot, after first data frame).
    if (bot.injectCanAfterFirstDataFrame && !bot.can_already_injected) {
      bot.can_already_injected = true;
      window.__mockReaderPush(new Uint8Array([CTRL_CAN]));
      return;
    }

    if (payload.length === 0) {
      // EOF marker — current file complete; ACK the EOF seq.
      window.__mockReaderPush(new Uint8Array([CTRL_ACK, seq]));
      return;
    }

    // Append payload to current file.
    const cur = bot.received_files[bot.received_files.length - 1];
    const next = new Uint8Array(cur.length + payload.length);
    next.set(cur, 0);
    next.set(payload, cur.length);
    bot.received_files[bot.received_files.length - 1] = next;
    window.__mockReaderPush(new Uint8Array([CTRL_ACK, seq]));
  }

  // ===== Send-role inbound parser + dispatch (Plan 10-05) =====
  //
  // BestialiTTY's recv-mode outbound bytes (which the bot interprets as
  // "inbound" from its sender perspective) are SLIDE control bytes — the
  // PC echoes CTRL_RDY on enter_recv_mode + CTRL_ACK/seq per frame +
  // CTRL_NAK/seq on CRC error + CTRL_CAN on cancel + CTRL_FIN on end of
  // session. This parser drives the sender state machine (mirrors
  // slide-rs/src/send.rs:155-249 algorithmically — PITFALLS §13 fourth
  // independent reimplementation).

  let sendInboundBuf = [];

  function onInboundByteSendRole(b) {
    sendInboundBuf.push(b);

    // CTRL_RDY (single byte) — BestialiTTY echoed our RDY (handshake
    // complete; ship the first header).
    if (b === CTRL_RDY && sendInboundBuf.length === 1) {
      bot.send.rdyAcknowledged = true;
      sendInboundBuf.length = 0;
      shipNextHeader();
      return;
    }
    // CTRL_FIN echo (single byte 0x04) — session done.
    if (b === CTRL_FIN && sendInboundBuf.length === 1 && bot.send.finEmitted) {
      bot.send.sessionDone = true;
      sendInboundBuf.length = 0;
      return;
    }
    // CTRL_CAN echo (single byte 0x18) — bot echoes back unless inject says no.
    if (b === CTRL_CAN && sendInboundBuf.length === 1) {
      if (!bot.send.injectNoEchoOnCancel) {
        // Echo CTRL_CAN back to settle BestialiTTY's CancelPending.
        window.__mockReaderPush(new Uint8Array([CTRL_CAN]));
      }
      sendInboundBuf.length = 0;
      return;
    }
    // CTRL_ACK + seq (2 bytes).
    if (sendInboundBuf.length === 2 && sendInboundBuf[0] === CTRL_ACK) {
      const ackedSeq = sendInboundBuf[1];
      sendInboundBuf.length = 0;
      handleAck(ackedSeq);
      return;
    }
    // CTRL_NAK + seq (2 bytes).
    if (sendInboundBuf.length === 2 && sendInboundBuf[0] === CTRL_NAK) {
      const nakedSeq = sendInboundBuf[1];
      sendInboundBuf.length = 0;
      handleNak(nakedSeq);
      return;
    }
    // Drop any byte beyond a 2-byte pair (defensive — recv mode shouldn't
    // push other control bytes).
    if (sendInboundBuf.length > 2) sendInboundBuf.length = 0;
  }

  function shipNextHeader() {
    const idx = bot.send.currentFileIdx;
    if (idx >= bot.send.queuedFiles.length) {
      // No more files — emit CTRL_FIN.
      window.__mockReaderPush(new Uint8Array([CTRL_FIN]));
      bot.send.finEmitted = true;
      return;
    }
    const file = bot.send.queuedFiles[idx];
    const headerFrame = buildSlideHeaderFrame(file.name, file.bytes.length);
    window.__mockReaderPush(headerFrame);
    bot.send.currentSeq = 1;
    bot.send.eofSeq = 0;
  }

  function handleAck(seq) {
    const file = bot.send.queuedFiles[bot.send.currentFileIdx];
    if (!file) return;
    if (seq === 0) {
      // Header acked — start data phase (or immediate EOF for empty file).
      if (file.bytes.length === 0) {
        // SLIDE-21 zero-byte file — immediate EOF marker at seq=1.
        const eof = buildSlideFrame(1, new Uint8Array(0));
        window.__mockReaderPush(eof);
        bot.send.eofSeq = 1;
        bot.send.currentSeq = 2;
      } else {
        shipDataWindow(1);
      }
      return;
    }
    if (bot.send.eofSeq !== 0 && seq === bot.send.eofSeq) {
      // EOF acked — advance to next file or FIN.
      bot.send.currentFileIdx += 1;
      shipNextHeader();
      return;
    }
    // Window-boundary ACK — ship next 4 frames or EOF.
    // Plan 10-05 cancel-tests — pauseAfterFirstWindow stops the bot from
    // shipping the next window so the receiver SM stays mid-DataPhase long
    // enough for the test to observe state + fire a cancel.
    if (bot.send.pauseAfterFirstWindow && bot.send._firstWindowShipped) {
      return;
    }
    shipDataWindow(seq + 1);
  }

  function shipDataWindow(startSeq) {
    const file = bot.send.queuedFiles[bot.send.currentFileIdx];
    const totalDataFrames = Math.ceil(file.bytes.length / FRAME_SIZE);
    for (let i = 0; i < WIN_SIZE; i++) {
      const seq = startSeq + i;
      const frameIdx = seq - 1;   // seq=1 → first data frame
      if (frameIdx >= totalDataFrames) {
        // EOF marker.
        const eof = buildSlideFrame(seq, new Uint8Array(0));
        window.__mockReaderPush(eof);
        bot.send.eofSeq = seq;
        return;
      }
      const start = frameIdx * FRAME_SIZE;
      const end = Math.min(start + FRAME_SIZE, file.bytes.length);
      const chunk = file.bytes.subarray(start, end);
      const dataFrame = buildSlideFrame(seq, chunk);
      window.__mockReaderPush(dataFrame);
      // CAN injection hook (cancel mid-frame test).
      if (bot.send.injectCanAfterFirstDataFrame && seq === startSeq) {
        window.__mockReaderPush(new Uint8Array([CTRL_CAN]));
        bot.send.injectCanAfterFirstDataFrame = false;
        return;
      }
      // NAK injection hook — note the bot does not push the NAK; the
      // test sets up the NAK via the receiver SM's CRC-error path.
      if (bot.send.injectNakOnSeq !== null && seq === bot.send.injectNakOnSeq) {
        bot.send.injectNakOnSeq = null;
      }
    }
    bot.send.currentSeq = startSeq + WIN_SIZE;
    // Plan 10-05 cancel-tests — flag that the first window has shipped so
    // the next window-boundary ACK can be paused via pauseAfterFirstWindow.
    bot.send._firstWindowShipped = true;
  }

  function handleNak(seq) {
    // Rewind to seq and re-ship the window starting at seq.
    bot.send.awaitingRetransmit = seq;
    shipDataWindow(seq);
  }
})();
`;
