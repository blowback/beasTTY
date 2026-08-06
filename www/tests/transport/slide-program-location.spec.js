// Beastty — where SLIDE.COM lives (prefs v2; replaces the Phase 12 SLIDE-38
// auto-send command safety spec this file grew from).
//
// v1 stored the whole CP/M line Beastty auto-typed ('B:SLIDE R\r') and guarded
// it with a loose regex plus a first-use confirmation chip. v2 stores a drive
// (dropdown) and a CP/M 8.3 program name, and appends the direction letter
// itself — `R` to send, `S` to pull. That narrowed grammar is what retired the
// confirmation ceremony: there is no arbitrary command left to confirm. What it
// did NOT retire is the use-time hard gate (T-12-03) — a hand-edited or corrupt
// localStorage blob can still carry anything, so nothing unvalidated reaches
// the wire.
//
// Covers: the name/drive grammar, path composition, the Settings validity cue
// (attribute + hint + red border round-trip), save-not-blocked, the use-time
// gate, the auto-start switch, live-read without reload, and the v1 → v2
// migration.
//
// Helpers (setup/setupConnected) copied verbatim from slide-prefs.spec.js +
// slide-sender.spec.js per Phase 8/9/10/11 spec-isolation precedent — DO
// NOT cross-import.

import { test, expect } from '@playwright/test';
import { SERIAL_MOCK } from './mock-serial.js';
import { MOCK_SERIAL_SLIDE_BOT } from './mock-serial-slide-bot.js';

async function setup(page) {
    await page.addInitScript(SERIAL_MOCK);
    await page.addInitScript(MOCK_SERIAL_SLIDE_BOT);
    await page.goto('/');
    await page.locator('#terminal-wrapper').focus();
    await page.waitForFunction(() => document.getElementById('terminal').width > 0);
    // E3.4 — setup stays modal-free: setupConnected() clicks the top-bar #connect-button,
    // which native <dialog> showModal() would make inert. Tests that manipulate the
    // location controls call openSlideModal(page) explicitly (they live in
    // #slide-config-modal, not the removed <details id="settings-slide"> pane).
}

// E3.4 — open the SLIDE File Transfer modal (Settings ▸ SLIDE File Transfer…) so the
// location controls + validation hint are in the top layer and interactable.
async function openSlideModal(page) {
    await page.waitForFunction(() => window.__menuBar
        && typeof window.__menuBar.open === 'function'
        && typeof window.__modal === 'object' && window.__modal !== null);
    await page.evaluate(() => window.__menuBar.open('settings'));
    await page.click('#dropdown-settings .menu-item[data-action="slide-config"]');
    await page.locator('#slide-config-modal').waitFor({ state: 'visible' });
}

async function setupConnected(page) {
    await setup(page);
    await page.evaluate(() => window.__menuBar.open('connection'));
    await page.click('#menu-connect-item');
    // Generous timeout — Playwright's 10-worker parallelism can starve
    // the wasm boot path on busy hardware (Phase 11 5s precedent — 8s
    // covers worst-case Chromium scheduling under heavy load).
    await expect.poll(
        () => page.evaluate(() => Boolean(navigator.serial._grantedPorts[0]?._reader)),
        { timeout: 8000 },
    ).toBe(true);
    await page.evaluate(() => {
        window.__slide && window.__slide.__resetForTests && window.__slide.__resetForTests();
        window.__fileSource && window.__fileSource.__resetForTests && window.__fileSource.__resetForTests();
        window.__slideChip && window.__slideChip.__resetForTests && window.__slideChip.__resetForTests();
        if (window.__mockWriterLog) window.__mockWriterLog.length = 0;
        window.__mockSlideBot && window.__mockSlideBot.reset && window.__mockSlideBot.reset();
    });
}


// ── The grammar ──
// A CP/M 8.3 program name, extension optional. Everything outside it is what
// the use-time gate exists to stop, so the reject table carries the T-12-03
// threat surface the v1 regex used to: separators, whitespace, control bytes,
// and the HTML-relevant characters (T-12-05).
// The name is not constrained to 'SLIDE' — Beastty only cares that the binary
// speaks the SLIDE protocol and takes the standard R / S argument, so a renamed
// one is a first-class case, not an edge case.
const VALID_NAMES = ['SLIDE.COM', 'SLIDE', 'BANANA.COM', 'S', 'ABCDEFGH.XYZ', 'SLIDE2.C0M', '12345678'];
const INVALID_NAMES = [
    { input: '',                 label: 'empty' },
    { input: 'slide.com',        label: 'lowercase (stored form is uppercase)' },
    { input: 'TOOLONGNAME.COM',  label: 'name over 8 chars' },
    { input: 'SLIDE.COMM',       label: 'extension over 3 chars' },
    { input: 'SLIDE R',          label: 'a direction letter — Beastty appends that itself' },
    { input: 'B:SLIDE',          label: 'a drive — that is the dropdown, not the name' },
    { input: 'SLIDE;RM',         label: 'semicolon injection' },
    { input: 'SLIDE\rDIR',       label: 'embedded CR' },
    { input: 'SLIDE\x07',        label: 'control char BEL' },
    { input: '<SLIDE>',          label: 'HTML-relevant characters' },
];

for (const name of VALID_NAMES) {
    test(`program name accepted: ${name}`, async ({ page }) => {
        await setup(page);
        expect(await page.evaluate(
            (n) => window.__prefs.__isValidProgramNameForTests(n), name)).toBe(true);
    });
}

for (const tc of INVALID_NAMES) {
    test(`program name rejected: ${tc.label}`, async ({ page }) => {
        await setup(page);
        expect(await page.evaluate(
            (n) => window.__prefs.__isValidProgramNameForTests(n), tc.input)).toBe(false);
    });
}

test('slideProgramPath composes drive + name, and returns null when either half is unusable', async ({ page }) => {
    await setup(page);
    const path = (p) => page.evaluate((pp) => window.__prefs.__slideProgramPathForTests(pp), p);
    expect(await path({ slideProgramDrive: 'A:', slideProgramName: 'SLIDE.COM' })).toBe('A:SLIDE.COM');
    expect(await path({ slideProgramDrive: 'B:', slideProgramName: 'SLIDE' })).toBe('B:SLIDE');
    expect(await path({ slideProgramDrive: 'P:', slideProgramName: 'SLIDE.COM' })).toBe('P:SLIDE.COM');
    // CP/M stops at drive P.
    expect(await path({ slideProgramDrive: 'Z:', slideProgramName: 'SLIDE.COM' })).toBe(null);
    expect(await path({ slideProgramDrive: 'A', slideProgramName: 'SLIDE.COM' })).toBe(null);
    expect(await path({ slideProgramDrive: 'A:', slideProgramName: 'SLIDE R' })).toBe(null);
    expect(await path(null)).toBe(null);
    // The direction letter is deliberately NOT part of the path — the send and
    // pull call sites append their own.
    expect(await path({ slideProgramDrive: 'A:', slideProgramName: 'SLIDE.COM' })).not.toContain(' ');
});

// ── The Settings validity cue ──

test('Settings: an invalid program name sets data-invalid and shows the hint', async ({ page }) => {
    await setup(page);
    await openSlideModal(page);
    await expect(page.locator('#slide-program-validation-hint')).toBeHidden();
    await page.locator('#slide-program-name').fill('TOOLONGNAME.COM');
    await page.locator('#slide-program-name').dispatchEvent('change');
    await expect.poll(
        () => page.locator('#slide-program-name').getAttribute('data-invalid'),
        { timeout: 2000 },
    ).toBe('true');
    await expect(page.locator('#slide-program-validation-hint')).toBeVisible();
    await expect(page.locator('#slide-program-validation-hint'))
        .toHaveText("Not a CP/M 8.3 program name — SLIDE won't start.");
    // A valid name clears both.
    await page.locator('#slide-program-name').fill('SLIDE.COM');
    await page.locator('#slide-program-name').dispatchEvent('change');
    await expect(page.locator('#slide-program-validation-hint')).toBeHidden();
});

test('Settings: a lowercase name is stored uppercase, not rejected', async ({ page }) => {
    await setup(page);
    await openSlideModal(page);
    // CP/M's CCP folds the line to uppercase anyway, so typing 'slide.com'
    // must be accepted and canonicalised rather than marked invalid.
    await page.locator('#slide-program-name').fill('slide.com');
    await page.locator('#slide-program-name').dispatchEvent('change');
    await expect(page.locator('#slide-program-name')).toHaveValue('SLIDE.COM');
    await expect(page.locator('#slide-program-validation-hint')).toBeHidden();
    await expect.poll(
        () => page.evaluate(() => window.__prefs.getPrefs().slideProgramName),
        { timeout: 2000 },
    ).toBe('SLIDE.COM');
});

test('Settings: an invalid name still persists (save is never blocked)', async ({ page }) => {
    await setup(page);
    await openSlideModal(page);
    // Save-time validation is forbidden — the use-time gate is the wire-safety
    // boundary. This is what lets a user iterate without losing their text.
    await page.locator('#slide-program-name').fill('TOOLONGNAME.COM');
    await page.locator('#slide-program-name').dispatchEvent('change');
    await expect.poll(
        () => page.evaluate(() => {
            const raw = localStorage.getItem('beastty.prefs');
            if (!raw) return null;
            try { return JSON.parse(raw).slideProgramName; } catch { return null; }
        }),
        { timeout: 2000 },
    ).toBe('TOOLONGNAME.COM');
});

test('Settings: the drive dropdown persists', async ({ page }) => {
    await setup(page);
    await openSlideModal(page);
    await page.locator('#slide-program-drive').selectOption('B:');
    await expect.poll(
        () => page.evaluate(() => {
            const raw = localStorage.getItem('beastty.prefs');
            if (!raw) return null;
            try { return JSON.parse(raw).slideProgramDrive; } catch { return null; }
        }),
        { timeout: 2000 },
    ).toBe('B:');
});

test('Settings: an invalid name paints the red border, a valid one returns to base', async ({ page }) => {
    await setup(page);
    await openSlideModal(page);
    await page.locator('#slide-program-name').fill('TOOLONGNAME.COM');
    await page.locator('#slide-program-name').dispatchEvent('change');
    await expect.poll(
        () => page.locator('#slide-program-name').getAttribute('data-invalid'),
        { timeout: 2000 },
    ).toBe('true');
    // Blur so the :focus-visible rule no longer paints var(--chrome-accent);
    // after blur the higher-specificity invalid rule wins.
    await page.locator('#slide-program-name').blur();
    expect(await page.locator('#slide-program-name').evaluate(
        (el) => window.getComputedStyle(el).borderColor)).toBe('rgb(224, 64, 64)');
    // Round-trip back, so a regression that pins data-invalid permanently surfaces.
    await page.locator('#slide-program-name').fill('SLIDE.COM');
    await page.locator('#slide-program-name').dispatchEvent('change');
    await expect.poll(
        () => page.locator('#slide-program-name').getAttribute('data-invalid'),
        { timeout: 2000 },
    ).not.toBe('true');
    await page.locator('#slide-program-name').blur();
    expect(await page.locator('#slide-program-name').evaluate(
        (el) => window.getComputedStyle(el).borderColor)).toBe('rgba(255, 255, 255, 0.08)');
});

// ── The use-time gate + what actually reaches the wire ──

// Drive a send through the file picker (the user-facing flow) and return every
// byte the mock writer saw, as a string.
async function sendAndReadWire(page) {
    await page.setInputFiles('#send-file-input', {
        name: 'hello.txt', mimeType: 'text/plain', buffer: Buffer.from('hi'),
    });
    await expect(page.locator('#send-modal')).toBeVisible();
    await page.locator('#send-modal-send').click();
    await page.waitForTimeout(500);
    return page.evaluate(() => {
        const out = [];
        for (const entry of window.__mockWriterLog || []) {
            const bytes = entry.bytes || entry;
            for (let i = 0; i < bytes.length; i++) out.push(String.fromCharCode(bytes[i]));
        }
        return out.join('');
    });
}

test('the auto-start command is composed from the location', async ({ page }) => {
    await setupConnected(page);
    await page.evaluate(() => window.__prefs.savePrefs({
        slideProgramDrive: 'B:', slideProgramName: 'SLIDE',
    }));
    expect(await sendAndReadWire(page)).toContain('B:SLIDE R\r');
});

test('a location that fails the grammar types nothing at all (use-time gate)', async ({ page }) => {
    await setupConnected(page);
    // Plant an unusable value directly — the Settings controls cannot produce
    // one, but a hand-edited or corrupt blob can. Nothing may reach the wire.
    await page.evaluate(() => window.__prefs.savePrefs({
        slideProgramDrive: 'A:', slideProgramName: 'SLIDE;RM',
    }));
    const wire = await sendAndReadWire(page);
    expect(wire).not.toContain(';');
    expect(wire).not.toContain('SLIDE');
});

test('auto-start off types nothing, but the location still composes the pull command', async ({ page }) => {
    await setupConnected(page);
    await page.evaluate(() => window.__prefs.savePrefs({
        slideAutoStart: false, slideProgramDrive: 'B:', slideProgramName: 'SLIDE',
    }));
    expect(await sendAndReadWire(page)).not.toContain('B:SLIDE R');
    // sendAndReadWire leaves a QUEUED send behind — with auto-start off nothing
    // is typed, so no wakeup arrives and pendingSendSession stays set (the chip
    // sits in awaiting-wakeup with its Cancel). Clear it before touching the
    // pull side, because this case is about pref composition, not about what
    // happens when a pull is composed on top of a queued send.
    //
    // Added by the E11 retrospective's predicate consolidation (2026-08-06):
    // pull-pane's suspension check used to miss the queued-send window that
    // peer-link's already covered, and unifying them onto isTransferRunning()
    // closed it. Without this reset the case fails for a reason that has
    // nothing to do with what it is testing.
    await page.evaluate(() => window.__slide.__resetForTests());
    // The pull side is unaffected — that is why auto-start is its own switch
    // rather than a blank program name.
    await page.evaluate(() => window.__pullPane.beginReview('GAME.COM'));
    expect(await page.evaluate(
        () => window.__pullPane.__getStateForTests().review.command)).toBe('B:SLIDE S GAME.COM');
});

test('a location change reaches the wire with no page reload', async ({ page }) => {
    // Regression for .planning/debug/slide-stale-auto-send-cmd.md: slide.js
    // used to hold a boot-time prefs snapshot, so a Settings edit only took
    // effect after a reload. savePrefs is what the change handlers call.
    await setupConnected(page);
    await page.evaluate(() => window.__prefs.savePrefs({
        slideProgramDrive: 'C:', slideProgramName: 'DIFFER',
    }));
    expect(await sendAndReadWire(page)).toContain('C:DIFFER R\r');
});

// ── v1 → v2 migration ──

// Seed a v1 blob before the app boots, then read back what v2 made of it.
function withV1Blob(page, slideAutoSendCommand) {
    return page.addInitScript((cmd) => {
        localStorage.setItem('beastty.prefs', JSON.stringify({
            version: 1, theme: 'crt', slideAutoSendCommand: cmd,
            slideAutoSendCommandConfirmed: cmd,
        }));
    }, slideAutoSendCommand);
}

const MIGRATIONS = [
    { v1: 'B:SLIDE R\r', drive: 'B:', name: 'SLIDE',     autoStart: true,  label: 'the v1 default' },
    { v1: 'A:slide\r',   drive: 'A:', name: 'SLIDE',     autoStart: true,  label: 'lowercase, no direction letter' },
    { v1: 'P:SLIDE.COM R\r', drive: 'P:', name: 'SLIDE.COM', autoStart: true, label: 'explicit extension' },
    // A renamed binary carries over intact — it still speaks the protocol.
    { v1: 'A:BANANA.COM R\r', drive: 'A:', name: 'BANANA.COM', autoStart: true, label: 'a renamed SLIDE binary' },
    // No drive in the v1 line meant "whatever drive is current"; v2 always
    // states one, so the default applies.
    { v1: 'SLIDE R\r',   drive: 'A:', name: 'SLIDE',     autoStart: true,  label: 'no drive' },
    // v1's empty string was the disabled sentinel — now an explicit switch.
    { v1: '',            drive: 'A:', name: 'SLIDE.COM', autoStart: false, label: 'the disabled sentinel' },
    // v1 stored a whole command line, so it could hold something that is not a
    // SLIDE invocation at all. Reducing those to their program token would make
    // Beastty auto-type a command the user never wrote, so they fall back to the
    // defaults instead. Both fallback branches: an argument that is not a
    // direction letter, and more arguments than a direction letter could be.
    { v1: 'A:SLIDE X\r',       drive: 'A:', name: 'SLIDE.COM', autoStart: true, label: 'an argument that is not R or S' },
    { v1: 'A:SLIDE R QUIET\r', drive: 'A:', name: 'SLIDE.COM', autoStart: true, label: 'more than a direction letter' },
];

for (const m of MIGRATIONS) {
    test(`v1 → v2 migration: ${m.label}`, async ({ page }) => {
        await withV1Blob(page, m.v1);
        await setup(page);
        const p = await page.evaluate(() => window.__prefs.getPrefs());
        expect(p.slideProgramDrive).toBe(m.drive);
        expect(p.slideProgramName).toBe(m.name);
        expect(p.slideAutoStart).toBe(m.autoStart);
        expect(p.version).toBe(2);
        // The dead v1 fields must not survive the upgrade.
        expect(p.slideAutoSendCommand).toBeUndefined();
        expect(p.slideAutoSendCommandConfirmed).toBeUndefined();
    });
}

test('v1 → v2 migration preserves unrelated stored prefs', async ({ page }) => {
    await page.addInitScript(() => {
        localStorage.setItem('beastty.prefs', JSON.stringify({
            version: 1, phosphor: 'amber', slideShowSummary: false,
            slideAutoSendCommand: 'B:SLIDE R\r',
        }));
    });
    await setup(page);
    const p = await page.evaluate(() => window.__prefs.getPrefs());
    expect(p.phosphor).toBe('amber');
    expect(p.slideShowSummary).toBe(false);
    expect(p.slideProgramDrive).toBe('B:');
});
