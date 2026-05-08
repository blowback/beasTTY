// BestialiTTY Phase 10 Plan 10-01 (Wave 0) — mid-session re-entry + hard-fail recovery scaffold.
//
// Filled in Wave 4 (Plan 10-04). Pins SLIDE-34 (mid-session ESC^SLIDE re-entry)
// + SLIDE-29 hard-fail recovery 3-mode convergence (clean-cancel / aborted /
// torn-wire). All three convergence paths must end with the same surface:
// chip surfaces a terminal status, owner is back to 'terminal', and a fresh
// Slide can be entered for the next session.
//
// Source: 10-VALIDATION.md §"Mid-session re-entry" + 10-RESEARCH.md §Threat T-10-03.

import { test, expect } from '@playwright/test';
import { SERIAL_MOCK } from './mock-serial.js';

test.describe('slide-recv-reentry — SLIDE-34 mid-session ESC^SLIDE', () => {

    test.skip('SLIDE-34: second ESC^SLIDE during DataPhase aborts in-flight session, starts new one', async ({ page }) => {
        // TODO Plan 10-04: drive bot into DataPhase; bot emits second ESC^SLIDE
        // wakeup mid-stream; assert in-flight Slide is dropped (state -> Done OR Idle),
        // new Slide constructed, dispatcher routes the next bytes to the new instance.
        // window.__slide.__getStateForTests() before/after must show different generation IDs.
    });
});

test.describe('slide-recv-reentry — SLIDE-29 hard-fail 3-mode recovery', () => {

    test.skip('SLIDE-29: clean-cancel + aborted + torn-wire all converge to terminal-mode', async ({ page }) => {
        // TODO Plan 10-04: parameterise across 3 failure modes (clean Esc-cancel,
        // peer-CAN echo received, force_idle from 2 s no-echo timeout). For each
        // mode assert: (a) txOwner === 'terminal' after recovery, (b) chip dismisses,
        // (c) next ESC^SLIDE wakeup correctly bootstraps a fresh session
        // (no leftover state from the failed one).
    });
});
