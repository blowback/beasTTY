// Beastty Epic E10 Story S10.1 (FR-1..5, FR-12, NFR-1..4) — host-side checksums
// in the pull pane: the pure csum module, the ambient CRC-32 column with cached
// async fill, and the per-record Fletcher-16 detail sub-state.
//
// Separate file from pull-pane.spec.js (that one is 60+ specs already — story
// AC-10). Same conventions: boot-race guard on window.__pullPane, __resetForTests
// in beforeEach, @fast (no serial), fake directory handle via
// __setDirHandleForTests. The fake-handle factory here is S10.1's own copy with
// two upgrades over the S9 one (story T5): mkFile honors f.mtime (lastModified
// feeds the cache key) and getFile calls are counted per entry (cache-hit specs
// assert the fill added zero reads). Per-file `mode` overrides the global
// getFile mode so one row can reject while its neighbours fill (AC-8).
//
// Ground-truth vectors: story e10-1 Dev Notes, generated 2026-07-24 with the
// real csumhost (beast_csum @ HEAD). CSUM.COM / csumhost / this module must all
// print byte-identical output.

import { test, expect } from '@playwright/test';
import { SERIAL_MOCK } from '../transport/mock-serial.js';

const CARD = '#pull-pane .pp-card';
const ROWS = '#pull-pane-list .pp-row';

// ── Embedded ground-truth vectors (Dev Notes table — the oracle) ──
// content is a plain number array (crosses the evaluate boundary; the page
// side rebuilds a Uint8Array).
const VECTORS = [
    { label: 'empty', content: [], records: [], crc: '00000000' },
    { label: 'one full record 0x00..0x7F', content: Array.from({ length: 128 }, (_, i) => i), records: ['9ADF'], crc: '24650D57' },
    { label: 'two records, short final', content: Array.from({ length: 200 }, (_, i) => i % 256), records: ['9ADF', '482A'], crc: 'EB945AF8' },
    { label: 'two identical full records 0xAA', content: Array.from({ length: 256 }, () => 0xAA), records: ['0055', '0055'], crc: 'AFBD4CF6' },
    { label: 'HELLO FROM Z80 CRLF', content: [...'HELLO FROM Z80\r\n'].map((c) => c.charCodeAt(0)), records: ['24C4'], crc: '5D3BDC84' },
];

// ── S10.1 fake-handle factory (story T5 upgrades over the S9 copy) ──
const FAKE_HANDLE_FACTORY = `
  (function makeFakeHandle({ name, permission, grantsTo, files }) {
    let curFiles = files.slice();
    let getFileMode = 'ok';
    const pendingGetFiles = [];
    const getFileCounts = {};
    const mkFile = (f) => new File(
      [f.content ? new Uint8Array(f.content) : new Uint8Array(f.size ?? 0)],
      f.name,
      { lastModified: f.mtime ?? 0 },
    );
    const handle = {
      name,
      kind: 'directory',
      enumCount: 0,
      getFileCounts,
      __setFiles(next) { curFiles = next.slice(); },
      __setGetFileMode(m) { getFileMode = m; },
      __resolvePendingGetFiles() { for (const p of pendingGetFiles.splice(0)) p.resolve(p.file); },
      async queryPermission() { return permission; },
      async requestPermission() { return grantsTo || permission; },
      async *entries() {
        handle.enumCount++;
        for (const f of curFiles) {
          yield [f.name, {
            kind: 'file',
            getFile() {
              getFileCounts[f.name] = (getFileCounts[f.name] || 0) + 1;
              const mode = f.mode || getFileMode;
              if (mode === 'reject') return Promise.reject(new DOMException('gone', 'NotFoundError'));
              if (mode === 'manual') return new Promise((resolve) => pendingGetFiles.push({ resolve, file: mkFile(f) }));
              return Promise.resolve(mkFile(f));
            },
          }];
        }
        yield ['SUBDIR', { kind: 'directory' }];
      },
    };
    return handle;
  })
`;

async function setup(page) {
    await page.addInitScript(SERIAL_MOCK);
    await page.goto('/');
    await page.locator('#terminal-wrapper').focus();
    await page.waitForFunction(() => document.getElementById('terminal').width > 0);
    // Boot-race guard (E0.1 learning) — wait on the window.__* hook before driving.
    await page.waitForFunction(() =>
        window.__pullPane && typeof window.__pullPane.__getStateForTests === 'function');
    await page.evaluate(() => window.__pullPane.__resetForTests());
}

async function bindFake(page, opts) {
    await page.evaluate(async ({ factory, o }) => {
        // eslint-disable-next-line no-eval
        const makeFakeHandle = eval(factory);
        window.__ppFake = makeFakeHandle(o);
        await window.__pullPane.__setDirHandleForTests(window.__ppFake);
    }, { factory: FAKE_HANDLE_FACTORY, o: opts });
}

const paneState = (page) => page.evaluate(() => window.__pullPane.__getStateForTests());
const csums = (page) => page.evaluate(() => window.__pullPane.__getStateForTests().csums);
const tick = (page) => page.evaluate(() => window.__pullPane.__timerTickForTests());
const release = (page) => page.evaluate(() => window.__ppFake.__resolvePendingGetFiles());

// Wait until every listed name shows a filled (8-hex or —) column value.
async function waitFilled(page, names) {
    await page.waitForFunction((ns) => {
        const cs = window.__pullPane.__getStateForTests().csums;
        return ns.every((n) => cs[n] && cs[n] !== '…');
    }, names);
}

// Simulate the selection.js observer feed + a pane DragEvent (S9.3 helpers).
const dragState = (page, s) => page.evaluate((st) => window.__pullPane.onSelectionDrag(st), s);
const dispatchDrag = (page, type, text) => page.evaluate(({ t, txt }) => {
    const dt = new DataTransfer();
    if (txt != null) dt.setData('text/plain', txt);
    const ev = new DragEvent(t, { bubbles: true, cancelable: true, dataTransfer: dt });
    return document.getElementById('pull-pane').dispatchEvent(ev);
}, { t: type, txt: text });

// ═══════════════ (a) csum.js vector conformance (AC-1) ═══════════════

test.describe('csum.js — vector conformance', () => {
    test('reproduces every embedded csumhost vector byte-for-byte @fast', async ({ page }) => {
        await page.goto('/');
        const results = await page.evaluate(async (vectors) => {
            const { analyzeCsum } = await import('/renderer/csum.js');
            return vectors.map((v) => analyzeCsum(new Uint8Array(v.content)));
        }, VECTORS);
        for (let i = 0; i < VECTORS.length; i++) {
            expect(results[i], VECTORS[i].label).toEqual({ records: VECTORS[i].records, crc: VECTORS[i].crc });
        }
    });

    test('module is pure: no DOM, no I/O, no imports @fast', async ({ page }) => {
        await page.goto('/');
        // Import-free + side-effect-free is proven by importing in a page that
        // never wired it: the import must succeed in isolation.
        const src = await page.evaluate(async () => {
            const resp = await fetch('/renderer/csum.js');
            return resp.text();
        });
        expect(src).not.toMatch(/^\s*import\b/m);
        expect(src).not.toMatch(/\bdocument\b|\bwindow\b|\bfetch\b/);
    });
});

// ═══════════════ (b)–(f) ambient column + cache + fill (AC-2/3/4/8) ═══════════════

// Three files with vector content — the column must show the vector CRCs.
const COLUMN_FILES = [
    { name: 'AA.DAT', content: Array.from({ length: 256 }, () => 0xAA), mtime: 100, crc: 'AFBD4CF6' },
    { name: 'EMPTY.TXT', content: [], mtime: 100, crc: '00000000' },
    { name: 'HELLO.TXT', content: [...'HELLO FROM Z80\r\n'].map((c) => c.charCodeAt(0)), mtime: 100, crc: '5D3BDC84' },
];

test.describe('ambient CRC-32 column', () => {
    test.beforeEach(async ({ page }) => setup(page));

    test('(b) column fills with the vector CRCs; tooltip + cell placement (AC-2) @fast', async ({ page }) => {
        await bindFake(page, { name: 'MicroBeastPull', permission: 'granted', files: COLUMN_FILES });
        await waitFilled(page, COLUMN_FILES.map((f) => f.name));
        for (const f of COLUMN_FILES) {
            const row = page.locator(`${ROWS}[data-name="${f.name}"]`);
            await expect(row.locator('.pp-cs')).toHaveText(f.crc);
            await expect(row.locator('.pp-cs')).toHaveAttribute('title', 'CRC-32 — matches CSUM / csumhost');
        }
        // Cell sits between name and size (AC-2 order).
        const order = await page.evaluate(() =>
            [...document.querySelector('#pull-pane-list .pp-row').children].map((el) => el.className));
        expect(order).toEqual(expect.arrayContaining(['pp-nm', 'pp-cs', 'pp-sz']));
        expect(order.indexOf('pp-nm')).toBeLessThan(order.indexOf('pp-cs'));
        expect(order.indexOf('pp-cs')).toBeLessThan(order.indexOf('pp-sz'));
    });

    test('(c) pending placeholder under manual getFile, fills after release (AC-3) @fast', async ({ page }) => {
        await bindFake(page, { name: 'MicroBeastPull', permission: 'granted', files: [COLUMN_FILES[0]] });
        await waitFilled(page, ['AA.DAT']);
        // A NEW file under manual mode: enumeration parks on its size read
        // (release #1), then the fill parks on its content read — the cell
        // must show the pending placeholder until release #2.
        await page.evaluate((hello) => {
            window.__ppFake.__setFiles([
                { name: 'AA.DAT', content: Array.from({ length: 256 }, () => 0xAA), mtime: 100 },
                hello,
            ]);
            window.__ppFake.__setGetFileMode('manual');
        }, COLUMN_FILES[2]);
        // Initial bind read AA.DAT twice (enumeration size + fill content), so
        // the new tick's parked size read is its 3rd call. Enumeration awaits
        // getFile per file in order: release AA.DAT's, then HELLO.TXT's.
        const ticked = tick(page);
        await page.waitForFunction(() => window.__ppFake.getFileCounts['AA.DAT'] >= 3);
        await release(page);                  // AA.DAT size read resolves
        await page.waitForFunction(() => window.__ppFake.getFileCounts['HELLO.TXT'] >= 1);
        await release(page);                  // HELLO.TXT size read → render with '…'
        await ticked;
        await expect(page.locator(`${ROWS}[data-name="HELLO.TXT"] .pp-cs`)).toHaveText('…');
        expect((await csums(page))['HELLO.TXT']).toBe('…');
        // AA.DAT is a cache hit — painted synchronously, no placeholder.
        await expect(page.locator(`${ROWS}[data-name="AA.DAT"] .pp-cs`)).toHaveText('AFBD4CF6');
        await page.waitForFunction(() => window.__ppFake.getFileCounts['HELLO.TXT'] >= 2);
        await release(page);                  // content read resolves → fill lands
        await expect(page.locator(`${ROWS}[data-name="HELLO.TXT"] .pp-cs`)).toHaveText('5D3BDC84');
    });

    test('(d) cache hit: an unchanged refresh adds zero fill reads (AC-4) @fast', async ({ page }) => {
        await bindFake(page, { name: 'MicroBeastPull', permission: 'granted', files: COLUMN_FILES });
        await waitFilled(page, COLUMN_FILES.map((f) => f.name));
        const before = await page.evaluate(() => ({ ...window.__ppFake.getFileCounts }));
        await tick(page);
        // Give a hypothetical stray fill a beat to run before counting.
        await page.evaluate(() => new Promise((r) => setTimeout(r, 50)));
        const after = await page.evaluate(() => ({ ...window.__ppFake.getFileCounts }));
        // Enumeration itself reads each file once for size/mtime — that is the
        // only permitted delta. The fill contributed ZERO additional reads.
        for (const f of COLUMN_FILES) {
            expect(after[f.name], f.name).toBe(before[f.name] + 1);
        }
    });

    test('(e) same-size mtime bump: snapshot-equal refresh, zero row churn, cell updates (AC-4) @fast', async ({ page }) => {
        await bindFake(page, {
            name: 'MicroBeastPull',
            permission: 'granted',
            files: [{ name: 'EDIT.BIN', content: Array.from({ length: 128 }, (_, i) => i), mtime: 100 }],
        });
        await waitFilled(page, ['EDIT.BIN']);
        await expect(page.locator(`${ROWS} .pp-cs`)).toHaveText('24650D57');
        // Tag the row node so identity proves zero churn (S9.1b assertion style).
        await page.evaluate(() => {
            document.querySelector('#pull-pane-list .pp-row').dataset.tag = 'keepme';
        });
        // Same name, same SIZE, new mtime + new content → snapshotsEqual → the
        // early-return path. The fill pass must still run and update the cell.
        await page.evaluate(() => {
            window.__ppFake.__setFiles([{ name: 'EDIT.BIN', content: Array.from({ length: 128 }, () => 0xAA), mtime: 200 }]);
            return window.__pullPane.__timerTickForTests();
        });
        // CRC of 128×0xAA (cross-checked against the module in node at story
        // implementation time; record 0055 matches the 0xAA vector's records).
        const NEW_CRC = 'B17ECC3C';
        await page.waitForFunction((c) =>
            window.__pullPane.__getStateForTests().csums['EDIT.BIN'] === c, NEW_CRC);
        // Row node identity survived (no rebuild) …
        expect(await page.evaluate(() =>
            document.querySelector('#pull-pane-list .pp-row').dataset.tag)).toBe('keepme');
        // … but the cell now shows the CRC of the NEW content.
        await expect(page.locator(`${ROWS} .pp-cs`)).toHaveText(NEW_CRC);
    });

    test('(f) read failure → — for that row; the rest still fill (AC-8, FR-12) @fast', async ({ page }) => {
        await bindFake(page, {
            name: 'MicroBeastPull',
            permission: 'granted',
            files: [
                { name: 'BAD.COM', size: 512, mtime: 100, mode: 'reject' },
                COLUMN_FILES[0],
                COLUMN_FILES[2],
            ],
        });
        await waitFilled(page, ['BAD.COM', 'AA.DAT', 'HELLO.TXT']);
        const cs = await csums(page);
        expect(cs['BAD.COM']).toBe('—');
        expect(cs['AA.DAT']).toBe('AFBD4CF6');
        expect(cs['HELLO.TXT']).toBe('5D3BDC84');
        await expect(page.locator(`${ROWS}[data-name="BAD.COM"] .pp-cs`)).toHaveText('—');
    });

    test('(k) epoch guard: a fill parked across a rebind writes no cell and cannot crash (AC-3) @fast', async ({ page }) => {
        await bindFake(page, { name: 'OldFolder', permission: 'granted', files: [COLUMN_FILES[0]] });
        await waitFilled(page, ['AA.DAT']);
        // A new file under manual mode: walk the enumeration's parked size
        // read, then leave the FILL parked on the content read.
        await page.evaluate((hello) => {
            window.__ppFake.__setFiles([hello]);
            window.__ppFake.__setGetFileMode('manual');
        }, COLUMN_FILES[2]);
        const oldFake = await page.evaluateHandle(() => window.__ppFake);
        tick(page);
        await page.waitForFunction(() => window.__ppFake.getFileCounts['HELLO.TXT'] >= 1);
        await release(page);   // size read → render; fill parks on content read
        await page.waitForFunction(() => window.__ppFake.getFileCounts['HELLO.TXT'] >= 2);
        // Rebind to a NEW folder (epoch bump + fresh cache/fill chain) holding
        // a DIFFERENT file, so a stale write from the old fill would be
        // visible as a phantom HELLO.TXT value.
        await bindFake(page, { name: 'NewFolder', permission: 'granted', files: [COLUMN_FILES[0]] });
        await waitFilled(page, ['AA.DAT']);
        // Release the OLD folder's parked resolve — the stale fill resumes,
        // finds gen !== epoch, and must write no cell and not crash.
        await page.evaluate((old) => old.__resolvePendingGetFiles(), oldFake);
        await page.evaluate(() => new Promise((r) => setTimeout(r, 50)));
        const cs = await csums(page);
        expect(cs).toEqual({ 'AA.DAT': 'AFBD4CF6' });
        await expect(page.locator(`${ROWS}[data-name="AA.DAT"] .pp-cs`)).toHaveText('AFBD4CF6');
        await expect(page.locator(ROWS)).toHaveCount(1);
        expect(await page.evaluate(() => window.__pullPane.__getStateForTests().folderName)).toBe('NewFolder');
    });
});

// ═══════════════ (g)–(l) detail sub-state + row button (AC-5/6/7) ═══════════════

const TWO_REC = { name: 'TWO.BIN', content: Array.from({ length: 200 }, (_, i) => i % 256), mtime: 100 };

test.describe('per-record detail sub-state', () => {
    test.beforeEach(async ({ page }) => setup(page));

    test('(g) detail opens paint-once: verbatim header, aligned Fletcher-16 rows, Back returns (AC-5) @fast', async ({ page }) => {
        await bindFake(page, { name: 'MicroBeastPull', permission: 'granted', files: [TWO_REC, COLUMN_FILES[2]] });
        await waitFilled(page, ['TWO.BIN', 'HELLO.TXT']);
        await page.locator(`${ROWS}[data-name="TWO.BIN"] .pp-detail`).click();
        await expect(page.locator(CARD)).toHaveAttribute('data-view', 'detail');
        await expect(page.locator('#pull-pane-detail-title')).toHaveText('TWO.BIN · 2 records · CRC EB945AF8');
        await expect(page.locator('#pull-pane-detail-rows .pp-dv-row')).toHaveCount(2);
        await expect(page.locator('#pull-pane-detail-rows .pp-dv-row').nth(0)).toHaveText('0000: 9ADF');
        await expect(page.locator('#pull-pane-detail-rows .pp-dv-row').nth(1)).toHaveText('0001: 482A');
        // Footer hint ships [hidden] until S10.2 wires the real drop.
        await expect(page.locator('#pull-pane-detail-foot')).toBeHidden();
        expect((await paneState(page)).detail).toEqual({ name: 'TWO.BIN', recordCount: 2, crc: 'EB945AF8', error: null });
        // ‹ Back re-projects the list.
        await page.locator('#pull-pane-detail-back').click();
        await expect(page.locator(CARD)).toHaveAttribute('data-view', 'list');
        expect((await paneState(page)).detail).toBeNull();
        // Singular header copy ("1 record").
        await page.locator(`${ROWS}[data-name="HELLO.TXT"] .pp-detail`).click();
        await expect(page.locator('#pull-pane-detail-title')).toHaveText('HELLO.TXT · 1 record · CRC 5D3BDC84');
    });

    test('detail read failure paints the verbatim failure copy, never throws (AC-5/8) @fast', async ({ page }) => {
        await bindFake(page, { name: 'MicroBeastPull', permission: 'granted', files: [TWO_REC] });
        await waitFilled(page, ['TWO.BIN']);
        // Flip getFile to reject AFTER the column filled — the detail's fresh
        // read is the one that fails.
        await page.evaluate(() => window.__ppFake.__setGetFileMode('reject'));
        await page.locator(`${ROWS}[data-name="TWO.BIN"] .pp-detail`).click();
        await expect(page.locator(CARD)).toHaveAttribute('data-view', 'detail');
        await expect(page.locator('#pull-pane-detail-rows .pp-dv-err')).toHaveText("Couldn't read this file.");
        expect((await paneState(page)).detail).toEqual({ name: 'TWO.BIN', recordCount: 0, crc: null, error: "Couldn't read this file." });
    });

    test('(h) a content-changing refresh never repaints an open detail; Back lands on the updated list (AC-5) @fast', async ({ page }) => {
        await bindFake(page, { name: 'MicroBeastPull', permission: 'granted', files: [TWO_REC] });
        await waitFilled(page, ['TWO.BIN']);
        await page.locator(`${ROWS}[data-name="TWO.BIN"] .pp-detail`).click();
        await expect(page.locator(CARD)).toHaveAttribute('data-view', 'detail');
        // Tag the painted detail nodes to prove identity survives the refresh.
        await page.evaluate(() => {
            document.getElementById('pull-pane-detail-rows').dataset.tag = 'painted';
            document.querySelector('#pull-pane-detail-rows .pp-dv-row').dataset.tag = 'row0';
        });
        await page.evaluate((extra) => {
            window.__ppFake.__setFiles([
                { name: 'TWO.BIN', content: Array.from({ length: 200 }, (_, i) => i % 256), mtime: 100 },
                extra,
            ]);
            return window.__pullPane.__timerTickForTests();
        }, COLUMN_FILES[0]);
        // State advanced (2 files) …
        await page.waitForFunction(() => window.__pullPane.__getStateForTests().fileCount === 2);
        // … but the detail DOM was not repainted and still projects.
        await expect(page.locator(CARD)).toHaveAttribute('data-view', 'detail');
        expect(await page.evaluate(() => document.getElementById('pull-pane-detail-rows').dataset.tag)).toBe('painted');
        expect(await page.evaluate(() => document.querySelector('#pull-pane-detail-rows .pp-dv-row').dataset.tag)).toBe('row0');
        await expect(page.locator('#pull-pane-detail-title')).toHaveText('TWO.BIN · 2 records · CRC EB945AF8');
        // Back → the list re-projects CURRENT state, new arrival included.
        await page.locator('#pull-pane-detail-back').click();
        await expect(page.locator(ROWS)).toHaveCount(2);
        await expect(page.locator(`${ROWS}[data-name="AA.DAT"]`)).toBeVisible();
    });

    test('(i) ⁞ pointerdown is gesture-inert: no drag stash armed, selection unchanged (AC-6) @fast', async ({ page }) => {
        await bindFake(page, { name: 'MicroBeastPull', permission: 'granted', files: [TWO_REC, COLUMN_FILES[0]] });
        await waitFilled(page, ['TWO.BIN', 'AA.DAT']);
        const btn = page.locator(`${ROWS}[data-name="TWO.BIN"] .pp-detail`);
        await btn.hover();
        const box = await btn.boundingBox();
        await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
        await page.mouse.down();
        const st = await paneState(page);
        expect(st.dragOutArmed).toBe(false);
        expect(st.selectedNames).toEqual([]);
        await page.mouse.up();
    });

    test('(j) drop refused while detail open — no affordance, drop inert (AC-7) @fast', async ({ page }) => {
        await bindFake(page, { name: 'MicroBeastPull', permission: 'granted', files: [TWO_REC] });
        await waitFilled(page, ['TWO.BIN']);
        await page.locator(`${ROWS}[data-name="TWO.BIN"] .pp-detail`).click();
        await expect(page.locator(CARD)).toHaveAttribute('data-view', 'detail');
        await dragState(page, { active: true, text: 'GAME.COM' });
        // dispatchEvent returns TRUE when preventDefault did NOT run — i.e.
        // the pane refused the drag (dispatchDrag helper, S9.3 precedent).
        expect(await dispatchDrag(page, 'dragenter', 'GAME.COM')).toBe(true);
        expect((await paneState(page)).dropAffordance).toBe(false);
        expect(await dispatchDrag(page, 'drop', 'GAME.COM')).toBe(true);
        const st = await paneState(page);
        expect(st.review).toBeNull();
        expect(st.detail).not.toBeNull();
        await dragState(page, { active: false });
    });

    test('(l) ⁞ is keyboard-reachable: focusable, visibly revealed on focus, Enter opens (AC-6) @fast', async ({ page }) => {
        await bindFake(page, { name: 'MicroBeastPull', permission: 'granted', files: [TWO_REC] });
        await waitFilled(page, ['TWO.BIN']);
        // Hidden at rest (opacity 0 — NOT display/visibility, which would drop
        // it from the tab order).
        const btn = page.locator(`${ROWS}[data-name="TWO.BIN"] .pp-detail`);
        expect(await btn.evaluate((el) => getComputedStyle(el).opacity)).toBe('0');
        await btn.evaluate((el) => el.focus());
        expect(await btn.evaluate((el) => document.activeElement === el)).toBe(true);
        // Revealed via .pp-row:focus-within while it holds focus.
        expect(await btn.evaluate((el) => getComputedStyle(el).opacity)).toBe('1');
        await expect(btn).toHaveAttribute('title', 'Per-record checksums (CSUM -V)');
        await page.keyboard.press('Enter');
        await expect(page.locator(CARD)).toHaveAttribute('data-view', 'detail');
        await expect(page.locator('#pull-pane-detail-title')).toHaveText('TWO.BIN · 2 records · CRC EB945AF8');
    });
});
