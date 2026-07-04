// Beastty Epic E7 Story E7.1 — shared menu-driven test helpers.
//
// The legacy #top-bar #connect-button retired with #top-bar (AD-7), so specs that
// used to drive Connect/Disconnect by clicking that button now go through the
// Connection ▸ Connect/Disconnect menu row (menu-bar.js, the sole Connect-surface
// writer). Cross-import is the established pattern here (specs already import
// SERIAL_MOCK from ./mock-serial.js), so these helpers live in one place instead
// of being re-derived per spec.
//
// Serial-state oracle after E7.1: #menu-connect-item[data-state] (was
// #connect-button[data-state]).

// Open the Connection menu and click the Connect/Disconnect row (a toggle).
export async function menuToggleConnect(page) {
    await page.evaluate(() => window.__menuBar.open('connection'));
    await page.click('#menu-connect-item');
}

// Connect and wait until the menu Connect surface reports 'connected'. Mirrors the
// old commonReset/connectMockSerial wait on #connect-button[data-state=connected].
export async function menuConnect(page, timeout = 8000) {
    await menuToggleConnect(page);
    await page.waitForFunction(
        () => document.getElementById('menu-connect-item')?.getAttribute('data-state') === 'connected',
        undefined,
        { timeout },
    );
}
