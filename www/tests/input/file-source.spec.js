// BestialiTTY Phase 9 Plan 09-04 — file-source Playwright assertions.
//
// Covers:
//   - SLIDE-08: drag-drop trigger (dragenter sets [data-drop-target] +
//     drop opens modal)
//   - SLIDE-09: drop-overlay visible with verbatim text + dashed border
//   - SLIDE-10: non-file dragenter silently ignored (no overlay flash)
//   - SLIDE-15: modal rewrite rows show original → uppercased 8.3 form
//   - SLIDE-16: modal rejection rows show invalid CP/M character + reason +
//     all-rejected hint visible + Send button disabled & labeled "Send 0 files"
//   - Pure-function unit tests for validateCpmFilename / truncateCpm83 /
//     packSendMetadata via page.evaluate(import('./input/file-source.js'))
//
// Setup mirrors tx-sink.spec.js (input-namespace placement template).

import { test, expect } from '@playwright/test';
import { SERIAL_MOCK } from '../transport/mock-serial.js';

async function setup(page) {
    await page.addInitScript(SERIAL_MOCK);
    await page.goto('/');
    await page.locator('#terminal-wrapper').focus();
    await page.waitForFunction(() => document.getElementById('terminal').width > 0);
}

test.beforeEach(async ({ page }) => {
    await setup(page);
    await page.evaluate(() => {
        if (window.__slide) window.__slide.__resetForTests();
        if (window.__fileSource) window.__fileSource.__resetForTests();
    });
});

// ===== Drag-drop simulation helper =====
//
// dt.items.add(file) is the canonical way to inject 'Files' into
// DataTransfer.types[] (HTML Living Standard). dt.setData('text/plain', ...)
// produces a non-Files drag (used by the SLIDE-10 silent-rejection test).

async function dragFileOnWrapper(page, eventType, fileSpec) {
    if (fileSpec) {
        await page.evaluate(({ ev, name, content }) => {
            const dt = new DataTransfer();
            const file = new File([content], name, { type: 'text/plain' });
            dt.items.add(file);
            const e = new DragEvent(ev, { bubbles: true, cancelable: true, dataTransfer: dt });
            document.getElementById('terminal-wrapper').dispatchEvent(e);
        }, { ev: eventType, name: fileSpec.name, content: fileSpec.content });
    } else {
        await page.evaluate(({ ev }) => {
            const dt = new DataTransfer();
            dt.setData('text/plain', 'hello');
            const e = new DragEvent(ev, { bubbles: true, cancelable: true, dataTransfer: dt });
            document.getElementById('terminal-wrapper').dispatchEvent(e);
        }, { ev: eventType });
    }
}

// ===== SLIDE-08: drag-drop trigger =====

test('drag-drop overlay shows on dragenter @fast', async ({ page }) => {
    await dragFileOnWrapper(page, 'dragenter', { name: 'a.txt', content: 'a' });
    await expect.poll(
        () => page.evaluate(() =>
            document.getElementById('terminal-wrapper').hasAttribute('data-drop-target')),
        { timeout: 2000 },
    ).toBe(true);
});

// ===== SLIDE-09: overlay visual =====

test('overlay visible — text and dashed border match UI-SPEC @fast', async ({ page }) => {
    await dragFileOnWrapper(page, 'dragenter', { name: 'a.txt', content: 'a' });
    // The drop overlay element must be visible and contain the locked text.
    await expect(page.locator('#drop-overlay-text')).toHaveText('Drop file(s) to send via SLIDE');
    await expect(page.locator('#drop-overlay')).toBeVisible();
    // Computed style — border must contain "dashed". Browsers stringify the
    // shorthand as "2px dashed rgb(...)" (or per-edge components in some
    // engines). toContain('dashed') is resilient.
    const borderStyle = await page.evaluate(() => {
        const el = document.getElementById('drop-overlay');
        return getComputedStyle(el).border;
    });
    expect(borderStyle).toContain('dashed');
});

// ===== SLIDE-10: non-file silent rejection =====

test('non-file rejection — silent at dragenter @fast', async ({ page }) => {
    await dragFileOnWrapper(page, 'dragenter', null);   // text/plain only
    // Wait a tick to confirm no async overlay-show.
    await page.waitForTimeout(100);
    const hasAttr = await page.evaluate(() =>
        document.getElementById('terminal-wrapper').hasAttribute('data-drop-target'));
    expect(hasAttr).toBe(false);
});

// ===== SLIDE-08 (continued): drop triggers picker-equivalent flow =====

test('drop triggers picker-equivalent flow — modal opens @fast', async ({ page }) => {
    // Connect first so writer is registered (the modal -> enterSendMode
    // path needs a stable page state; some implementations route through
    // tx-sink even before Connect, but Plan 09-03's processFiles uses
    // dependency-injected enterSendMode which itself needs a connected
    // writer to push the auto-type bytes onto the wire — verified locally).
    await page.locator('#connect-button').click();
    await expect.poll(
        () => page.evaluate(() => Boolean(navigator.serial._grantedPorts[0]?._reader)),
        { timeout: 5000 },
    ).toBe(true);

    await dragFileOnWrapper(page, 'drop', { name: 'dropped.txt', content: 'D' });

    await expect(page.locator('#send-modal')).toBeVisible({ timeout: 2000 });
    await expect(page.locator('#send-modal-list li').first()).toContainText('dropped.txt');
});

// ===== SLIDE-15: modal rewrite displayed =====

test('modal rewrite — uppercased + 8.3 truncation surfaced @fast', async ({ page }) => {
    await page.setInputFiles('#send-file-input', [
        { name: 'my-doc.txt', mimeType: 'text/plain', buffer: Buffer.from('1') },
        { name: 'REPORT-2024.csv', mimeType: 'text/csv', buffer: Buffer.from('2') },
    ]);
    await expect(page.locator('#send-modal')).toBeVisible();
    const liTexts = await page.locator('#send-modal-list li').allTextContents();
    expect(liTexts.some((t) => t.includes('my-doc.txt') && t.includes('MY-DOC.TXT'))).toBe(true);
    expect(liTexts.some((t) => t.includes('REPORT-2024.csv') && t.includes('REPORT-2.CSV'))).toBe(true);
});

// ===== SLIDE-16: modal rejection displayed =====

test('modal rejection — invalid CP/M character listed @fast', async ({ page }) => {
    await page.setInputFiles('#send-file-input', {
        name: 'bad?file.txt',
        mimeType: 'text/plain',
        buffer: Buffer.from('x'),
    });
    await expect(page.locator('#send-modal')).toBeVisible();
    await expect(page.locator('#send-modal-list li').first())
        .toContainText("rejected: invalid CP/M character '?'");
});

test('all-files-rejected disables Send button @fast', async ({ page }) => {
    await page.setInputFiles('#send-file-input', {
        name: 'bad?file.txt',
        mimeType: 'text/plain',
        buffer: Buffer.from('x'),
    });
    await expect(page.locator('#send-modal-send')).toHaveText('Send 0 files');
    await expect(page.locator('#send-modal-send')).toBeDisabled();
    await expect(page.locator('#send-modal-all-rejected-hint')).toBeVisible();
    await expect(page.locator('#send-modal-all-rejected-hint'))
        .toContainText('All files rejected');
});

// ===== Pure-function unit tests via page.evaluate =====

test('validateCpmFilename pure function unit tests @fast', async ({ page }) => {
    const results = await page.evaluate(async () => {
        const m = await import('./input/file-source.js');
        return {
            empty:      m.validateCpmFilename(''),
            dotfile:    m.validateCpmFilename('.hidden'),
            ascii:      m.validateCpmFilename('hello.txt'),
            qmark:      m.validateCpmFilename('bad?file.txt'),
            highByte:   m.validateCpmFilename('résumé.txt'),
            ctrl:       m.validateCpmFilename('ab.txt'),
            star:       m.validateCpmFilename('a*b.txt'),
        };
    });
    expect(results.empty.ok).toBe(false);
    expect(results.dotfile.ok).toBe(false);
    expect(results.ascii.ok).toBe(true);
    expect(results.qmark.ok).toBe(false);
    expect(results.qmark.reason).toContain("'?'");
    expect(results.highByte.ok).toBe(false);
    expect(results.highByte.reason).toContain('non-ASCII');
    expect(results.ctrl.ok).toBe(false);
    expect(results.ctrl.reason).toContain('control character');
    expect(results.star.ok).toBe(false);
    expect(results.star.reason).toContain("'*'");
});

test('truncateCpm83 pure function unit tests @fast', async ({ page }) => {
    const results = await page.evaluate(async () => {
        const m = await import('./input/file-source.js');
        return {
            simple:       m.truncateCpm83('hello.txt'),
            longBase:     m.truncateCpm83('REPORT-2024.csv'),
            multiDot:     m.truncateCpm83('my.tar.gz'),
            multiDotLong: m.truncateCpm83('my.tar.long'),
            noExt:        m.truncateCpm83('noext'),
            veryLong:     m.truncateCpm83('VERYLONGFILENAME'),
        };
    });
    expect(results.simple).toBe('HELLO.TXT');
    expect(results.longBase).toBe('REPORT-2.CSV');
    expect(results.multiDot).toBe('MY.TAR.GZ');
    expect(results.multiDotLong).toBe('MY.TAR.LON');
    expect(results.noExt).toBe('NOEXT');
    expect(results.veryLong).toBe('VERYLONG');
});

test('packSendMetadata produces correct D-09 layout @fast', async ({ page }) => {
    const result = await page.evaluate(async () => {
        const m = await import('./input/file-source.js');
        const files = [
            { name: 'A.TXT', bytes: new Uint8Array([1, 2, 3]) },        // size = 3
            { name: 'BB.BIN', bytes: new Uint8Array([4, 5, 6, 7, 8]) }, // size = 5
        ];
        const buf = m.packSendMetadata(files);
        return Array.from(buf);
    });
    // D-09 layout:
    //   <u32 LE file_count = 2>     -> [0x02, 0, 0, 0]
    //   for file 0:
    //     <u32 LE name_len = 5>     -> [0x05, 0, 0, 0]
    //     name 'A.TXT' 5 bytes      -> [0x41, 0x2E, 0x54, 0x58, 0x54]
    //     <u32 LE size = 3>         -> [0x03, 0, 0, 0]
    //   for file 1:
    //     <u32 LE name_len = 6>     -> [0x06, 0, 0, 0]
    //     name 'BB.BIN' 6 bytes     -> [0x42, 0x42, 0x2E, 0x42, 0x49, 0x4E]
    //     <u32 LE size = 5>         -> [0x05, 0, 0, 0]
    expect(result).toEqual([
        0x02, 0x00, 0x00, 0x00,
        0x05, 0x00, 0x00, 0x00,
        0x41, 0x2E, 0x54, 0x58, 0x54,
        0x03, 0x00, 0x00, 0x00,
        0x06, 0x00, 0x00, 0x00,
        0x42, 0x42, 0x2E, 0x42, 0x49, 0x4E,
        0x05, 0x00, 0x00, 0x00,
    ]);
});
