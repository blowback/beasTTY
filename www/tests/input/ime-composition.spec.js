// Phase 4 Plan 01 — SC-5 (IME half) — CompositionEvent lifecycle no double-emit (stub; Plan 04-04 fills body).
import { test, expect } from '@playwright/test';

test.describe('SC-5 — IME composition does not double-emit', () => {
  test('synthetic compositionstart/end emits once', async ({ page }) => {
    test.fixme(true, 'Plan 04-04 fills body after Plan 04-02; may remain fixmed if Playwright cannot drive isComposing');
  });
});
