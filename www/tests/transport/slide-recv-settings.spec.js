// BestialiTTY Phase 10 Plan 10-01 (Wave 0) — Settings save-mode toggle + persistence scaffold.
//
// Filled in Wave 4 (Plan 10-04). Pins the Settings → "Save received files to..."
// row state machine: (off, default) anchor-click; (on) showDirectoryPicker.
// Persistence: IndexedDB stores the dirHandle across reloads with permission
// re-request on demand.
//
// Source: 10-UI-SPEC.md §Settings + 10-RESEARCH.md §"showDirectoryPicker handle persistence".

import { test, expect } from '@playwright/test';
import { SERIAL_MOCK } from './mock-serial.js';

test.describe('slide-recv-settings — toggle row state machine', () => {

    test.skip('Toggle on: showDirectoryPicker invoked; folder name displayed in row subtitle', async ({ page }) => {
        // TODO Plan 10-04: stub navigator.showDirectoryPicker -> { name: 'Downloads/SLIDE' };
        // click the toggle row; assert showDirectoryPicker called once;
        // assert the row subtitle text === 'Saving to: Downloads/SLIDE'.
    });
});

test.describe('slide-recv-settings — IndexedDB persistence', () => {

    test.skip('Reload: stored dirHandle round-trips; permission re-request on first save', async ({ page }) => {
        // TODO Plan 10-04: complete a 1-file batch with toggle on -> handle persisted;
        // reload page; verify the toggle row resumes ON state with the stored
        // folder name; trigger a second batch -> assert handle.queryPermission called
        // before handle.requestPermission (re-request flow per Chromium FSAP spec).
    });
});
