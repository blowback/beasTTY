# ADR-002: Wasm-bindgen Target Gating

**Status:** Accepted
**Date:** 2026-04-21
**Phase:** 02-wasm-boundary-minimal-js-harness
**Deciders:** ant (project author)

## Context

Phase 2 adds `wasm-bindgen` to `crates/bestialitty-core` so `lib.rs` can export
`#[wasm_bindgen]` types consumed by the `www/` static harness. Three mechanisms
exist to keep wasm-bindgen out of the native `cargo test` path per D-20 (plain
`cargo test` must work with no flags):

A. Target-specific dep + `cfg(target_arch = "wasm32")`-gated module in `lib.rs`.
B. Plain `[dependencies] wasm-bindgen`, module still `cfg`-gated.
C. Cargo feature flag (`wasm = ["dep:wasm-bindgen"]`).

See `.planning/phases/02-wasm-boundary-minimal-js-harness/02-RESEARCH.md`
§"Mechanism Evaluation" for the full tradeoff analysis.

## Decision

**Adopt Candidate A.** `Cargo.toml` gets:

```toml
[target.'cfg(target_arch = "wasm32")'.dependencies]
wasm-bindgen = "0.2.118"
```

`src/lib.rs` wraps its entire wasm surface in a `#[cfg(target_arch = "wasm32")]
mod wasm_boundary { ... }` block (added by Plan 03).

This is the pattern the Rust + WebAssembly book recommends for dual-target
crates that carry wasm bindings but are also useful as a native rlib
(https://rustwasm.github.io/book/reference/add-wasm-support-to-crate.html).

## Consequences

**Positive:**
- Native `cargo test` does not resolve `wasm-bindgen` — no compile-time or
  build-time cost on the fast feedback loop.
- `cargo build --target wasm32-unknown-unknown` and `wasm-pack build --target
  web` resolve `wasm-bindgen` automatically — no extra flags needed in
  `scripts/build.sh`.
- `tests/core_02_no_browser_deps.rs` update is surgical: remove `wasm-bindgen`
  from `FORBIDDEN_CRATES` (it is permitted in `cargo metadata`) and add a
  per-token, per-file exemption (`wasm_bindgen` allowed in `lib.rs` only,
  `web_sys` / `js_sys` still forbidden everywhere).
- `cargo metadata` still lists `wasm-bindgen` regardless of host target
  (metadata is target-agnostic), so the allowlist change is stable.

**Negative:**
- Cargo's `[target.'cfg(...)'.dependencies]` table syntax is slightly less
  discoverable than a plain `[dependencies]` entry.
- rust-analyzer on an x86_64 host may show `wasm-bindgen` imports in `lib.rs`
  as unresolved when the cfg is inactive. Standard Rust tooling limitation;
  wasm-pack builds always resolve correctly.

## Rejected Alternatives

**Candidate B — plain `[dependencies] wasm-bindgen`:**
Forces every `cargo test` invocation to resolve and compile `wasm-bindgen`
plus its proc-macro dependencies (`syn`, `quote`, `proc-macro2`) even though
the module body is stripped under `cfg(not(target_arch = "wasm32"))`. Adds
roughly 15 seconds to a clean test build. Ongoing DX tax; rejected.

**Candidate C — Cargo feature flag:**
Requires `wasm-pack build -- --features wasm` ceremony in `scripts/build.sh`.
Creates a footgun where `cargo build --target wasm32-unknown-unknown` without
`--features wasm` silently succeeds with an empty `lib.rs`, emitting no wasm
exports. `cargo test --all-features` would also activate it on native,
breaking the build. Cascading DX damage; rejected.
