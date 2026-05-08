// BestialiTTY Phase 10 Plan 10-01 (Wave 0) — receiver download path RED-gate scaffold.
//
// Filled in Wave 4 (Plan 10-04). Each test.skip locks in the spec contract;
// turning on each test becomes the GREEN gate for the corresponding requirement.
//
// Source: 10-VALIDATION.md Wave 0 Requirements + 10-RESEARCH.md
//         §"Phase Requirements → Test Map" + 10-UI-SPEC.md §"Settings — Save mode".
//
// Setup template borrowed from www/tests/transport/slide-sender.spec.js (Phase 9 P-04).
// Mock-bot extension to sender-role role lands in Plan 10-04.

import { test, expect } from '@playwright/test';
import { SERIAL_MOCK } from './mock-serial.js';

test.describe('slide-recv — anchor-click download path (toggle off, default)', () => {

    test.skip('SLIDE-18: single file -> anchor-click -> file in Downloads folder', async ({ page }) => {
        // TODO Plan 10-04: drive mock bot as sender, single file 100 bytes;
        // intercept URL.createObjectURL + assert anchor.download attribute matches CP/M name.
    });

    test.skip('SLIDE-19: multi-file batch -> 250 ms inter-file gap', async ({ page }) => {
        // TODO Plan 10-04: drive 3-file batch; assert delta between
        // consecutive URL.createObjectURL calls >= 250 ms (anchor-click throttle
        // OQ-3 anchor-click-per-file decision).
    });

    test.skip('SLIDE-20: filename verbatim from CP/M 8.3 uppercase', async ({ page }) => {
        // TODO Plan 10-04: header sends name=b"REPORT.TXT" verbatim;
        // assert anchor.download === "REPORT.TXT" (no client-side rewrite).
    });
});

test.describe('slide-recv — folder-save (toggle on)', () => {

    test.skip('SLIDE-18: showDirectoryPicker -> createWritable -> file in chosen folder', async ({ page }) => {
        // TODO Plan 10-04: stub navigator.showDirectoryPicker;
        // toggle on; drive 1-file batch; assert dirHandle.getFileHandle called with create:true.
    });
});
