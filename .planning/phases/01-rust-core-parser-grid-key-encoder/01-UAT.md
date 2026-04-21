---
status: complete
phase: 01-rust-core-parser-grid-key-encoder
source: [01-01-SUMMARY.md, 01-02-SUMMARY.md, 01-03-SUMMARY.md, 01-04-SUMMARY.md, 01-05-SUMMARY.md, 01-06-SUMMARY.md, 01-07-SUMMARY.md]
started: 2026-04-21T00:00:00Z
updated: 2026-04-21T00:00:00Z
---

## Current Test

[testing complete]

## Tests

### 1. Full test suite passes (128 tests)
expected: `cargo test --workspace --all-targets` runs 128 tests across 4 targets (lib: 107, boundary_api_shape: 10, core_02_no_browser_deps: 3, fixture_runner: 8) and reports 0 failed, 0 ignored.
result: pass

### 2. Cross-target native build
expected: `cargo build --target x86_64-unknown-linux-gnu --workspace` exits 0 with no warnings — proves the core compiles for the native host, not just wasm.
result: pass

### 3. Fmt and Clippy clean at -D warnings
expected: `cargo fmt --all -- --check` exits 0 (no formatting drift); `cargo clippy --workspace --all-targets -- -D warnings` exits 0 (zero lint warnings, including the Plan 06 const-assert cleanup).
result: pass

### 4. CORE-02 zero-browser-dependency gate
expected: `! cargo metadata --format-version=1 -p bestialitty-core | grep -E '"name":"(web-sys|js-sys|wasm-bindgen)"'` returns CLEAN; the 3 automated tests in `tests/core_02_no_browser_deps.rs` (dep-graph scan, src/ token grep, Cargo.toml crate-type check) all pass.
result: issue
reported: "error: unexpected argument '-p' found"
severity: major

### 5. VT52 parser: cursor motion and addressing (PARSER-01/02)
expected: Feeding ESC A/B/C/D moves cursor up/down/right/left with bounds clamping. ESC Y `<row+0x20>` `<col+0x20>` addresses cursor with `saturating_sub(0x20)` underflow clamp (0x1F → 0) and upper-bound clamp at (rows-1, cols-1). All 6 ESC Y edge cases pass.
result: skipped
reason: internal library behavior; validated by full test suite in Test 1

### 6. VT52 parser: torn-chunk robustness (PARSER-03)
expected: 20 torn-chunk tests in `vt52.rs` split every multi-byte ESC sequence at every internal offset. `feed()` fed a sequence whole vs split at every byte boundary reaches identical final Terminal state. ESC Y phase shuttles across chunk boundaries via `std::mem::take` and survives C0 bytes (0x00–0x1F) mid-sequence.
result: skipped
reason: internal library behavior; validated by full test suite in Test 1

### 7. VT52 parser: LF implies CR default (PARSER-07)
expected: `Terminal::new` defaults `lf_implies_cr = true`. LF (0x0A) both advances row AND resets column. A pure LF-only stream (CP/M-style) and a CRLF stream (BASIC-80-style) reach identical final state. Regression-pinned by `crlf_reaches_same_state_as_lf_only` test.
result: skipped
reason: internal library behavior; validated by full test suite in Test 1

### 8. VT52 parser: ESC Z identify reply (PARSER-05)
expected: `Terminal::feed(b"\x1BZ")` returns the exact byte sequence `[0x1B, b'/', b'K']` (3 bytes: ESC, '/', 'K'). No other input produces a host reply in Phase 1.
result: skipped
reason: internal library behavior; validated by full test suite in Test 1

### 9. Paired-fixture runner: 8 fixtures pass
expected: `cargo test -p bestialitty-core --test fixture_runner` runs 8 tests — basic_print, esc_y_edges (24 bytes, all 6 edges), noop_sequences, identify_reply (2 bytes), bell, erase_j, erase_k, torn_esc_y — each loading its paired `session.bin` + `session.trace` and diffing the production parser's trace against the recorded ground truth. All green.
result: skipped
reason: internal library behavior; validated by full test suite in Test 1

### 10. Key encoder: arrows, Ctrl-letter, printable (CORE-01)
expected: `encode(KeyEvent::new(KeyCode::ArrowUp))` returns `[0x1B, b'A']`. `encode(KeyEvent::with_ctrl(KeyCode::Char(b'a')))` returns `[0x01]` (case-insensitive across 26 letters). Printable ASCII 0x20–0x7E passes through as single-byte. 30 unit tests cover the full mapping table.
result: skipped
reason: internal library behavior; validated by full test suite in Test 1

### 11. Data layer: Cell 8-byte repr(C) layout lock
expected: `Cell { ch: u32, fg: u8, bg: u8, flags: u8, _pad: u8 }` carries `#[repr(C)]` and a compile-time `const _: () = assert!(size_of::<Cell>() == 8)`. Any future field reorder or type change fails the build at assert-eval time (before tests run). `ch: u32` holds the raw VT52 byte in LSB with upper 24 bits reserved.
result: skipped
reason: internal library behavior; validated by full test suite in Test 1

### 12. Data layer: Scrollback 10k-line cap eviction (D-11)
expected: `Scrollback::new(rows, cols, 10_000)` enforces `total_len <= visible_rows + scrollback_cap` on every `push_line` via `VecDeque::pop_front` loop. Marker-row test confirms the oldest inserted row is actually gone from the front (not just length cap respected). `resize_scrollback` shrink truncates; grow is a no-op on existing data.
result: skipped
reason: internal library behavior; validated by full test suite in Test 1

### 13. Boundary API shape contract (D-17)
expected: `tests/boundary_api_shape.rs` (10 integration tests) pins the public surface of `Terminal` and `key::encode` that Phase 2's wasm-bindgen shim will consume. Signature drift (e.g., someone narrowing a `pub` to `pub(crate)` or changing a return type) fails `cargo test` at compile time, not at `wasm-pack build`.
result: skipped
reason: internal library behavior; validated by full test suite in Test 1

### 14. ADR-001 parser-strategy decision committed
expected: `.planning/decisions/ADR-001-parser-strategy.md` exists, locks `vte = "=0.15"` as the sole production parser dep, cites Alacritty's hardened state machine as rationale, and lists the Plan 04 migration steps. Spike module (`src/spike/`) has been deleted entirely per the ADR's implications block.
result: pass

### 15. Live MicroBeast captures recorded (PARSER-07 evidence)
expected: `.planning/research/captures/capture-01-cpm-boot/` contains `bytes.bin` (797 B, LF-only, zero ESC), `hexdump.txt`, and `README.md`. `.planning/research/captures/capture-02-basic/` contains `bytes.bin` (760 B, CRLF, zero ESC), `hexdump.txt`, and `README.md`. Top-level `captures/README.md` inventories both and documents the CR/LF divergence that drove the `lf_implies_cr = true` default.
result: pass

## Summary

total: 15
passed: 5
issues: 1
pending: 0
skipped: 9
blocked: 0

## Gaps

- truth: "cargo metadata CORE-02 manual sanity-check command documented in SUMMARY / VALIDATION docs is runnable"
  status: failed
  reason: "User reported: error: unexpected argument '-p' found — cargo metadata does not accept -p; the correct package filter is --manifest-path, or drop the flag since -p bestialitty-core is the only workspace member"
  severity: major
  test: 4
  artifacts: []
  missing: []
