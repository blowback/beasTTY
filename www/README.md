# Beastty Phase 2 Harness (www/)

This directory is the static-site deliverable for Phase 2: a minimal
`index.html` + `main.js` harness that loads the wasm-pack-built Rust core
and proves the boundary shape end-to-end. Phase 3 replaces the harness with
the real canvas renderer; until then, this is the dev loop.

## Build

From the repo root:

    ./scripts/build.sh

This runs `wasm-pack build --target web` and writes the output to
`www/pkg/` (gitignored). Re-run whenever you touch `crates/beastty-core/`.

If your `wasm-pack` does not have `wasm-opt` on PATH, the build will warn
but still succeed. To suppress the warning in dev:

    wasm-pack build crates/beastty-core --target web --out-dir ../../www/pkg --no-opt

## Serve (pick one -- both work; per D-14)

### Option A -- Python 3.12 (no install needed on Linux/macOS)

    python3 -m http.server -d www 8000

Open http://localhost:8000/ in a Chromium-based browser. Python 3.7.2+
serves `.wasm` as `application/wasm`, which Chromium's streaming compile
requires.

### Option B -- basic-http-server (single Rust binary)

    cargo install basic-http-server    # once
    basic-http-server www              # default port 4000

Open http://localhost:4000/.

Do NOT use a Node-based server (`npx serve`, `vite`, etc.) -- per D-14
the dev loop is kept Node-free.

## Phase 2 Success Criteria -- manual verification

The four ROADMAP Success Criteria for Phase 2 are browser-demonstrations,
not cargo tests. After `./scripts/build.sh` and a running server:

### SC-1: wasm-pack -> loadable pkg/

1. Open Chromium DevTools Console before loading the page.
2. Navigate to http://localhost:8000/.
3. Expect exactly these log lines and NO errors:

        [boot] encode_key_raw(ArrowUp, none) = [27, 65]
        [boot] Harness ready. Terminal= ... wasm.memory= ...

The `[27, 65]` array is `[ESC, 'A']` -- the Rust `encode` function returned
the VT52 ArrowUp sequence across the wasm boundary.

### SC-2: paste -> feed() -> ASCII pre render

1. In the textarea, paste: `Hello\x1BY\x21\x20World`
   where `\x1B` = ESC, `Y` = direct-addressing, `\x21\x20` = row 1 col 0
   (the +32 ESC Y offset: row = 0x21 - 0x20 = 1, col = 0x20 - 0x20 = 0).
2. Click **Feed**.
3. `<pre id="grid">` shows `Hello` on row 0 and `World` starting at row 1 col 0.
4. `<span id="status">` shows `cursor=(1,5) bell=false` (after `World`, 5 chars).
5. `<pre id="dirty">` shows `11000...` -- rows 0 and 1 are dirty.

### SC-3: zero-copy Uint8Array views

1. DevTools -> Performance tab -> Record.
2. Click Feed 5 times, then Stop.
3. In the Memory track (or the Summary's Allocation breakdown), the
   per-frame allocation pattern should be flat after the initial view
   construction -- no growing heap from `Uint8Array` churn. The harness's
   defensive `reDeriveViews()` allocates two small `Uint8Array` objects per
   render (far less than 1 KB total) which is steady-state, not growing.

### SC-4: 64 KB in ONE feed() call

1. DevTools Console -> Clear.
2. Click **64 KB Stress**.
3. Expect exactly these log lines per click (ONE log, not 65,536):

        Terminal.feed 64KB: X ms
        [SC-4] Fed 65536 bytes in ONE feed() call
        [SC-4] Elapsed: N ms
        [SC-4] If this log appears ONCE (not 65536 times), SC-4 is satisfied.

4. For the flame-graph signal: DevTools Performance -> Record -> click
   **64 KB Stress** once -> Stop. Inspect the timeline: a single `Terminal.feed`
   (or `__wbg_feed_*`) frame should appear, lasting a few milliseconds.
   If 65,536 stacked `feed` frames appear, the harness is broken.

## Phase 3 Success Criteria -- manual verification

After `./scripts/build.sh` and a running server:

### SC-1: Canvas renders 80×24 grid without blur or font flash

1. Open http://localhost:8000/ in a Chromium-based browser.
2. Expect an 80×24 canvas in green-phosphor CRT theme with a visible block
   cursor at (0, 0). No font-loading flash at first paint.
3. On a Retina / 2× display: the pixel font is crisp, not blurred.

### SC-2: Theme toggle (Ctrl+Alt+T and UI button)

1. Click the top-bar button labelled "Clean" to switch to the clean theme
   (JetBrains Mono).
2. Press Ctrl+Alt+T to switch back to CRT. (Ctrl+Shift+T is reserved by Chromium for "reopen closed tab" and cannot be overridden from a web page — see 03-UAT.md gap #4.)
3. Each theme has a distinct cursor style.

### SC-3: Phosphor selection and integer zoom

1. In CRT theme, click Green / Amber / White in the phosphor radio-group.
   Canvas palette updates immediately.
2. Press Ctrl+= (or Ctrl++) to zoom in; Ctrl+- to zoom out; Ctrl+0 to reset.
3. Integer steps 1..4 only.

### SC-4: Bell overlay + background-tab title prefix

1. Open the Debug details pane.
2. Paste `\x07` into the textarea; click Feed.
3. Canvas flashes white for ~100 ms.
4. Background the tab; trigger another `\x07` feed; foreground the tab --
   title shows `(!) Beastty` then clears when you return.

### SC-5: Focus indicator + DPR-safe resize

1. Click the canvas -- a 1 px accent border appears on the wrapper; the
   cursor starts blinking.
2. Click elsewhere (e.g., the Debug textarea) -- the border becomes
   transparent (no layout reflow) and the cursor becomes a steady outlined
   block.
3. Drag the browser window between monitors with different DPR (if
   available) -- canvas stays crisp, no blur.

## Phase 2 SC-4 regression check (still works inside Debug pane)

1. Expand the "Debug" details below the canvas.
2. Click "64 KB Stress".
3. Console shows the Phase 2 SC-4 log lines exactly once per click.

## Bundle size (informational -- Phase 2 deferred concern)

After `./scripts/build.sh`:

    ls -lh www/pkg/beastty_core_bg.wasm

The wasm output for Phase 2 is typically in the 20-50 KB range (vte parser
+ boundary glue). Size-reduction work is Phase 6's concern.

## Troubleshooting

- `CompileError: Wasm decoding failed`: dev-server is serving `.wasm`
  with the wrong MIME type. Both recommended servers handle this correctly.
- `TypeError: Cannot perform %TypedArray%.prototype.length on detached
  ArrayBuffer`: a wasm `memory.grow` detached the view. `main.js` already
  calls `reDeriveViews()` on every render as a defensive guard. If this
  still appears, rerun `./scripts/build.sh` and reload.
- `ReferenceError: Terminal is not defined`: wasm build is out of date
  or `pkg/` is missing. Run `./scripts/build.sh` and hard-refresh (Ctrl-Shift-R).
- Firefox/Safari: Beastty is Chromium-only (CLAUDE.md hard
  constraint). Phase 6 ships the polite-fail UX; for Phase 2, use a
  Chromium-based browser.

## Files in this directory

| File | Tracked | Role |
|------|---------|------|
| `index.html` | yes | Minimal harness page with D-11/D-12 affordances |
| `main.js` | yes | ES-module driver: init, views, renderers, buttons |
| `README.md` | yes | This file |
| `.gitignore` | yes | Ignores `pkg/` |
| `pkg/` | NO | wasm-pack output, regenerated by `scripts/build.sh` |
| `renderer/canvas.js` | yes | Phase 3 -- rAF loop, HiDPI resize, cursor overdraw |
| `renderer/atlas.js` | yes | Phase 3 -- glyph atlas (OffscreenCanvas tiles) |
| `renderer/themes.js` | yes | Phase 3 -- CRT + clean theme descriptors + phosphor palette |
| `renderer/bitmap-font.js` | yes | Phase 3 -- hand-drawn 8×16 ASCII bitmap font Uint8Array |
| `renderer/chrome.js` | yes | Phase 3 -- DOM event wiring (theme toggle, phosphor, shortcuts) |
| `assets/fonts/jetbrains-mono-regular.woff2` | yes | Phase 3 -- self-hosted clean-theme font (OFL 1.1) |
| `assets/fonts/LICENSE-JetBrainsMono.txt` | yes | OFL 1.1 attribution |
| `package.json` | yes | Phase 3 -- Playwright dev-dependency |
| `playwright.config.js` | yes | Phase 3 -- Chromium-only test config, HiDPI enabled |
| `tests/` | yes | Phase 3 -- Playwright visual-regression tests |
| `node_modules/` | NO | `npm install` output; gitignored |
| `playwright-report/` | NO | Playwright HTML report; gitignored |
| `_headers` | yes | Phase 6 -- best-effort hosting headers (Cloudflare/Netlify honor; GitHub Pages ignores) |
| `.nojekyll` | yes | Phase 6 -- empty file disables Jekyll on GitHub Pages |

## Deployment

Beastty ships as a static site. The recommended deploy target is GitHub Pages.

### GitHub Pages

A push to the `main` branch triggers `.github/workflows/pages.yml`, which:
1. Installs the Rust toolchain + wasm-pack.
2. Runs `./scripts/build.sh` to produce `www/pkg/`.
3. Touches `www/.nojekyll` (committed file is also present as a redundancy).
4. Uploads `www/` as a Pages artifact.
5. Deploys via `actions/deploy-pages@v5`.

The deployed URL is `https://<user>.github.io/<repo>/`.

**One-time repo setting:** Before the workflow first runs, the repo owner must visit
Settings -> Pages and set "Build and deployment -> Source: GitHub Actions" (not "Deploy
from a branch"). Without this, the `actions/configure-pages` step fails on first push.
This is a one-time setup; subsequent pushes auto-deploy.

**CDN cache TTL:** GitHub Pages serves through a Fastly CDN with minute-grained TTL.
After a push, expect ~5-15 minute propagation before the new artifact appears at the
URL. Hard-refresh (Ctrl+Shift+R) is the user-side workaround. Cache-buster query string
`?_=<unix-timestamp>` confirms a fresh fetch. (RESEARCH Pitfall 8.)

### Custom HTTP headers

`www/_headers` declares `Permissions-Policy` + `Content-Security-Policy` +
`X-Content-Type-Options` + `Referrer-Policy` + a `pkg/*.wasm` MIME override.
**GitHub Pages does NOT honor `_headers`**
([GitHub Community 54257](https://github.com/orgs/community/discussions/54257) -- per
GitHub staff, custom HTTP headers are not supported on GitHub Pages). The fallback is
a `<meta http-equiv="Content-Security-Policy">` element in `www/index.html`. The
meta-tag enforces every directive EXCEPT `frame-ancestors`, which requires an actual
HTTP header to take effect (per CSP spec).

Hosting on Cloudflare Pages or Netlify (which honor `_headers`) gives full enforcement
of every directive in the file, including `frame-ancestors 'none'`. Self-hosting
behind nginx/Caddy lets you replicate the `_headers` semantics directly in the server
config.

### License

Beastty is MIT-licensed (SPDX `MIT`). See `LICENSE` at the repo root. The MIT
text is the canonical SPDX form with `Copyright (c) 2026 Ant Skelton`.

### Other targets

The static site is also deployable to:
- **Cloudflare Pages** -- `_headers` and `_redirects` honored natively. After running
  `./scripts/build.sh`, deploy with `wrangler pages deploy www/`.
- **Netlify** -- same `_headers` syntax. `netlify deploy --dir=www`.
- **Self-hosted nginx/Caddy** -- copy `www/` to the document root; replicate the
  `_headers` directives in the server config.

### Local development

Run a static HTTP server pointed at `www/`:

    cd www && python3 -m http.server 8000

Then visit http://localhost:8000/. The wasm module loads via the existing `pkg/`
directory produced by `./scripts/build.sh`.
