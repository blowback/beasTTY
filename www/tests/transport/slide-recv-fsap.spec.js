// Beastty Phase 10 Plan 10-05 — File System Access Picker integration
// Playwright assertions.
//
// Drives the showDirectoryPicker / createWritable path including the ~N
// collision suffix retry (CONTEXT D-05/D-06; up to ~999) per slide-recv.js
// downloadToFolder + ensureUnique. Also exercises the ~999 budget exhaustion
// fallback to anchor-click.
//
// Source: 10-05-PLAN.md Task 3 + 10-RESEARCH.md §"showDirectoryPicker handle
//         persistence" + §"~N collision retry" + 10-UI-SPEC.md §"Save mode".

import { test, expect } from '@playwright/test';
import { SERIAL_MOCK } from './mock-serial.js';
import { MOCK_SERIAL_SLIDE_BOT } from './mock-serial-slide-bot.js';

// FSAP stub installer — installed as page.addInitScript so showDirectoryPicker
// is mocked at module-load time. Tests can pre-populate the fake handle's
// _files Map via window.__pickerStub.preloadFiles.
const PICKER_STUB = `
(() => {
  window.__pickerStub = {
    queryPermissionResult: 'granted',
    requestPermissionResult: 'granted',
    handleName: 'TestFolder',
    preloadFiles: [],            // file-names to seed _files with before any read
    pickCount: 0,
    handle: null,
  };
  function makeFakeHandle(name) {
    const handle = {
      name,
      kind: 'directory',
      _files: new Map(),
      _writeLog: [],             // [{ name, bytes }]
      async getFileHandle(fileName, opts) {
        if (opts && opts.create) {
          const captureBytes = [];
          const fh = {
            name: fileName,
            createWritable: async () => ({
              write: async (data) => {
                captureBytes.push(data);
              },
              close: async () => {
                let combined;
                if (captureBytes[0] instanceof Blob) {
                  const buf = await captureBytes[0].arrayBuffer();
                  combined = new Uint8Array(buf);
                } else if (captureBytes[0] instanceof Uint8Array) {
                  combined = captureBytes[0];
                } else {
                  combined = new Uint8Array(0);
                }
                handle._files.set(fileName, combined);
                handle._writeLog.push({ name: fileName, bytes: Array.from(combined) });
              },
            }),
          };
          // Reserve the slot so subsequent ensureUnique probes see it.
          if (!handle._files.has(fileName)) handle._files.set(fileName, null);
          return fh;
        }
        if (handle._files.has(fileName)) return { name: fileName };
        const err = new Error('NotFoundError');
        err.name = 'NotFoundError';
        throw err;
      },
      async queryPermission() { return window.__pickerStub.queryPermissionResult; },
      async requestPermission() { return window.__pickerStub.requestPermissionResult; },
    };
    // Pre-populate collision-test seed files.
    for (const seedName of window.__pickerStub.preloadFiles) {
      handle._files.set(seedName, new Uint8Array(0));
    }
    return handle;
  }
  window.showDirectoryPicker = async () => {
    window.__pickerStub.pickCount += 1;
    const h = makeFakeHandle(window.__pickerStub.handleName);
    window.__pickerStub.handle = h;
    return h;
  };
})();
`;

async function setup(page) {
    await page.addInitScript(SERIAL_MOCK);
    await page.addInitScript(MOCK_SERIAL_SLIDE_BOT);
    await page.addInitScript(PICKER_STUB);
    await page.goto('/');
    await page.locator('#terminal-wrapper').focus();
    await page.waitForFunction(() => document.getElementById('terminal').width > 0);
    await page.locator('#connection').evaluate((el) => { el.open = true; });
    await page.locator('#settings').evaluate((el) => { el.open = true; });
    // Plan 11-03 moved the recv-to-folder row inside a nested
    // <details id="settings-slide"> block; expand it so the toggle + button
    // are visible/clickable.
    await page.locator('#settings-slide').evaluate((el) => { el.open = true; });
}

async function pickFolderAndToggle(page) {
    // Toggle "Save received files to a folder" on, then pick the folder via
    // the stubbed showDirectoryPicker. After this, cachedHandle is populated
    // and downloadToFolder will route to the fake handle.
    const checkbox = page.locator('#slide-recv-to-folder-checkbox');
    await checkbox.evaluate((el) => { el.checked = true; el.dispatchEvent(new Event('change')); });
    await page.locator('#slide-recv-folder-button').click();
    await expect(page.locator('#slide-recv-folder-status')).toHaveText('Saving to: TestFolder');
}

async function driveOneFile(page, name, bytes) {
    await page.evaluate(({ name, bytes }) => {
        window.__mockSlideBot.queueSendFiles([{ name, bytes: new Uint8Array(bytes) }]);
        window.__mockSlideBot.pushSlideHostWakeup();
    }, { name, bytes: Array.from(bytes) });
    await expect.poll(
        () => page.evaluate(() => window.__slide.__getStateForTests().mode),
        { timeout: 5000 },
    ).toBe('recv');
    await page.evaluate(() => window.__mockSlideBot.startSendSession());
}

async function driveMultiFile(page, files) {
    await page.evaluate((files) => {
        window.__mockSlideBot.queueSendFiles(
            files.map((f) => ({ name: f.name, bytes: new Uint8Array(f.bytes) })),
        );
        window.__mockSlideBot.pushSlideHostWakeup();
    }, files.map((f) => ({ name: f.name, bytes: Array.from(f.bytes) })));
    await expect.poll(
        () => page.evaluate(() => window.__slide.__getStateForTests().mode),
        { timeout: 5000 },
    ).toBe('recv');
    await page.evaluate(() => window.__mockSlideBot.startSendSession());
}

test.describe('slide-recv-fsap — showDirectoryPicker integration', () => {

    test.beforeEach(async ({ page }) => {
        await setup(page);
        await page.locator('#connect-button').click();
        await expect.poll(
            () => page.evaluate(() => Boolean(navigator.serial._grantedPorts[0]?._reader)),
            { timeout: 5000 },
        ).toBe(true);
        await page.evaluate(() => {
            window.__slide.__resetForTests();
            window.__slideRecv.__resetForTests();
            window.__mockWriterLog.length = 0;
            window.__mockSlideBot.reset();
            window.__mockSlideBot.setRole('send');
        });
    });

    test('FSAP: createWritable.write(blob) writes received bytes; close() invoked', async ({ page }) => {
        await pickFolderAndToggle(page);
        const fixture = [10, 20, 30, 40, 50, 60, 70, 80, 90, 100];
        await driveOneFile(page, 'PAYLOAD.BIN', fixture);
        // Wait for the file to settle into the fake handle's _writeLog.
        await expect.poll(
            () => page.evaluate(() => window.__pickerStub.handle?._writeLog?.length || 0),
            { timeout: 5000 },
        ).toBe(1);
        const writeLog = await page.evaluate(() => window.__pickerStub.handle._writeLog);
        expect(writeLog[0].name).toBe('PAYLOAD.BIN');
        expect(writeLog[0].bytes).toEqual(fixture);
        // Verify mode returns to terminal (FIN echoed cleanly).
        await expect.poll(
            () => page.evaluate(() => window.__slide.__getStateForTests().mode),
            { timeout: 5000 },
        ).toBe('terminal');
    });

    test('Collision: existing REPORT.TXT -> writes REPORT~1.TXT (CONTEXT D-05)', async ({ page }) => {
        // Pre-seed a REPORT.TXT into the picker so ensureUnique must escalate.
        await page.evaluate(() => { window.__pickerStub.preloadFiles = ['REPORT.TXT']; });
        await pickFolderAndToggle(page);
        const fixture = [0xCA, 0xFE, 0xBA, 0xBE];
        await driveOneFile(page, 'REPORT.TXT', fixture);
        // The new file must land at REPORT~1.TXT — REPORT.TXT pre-existed.
        await expect.poll(
            () => page.evaluate(() => window.__pickerStub.handle?._writeLog?.length || 0),
            { timeout: 5000 },
        ).toBe(1);
        const writeLog = await page.evaluate(() => window.__pickerStub.handle._writeLog);
        expect(writeLog[0].name).toBe('REPORT~1.TXT');
        expect(writeLog[0].bytes).toEqual(fixture);
    });

    test('Collision-cascade: 3 same-name files -> ~1, ~2, ~3 (in order)', async ({ page }) => {
        await pickFolderAndToggle(page);
        // Drive the SAME filename three times. ensureUnique must escalate each
        // time because the previous write reserved the slot in _files.
        const files = [
            { name: 'DOC.TXT', bytes: [0x01] },
            { name: 'DOC.TXT', bytes: [0x02] },
            { name: 'DOC.TXT', bytes: [0x03] },
        ];
        await driveMultiFile(page, files);
        await expect.poll(
            () => page.evaluate(() => window.__pickerStub.handle?._writeLog?.length || 0),
            { timeout: 8000 },
        ).toBe(3);
        const writeLog = await page.evaluate(() => window.__pickerStub.handle._writeLog);
        // First write: bare name (slot was free); next two escalate ~1, ~2.
        expect(writeLog.map((e) => e.name)).toEqual(['DOC.TXT', 'DOC~1.TXT', 'DOC~2.TXT']);
        // Confirm bytes are byte-identical to each fixture (no truncation /
        // mis-routing).
        expect(writeLog[0].bytes).toEqual([0x01]);
        expect(writeLog[1].bytes).toEqual([0x02]);
        expect(writeLog[2].bytes).toEqual([0x03]);
    });

    test('~999 budget exhaustion -> falls through to anchor-click', async ({ page }) => {
        // Pre-seed BUDGET.TXT and BUDGET~1.TXT … BUDGET~999.TXT. ensureUnique
        // probes 0..999 inclusive; on exhaustion returns null and downloadToFolder
        // calls downloadViaAnchor (URL.createObjectURL spy will see the blob).
        await page.evaluate(() => {
            const seeds = ['BUDGET.TXT'];
            for (let n = 1; n <= 999; n++) seeds.push(`BUDGET~${n}.TXT`);
            window.__pickerStub.preloadFiles = seeds;
        });
        await pickFolderAndToggle(page);
        // Install URL.createObjectURL spy AFTER the picker click so the click
        // doesn't pollute the spy. The spy fires only when downloadViaAnchor
        // runs (i.e. on the ~999 fall-through path).
        await page.evaluate(() => {
            window.__capturedBlobs = [];
            const orig = URL.createObjectURL;
            URL.createObjectURL = (blob) => {
                window.__capturedBlobs.push(blob);
                return orig.call(URL, blob);
            };
        });
        await driveOneFile(page, 'BUDGET.TXT', [0xDE, 0xAD]);
        // Anchor-click must fire (the ~999 fall-through path) — wait for it.
        await expect.poll(
            () => page.evaluate(() => window.__capturedBlobs.length),
            { timeout: 8000 },
        ).toBe(1);
        // Confirm no folder write happened.
        const writeLogLen = await page.evaluate(
            () => window.__pickerStub.handle?._writeLog?.length || 0,
        );
        expect(writeLogLen).toBe(0);
    });
});
