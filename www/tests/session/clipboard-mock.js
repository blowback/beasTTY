// Beastty Phase 6 Plan 01 (Wave 0) — Clipboard mock fixture.
//
// TEST-ONLY. Mirrors www/tests/transport/mock-serial.js shape (Phase 5 D-40).
// The exported CLIPBOARD_MOCK string is passed to page.addInitScript() so the
// IIFE runs in the page context BEFORE any module loads — replaces
// navigator.clipboard with a controllable mock.
//
// Sources:
//   - 06-PATTERNS.md §"www/tests/session/clipboard-mock.js" (verbatim CLIPBOARD_MOCK).
//   - 06-CONTEXT.md D-21..D-25 (clipboard contract).
//
// Test hooks exposed on window:
//   - window.__setClipboardContents(text) — pre-populate clipboard for paste tests.
//   - window.__getClipboardContents() — read clipboard for copy assertions.
//   - window.__mockClipboardLog — array of { op, payload, ts } per call.
export const CLIPBOARD_MOCK = `
(() => {
  window.__clipboardContents = '';
  window.__mockClipboardLog = [];
  const mock = {
    async writeText(text) {
      window.__mockClipboardLog.push({ op: 'writeText', payload: text, ts: performance.now() });
      window.__clipboardContents = String(text);
    },
    async readText() {
      window.__mockClipboardLog.push({ op: 'readText', payload: null, ts: performance.now() });
      return window.__clipboardContents;
    },
  };
  Object.defineProperty(navigator, 'clipboard', { value: mock, configurable: true });
  window.__setClipboardContents = (text) => { window.__clipboardContents = String(text); };
  window.__getClipboardContents = () => window.__clipboardContents;
})();`;
