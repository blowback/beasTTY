---
phase: 1
slug: rust-core-parser-grid-key-encoder
status: approved
nyquist_compliant: true
wave_0_complete: false
created: 2026-04-21
---

# Phase 1 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | `cargo test` (Rust stdlib test harness, Edition 2024) |
| **Config file** | `crates/bestialitty-core/Cargo.toml` (Wave 0 creates) |
| **Quick run command** | `cargo test -p bestialitty-core --lib` |
| **Full suite command** | `cargo test -p bestialitty-core --all-targets` |
| **Estimated runtime** | ~5s for library tests; ~10s full suite (greenfield, pure-logic, no I/O) |

---

## Sampling Rate

- **After every task commit:** Run `cargo test -p bestialitty-core --lib`
- **After every plan wave:** Run `cargo test -p bestialitty-core --all-targets` + `cargo build --target x86_64-unknown-linux-gnu -p bestialitty-core`
- **Before `/gsd-verify-work`:** Full suite green + explicit absence check `! cargo metadata --format-version=1 | grep -E '"name":"(web-sys|js-sys)"'` (proves CORE-02 zero-browser-deps)
- **Max feedback latency:** 10 seconds

---

## Per-Task Verification Map

> Task IDs are placeholders. Planner will finalise per-plan `{N}-{plan}-{task}` IDs.
> Every row maps one phase requirement to either an automated command or a Wave 0 dependency.

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|
| 1-W0-01 | W0 | 0 | infra | — | N/A | infra | `cargo test -p bestialitty-core --lib 2>&1 \| grep "running 0 tests"` | ❌ W0 | ⬜ pending |
| 1-CAP-01 | capture | 1 | PARSER-inventory (D-06) | — | Captured bytes inform parser scope | manual+infra | `test -f .planning/research/captures/capture-01-cpm-boot/bytes.bin` | ❌ W0 | ⬜ pending |
| 1-CAP-02 | capture | 1 | CR/LF convention (SC4) | — | CR/LF behaviour documented | manual | `grep -i "CR/LF\|carriage" .planning/research/captures/capture-01-cpm-boot/README.md` | ❌ W0 | ⬜ pending |
| 1-SPIKE-01 | parser-spike | 2 | D-02/D-03 (spike floor) | — | Both prototypes pass torn-chunk suite | unit | `cargo test -p bestialitty-core spike::` | ❌ W0 | ⬜ pending |
| 1-ADR-01 | parser-spike | 2 | SC3 (parser-strategy ADR) | — | ADR committed + dated | infra | `test -f .planning/decisions/ADR-001-parser-strategy.md && grep -E "^date:\|^Date:" .planning/decisions/ADR-001-parser-strategy.md` | ❌ W0 | ⬜ pending |
| 1-P-01 | parser-core | 3 | PARSER-01 (ESC A/B/C/D cursor) | — | Cursor moves saturate at grid edges | unit | `cargo test -p bestialitty-core parser::cursor_moves` | ❌ W0 | ⬜ pending |
| 1-P-02 | parser-core | 3 | PARSER-02 (ESC Y row col) | — | +32 offset decode with clamp | unit | `cargo test -p bestialitty-core parser::esc_y` | ❌ W0 | ⬜ pending |
| 1-P-03 | parser-core | 3 | PARSER-03 (ESC H home) | — | Cursor returns to (0,0) | unit | `cargo test -p bestialitty-core parser::esc_h` | ❌ W0 | ⬜ pending |
| 1-P-04 | parser-core | 3 | PARSER-04 (ESC J erase to end) | — | Erase region correct | unit | `cargo test -p bestialitty-core parser::esc_j` | ❌ W0 | ⬜ pending |
| 1-P-05 | parser-core | 3 | PARSER-05 (ESC K erase to eol) | — | Erase region correct | unit | `cargo test -p bestialitty-core parser::esc_k` | ❌ W0 | ⬜ pending |
| 1-P-06 | parser-core | 3 | PARSER-06 (ESC Z identify) | — | Host reply `ESC / K` returned from `feed()` | unit | `cargo test -p bestialitty-core parser::esc_z_identify` | ❌ W0 | ⬜ pending |
| 1-P-07 | parser-core | 3 | PARSER-07 (BEL pending flag) | — | `0x07` sets `bell_pending` | unit | `cargo test -p bestialitty-core parser::bel` | ❌ W0 | ⬜ pending |
| 1-P-08 | parser-core | 3 | PARSER-08 (ESC F/G/=/> silent) | — | No state mutation, no panic | unit | `cargo test -p bestialitty-core parser::silent_noops` | ❌ W0 | ⬜ pending |
| 1-TC-01 | torn-chunk | 3 | SC2 (torn-chunk harness) | — | Split at every internal offset → identical state | property | `cargo test -p bestialitty-core torn_chunk::` | ❌ W0 | ⬜ pending |
| 1-TC-02 | torn-chunk | 3 | SC1 (session trace match) | — | Fixture bytes → expected op trace | integration | `cargo test -p bestialitty-core --test session_trace` | ❌ W0 | ⬜ pending |
| 1-G-01 | grid | 3 | CORE-01 (grid + Cell layout) | — | `repr(C)` 8-byte Cell, 80×24 row-major | unit | `cargo test -p bestialitty-core grid::cell_layout` | ❌ W0 | ⬜ pending |
| 1-G-02 | grid | 3 | CORE-01 (dirty bitmap) | — | Dirty bit set on write, cleared by API | unit | `cargo test -p bestialitty-core grid::dirty` | ❌ W0 | ⬜ pending |
| 1-SB-01 | scrollback | 3 | CORE-01 (scrollback ring, D-11/D-12) | — | `VecDeque` ring, 10k cap, resize + truncate | unit | `cargo test -p bestialitty-core scrollback::` | ❌ W0 | ⬜ pending |
| 1-K-01 | key-encoder | 3 | CORE-01 (arrows → ESC A/B/C/D) | — | Exhaustive key→bytes map | unit | `cargo test -p bestialitty-core key::arrows` | ❌ W0 | ⬜ pending |
| 1-K-02 | key-encoder | 3 | CORE-01 (Ctrl-letter → 0x01-0x1F) | — | Mask to low 5 bits | unit | `cargo test -p bestialitty-core key::ctrl` | ❌ W0 | ⬜ pending |
| 1-K-03 | key-encoder | 3 | CORE-01 (printable pass-through) | — | Raw byte returned | unit | `cargo test -p bestialitty-core key::printable` | ❌ W0 | ⬜ pending |
| 1-B-01 | boundary | 4 | CORE-02 (zero browser deps) | — | `cargo build --target x86_64-unknown-linux-gnu` green | infra | `cargo build --target x86_64-unknown-linux-gnu -p bestialitty-core` | ❌ W0 | ⬜ pending |
| 1-B-02 | boundary | 4 | CORE-02 (no web-sys/js-sys deps) | — | Dep graph free of browser crates | infra | `! cargo metadata --format-version=1 \| grep -E '"name":"(web-sys\|js-sys)"'` | ❌ W0 | ⬜ pending |
| 1-B-03 | boundary | 4 | CORE-01 (wasm boundary shape, D-17) | — | `grid_ptr/dirty_ptr/feed/encode_key/resize/cursor` exported | unit | `cargo test -p bestialitty-core boundary::api_shape` | ❌ W0 | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] `crates/bestialitty-core/Cargo.toml` — crate manifest with `crate-type = ["cdylib", "rlib"]`, Edition 2024
- [ ] Workspace root `Cargo.toml` — `[workspace] members = ["crates/bestialitty-core"]`
- [ ] `rust-toolchain.toml` — Rust 1.85+ stable pin (or deferred explicitly per D Claude's Discretion)
- [ ] `crates/bestialitty-core/src/lib.rs` — stub exporting nothing, so `cargo test` runs 0 tests green
- [ ] `crates/bestialitty-core/tests/` dir — empty, ready for integration tests
- [ ] `.planning/research/captures/` dir exists (tooling: `tio` or `minicom` verified present)
- [ ] `.planning/decisions/` dir exists (ready for ADR-001)

*Wave 0 verification: `cargo test -p bestialitty-core --lib` exits 0 with "running 0 tests" output (proves crate compiles, test harness reachable, before any parser logic exists).*

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Live MicroBeast byte capture | SC4 (D-05/D-06/D-07) | Requires physical hardware + serial cable | Run `tio -b 19200 -d 8 -p none -s 1 -f none -L --output-mode hex /dev/ttyUSB0 > bytes.bin`; boot the MicroBeast; drive CP/M + `dir` + `stat`; reset and capture a BASIC `LIST`/`RUN` session; document CR/LF observations in per-capture README.md |
| CR/LF convention documentation | SC4 | Derived from capture observation | Inspect `capture-01-cpm-boot/bytes.bin` with `xxd`; note whether line endings are `\r`, `\n`, or `\r\n`; record in README.md; confirm parser treats CR = return-to-col-0, LF = advance-row |
| Parser-strategy spike readability judgment | SC3 (D-03) | Subjective code-review judgment by author | After both prototypes pass torn-chunk suite, author reads both implementations, picks winner, writes ADR-001 with rationale |

---

## Validation Sign-Off

- [x] All tasks have `<automated>` verify or Wave 0 dependencies
- [x] Sampling continuity: no 3 consecutive tasks without automated verify (every parser/grid/key task has a `cargo test` command)
- [x] Wave 0 covers all MISSING references (crate skeleton + capture/decisions dirs)
- [x] No watch-mode flags (all `cargo test` invocations are one-shot)
- [x] Feedback latency < 10s (pure-logic tests; no I/O)
- [x] `nyquist_compliant: true` set in frontmatter

*`wave_0_complete` flips to `true` after Plan 01 executes and `cargo test -p bestialitty-core --lib` returns "running 0 tests" exit 0.*

**Nyquist sampling rationale:** The critical frequency for this phase is the per-byte state transition of the parser, because PITFALLS.md #2 (torn chunks) breaks at the sub-sequence level. The torn-chunk harness (1-TC-01) samples at 2× that frequency by splitting every multi-byte sequence at every internal offset and asserting identical final state — this is the Nyquist floor. Requirements PARSER-01..08 each have dedicated per-opcode tests (1-P-01..08) sampling at the opcode level. Grid, scrollback, and key encoder each have sub-system tests at the invariant level. CORE-02 (zero browser deps) is sampled at the build-graph level via `cargo metadata` dep inspection. No requirement is left below the Nyquist floor.

**Approval:** approved 2026-04-21
