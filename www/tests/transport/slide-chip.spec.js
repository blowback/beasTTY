// BestialiTTY Phase 11 Plan 11-01 (Wave 0) — RED-gate stubs for SLIDE chip
// lifecycle (SLIDE-25 active layout, SLIDE-26 throughput auto-scaled units +
// 2 s sliding window, SLIDE-28 cancelled-summary chip).
//
// These tests are intentionally registered as `test.skip` so the suite stays
// green while Plans 11-02 (chip module + DOM) and 11-05 (verification gate)
// are still in flight. Plan 11-05 fills the bodies; the test names below
// match the `-g` filters in 11-VALIDATION.md Per-Task Verification Map
// (rows 11-02-01 / 11-02-02 / 11-02-03) verbatim so the per-task grep
// resolves to the stubs registered here once they go live.
//
// Sources:
//   - 11-CONTEXT.md D-01 (single-line dense chip layout — token order
//     `↑ MY-DOC.TXT  2/3  47%  482 KB  12.3 KB/s  [Cancel]`)
//   - 11-CONTEXT.md D-02 (throughput first-2-s `—` + auto-scaled units
//     B/s / KB/s / MB/s on a 2-second sliding sample window)
//   - 11-CONTEXT.md D-03 (CP/M 8.3 filename verbatim — no truncation)
//   - 11-CONTEXT.md D-04 (`[Cancel]` button hand-off to cancelSlideRecv)
//   - 11-CONTEXT.md D-08 (SLIDE-28 cancelled-summary chip ALWAYS shows
//     for 5 s on cancel regardless of slideShowSummary checkbox state)
//
// Analog: www/tests/transport/slide-cancel.spec.js (mock-bot setup +
// commonReset + ctrlCanInWriterLog + enterMidStream pattern). Plan 11-05
// will copy the helpers in verbatim.

import { test } from '@playwright/test';

test.describe('slide-chip — active layout', () => {
    test.skip('renders single-line dense layout with all six tokens', async () => {});
    test.skip('direction arrow swaps to ↓ in recv mode', async () => {});
    test.skip('preserves CP/M 8.3 filename verbatim from header frame', async () => {});
    test.skip('inline [Cancel] click hands off to cancelSlideRecv', async () => {});
});

test.describe('slide-chip — throughput', () => {
    test.skip('shows two-em-dash separator before first 2 seconds elapse', async () => {});
    test.skip('switches to auto-scaled B/s under 1 KB/s', async () => {});
    test.skip('renders 12.3 KB/s with one decimal place between 1 and 999 KB/s', async () => {});
    test.skip('renders 1.4 MB/s when sustained throughput exceeds 1 MB/s', async () => {});
    test.skip('uses a 2-second sliding sample window for throughput averaging', async () => {});
});

test.describe('slide-chip — cancelled summary', () => {
    test.skip('shows "Cancelled — N of M files transferred" for 5 seconds after cancel', async () => {});
    test.skip('summary chip surfaces regardless of slideShowSummary checkbox state', async () => {});
});
