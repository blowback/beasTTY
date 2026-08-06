// Beastty Phase 5 Plan 01 (Wave 0) — Web Serial mock fixture.
//
// TEST-ONLY. Never imported from www/main.js or any production module.
// The exported SERIAL_MOCK string is passed to `page.addInitScript()` so the
// IIFE runs in the page context BEFORE any module loads — this is how the
// mock replaces `navigator.serial` before main.js's polite-fail gate evaluates.
//
// Sources:
//   - 05-CONTEXT.md D-40..D-42 (mock + simulateUnplug/simulateReplug hooks).
//   - 05-RESEARCH.md Pattern 7 (lines 696-803) — full mock implementation.
//   - 05-PATTERNS.md §"www/tests/transport/mock-serial.js" — __-prefix hook convention
//     matches the existing window.__testGridView precedent at main.js:55-64.
//
// Test hooks exposed on window:
//   - window.__simulateUnplug()  — dispatches 'disconnect' on navigator.serial.
//   - window.__simulateReplug()  — dispatches 'connect' on navigator.serial.
//   - window.__mockReaderPush(bytes) — simulates bytes arriving via reader.read().
//   - window.__mockWriterLog     — array of { bytes, ts } recording every writer.write.
//   - window.__mockLockLog       — Plan 05-08 — array of { op, ts } recording
//                                  reader.cancel / reader.releaseLock /
//                                  writer.releaseLock / port.close. Used by
//                                  lifecycle.spec.js to assert the close-contract
//                                  ordering (release-before-close) during the
//                                  beforeunload tear-down path.
//
// Spec introspection:
//   - navigator.serial._grantedPorts[0]._config   — last config passed to port.open().
//   - navigator.serial._grantedPorts[0]._lastSignals — last DTR/RTS signals set.

export const SERIAL_MOCK = `
(() => {
  // Default device info — VID/PID matches MicroBeast CP2102N (D-02).
  const DEFAULT_INFO = { usbVendorId: 0x10c4, usbProductId: 0xea60 };

  // Module-scope state on window for spec introspection.
  window.__mockWriterLog = [];   // records { bytes: number[], ts: number } per write
  window.__mockLockLog   = [];   // Plan 05-08 — records { op, ts } for releaseLock + close ordering specs
  window.__mockState     = { opened: false, port: null, listeners: {} };

  class MockReader {
    constructor(port) {
      this.port = port;
      this.pending = [];     // queued chunks pushed before a read is pending
      this.cancelled = false;
      this.waiter = null;    // promise resolver when read() is awaiting
    }
    async read() {
      if (this.cancelled) return { value: undefined, done: true };
      if (this.pending.length > 0) return { value: this.pending.shift(), done: false };
      return new Promise((resolve) => { this.waiter = resolve; });
    }
    async cancel() {
      window.__mockLockLog.push({ op: 'reader-cancel', ts: performance.now() });
      this.cancelled = true;
      if (this.waiter) { this.waiter({ value: undefined, done: true }); this.waiter = null; }
    }
    releaseLock() {
      window.__mockLockLog.push({ op: 'reader-release', ts: performance.now() });
    }
  }

  class MockWriter {
    constructor(port) { this.port = port; }
    async write(bytes) {
      window.__mockWriterLog.push({ bytes: Array.from(bytes), ts: performance.now() });
      return undefined;
    }
    releaseLock() {
      window.__mockLockLog.push({ op: 'writer-release', ts: performance.now() });
    }
  }

  class MockSerialPort extends EventTarget {
    constructor(info = DEFAULT_INFO) {
      super();
      this._info = info;
      this._opened = false;
      this._reader = null;
      this._writer = null;
      this.readable = null;
      this.writable = null;
      this.connected = true;
    }
    getInfo() { return { ...this._info }; }
    async open(config) {
      // Web Serial spec — open() on a port that is not closed rejects
      // InvalidStateError. Modelled here because the half-open rollback review fix
      // turns on exactly this: a port left open by a failed setSignals() makes the
      // NEXT open() reject with a name isPortInUse() reads as "another tab".
      if (this._opened) {
        const e = new Error("Failed to execute 'open' on 'SerialPort': The port is already open.");
        e.name = 'InvalidStateError';
        throw e;
      }
      this._opened = true;
      this._config = config;
      const reader = new MockReader(this);
      const writer = new MockWriter(this);
      this._reader = reader;
      this._writer = writer;
      this.readable = { getReader: () => reader };
      this.writable = { getWriter: () => writer };
    }
    async close() {
      window.__mockLockLog.push({ op: 'close', ts: performance.now() });
      this._opened = false;
      this.readable = null;
      this.writable = null;
    }
    // __forceSetSignalsReject — when set on window to a { name, message } shape,
    // setSignals() rejects with a DOMException-shaped error. Exercises the
    // open-succeeded-then-a-later-step-threw paths, which are the only way the port
    // can be left open with nothing referencing it.
    async setSignals(s) {
      const shape = window.__forceSetSignalsReject;
      if (shape && this._opened) {
        const e = new Error(shape.message);
        e.name = shape.name;
        throw e;
      }
      this._lastSignals = s;
    }
    async getSignals() {
      return { dataCarrierDetect: false, clearToSend: true, ringIndicator: false, dataSetReady: true };
    }
    async forget() {}
  }

  class MockSerial extends EventTarget {
    constructor() {
      super();
      this._grantedPorts = [];
    }
    async requestPort(opts) {
      // D-02 — CP2102N filter; mock returns a port with MicroBeast VID/PID.
      const p = new MockSerialPort(DEFAULT_INFO);
      this._grantedPorts.push(p);
      return p;
    }
    async getPorts() { return [...this._grantedPorts]; }
  }

  const serial = new MockSerial();
  Object.defineProperty(navigator, 'serial', { value: serial, configurable: true });

  // Phase 6 Plan 06 (Wave 5) — auto-connect.spec.js test hooks.
  //
  // __preGrantPort     — when set on window before SERIAL_MOCK installs, seed
  //                      one MockSerialPort into _grantedPorts so navigator.serial
  //                      .getPorts() returns a match at boot (auto-connect path
  //                      depends on a previously-granted port being discoverable).
  // __preGrantPortCount — E11 S11.1 (AC-7). Set to N before SERIAL_MOCK installs
  //                      to seed N identical CP2102N ports, so the boot getPorts()
  //                      scan sees an ambiguous match with no hardware. OPT-IN and
  //                      unset by default, and that is deliberate: 30+ transport
  //                      specs index _grantedPorts[0] while __simulateUnplug /
  //                      __simulateReplug / __mockReaderPush all target
  //                      _grantedPorts[length - 1]. With one port those are the
  //                      same object; with two they are not, so raising the default
  //                      grant count would silently re-point every one of those
  //                      hooks at a different port. Takes precedence over
  //                      __preGrantPort, which is the N = 1 case.
  //                      In a two-port spec, say which port you mean: [0] and
  //                      "the last one" are no longer the same object.
  // __forceOpenReject  — when set on window to a string message, override
  //                      MockSerialPort.prototype.open to reject with that
  //                      message. Used by the open-reject branch test.
  // __mockOpenCount    — incremented on every successful open(). Used by the
  //                      Pitfall 3 race-guard regression to assert <= 1.
  window.__mockOpenCount = 0;
  const preGrantCount = (Number.isInteger(window.__preGrantPortCount) && window.__preGrantPortCount > 0)
    ? window.__preGrantPortCount
    : (window.__preGrantPort ? 1 : 0);
  for (let i = 0; i < preGrantCount; i++) {
    serial._grantedPorts.push(new MockSerialPort(DEFAULT_INFO));
  }
  const _origOpen = MockSerialPort.prototype.open;
  MockSerialPort.prototype.open = async function (config) {
    if (typeof window.__forceOpenReject === 'string') {
      throw new Error(window.__forceOpenReject);
    }
    window.__mockOpenCount++;
    return _origOpen.call(this, config);
  };

  // Test hooks — D-42.
  window.__simulateUnplug = () => {
    // Dispatch 'disconnect' on navigator.serial. event.target = the port that went away.
    const port = serial._grantedPorts[serial._grantedPorts.length - 1];
    if (!port) return;
    port.connected = false;
    port.readable = null;  // WICG: fatal error sets port.readable to null.
    const ev = new Event('disconnect', { bubbles: true });
    Object.defineProperty(ev, 'target', { value: port });
    serial.dispatchEvent(ev);
    // Also resolve any pending read() with done:true (simulates cancel-on-unplug).
    if (port._reader && port._reader.waiter) {
      port._reader.waiter({ value: undefined, done: true });
      port._reader.waiter = null;
    }
  };

  window.__simulateReplug = () => {
    // Dispatch 'connect' on navigator.serial.
    const port = serial._grantedPorts[serial._grantedPorts.length - 1];
    if (!port) return;
    port.connected = true;
    const ev = new Event('connect', { bubbles: true });
    Object.defineProperty(ev, 'target', { value: port });
    serial.dispatchEvent(ev);
  };

  window.__mockReaderPush = (bytes) => {
    // Simulates MicroBeast writing bytes to the wire. Delivered via resolved read().
    const port = serial._grantedPorts[serial._grantedPorts.length - 1];
    if (!port || !port._reader) return;
    const chunk = new Uint8Array(bytes);
    if (port._reader.waiter) {
      port._reader.waiter({ value: chunk, done: false });
      port._reader.waiter = null;
    } else {
      port._reader.pending.push(chunk);
    }
  };
})();`;
