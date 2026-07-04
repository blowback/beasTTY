// Beastty Phase 3 — Playwright config (Chromium-only per CLAUDE.md).
// Source: RESEARCH §Validation Architecture + §Phase Requirements → Test Map.
import { defineConfig, devices } from '@playwright/test';

// Shared browser config — every project runs Chromium at 2× (HiDPI verification
// per RENDER-10 / RESEARCH §Pattern 1: deviceScaleFactor: 2 emulates a 2× Retina
// display; Canvas.width MUST equal cssWidth × 2 for the HiDPI test to pass).
const chromiumUse = {
  ...devices['Desktop Chrome'],
  deviceScaleFactor: 2,
  viewport: { width: 1440, height: 900 },
};

export default defineConfig({
  testDir: './tests',
  testMatch: ['**/render/*.spec.js', '**/input/*.spec.js', '**/transport/*.spec.js', '**/session/*.spec.js'], // Phase 6 Plan 01 (Wave 0) — extends test discovery to include tests/session/ specs.
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  // E1 retro action #1 — the pre-existing "shifting failure set" flake was pure
  // resource contention: too many transport specs booting the wasm core at once
  // starved the connect handshake past its short (~2 s) polls. Fixed two ways:
  //   (a) the transport specs run in their own NON-fully-parallel project below,
  //       so 25 wasm-heavy boots no longer fan out simultaneously; and
  //   (b) one automatic retry (local + CI) self-heals any residual boot-under-
  //       load timeout, so a momentary starvation is no longer a suite failure
  //       that needs per-story `--workers=1` re-diagnosis.
  retries: 1,
  reporter: 'list',
  use: {
    baseURL: 'http://localhost:8000/',
    trace: 'retain-on-failure',
  },
  projects: [
    {
      // Light specs (pure-logic / render / DOM) — safe to run fully parallel.
      name: 'chromium',
      testMatch: ['**/render/*.spec.js', '**/input/*.spec.js', '**/session/*.spec.js'],
      use: chromiumUse,
    },
    {
      // Transport specs each boot the wasm core AND drive a serial connect
      // handshake — the expensive combination that starved under full parallelism.
      // fullyParallel: false keeps each file's tests sequential (no intra-file
      // fan-out), capping peak concurrent wasm boots at the worker count instead
      // of the full 25-spec set. Judged green in isolation is now the default.
      name: 'chromium-transport',
      testMatch: ['**/transport/*.spec.js'],
      fullyParallel: false,
      use: chromiumUse,
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
