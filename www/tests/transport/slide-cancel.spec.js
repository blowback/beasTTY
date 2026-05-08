// BestialiTTY Phase 10 Plan 10-01 (Wave 0) — Esc-cancel + force_idle escape hatch RED-gate scaffold.
//
// Filled in Wave 4 (Plan 10-04). Locks in the cancel-window contract from
// ADR-003 (v0.2.1 CAN amendment) + 10-PATTERNS.md §"Esc-cancel slot".
//
// Source: 10-VALIDATION.md Wave 0 Requirements + ADR-003.

import { test, expect } from '@playwright/test';
import { SERIAL_MOCK } from './mock-serial.js';

test.describe('slide-cancel — Esc-cancel slot (D-05/D-06/D-07)', () => {

    test.skip('SLIDE-29: Esc during DataPhase -> CTRL_CAN echo within 200 ms (slot 2)', async ({ page }) => {
        // TODO Plan 10-04: drive bot into DataPhase mid-stream; press Esc;
        // assert __mockWriterLog last byte is 0x18 (CTRL_CAN); assert state == CancelPending
        // within 200 ms.
    });

    test.skip('SLIDE-29: peer CAN echo within 500 ms -> Done', async ({ page }) => {
        // TODO Plan 10-04: after PC-side CAN, mock bot echoes CAN within 500 ms;
        // assert state transitions to Done; chip surfaces "cancelled" copy.
    });

    test.skip('SLIDE-29: force_idle escape hatch after 2 s no-echo timeout', async ({ page }) => {
        // TODO Plan 10-04: drive PC-side CAN; mock bot withholds echo;
        // wait > 2 s; assert force_idle transition to Done without peer ack;
        // chip surfaces "timed out — session forcibly ended" copy
        // (D-06 escape hatch + 10-UI-SPEC.md §Cancel UX).
    });

    test.skip('SLIDE-29: cancel idempotent — double-press Esc emits one CAN', async ({ page }) => {
        // TODO Plan 10-04: press Esc twice within 100 ms;
        // assert __mockWriterLog contains exactly ONE 0x18 byte
        // (D-06 idempotent contract; mirrors Rust state.rs:cancel_idempotent test).
    });
});
