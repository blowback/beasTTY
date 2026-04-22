// BestialiTTY Phase 3 — Playwright config (Chromium-only per CLAUDE.md).
// Source: RESEARCH §Validation Architecture + §Phase Requirements → Test Map.
import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './tests/render',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: 'list',
  use: {
    baseURL: 'http://localhost:8000/',
    trace: 'retain-on-failure',
  },
  // HiDPI verification per RENDER-10 / RESEARCH §Pattern 1:
  // deviceScaleFactor: 2 emulates a 2× Retina display. Canvas.width
  // MUST equal cssWidth × 2 for the HiDPI test to pass.
  projects: [
    {
      name: 'chromium',
      use: {
        ...devices['Desktop Chrome'],
        deviceScaleFactor: 2,
        viewport: { width: 1440, height: 900 },
      },
    },
  ],
  // The dev server is a static http.server that serves www/.
  // Test runner should assume it is already running on port 8000
  // (see www/README.md "Serve" section — start it manually or via CI).
  webServer: process.env.PLAYWRIGHT_NO_WEBSERVER ? undefined : {
    command: 'python3 -m http.server -d . 8000',
    port: 8000,
    reuseExistingServer: !process.env.CI,
    timeout: 30_000,
  },
  expect: {
    // Visual regression: allow 1% pixel diff for font antialiasing jitter.
    toHaveScreenshot: { maxDiffPixelRatio: 0.01 },
  },
});
