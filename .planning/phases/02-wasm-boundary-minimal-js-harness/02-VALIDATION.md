---
phase: 02
slug: wasm-boundary-minimal-js-harness
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-04-21
---

# Phase 02 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | cargo test (Rust, native x86_64-unknown-linux-gnu) + manual in-browser harness (Chromium DevTools) |
| **Config file** | `Cargo.toml` workspace at repo root |
| **Quick run command** | `cargo test -p bestialitty-core` |
| **Full suite command** | `cargo test --workspace` + `scripts/build.sh` (wasm-pack build --target web) smoke |
| **Estimated runtime** | ~20 s native cargo test, ~60 s first wasm-pack build, ~15 s rebuild |

---

## Sampling Rate

- **After every task commit:** Run `cargo test -p bestialitty-core`
- **After every plan wave:** Run `cargo test --workspace` + `scripts/build.sh`
- **Before `/gsd-verify-work`:** Full suite green + `wasm-pack build --target web` produces `www/pkg/bestialitty_core.js` + manual SC-2 / SC-4 Chromium demonstration recorded
- **Max feedback latency:** 30 s for native path; 90 s when wasm build is in the wave

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|
| _Planner fills this table when producing the PLAN.md files._ | | | | | | | | | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] `rustup target add wasm32-unknown-unknown` — required before any `wasm-pack build` succeeds
- [ ] `wasm-pack` installed (local `wasm-pack 0.12.1` detected; 0.14.0+ preferred but 0.12.x works for `--target web`)
- [ ] `crates/bestialitty-core/tests/boundary_api_shape.rs` extended with compile-time pins for `snapshot_grid`, `grid_ptr`, `grid_byte_len`, `dirty_ptr`, `cursor_packed`, `encode_key_raw` (must compile before Wave 1 can land the methods)
- [ ] `crates/bestialitty-core/tests/core_02_no_browser_deps.rs` updated with per-file / per-token exemption table (exempt `wasm_bindgen` only in `src/lib.rs`; keep `web_sys` / `js_sys` / `gloo-*` forbidden everywhere)
- [ ] `crates/bestialitty-core/tests/dependency_graph_excludes_browser_crates.rs` (or equivalent) allowlist update: `wasm-bindgen` permitted; `wasm-bindgen-futures`, `web-sys`, `js-sys`, `gloo-*` still forbidden

*If none: "Existing infrastructure covers all phase requirements." — does not apply here; 5 items above are required before implementation waves.*

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| ES-module import in plain HTML via `wasm-pack --target web` output (SC-1) | CORE-05 | Requires browser runtime; no headless wasm ES-module loader in cargo test | (1) `./scripts/build.sh`; (2) `python3 -m http.server -d www 8080`; (3) Chromium → `http://localhost:8080/` → Console shows `init()` completed, no errors; (4) `console.log(Terminal)` resolves to the exported class |
| Paste → feed(bytes) → ASCII `<pre>` grid render (SC-2) | CORE-03 | End-to-end paste → `<pre>` requires DOM event loop | Paste 3–5 lines of VT52 bytes (including `\x1B[Y...` cursor moves) into textarea, click Feed, verify `<pre>` shows expected grid content with cursor at decoded position |
| Zero-copy `Uint8Array` over wasm.memory.buffer with no per-frame allocation (SC-3) | CORE-03, CORE-04 | DevTools Memory profiler required to prove no allocation | Chromium DevTools → Performance → record 5 s of repeated Feed clicks → Memory allocation timeline shows no `Uint8Array` allocation growth after initial view construction (allocation is steady-state Rust-side only) |
| 64 KB single `feed()` call demonstration (SC-4) | CORE-04 | Must show single flame entry in Profiler, not 65,536 | Click "64 KB stress" button → Console logs `[SC-4] Fed 65536 bytes in ONE feed() call (Nms)` → DevTools Performance tab records single `Terminal.feed` flame entry (not 65_536 discrete entries) |
| `console_error_panic_hook` wires Rust panics to browser console readably | Pitfall mitigation | Panic-across-FFI behavior only visible in browser | Trigger a panic via a harness "panic test" button (dev-only), confirm JS console shows Rust stack trace rather than opaque `RuntimeError: unreachable` |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify OR are listed under Manual-Only Verifications with clear instructions
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all 5 prerequisite items above
- [ ] No watch-mode flags (`cargo watch`, `wasm-pack build --watch`) in any task command
- [ ] Feedback latency < 30 s for native tasks; < 90 s for wasm-build tasks
- [ ] `nyquist_compliant: true` set in frontmatter once planner fills the Per-Task Verification Map

**Approval:** pending
