// BestialiTTY Phase 9 Plan 09-04 — SLIDE-receiver mock bot.
//
// TEST-ONLY. Never imported from www/main.js or production modules.
// Loaded via page.addInitScript(MOCK_SERIAL_SLIDE_BOT) AFTER page.addInitScript(SERIAL_MOCK).
//
// Mirrors slide-rs/src/recv.rs control flow as a hand-written JS parallel
// implementation — PITFALLS §13 explicitly mandates this divergence so a
// SLIDE protocol drift in the production Rust core CANNOT be masked by a
// sympathetic bug in the mock peer. The Plan 09-01 Rust mock receiver
// (crates/bestialitty-core/tests/slide_sender.rs) is the OTHER independent
// implementation; both bots cross-validate the SLIDE wire contract.
//
// Hooks into navigator.serial._grantedPorts (installed by SERIAL_MOCK) +
// window.__mockWriterLog (push monkey-patch) + window.__mockReaderPush
// (existing Phase 5 reader-injection hook).
//
// Test-public API on window.__mockSlideBot:
//   - reset()                              — clear all state, ready for next test
//   - enable() / disable()                 — gate the bot's response generator
//   - setInjectNakOnSeq(seq)               — one-shot NAK injection at seq
//   - setInjectCanAfterFirstDataFrame()    — one-shot CAN injection after first data frame
//   - pushSlideWakeup()                    — push 7-byte ESC^SLIDE via __mockReaderPush
//   - getReceivedBytes(fileIdx)            — Array<number> of bytes received for file
//   - getReceivedFilenames()               — Array<string> of filenames received
//   - finObserved()                        — true if CTRL_FIN observed from sender
//   - framesObservedCount()                — count of complete frames parsed

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

  // ===== Bot state =====
  const bot = {
    enabled: true,
    received_files: [],          // [Uint8Array, ...]
    received_filenames: [],      // [string, ...]
    parse_buf: [],               // accumulator (Array<number> for simple splice ops)
    rdy_emitted: false,
    fin_observed: false,

    // Injection hooks (test-controlled).
    injectNakOnSeq: null,
    nak_already_injected: false,
    injectCanAfterFirstDataFrame: false,
    can_already_injected: false,
    first_data_frame_seen: false,

    framesObserved: 0,

    // ===== Test-public API =====
    reset() {
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
    },
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
    pushSlideWakeup() {
      // 7-byte ESC ^ S L I D E sequence — wakes the dispatcher.
      const wakeBytes = new Uint8Array([0x1B, 0x5E, 0x53, 0x4C, 0x49, 0x44, 0x45]);
      window.__mockReaderPush(wakeBytes);
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
  // parser. Production code never sees the patch (loaded only in Playwright).
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

  // ===== Frame parser =====
  function feedBytes(bytes) {
    for (const b of bytes) bot.parse_buf.push(b);
    drainBuf();
  }

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
})();
`;
