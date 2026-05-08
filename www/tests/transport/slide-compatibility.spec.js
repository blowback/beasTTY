// BestialiTTY Phase 11 Plan 11-01 (Wave 0) — RED-gate stubs for SLIDE
// 3-way Compatibility mode (SLIDE-35 Auto timeout chip + SLIDE-39
// Wakeup-required + Force-start branches; D-15 + D-16).
//
// Registered as `test.skip` so the suite stays green while Plans 11-02
// (chip awaiting-wakeup state + 3-second timer arm) and 11-04 (Compat
// mode dispatch wiring) land. Plan 11-05 fills the bodies; the test
// names match the `-g` filters in 11-VALIDATION.md Per-Task Verification
// Map (rows 11-05-01..11-05-06) verbatim.
//
// Sources:
//   - 11-CONTEXT.md D-15 (3-second timer counted from auto-type
//     completion; chip enters awaiting-wakeup; on timeout chip displays
//     `Z80 didn't respond.  [Retry]  [Cancel]  [Force start]`)
//   - 11-CONTEXT.md D-16 (Compatibility mode 3-way governs whether the
//     timer arms — `auto` | `wakeup-required` | `force-start`)
//   - 11-CONTEXT.md D-07 (3-way `<select>` semantics)
//   - 11-CONTEXT.md C-03 (force-start skips wakeup wait — jumps directly
//     into enterSendModeInternal)
//
// Analog: www/tests/transport/slide-recv-settings.spec.js (Settings-driven
// branching with `__pickerStub`-style timing tweaks). Plan 11-05 will use
// the new mock-bot `setWakeupDelay(ms)` (Plan 11-01 Task 2) to control
// timer-arm vs wakeup-arrival ordering.

import { test } from '@playwright/test';

test.describe('slide-compatibility — Auto timeout', () => {
    test.skip('arms 3-second timer at auto-type completion', async () => {});
    test.skip('chip transitions to awaiting-timeout text "Z80 didn\'t respond.  [Retry]  [Cancel]  [Force start]"', async () => {});
});

test.describe('slide-compatibility — Wakeup-required', () => {
    test.skip('does not arm 3-second timer in Wakeup-required mode', async () => {});
    test.skip('chip stays in awaiting-wakeup indefinitely past 5 seconds', async () => {});
});

test.describe('slide-compatibility — Force-start', () => {
    test.skip('skips wakeup wait entirely in Force-start mode', async () => {});
    test.skip('chip enters active state immediately on auto-type completion', async () => {});
});

test.describe('slide-compatibility — Retry button', () => {
    test.skip('[Retry] re-emits auto-type and restarts the 3-second timer', async () => {});
});

test.describe('slide-compatibility — Cancel button', () => {
    test.skip('[Cancel] clears pendingSendSession and hides the chip', async () => {});
});

test.describe('slide-compatibility — Force start button', () => {
    test.skip('[Force start] click jumps directly into send mode without waiting for wakeup', async () => {});
});
