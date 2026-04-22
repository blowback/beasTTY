// Phase 4 Plan 01 — INPUT-03 — Ctrl-letter combinations transmit 0x01..0x1A (stub; Plan 04-04 fills body).
import { test, expect } from '@playwright/test';

test.describe('INPUT-03 — Ctrl-letter → control byte', () => {
  test('Ctrl+KeyL forwards 0x0C and keeps focus @fast', async ({ page }) => {
    test.fixme(true, 'Plan 04-04 fills body after Plan 04-02 implements keyboard.js');
  });
});
