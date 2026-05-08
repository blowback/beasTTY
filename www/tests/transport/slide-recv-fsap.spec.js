// BestialiTTY Phase 10 Plan 10-01 (Wave 0) — File System Access Picker scaffold.
//
// Filled in Wave 4 (Plan 10-04). Pins the showDirectoryPicker / createWritable
// path including the ~N collision suffix retry (up to ~999) per CP/M file-name
// collision avoidance behaviour preserved across SLIDE downloads.
//
// Source: 10-RESEARCH.md §"showDirectoryPicker handle persistence" +
//         §"~N collision retry" + 10-UI-SPEC.md §"Save mode".

import { test, expect } from '@playwright/test';
import { SERIAL_MOCK } from './mock-serial.js';

test.describe('slide-recv-fsap — showDirectoryPicker integration', () => {

    test.skip('FSAP: createWritable.write(blob) called with full payload; close() invoked once', async ({ page }) => {
        // TODO Plan 10-04: stub showDirectoryPicker -> dirHandle;
        // dirHandle.getFileHandle(name, {create:true}) -> fileHandle;
        // fileHandle.createWritable() -> writable; assert writable.write called
        // with the received bytes (Uint8Array) and writable.close called exactly once.
    });
});

test.describe('slide-recv-fsap — ~N collision suffix retry', () => {

    test.skip('Collision: existing REPORT.TXT -> writes REPORT.TXT~1 (up to ~999)', async ({ page }) => {
        // TODO Plan 10-04: stub dirHandle.getFileHandle to throw on first call
        // (simulating "file exists; CP/M-style overwrite-protect"); assert the
        // retry loop tries name~1, then name~2, etc., up to a documented cap (999);
        // assert final filename matches expected pattern.
    });
});
