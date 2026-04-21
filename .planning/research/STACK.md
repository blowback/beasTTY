# Stack Research

**Domain:** In-browser VT52 terminal emulator (Rust-core + JS-shell) for the MicroBeast Z80 retrocomputer
**Researched:** 2026-04-21
**Confidence:** HIGH (toolchain, bundler, web APIs), MEDIUM (parser crate fit for VT52), HIGH (fonts, testing)

## TL;DR

Use stable Rust with `wasm-bindgen` 0.2.118 + `wasm-pack` for the core, ship via **Vite 8 + `vite-plugin-wasm` (Menci)** to a static site, render with **2D Canvas + glyph atlas on an OffscreenCanvas**, drive I/O with the **Chromium Web Serial API from JS only**, and test Rust with `wasm-bindgen-test` + JS glue with `vitest`.

For the parser, **do NOT use `vte` (alacritty/vte) wholesale** — it implements the Paul Williams ANSI/VT100 state machine and VT52's escape grammar is a different (simpler) shape. **Hand-roll a small VT52 parser in Rust** instead. This is the single most important opinionated call in this research; everything else is standard 2026 Rust/wasm plumbing.

---

## Recommended Stack

### Core Technologies

| Technology | Version | Purpose | Why Recommended |
|---|---|---|---|
| **Rust** (stable, Edition 2024) | 1.85+ (2026 stable) | Language for parser, terminal state, key encoding | Standard language for wasm cores; `wasm32-unknown-unknown` is Tier 2 and well-trodden. Edition 2024 is current. |
| **`wasm-bindgen`** | **0.2.118** (April 2026) | Rust↔JS interop codegen | The standard. Paired with `wasm-pack`. 0.2.x line is stable and actively maintained by the `wasm-bindgen` org (repo moved out of `rustwasm/` to `wasm-bindgen/` org in 2025). |
| **`wasm-pack`** | **0.13.x** (2026) | Build orchestrator, runs `wasm-bindgen-cli`, emits JS glue + `pkg/` | Mandatory partner for `wasm-bindgen`. `wasm-pack build --target web` is the right target for this project (see "Stack Patterns" below). |
| **TypeScript** | **5.9.x** (stable 2026 line; 6.0 is out but 5.9 is the conservative pick; avoid 7.0-preview) | Type-checking for the JS shell | TS 6.0 drops ES5 target (fine here, Chromium-only). Stay on 5.9 unless something on the dep graph forces 6.0. |
| **Vite** | **8.0.9** (stable, released March 2026) | Dev server + static-site bundler | Rolldown-based, fast builds, first-class wasm support via `vite-plugin-wasm`. Produces a plain `dist/` tree deployable to GitHub Pages / Cloudflare Pages with no server runtime. |
| **`vite-plugin-wasm`** (by Menci) | **latest** (supports Vite 2–8) | Adds WebAssembly ESM integration to Vite and consumes `wasm-pack` output | Context7-verified (`/menci/vite-plugin-wasm`, benchmark score 90.5) as the mainstream `wasm-pack` + Vite integration. Pair with `vite-plugin-top-level-await` only if targeting pre-2022 browsers — for Chromium-only we can skip it and set `build.target: 'esnext'`. |
| **HTML Canvas 2D** (`CanvasRenderingContext2D`) | N/A (Web API) | Primary renderer | For a cell grid at ~80×24 with a scrollback buffer, 2D Canvas + a pre-rasterised glyph atlas comfortably hits 60 fps on any Chromium browser without needing WebGL. Simpler code, no shader maintenance. |
| **OffscreenCanvas** | N/A (Web API, widely supported in Chromium since 2019) | Move glyph-atlas generation + scrollback composition off the main thread | Lets us pre-rasterise the whole font atlas once in a Web Worker and transfer a bitmap without jank. Only needed for the atlas — main-thread rendering is fine for 80×24 redraws. |
| **Web Serial API** | N/A (Chromium-only Web API) | Serial I/O transport | Already a constraint. Driven entirely from JS. See "Key API Notes" below for the chunking gotcha. |

### Rust Crates

| Crate | Version | Purpose | When to Use |
|---|---|---|---|
| **`wasm-bindgen`** | 0.2.118 | Interop macros + `JsValue` | Every wasm crate needs this. |
| **`wasm-bindgen-futures`** | 0.4.58 | `JsFuture` ↔ Rust `Future` bridge | Only if we need to await JS promises from Rust. Likely **not needed** for this project — JS owns I/O, Rust is synchronous. |
| **`js-sys`** | 0.3.x (paired with wasm-bindgen 0.2.x) | JS standard-library bindings | Occasional — e.g. `Uint8Array` handling for byte slices coming in from Web Serial. |
| **`web-sys`** | 0.3.x | Raw Web API bindings | **Minimise use.** We specifically don't want Rust touching Web Serial / DOM / keyboard events. Only reach for it if strictly necessary (e.g. `console.log` via `web_sys::console` during dev). |
| **`serde` + `serde-wasm-bindgen`** | serde 1.0.x, serde-wasm-bindgen 0.6.x | Pass structured data across the boundary | If/when we need richer-than-primitive data (e.g. diff events). Start without it; add only if the API needs it. |
| **`tsify-next`** (fork of `tsify`) | 0.5.x | Auto-generate TypeScript `.d.ts` from Rust structs | Nice-to-have for keeping JS types in sync with Rust types. Not mandatory for v1. |
| **(custom) VT52 parser module** | in-repo | Parse VT52 escape sequences from the byte stream | **Hand-rolled.** See "What NOT to Use" for why existing crates don't fit. |
| **`thiserror`** | 1.x | Ergonomic error types in the parser/state machine | Optional — `Result<_, &'static str>` works for a crate this small. |

### JS / Build Dependencies

| Package | Version | Purpose | Notes |
|---|---|---|---|
| `vite` | 8.0.9 | Bundler + dev server | — |
| `vite-plugin-wasm` | latest | Consume `wasm-pack` output | From Menci; Context7-recommended. |
| `typescript` | 5.9.x | Type checking | — |
| `vitest` | 4.1.x | JS-side unit tests | Native Vite integration; mock `navigator.serial` via `vi.stubGlobal`. |
| `@types/w3c-web-serial` | latest | Ambient types for Web Serial | Web Serial isn't in `lib.dom.d.ts` by default — pull in community types or declare locally. |

### Development Tools

| Tool | Purpose | Notes |
|---|---|---|
| `cargo` (stable) | Build Rust | Pin in `rust-toolchain.toml` for reproducibility. |
| `cargo-watch` | Re-run tests on change | Dev convenience. |
| `wasm-pack` | Build + glue generator | Prefer invoking from an npm script so `npm run dev` bootstraps everything. |
| `wasm-bindgen-test` | Rust-in-browser tests | Installed implicitly by `wasm-pack test`. Configure with `wasm_bindgen_test_configure!(run_in_browser)` for browser-context tests; for pure logic prefer native `cargo test` (faster, no browser needed). |
| `wasm-pack test --chrome --headless` | CI test runner | Headless Chrome via WebDriver. |
| Prettier + ESLint (or Biome) | JS/TS formatting + lint | Biome is faster and acceptable since the JS footprint is small. |
| `rustfmt` + `clippy` | Rust formatting + lint | Standard. |

---

## Installation

```bash
# Rust toolchain (one-time)
rustup target add wasm32-unknown-unknown
cargo install wasm-pack            # 0.13.x
# or: cargo install wasm-bindgen-cli --version 0.2.118 (if not using wasm-pack)

# Rust crate (Cargo.toml excerpt)
# [dependencies]
# wasm-bindgen = "0.2.118"
# [lib]
# crate-type = ["cdylib", "rlib"]

# JS/Node (package.json devDependencies)
npm install -D \
  vite@^8.0.9 \
  vite-plugin-wasm@latest \
  typescript@~5.9 \
  vitest@^4.1 \
  @types/w3c-web-serial
```

Project layout (recommended):

```
bestialitty/
├── crates/
│   └── core/               # Rust wasm crate (parser, state, key encoding)
│       ├── Cargo.toml
│       └── src/lib.rs
├── web/                    # Vite static-site app (TS, canvas, Web Serial)
│   ├── index.html
│   ├── src/
│   │   ├── main.ts
│   │   ├── serial.ts       # Web Serial wrapper
│   │   ├── render/         # Canvas renderer + themes
│   │   └── keyboard.ts
│   ├── package.json
│   └── vite.config.ts
├── pkg/                    # wasm-pack output (gitignored)
└── rust-toolchain.toml
```

The `web/` app imports from `../pkg/` as a local dep; `wasm-pack build crates/core --target web --out-dir ../../pkg` is wired into `npm run dev` / `npm run build`.

---

## Key API Notes (Project-Specific Gotchas)

### Web Serial: chunked reads
**You will NOT receive data in neat line-sized chunks.** `port.readable.getReader().read()` hands you arbitrary slices of bytes, timed by the OS USB-serial stack. The VT52 parser MUST be byte-streaming and tolerant of escape sequences split across read calls. (This is *exactly* why the parser is a state machine in the first place.)

Use the `while (port.readable)` + inner `while (true)` pattern from Chrome's docs to survive transient non-fatal errors (framing, parity, overflow). Chromium spawns a fresh `ReadableStream` each time.

### Web Serial: signal control
`port.setSignals({ break, dataTerminalReady, requestToSend })` and `port.getSignals()` are supported. MicroBeast driving may want DTR toggles; wire these into a debug panel for v1.

### Web Serial: no persistence across tabs
The port lives with the tab. Closing/refreshing drops the port; users re-pick via `navigator.serial.requestPort()`. `navigator.serial.getPorts()` returns previously-authorised ports — good UX, but the user still needs a gesture to re-open.

### Canvas rendering approach (opinionated)
1. On startup, render each printable glyph (0x20–0x7E, plus VT52 graphic-mode characters) to an offscreen glyph atlas once.
2. On each terminal state update, diff the cell grid (row, col, char, attrs) and only redraw changed cells by `drawImage()`ing the atlas section into the main canvas.
3. Scrollback is a Rust-side ring buffer of rows; only the visible window is rendered.
4. CRT theme: apply a second pass (scanline overlay, phosphor tint, optional bloom) via `globalCompositeOperation` or a cheap shader if we later upgrade to WebGL.

This is how xterm.js's canvas addon works and it's plenty for an 80×24 grid. WebGL is available if profiling demands it, but it is not needed for a VT52 daily driver.

---

## Alternatives Considered

| Recommended | Alternative | When to Use Alternative |
|---|---|---|
| **Hand-rolled VT52 parser** | `vte` (alacritty/vte) crate | If we ever extend to ANSI/VT100 (out of scope). `vte` implements Paul Williams' ANSI state machine which explicitly targets VT100+ grammar. VT52 uses ESC + single letter (A/B/C/D/H/J/K) plus ESC Y <row+32> <col+32> for direct cursor addressing — a much simpler DFA. Forcing VT52 through an ANSI DFA adds surface area for no benefit. |
| **Hand-rolled parser** | `vt100` crate (doy/vt100-rust) | If we ever target VT100. Full-fat parser + screen state; overkill for VT52 and not VT52-aware. |
| **2D Canvas + atlas** | WebGL via xterm.js's `@xterm/addon-webgl` | If we ever need 1000+ cells or rich styling. 2D Canvas handles 80×24 × 60 fps trivially. xterm.js also carries years of ANSI assumptions we don't want to fight for a VT52-specific app. |
| **2D Canvas + atlas** | CanvasKit (Skia-wasm) | If we needed pro-grade text shaping. For a monospace bitmap font at a fixed grid, CanvasKit is a 2 MB wasm blob for zero benefit. |
| **2D Canvas** | WebGPU | If we ever need compute shaders for effects. Chromium WebGPU is stable in 2026 but adds build complexity and contributes nothing at 80×24. |
| **Vite 8 + `vite-plugin-wasm`** | `vite-plugin-wasm-pack` (nshen) | If we want the plugin to orchestrate `wasm-pack` itself. Menci's plugin is more mature and the explicit two-step (`wasm-pack build` then Vite bundles `pkg/`) is easier to debug. |
| **Vite 8** | esbuild / Rollup directly | If we wanted to micro-optimise bundle. Vite already uses Rolldown (Rust-based bundler) under the hood and gives us HMR + dev server. No reason to hand-roll. |
| **`wasm-pack --target web`** | `wasm-pack --target bundler` | If we used webpack. With Vite 8 + Menci's plugin, `--target web` produces ES modules Vite happily consumes, and you retain the option to serve without a bundler for diagnostics. |
| **`vitest`** | Jest | If there was an existing Jest codebase. Greenfield + Vite = Vitest is the obvious choice. |
| **OffscreenCanvas for atlas only** | Full off-main-thread rendering | If profiling shows main-thread jank. For 80×24 this is a speculative optimisation. |

---

## What NOT to Use

| Avoid | Why | Use Instead |
|---|---|---|
| **`vte` crate as a VT52 parser** | Implements Paul Williams' ANSI DFA (VT100+). VT52 grammar (ESC + letter, plus `ESC Y <row> <col>`) does not fit that state machine cleanly, and VT52 is explicitly a *pre-ANSI* protocol. Forcing it through `vte` means constant `Perform` callback interpretation of sequences the DFA wasn't designed for. | Hand-rolled streaming DFA in Rust (~200 LOC). Pragmatic VT52 has maybe 12–15 commands. |
| **`vt100` / `vt100-rust` / `vt100_ctt`** | Full VT100 screen-state crate; not VT52-aware and overkill for the pragmatic MicroBeast subset. | Hand-rolled VT52 parser + screen state. |
| **xterm.js** | Assumes ANSI/VT100+ throughout; wrestling it into VT52-only behaviour is more work than writing a Rust core, and conflicts with the Rust/wasm architecture. | Our own Canvas renderer driven by the Rust core. |
| **`wee_alloc`** | Unmaintained; known memory leak. | Rust's default allocator (fine for this workload — bundle-size pressure is low). If bundle size later matters, evaluate `lol_alloc` or `mini-alloc`. |
| **Emscripten / `wasm32-unknown-emscripten`** | Pulls a C runtime we don't need and complicates interop. | `wasm32-unknown-unknown` with `wasm-bindgen`. |
| **Rust Web Serial bindings (`web_sys::Serial*`)** | Already ruled out by project constraints. They're behind `--cfg=web_sys_unstable_apis` and the ergonomics of doing streams across the wasm boundary are bad. | JS owns Web Serial; passes `Uint8Array` slices into wasm. |
| **WebSocket / WebUSB shims** | Out of scope per PROJECT.md. | Web Serial direct only for v1. |
| **CanvasKit / Skia-wasm for the renderer** | ~2 MB wasm for features we don't need (paragraph shaping, vector graphics). | Native 2D Canvas + glyph atlas. |
| **`vite-plugin-wasm-pack-watcher`** (while nice) | Nice-to-have only — not load-bearing. Start with a simple `npm-run-all --parallel wasm:watch vite:dev` script and only add a watcher plugin if the feedback loop hurts. | Two npm scripts + `cargo watch -s 'wasm-pack build ...'`. |
| **DOM-based rendering** | Terminal redraw via DOM is slow and inelegant for a cell grid. | Canvas. |
| **Firefox/Safari polyfills for Web Serial** | Ruled out by project. Polyfills are poor. | Chromium-only polite fail on `!('serial' in navigator)`. |

---

## Fonts

### Classic CRT theme (bitmap style)
| Font | Why | License |
|---|---|---|
| **PxPlus IBM VGA 8x16** (from The Ultimate Oldschool PC Font Pack by VileR) | Faithful IBM VGA look; WOFF webfonts provided; authentic for retro-computing vibes; wide coverage including `Plus` character set. | CC BY-SA 4.0 — attribute VileR in UI credits. |
| **BigBlue Terminal** (int10h.org) | Alternative classic look if PxPlus feels too PC-centric. | Free for personal & commercial use (check current terms). |
| **Terminus (TTF)** | Clean pixel-style, good legibility. | OFL-1.1. |

### Clean modern theme
| Font | Why | License |
|---|---|---|
| **JetBrains Mono** | Best free modern monospace in 2026: ligatures, italics, excellent hinting, wide glyph coverage. | SIL OFL 1.1. |
| **Fira Code** (alternative) | More ligatures; slightly warmer shapes. | SIL OFL 1.1. |

Ship both fonts as local assets (no CDN) — this keeps the app fully static and offline-capable.

---

## Stack Patterns by Variant

**If v1 scrollback proves too slow on low-end Chromebooks:**
- Move the glyph atlas + compositing to a `Worker` + `OffscreenCanvas`, transfer `ImageBitmap`s back. The Rust core doesn't need to move.
- Only change if profiling shows main-thread > 5 ms per frame at 80×24.

**If the MicroBeast emits anything the VT52 parser doesn't handle:**
- Extend the hand-rolled DFA, not adopt `vte`. The VT52 table is small; add a state, add a test.
- Document "MicroBeast-observed VT52" as the de-facto spec in the repo.

**If bundle size becomes a concern post-v1:**
- Swap default allocator to `lol_alloc`; strip debug info in release; `wasm-opt -Oz` (bundled with `wasm-pack`).
- Enable `wasm-bindgen` `--reference-types` where supported.

**If we want to ship a second transport (out of scope now):**
- Put a JS-side `Transport` interface in `web/src/transport/` with `WebSerialTransport` as the only v1 impl.
- The Rust core already takes byte slices; transport choice is a JS-only concern.

---

## Version Compatibility

| Package A | Compatible With | Notes |
|---|---|---|
| `wasm-bindgen` Rust crate | `wasm-bindgen-cli` of the **exact same version** | Mismatches cause cryptic JS runtime errors. Pin `wasm-bindgen = "=0.2.118"` in Cargo.toml and keep CLI aligned. `wasm-pack` handles this if you let it install the CLI. |
| `vite-plugin-wasm` (Menci) | Vite 2.x – 8.x | Works with current Vite 8.0.9. |
| `wasm-pack --target web` | Vite 8 + `vite-plugin-wasm` | Recommended combo. `--target bundler` also works but `--target web` gives the cleanest ES-module output and lets you bypass the bundler during diagnostics. |
| Rust edition 2024 | wasm-bindgen 0.2.118 | Fine — wasm-bindgen has been edition-agnostic for years. |
| TypeScript 5.9 | Vite 8 | Fine. TS 6.0 is out but 5.9 is conservative. |

---

## Confidence Notes

| Claim | Confidence | Evidence |
|---|---|---|
| `wasm-bindgen` 0.2.118 is current (April 2026) | HIGH | crates.io search results; aligns with public release cadence. |
| `wasm-pack` is the right build orchestrator | HIGH | Context7 `/wasm-bindgen/wasm-pack` (283 snippets, benchmark 81.1). |
| Vite 8.0.9 stable, March 2026 | HIGH | Vite official blog + release notes. |
| `vite-plugin-wasm` (Menci) is the mainstream integration | HIGH | Context7 `/menci/vite-plugin-wasm` (90.5 benchmark, 30 snippets). |
| `vte` crate is ANSI/VT100-shaped, not VT52 | MEDIUM-HIGH | docs.rs + README explicitly reference Paul Williams' ANSI DFA and vt100.net/emu/dec_ansi_parser. No mention of VT52 support. Could still be *used* as the byte-feeder, but the DFA's state model (CSI/OSC/DCS/SOS) adds noise for VT52. |
| 2D Canvas + atlas is enough for 80×24 @ 60 fps | HIGH | xterm.js shipped this for years before WebGL addon; terminal cell grids at this size are trivial for Canvas 2D. |
| OffscreenCanvas widely supported in Chromium | HIGH | Shipped 2019; stable. |
| PxPlus IBM VGA for CRT theme, JetBrains Mono for modern theme | HIGH | Both have web-ready WOFF/TTF assets under permissive licenses. |
| Web Serial produces arbitrarily chunked reads | HIGH | Chrome official docs state this explicitly. |
| TypeScript 5.9 is the safe pin (not 6.0) | MEDIUM | 6.0 is released but ES5 drop + Go-compiler transition means stability risk for a hobby project. Safe to bump later. |
| `wee_alloc` deprecated, use default allocator | HIGH | Multiple sources; `wee_alloc` repo confirms. |

---

## Sources

### Primary / Context7
- [`/wasm-bindgen/wasm-pack`](https://context7.com/wasm-bindgen/wasm-pack) — wasm-pack usage, build targets, bundler integration
- [`/menci/vite-plugin-wasm`](https://context7.com/menci/vite-plugin-wasm) — wasm-pack + Vite integration patterns

### Official docs
- [wasm-bindgen Guide — testing in headless browsers](https://rustwasm.github.io/docs/wasm-bindgen/wasm-bindgen-test/browsers.html)
- [wasm-pack quickstart / `--target web`](https://rustwasm.github.io/docs/wasm-pack/commands/build.html)
- [Vite 8.0 announcement (March 2026)](https://vite.dev/blog/announcing-vite8)
- [Chrome Web Serial guide (chunking, setSignals, permissions)](https://developer.chrome.com/docs/capabilities/serial)
- [vte crate on crates.io / docs.rs](https://docs.rs/crate/vte/latest)
- [The Ultimate Oldschool PC Font Pack (VileR)](https://int10h.org/oldschool-pc-fonts/readme/)
- [JetBrains Mono](https://www.jetbrains.com/lp/mono/)
- [Paul Williams ANSI parser (VT100.net)](https://vt100.net/emu/dec_ansi_parser)
- [TOS VT-52 terminal reference](https://freemint.github.io/tos.hyp/en/VT_52_terminal.html)

### Background / ecosystem
- [xterm.js WebGL addon (rendering approach reference)](https://github.com/xtermjs/xterm.js/tree/master/addons/addon-webgl)
- [Vitest](https://vitest.dev/)
- [lol_alloc / mini-alloc (wee_alloc replacements)](https://crates.io/crates/lol_alloc)
- [Can I Use — Web Serial API](https://caniuse.com/web-serial)

---

*Stack research for: BestialiTTY — browser-based VT52 emulator for MicroBeast*
*Researched: 2026-04-21*
