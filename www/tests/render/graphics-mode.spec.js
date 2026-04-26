// VT52 graphics-mode (ESC F / ESC G) end-to-end through the wasm boundary.
// Verifies Cell.flags bit 2 is observable in the JS gridView after print.

import { test, expect } from '@playwright/test';

test('ESC F + 0x61 sets Cell.flags bit 2 in the JS gridView', async ({ page }) => {
    await page.goto('/');
    await page.waitForFunction(() => document.getElementById('terminal').width > 0);

    const result = await page.evaluate(async () => {
        const wasm = await import('/pkg/bestialitty_core.js');
        const wasmInstance = await wasm.default();
        const memory = wasmInstance.memory;
        const term = new wasm.Terminal(24, 80, 100);
        term.feed(new TextEncoder().encode('\x1b\x46\x61')); // ESC F + 'a'
        term.snapshot_grid();
        const view = new Uint8Array(memory.buffer, term.grid_ptr(), term.grid_byte_len());
        return {
            ch:    view[0],
            flags: view[6],
            firstEightBytes: Array.from(view.slice(0, 16)),
        };
    });
    console.log('graphics-mode test result:', JSON.stringify(result));

    expect(result.ch).toBe(0x61);
    expect(result.flags & 0x04).toBe(0x04);
});
