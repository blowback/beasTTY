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
        // S10.2 — the footer hint is live now: visible resting copy on a
        // diffable detail (it was [hidden] under the S10.1 interim rule).
        await expect(page.locator('#pull-pane-detail-foot')).toHaveText('Drag CSUM -V output here to compare');
        await expect(page.locator('#pull-pane-detail-foot')).toBeVisible();
        expect((await paneState(page)).detail).toEqual({ name: 'TWO.BIN', recordCount: 2, crc: 'EB945AF8', error: null, diff: null });
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
        expect((await paneState(page)).detail).toEqual({ name: 'TWO.BIN', recordCount: 0, crc: null, error: "Couldn't read this file.", diff: null });
        // S10.2 — the error body hides the compare hint (its drop is refused;
        // never invite a drop that can't compare).
        await expect(page.locator('#pull-pane-detail-foot')).toBeHidden();
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

    test('(j) S10.2 routing: a detail-open drop diffs (never opens the review); an error-bodied detail refuses (AC-3/4) @fast', async ({ page }) => {
        // This spec INVERTS S10.1's interim "(j) drop refused while detail
        // open": the detail-open drop now routes to the CSUM -V diff.
        await bindFake(page, { name: 'MicroBeastPull', permission: 'granted', files: [TWO_REC] });
        await waitFilled(page, ['TWO.BIN']);
        await page.locator(`${ROWS}[data-name="TWO.BIN"] .pp-detail`).click();
        await expect(page.locator(CARD)).toHaveAttribute('data-view', 'detail');
        await dragState(page, { active: true, text: 'GAME.COM' });
        // dispatchEvent returns FALSE when preventDefault ran — the pane
        // ACCEPTS the drag over the open (diffable) detail …
        expect(await dispatchDrag(page, 'dragenter', 'GAME.COM')).toBe(false);
        // … and the affordance lands on the DETAIL footer, verbatim.
        await expect(page.locator('#pull-pane-detail-foot')).toHaveText('⤓ Drop to compare');
        expect(await page.evaluate(() =>
            document.getElementById('pull-pane-detail-foot').classList.contains('drop-active'))).toBe(true);
        expect(await dispatchDrag(page, 'drop', 'GAME.COM')).toBe(false);
        await dragState(page, { active: false });
        const st = await paneState(page);
        // The review never opened; the detail stayed; the drop painted a diff
        // (garbage text → the FR-9 failure message is still a painted result).
        expect(st.review).toBeNull();
        expect(st.detail).not.toBeNull();
        expect(st.detail.diff).not.toBeNull();
        await expect(page.locator(CARD)).toHaveAttribute('data-view', 'detail');
        // Footer restored to the resting hint after the drop.
        await expect(page.locator('#pull-pane-detail-foot')).toHaveText('Drag CSUM -V output here to compare');
        await page.locator('#pull-pane-detail-back').click();

        // An ERROR-bodied detail keeps the refusal (nothing to compare).
        await page.evaluate(() => window.__ppFake.__setGetFileMode('reject'));
        await page.locator(`${ROWS}[data-name="TWO.BIN"] .pp-detail`).click();
        await expect(page.locator(CARD)).toHaveAttribute('data-view', 'detail');
        await dragState(page, { active: true, text: 'GAME.COM' });
        expect(await dispatchDrag(page, 'dragenter', 'GAME.COM')).toBe(true);
        expect((await paneState(page)).dropAffordance).toBe(false);
        expect(await dispatchDrag(page, 'drop', 'GAME.COM')).toBe(true);
        const st2 = await paneState(page);
        expect(st2.review).toBeNull();
        expect(st2.detail.diff).toBeNull();
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

// ═══════════════ S10.2 (c)–(k) drop-to-diff routing + render (AC-3..10) ═══════════════

// Five full records — enough indices to exercise every mismatch pattern.
const FIVE_REC = { name: 'FIVE.BIN', content: Array.from({ length: 640 }, (_, i) => (i * 7) % 256), mtime: 100 };

// Device-side CSUM -V text built from the same content via analyzeCsum (the
// self-consistent oracle — story T1). Tweaks: flip = corrupt these indices
// (Fletcher-16 sums run mod 255, so FFFF can never be a real value — a flip
// is always a mismatch), limit = truncate the listing to n records,
// crc: false omits the CRC line, crc: 'bad' prints a wrong one.
const buildDeviceText = (page, content, opts = {}) => page.evaluate(async ({ content, opts }) => {
    const { analyzeCsum } = await import('/renderer/csum.js');
    const a = analyzeCsum(new Uint8Array(content));
    const hx4 = (n) => n.toString(16).toUpperCase().padStart(4, '0');
    const flip = new Set(opts.flip || []);
    const values = opts.limit !== undefined ? a.records.slice(0, opts.limit) : a.records.slice();
    const lines = values.map((v, i) => `${hx4(i)}: ${flip.has(i) ? 'FFFF' : v}`);
    if (opts.crc !== false) lines.push(opts.crc === 'bad' ? '12345678' : a.crc);
    return lines.join('\r\n') + '\r\n';
}, { content, opts });

async function openDetailFor(page, name) {
    await page.locator(`${ROWS}[data-name="${name}"] .pp-detail`).click();
    await expect(page.locator(CARD)).toHaveAttribute('data-view', 'detail');
}

// Full drag/drop cycle landing `text` on the pane (the diff route while a
// detail is open).
async function dropDiff(page, text) {
    await dragState(page, { active: true, text });
    await dispatchDrag(page, 'dragenter', text);
    await dispatchDrag(page, 'drop', text);
    await dragState(page, { active: false });
}

const RESULT = '#pull-pane-detail-result';
const DV_ROWS = '#pull-pane-detail-rows .pp-dv-row';

test.describe('S10.2 — drop-to-diff render + diagnosis', () => {
    test.beforeEach(async ({ page }) => {
        await setup(page);
        await bindFake(page, { name: 'MicroBeastPull', permission: 'granted', files: [FIVE_REC] });
        await waitFilled(page, ['FIVE.BIN']);
        await openDetailFor(page, 'FIVE.BIN');
    });

    test('(d) mismatch render: row class + ≠ suffix + both values + title; quiet matches; caption (AC-5/6/10) @fast', async ({ page }) => {
        await dropDiff(page, await buildDeviceText(page, FIVE_REC.content, { flip: [1] }));
        await expect(page.locator(DV_ROWS)).toHaveCount(5);
        const bad = page.locator(DV_ROWS).nth(1);
        await expect(bad).toHaveClass(/mismatch/);
        await expect(bad).toHaveAttribute('title', 'local ≠ device');
        // Local value left, accent device value right — both present, textual.
        await expect(bad).toHaveText(/^0001: [0-9A-F]{4} ≠ FFFF$/);
        await expect(bad.locator('.pp-dv-ne')).toHaveText(/≠ FFFF/);
        // Matching rows stay quiet: no class, no title, no suffix.
        const quiet = page.locator(DV_ROWS).nth(0);
        await expect(quiet).not.toHaveClass(/mismatch/);
        expect(await quiet.getAttribute('title')).toBeNull();
        await expect(quiet.locator('.pp-dv-ne')).toHaveCount(0);
        // Caption verbatim; a single mid-file mismatch names NO pattern.
        await expect(page.locator(`${RESULT} .pp-dv-caption`)).toHaveText('1 of 5 records differ');
        await expect(page.locator(`${RESULT} .pp-dv-diag`)).toHaveCount(0);
        await expect(page.locator(`${RESULT} .pp-dv-countline`)).toHaveCount(0);
        // Test hook — the sanctioned diff field, deep-copied.
        expect((await paneState(page)).detail.diff).toEqual({
            caption: '1 of 5 records differ', countLine: null, diagnosis: null, mismatched: [1], error: null,
        });
    });

    test('(d2) caption cases: CRC match / no device CRC / CRC differs (AC-6) @fast', async ({ page }) => {
        await dropDiff(page, await buildDeviceText(page, FIVE_REC.content));
        await expect(page.locator(`${RESULT} .pp-dv-caption`)).toHaveText('All 5 records match · CRC match');
        await dropDiff(page, await buildDeviceText(page, FIVE_REC.content, { crc: false }));
        await expect(page.locator(`${RESULT} .pp-dv-caption`)).toHaveText('All 5 records match');
        await dropDiff(page, await buildDeviceText(page, FIVE_REC.content, { crc: 'bad' }));
        await expect(page.locator(`${RESULT} .pp-dv-caption`)).toHaveText('All 5 records match · CRC differs');
        // All-match paints no row marks and no diagnosis.
        await expect(page.locator(`${DV_ROWS}.mismatch`)).toHaveCount(0);
        await expect(page.locator(`${RESULT} .pp-dv-diag`)).toHaveCount(0);
    });

    test('(e) diagnosis verbatim: tail + ⓘ split, run, stride ordinal (AC-6) @fast', async ({ page }) => {
        // Tail — the visible line + the ⓘ title split the epic's verbatim text.
        await dropDiff(page, await buildDeviceText(page, FIVE_REC.content, { flip: [4] }));
        await expect(page.locator(`${RESULT} .pp-dv-diag`))
            .toContainText('Only the last record differs — likely tail padding.');
        await expect(page.locator(`${RESULT} .pp-dv-diag .pp-info`))
            .toHaveAttribute('title', "SLIDE before v0.5.2 didn't zero-fill the final record; the file is probably fine.");
        // Run.
        await dropDiff(page, await buildDeviceText(page, FIVE_REC.content, { flip: [1, 2, 3] }));
        await expect(page.locator(`${RESULT} .pp-dv-caption`)).toHaveText('3 of 5 records differ');
        await expect(page.locator(`${RESULT} .pp-dv-diag`))
            .toHaveText('A contiguous run of records differs — likely a block that never got written back.');
        await expect(page.locator(`${RESULT} .pp-dv-diag .pp-info`)).toHaveCount(0);
        // Stride 2 → English ordinal "2nd".
        await dropDiff(page, await buildDeviceText(page, FIVE_REC.content, { flip: [0, 2, 4] }));
        await expect(page.locator(`${RESULT} .pp-dv-diag`))
            .toHaveText('Every 2nd record differs — likely an interleave / skew-table bug.');
    });

    test('(f) count mismatch: count line, shared-range diff, NO second diagnosis (AC-6) @fast', async ({ page }) => {
        await dropDiff(page, await buildDeviceText(page, FIVE_REC.content, { limit: 3, flip: [1], crc: false }));
        await expect(page.locator(`${RESULT} .pp-dv-countline`))
            .toHaveText('Device reports 3 records; local file has 5.');
        await expect(page.locator(`${RESULT} .pp-dv-caption`)).toHaveText('1 of 3 records differ');
        // The count mismatch IS the named cause — no pattern line over it.
        await expect(page.locator(`${RESULT} .pp-dv-diag`)).toHaveCount(0);
        // The shared range still diffs; host rows past it stay quiet.
        await expect(page.locator(DV_ROWS).nth(1)).toHaveClass(/mismatch/);
        await expect(page.locator(`${DV_ROWS}.mismatch`)).toHaveCount(1);
        expect((await paneState(page)).detail.diff.mismatched).toEqual([1]);
    });

    test('(f2) same count but misaligned: partial line, no "All N match" claim, no pattern (AC-6) @fast', async ({ page }) => {
        // Device carries 5 record lines (== host count) but its indices are
        // {0,1,2,3,7}: records 0-3 match, host record 4 is never compared, and
        // index 7 is out of range. parsed.count coincidentally equals hostCount,
        // so the pre-fix code slipped past the count guard and could name a
        // spurious pattern / claim "All match". Now it must report the partial
        // overlap and stay pattern-free.
        const text = await page.evaluate(async ({ content }) => {
            const { analyzeCsum } = await import('/renderer/csum.js');
            const a = analyzeCsum(new Uint8Array(content));
            const hx4 = (n) => n.toString(16).toUpperCase().padStart(4, '0');
            const lines = [0, 1, 2, 3].map((i) => `${hx4(i)}: ${a.records[i]}`);
            lines.push(`${hx4(7)}: FFFF`);   // out-of-range record pads the count
            lines.push(a.crc);               // whole-file CRC matches — still no "All match"
            return lines.join('\r\n') + '\r\n';
        }, { content: FIVE_REC.content });
        await dropDiff(page, text);
        await expect(page.locator(`${RESULT} .pp-dv-countline`))
            .toHaveText("Compared 4 of 5 records — the dropped listing doesn't line up with this file.");
        await expect(page.locator(`${RESULT} .pp-dv-caption`)).toHaveCount(0);
        await expect(page.locator(`${RESULT} .pp-dv-diag`)).toHaveCount(0);
        await expect(page.locator(`${DV_ROWS}.mismatch`)).toHaveCount(0);
    });

    test('(f3) same count, zero overlap: partial line shown, result region never blank (AC-6) @fast', async ({ page }) => {
        // Every device index out of host range (5..9) with a matching count —
        // the pre-fix path produced an empty, silent result box. Now the
        // partial line explains it and the region stays visible.
        const text = await page.evaluate(() => {
            const hx4 = (n) => n.toString(16).toUpperCase().padStart(4, '0');
            return [5, 6, 7, 8, 9].map((i) => `${hx4(i)}: FFFF`).join('\r\n') + '\r\n';
        });
        await dropDiff(page, text);
        await expect(page.locator(RESULT)).toBeVisible();
        await expect(page.locator(`${RESULT} .pp-dv-countline`))
            .toHaveText("Compared 0 of 5 records — the dropped listing doesn't line up with this file.");
        await expect(page.locator(`${RESULT} .pp-dv-caption`)).toHaveCount(0);
        await expect(page.locator(`${DV_ROWS}.mismatch`)).toHaveCount(0);
    });

    test('(g2) failure: verbatim message, zero highlights, view open, zero transmit (AC-7/8) @fast', async ({ page }) => {
        // tx capture (pull-pane.spec.js armTxCapture pattern) — the diff path
        // must transmit NOTHING.
        await page.evaluate(async () => {
            const tx = await import('/input/tx-sink.js');
            tx.resetTx();
            tx.registerWriter({ write: async () => {} });
            window.__txPushes = 0;
            tx.registerTxObserver(() => { window.__txPushes++; });
        });
        await dropDiff(page, 'A>DIR\r\nsome prose that is not a capture   \r\nA>');
        await expect(page.locator(`${RESULT} .pp-dv-fail`))
            .toHaveText('No CSUM -V records found in the dropped text.');
        await expect(page.locator(`${DV_ROWS}.mismatch`)).toHaveCount(0);
        await expect(page.locator(CARD)).toHaveAttribute('data-view', 'detail');
        const st = await paneState(page);
        expect(st.review).toBeNull();
        expect(st.detail.diff).toEqual({
            caption: null, countLine: null, diagnosis: null, mismatched: [], error: 'No CSUM -V records found in the dropped text.',
        });
        expect(await page.evaluate(() => window.__txPushes)).toBe(0);
        await page.evaluate(async () => {
            const tx = await import('/input/tx-sink.js');
            tx.unregisterWriter();
            tx.resetTx();
            delete window.__txPushes;
        });
    });

    test('(h) wire-ownership: the diff drop lands under an active SLIDE session; a no-detail drop stays refused (AC-8, FR-11) @fast', async ({ page }) => {
        await page.evaluate(() => window.__pullPane.__setSlideActiveForTests(true));
        await dropDiff(page, await buildDeviceText(page, FIVE_REC.content));
        await expect(page.locator(`${RESULT} .pp-dv-caption`)).toHaveText('All 5 records match · CRC match');
        // Back to the list — with the session still active, the S9.3 pull
        // branch keeps its refusal exactly as shipped.
        await page.locator('#pull-pane-detail-back').click();
        await dragState(page, { active: true, text: 'GAME.COM' });
        expect(await dispatchDrag(page, 'dragenter', 'GAME.COM')).toBe(true);
        expect(await dispatchDrag(page, 'drop', 'GAME.COM')).toBe(true);
        expect((await paneState(page)).review).toBeNull();
        await dragState(page, { active: false });
        await page.evaluate(() => window.__pullPane.__setSlideActiveForTests(null));
    });

    test('(i) a second drop fully resets the previous diff before painting the new one (AC-5/7) @fast', async ({ page }) => {
        await dropDiff(page, await buildDeviceText(page, FIVE_REC.content, { flip: [1] }));
        await expect(page.locator(DV_ROWS).nth(1)).toHaveClass(/mismatch/);
        await dropDiff(page, await buildDeviceText(page, FIVE_REC.content, { flip: [2] }));
        // Row 1's marks are fully gone; row 2 carries them now.
        const row1 = page.locator(DV_ROWS).nth(1);
        await expect(row1).not.toHaveClass(/mismatch/);
        expect(await row1.getAttribute('title')).toBeNull();
        await expect(row1.locator('.pp-dv-ne')).toHaveCount(0);
        await expect(page.locator(DV_ROWS).nth(2)).toHaveClass(/mismatch/);
        await expect(page.locator(`${RESULT} .pp-dv-caption`)).toHaveText('1 of 5 records differ');
        // A failed drop also replaces a painted diff — the region always
        // reflects the LAST drop.
        await dropDiff(page, 'nothing parseable here');
        await expect(page.locator(`${RESULT} .pp-dv-fail`))
            .toHaveText('No CSUM -V records found in the dropped text.');
        await expect(page.locator(`${DV_ROWS}.mismatch`)).toHaveCount(0);
        await expect(page.locator(`${RESULT} .pp-dv-caption`)).toHaveCount(0);
    });

    test('(j2) a refresh while a diff is painted repaints nothing in the detail (AC-5) @fast', async ({ page }) => {
        await dropDiff(page, await buildDeviceText(page, FIVE_REC.content, { flip: [1] }));
        // Tag the painted nodes to prove identity survives (S10.1 spec (h) pattern).
        await page.evaluate(() => {
            document.getElementById('pull-pane-detail-result').dataset.tag = 'painted';
            document.querySelectorAll('#pull-pane-detail-rows .pp-dv-row')[1].dataset.tag = 'row1';
        });
        await page.evaluate((extra) => {
            window.__ppFake.__setFiles([
                { name: 'FIVE.BIN', content: Array.from({ length: 640 }, (_, i) => (i * 7) % 256), mtime: 100 },
                extra,
            ]);
            return window.__pullPane.__timerTickForTests();
        }, COLUMN_FILES[0]);
        await page.waitForFunction(() => window.__pullPane.__getStateForTests().fileCount === 2);
        await expect(page.locator(CARD)).toHaveAttribute('data-view', 'detail');
        expect(await page.evaluate(() => document.getElementById('pull-pane-detail-result').dataset.tag)).toBe('painted');
        expect(await page.evaluate(() =>
            document.querySelectorAll('#pull-pane-detail-rows .pp-dv-row')[1].dataset.tag)).toBe('row1');
        await expect(page.locator(DV_ROWS).nth(1)).toHaveClass(/mismatch/);
        await expect(page.locator(`${RESULT} .pp-dv-caption`)).toHaveText('1 of 5 records differ');
        // Back lands on the updated list, new arrival included.
        await page.locator('#pull-pane-detail-back').click();
        await expect(page.locator(ROWS)).toHaveCount(2);
    });

    test('(k) bloom: a drag with a diffable detail blooms the rail; a landed diff keeps it; Back un-blooms (AC-9) @fast', async ({ page }) => {
        const text = await buildDeviceText(page, FIVE_REC.content, { flip: [1] });
        await page.setViewportSize({ width: 720, height: 900 });
        await expect(page.locator('#pull-pane .pp-rail')).toBeVisible();
        const bloom = () => page.evaluate(() => window.__pullPane.__getStateForTests().bloom);
        // A drag that ends WITHOUT a drop un-blooms as today.
        await dragState(page, { active: true, text });
        expect(await bloom()).toBe(true);
        await expect(page.locator(CARD)).toBeVisible();
        await dragState(page, { active: false });
        expect(await bloom()).toBe(false);
        // A drag whose drop lands a diff keeps the bloom — ‹ Back is its exit.
        await dragState(page, { active: true, text });
        expect(await bloom()).toBe(true);
        await dispatchDrag(page, 'dragenter', text);
        await dispatchDrag(page, 'drop', text);
        await dragState(page, { active: false });
        expect(await bloom()).toBe(true);
        await expect(page.locator(`${RESULT} .pp-dv-caption`)).toHaveText('1 of 5 records differ');
        await page.locator('#pull-pane-detail-back').click();
        expect(await bloom()).toBe(false);
        await expect(page.locator(CARD)).toBeHidden();
        expect((await paneState(page)).detail).toBeNull();
    });
});

// ═══════════════ S10.2 (a) parseCsumV unit (AC-1) ═══════════════
//
// Grammar pinned by csumhost.c:80,86 ("%04X: %04X\n" records, "%08lX\n" CRC)
// and the real capture ../beast_csum/pc.txt. The clean fixture is built from a
// real analyzeCsum result (self-consistent oracle — story T1); the noisy one
// wraps it in the terminal-selection noise envelope (echoed command, prompts,
// blank lines, 80-column trailing spaces).

// Page-side fixture builder: analyze content → the exact -V output text.
const BUILD_CLEAN = `
  (async (content) => {
    const { analyzeCsum } = await import('/renderer/csum.js');
    const a = analyzeCsum(new Uint8Array(content));
    const lines = a.records.map((v, i) => i.toString(16).toUpperCase().padStart(4, '0') + ': ' + v);
    return { records: a.records, crc: a.crc, text: lines.join('\\r\\n') + '\\r\\n' + a.crc + '\\r\\n' };
  })
`;

// Serialize the Map across the evaluate boundary as sorted [index, value] pairs.
const parseInPage = (page, text) => page.evaluate(async (t) => {
    const { parseCsumV } = await import('/renderer/csum.js');
    const r = parseCsumV(t);
    return { entries: [...r.records.entries()].sort((a, b) => a[0] - b[0]), count: r.count, crc: r.crc };
}, text);

test.describe('S10.2 — parseCsumV unit', () => {
    test('clean capture (real analyzeCsum output) → records + CRC @fast', async ({ page }) => {
        await page.goto('/');
        const clean = await page.evaluate(`${BUILD_CLEAN}(${JSON.stringify(VECTORS[2].content)})`);
        expect(clean.records).toEqual(VECTORS[2].records);   // oracle sanity
        const res = await parseInPage(page, clean.text);
        expect(res.count).toBe(2);
        expect(res.crc).toBe(VECTORS[2].crc);
        expect(res.entries).toEqual([[0, VECTORS[2].records[0]], [1, VECTORS[2].records[1]]]);
    });

    test('noisy capture (echoed command, prompts, blanks, trailing spaces) → identical result @fast', async ({ page }) => {
        await page.goto('/');
        const clean = await page.evaluate(`${BUILD_CLEAN}(${JSON.stringify(VECTORS[2].content)})`);
        const noisy = 'A>CSUM -V TWO.BIN   \r\n\r\n'
            + clean.text.split('\r\n').map((l) => `${l}     `).join('\r\n')
            + '\r\nA> \r\n';
        const [cleanRes, noisyRes] = [await parseInPage(page, clean.text), await parseInPage(page, noisy)];
        expect(noisyRes).toEqual(cleanRes);
        expect(noisyRes.count).toBe(2);
    });

    test('garbage → zero records, null CRC; records-without-CRC → crc null @fast', async ({ page }) => {
        await page.goto('/');
        const garbage = await parseInPage(page, 'hello world\r\nnothing: here either\r\nA>');
        expect(garbage).toEqual({ entries: [], count: 0, crc: null });
        const noCrc = await parseInPage(page, '0000: 9ADF\r\n0001: 482A\r\n');
        expect(noCrc.count).toBe(2);
        expect(noCrc.crc).toBeNull();
        // A whole-file CSUM output (CRC only, zero record lines) parses as
        // zero records — FR-9's defined failure input.
        const crcOnly = await parseInPage(page, 'A>CSUM TWO.BIN\r\nEB945AF8\r\nA>');
        expect(crcOnly.count).toBe(0);
        expect(crcOnly.crc).toBe('EB945AF8');
    });

    test('duplicate index → last wins; lowercase hex normalizes; LAST 8-hex line is the CRC @fast', async ({ page }) => {
        await page.goto('/');
        const res = await parseInPage(page, '0000: 1111\r\n0000: 2222\r\n0001: abcd\r\ndeadbeef\r\n0BADF00D\r\n');
        expect(res.entries).toEqual([[0, '2222'], [1, 'ABCD']]);
        expect(res.count).toBe(2);
        expect(res.crc).toBe('0BADF00D');
    });
});

// ═══════════════ S10.2 (b) classifyCsumDiff unit (AC-2) ═══════════════

test.describe('S10.2 — classifyCsumDiff unit', () => {
    test('kinds, precedence, and boundaries @fast', async ({ page }) => {
        await page.goto('/');
        const out = await page.evaluate(async () => {
            const { classifyCsumDiff } = await import('/renderer/csum.js');
            const c = (hostCount, deviceCount, mismatched) =>
                classifyCsumDiff({ hostCount, deviceCount, mismatched });
            return {
                countBeatsTail: c(10, 8, [9]),
                none: c(10, 10, []),
                tail: c(10, 10, [9]),
                midfileNone: c(10, 10, [4]),
                runOfTwo: c(10, 10, [3, 4]),
                runNotStride: c(10, 10, [4, 5, 6]),     // contiguous AP (stride 1) → run wins
                runAtTail: c(10, 10, [8, 9]),           // run of 2 ending at the tail is a run, not tail
                stride3: c(20, 20, [0, 3, 6, 9]),
                strideMinMembers: c(10, 10, [1, 3, 5]), // exactly 3 members, stride 2 (boundary)
                twoSpacedNone: c(10, 10, [0, 4]),       // 2 members, stride-shaped but < 3 → none
                raggedNone: c(10, 10, [0, 1, 5]),       // neither run nor progression → none
            };
        });
        expect(out.countBeatsTail).toEqual({ kind: 'count' });
        expect(out.none).toEqual({ kind: 'none' });
        expect(out.tail).toEqual({ kind: 'tail' });
        expect(out.midfileNone).toEqual({ kind: 'none' });
        expect(out.runOfTwo).toEqual({ kind: 'run' });
        expect(out.runNotStride).toEqual({ kind: 'run' });
        expect(out.runAtTail).toEqual({ kind: 'run' });
        expect(out.stride3).toEqual({ kind: 'stride', n: 3 });
        expect(out.strideMinMembers).toEqual({ kind: 'stride', n: 2 });
        expect(out.twoSpacedNone).toEqual({ kind: 'none' });
        expect(out.raggedNone).toEqual({ kind: 'none' });
    });
});
