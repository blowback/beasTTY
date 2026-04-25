// BestialiTTY Phase 6 Plan 01 (Wave 0) — PLAT-05/D-34 auto-connect-on-load stubs.
//
// All assertions are test.fixme until later waves un-fixme them as the
// corresponding feature lands. Mirrors Phase 5 Wave 0 discipline.
//
// Sources:
//   - 06-CONTEXT.md D-34 (auto-connect-on-load — off by default; opt-in silent open).
//   - 06-RESEARCH.md Pitfall 3 (race against user click — state must be 'disconnected'
//                                at moment of invocation).
//   - 06-VALIDATION.md §Phase Requirements → Test Map (auto-connect row).
//   - Analog: www/tests/transport/connect.spec.js + www/tests/transport/reconnect.spec.js.
import { test, expect } from '@playwright/test';
import { SERIAL_MOCK } from '../transport/mock-serial.js';

async function setup(page) {
    await page.addInitScript(SERIAL_MOCK);
    await page.goto('/');
    await page.locator('#terminal-wrapper').focus();
    await page.waitForFunction(() => document.getElementById('terminal').width > 0);
}

test.describe('PLAT-05/D-34 — Auto-connect on load', () => {
    test.fixme('prefs.autoConnect=false → no silent open at boot @fast', async ({ page }) => {
        // TODO: live in Wave 5 when main.js boot sequence + prefs.autoConnect gate land.
    });

    test.fixme('prefs.autoConnect=true + getPorts() match → silent connectMicroBeast() at boot', async ({ page }) => {
        // TODO: live in Wave 5 when main.js auto-connect silent-open path lands.
    });

    test.fixme('prefs.autoConnect=true + getPorts() empty → log "auto-connect-failed", remain disconnected', async ({ page }) => {
        // TODO: live in Wave 5 when main.js auto-connect failure logging lands.
    });

    test.fixme('prefs.autoConnect=true + open() rejects → log "auto-connect-failed: {err.message}"', async ({ page }) => {
        // TODO: live in Wave 5 when main.js auto-connect open-reject branch lands.
    });

    test.fixme('auto-connect race: state must be "disconnected" at moment of invocation (Pitfall 3)', async ({ page }) => {
        // TODO: live in Wave 5 when main.js auto-connect Pitfall 3 race-guard lands.
    });
});
