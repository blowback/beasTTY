# ADR-001: Parser Strategy for VT52 Terminal Emulator

**Status:** Accepted
**Date:** 2026-04-21
**Phase:** 01-rust-core-parser-grid-key-encoder
**Deciders:** ant (project author)

## Context

The BestialiTTY Rust core must parse a pragmatic VT52 byte stream from the
MicroBeast (see `.planning/phases/01-rust-core-parser-grid-key-encoder/01-CONTEXT.md`
and `01-RESEARCH.md` for scope). Two architecturally reasonable approaches exist:

- **Hand-rolled VT52 DFA** (`.planning/research/STACK.md` recommendation)
- **`vte::Parser` + `Perform` trait** (`.planning/research/ARCHITECTURE.md` recommendation)

CONTEXT D-02 and D-03 lock the resolution method: implement both prototypes
against an identical 7-sequence test surface plus a torn-chunk floor, then pick
the winner on **readability + extensibility**, with dependency count as a
tiebreaker only.

Both prototypes were implemented in `crates/bestialitty-core/src/spike/` and
driven through the identical test matrix in `spike/tests.rs`. Both pass the
torn-chunk floor (D-03 precondition). This ADR resolves which prototype Plan 04
promotes into the production parser at `crates/bestialitty-core/src/vt52.rs`.

## Decision

We adopt the **`vte::Parser` + `Perform`** approach for Phase 1 and beyond.

- vte version used: **0.15.0** (verified against docs.rs and the cached crate
  source at `~/.cargo/registry/src/index.crates.io-*/vte-0.15.0/src/lib.rs:360-363`
  during the spike — the `Parser::advance(&mut self, performer: &mut P, bytes: &[u8])`
  signature and `Perform` trait surface match `RESEARCH.md` Pattern 1).
- Plan 04 will pin this version exactly (`vte = "=0.15"`) to avoid silent API
  drift on a `cargo update`.

## Consequences

**Positive:**
- The parser state machine itself (the bit that reads "what does ESC mean in
  this context?") is Alacritty's — code that has been under third-party
  input-fuzzing since 2017 and has shipped to every Alacritty user across
  macOS / Linux / BSD / Windows. Correctness-by-authoring risk is substantially
  lower than a hand-written DFA where every edge case rests on the author's
  test coverage alone.
- Callback organization via the `Perform` trait maps one-to-one with VT52
  semantic categories: `esc_dispatch` for all 14 single-char ESC sequences,
  `execute` for C0 control (BS / HT / LF / CR / BEL), `print` for printable
  ASCII. Plan 04 fills in each method independently without touching a global
  state machine.
- The ESC Y sub-state (`EscYPhase` in `spike/vte_path.rs:20-23`) is contained
  inside our `Perform` impl rather than in vte itself — so even though vte's
  state machine does not model VT52's one multi-byte sequence natively, the
  workaround is a ~15-line module-local concern, not a dependency fork.
- If Phase 1's VT52 scope ever widens (PROJECT.md currently forecloses this,
  but requirements can change), adding CSI / DCS / OSC is a matter of filling
  in trait methods that are already there as no-ops. A hand-rolled DFA would
  require a full state-machine redesign.

**Negative:**
- One extra runtime dependency: `vte 0.15.0` plus its transitive deps
  (`memchr`, `arrayvec`). Final wasm bundle grows accordingly. Mitigation:
  Phase 2's wasm-pack build-time inspection will measure the delta; if the
  bundle cost is > 20 KB gzipped beyond the hand-rolled baseline, we will
  reopen this ADR and reconsider.
- `Perform` requires five trait methods that VT52 never triggers —
  `csi_dispatch`, `hook`, `put` (DCS passthrough, not grid `put`), `unhook`,
  `osc_dispatch` (`spike/vte_path.rs:104-108`). They are empty one-liners,
  but they are still five code paths a reader has to verify are genuinely
  never reached by MicroBeast input. Mitigation: add a defensive `debug_assert!`
  in each empty callback in Plan 04's production copy so any unexpected
  invocation surfaces immediately in dev builds.
- vte's API has drifted across versions (0.13 → 0.15 changed `advance`
  semantics per `01-RESEARCH.md` Open Question #4, now resolved). Future
  upgrades will touch our code. Mitigation: pin the exact version (`=0.15`)
  and only bump deliberately, with the spike harness re-run as the upgrade
  gate.

**vte-specific:** The spike resolved `vte 0.15.0` via docs.rs; the GitHub
README still showed 0.13.0 at plan-time. Plan 04 will commit the resolved
version to `Cargo.lock`.

## Rejected Alternative

The **hand-rolled VT52 DFA** was rejected on the following concrete grounds:

- **Correctness risk is author-written rather than third-party-hardened.**
  `spike/hand_rolled.rs` lines 65-101 implement a 4-state DFA (`Ground`,
  `Escape`, `CursorRow`, `CursorCol(u8)`) that is clean for the D-02
  7-sequence set but grows linearly with every new opcode. Each new match
  arm is a chance to introduce a torn-chunk defect, and the only safety net
  is the author's own `assert_identical_across_splits` coverage. vte's
  equivalent DFA has been exercised by years of Alacritty traffic against
  real-world terminal applications — including pathological input that our
  own fixture-derived tests will never replicate.
- **Multi-byte sequence scaling.** The hand-rolled path expresses VT52's
  one multi-byte sequence (ESC Y row col) as a linear `CursorRow → CursorCol(r)`
  state pair (`spike/hand_rolled.rs:89,95-100`). This pattern does not
  generalize to CSI-style parameter sequences (`ESC [ Pn ; Pn … cmd`) if
  scope ever widens — each new multi-byte family would require its own
  hand-coded sub-state, whereas vte already handles CSI / OSC / DCS parameter
  accumulation correctly.
- **Smaller bundle is not the axis the project is optimizing for.** BestialiTTY
  is a daily-driver terminal targeting retrocomputing enthusiasts with
  hardware on their desks, not a size-constrained embedded deployment. The
  dependency weight of vte (3 crates) is real but not decisive when the
  correctness and extensibility story of the alternative is stronger.

## Floor Condition (D-03)

Both prototypes pass the identical torn-chunk test suite at
`crates/bestialitty-core/src/spike/tests.rs`. The floor is confirmed by
`cargo test -p bestialitty-core --features spike spike::tests` returning
22 tests green on 2026-04-21, including:

- 9 `torn_*` tests splitting every D-02 multi-byte sequence at every internal
  offset (both prototypes), cross-checked via `assert_identical_across_splits`
- 3 direct cross-prototype equivalence tests comparing final `SpikeTerminal`
  state between `run_hand_rolled` and `run_vte` on mixed-input payloads
- 10 `both_produce!` macro-generated tests exercising the D-02 opcode set
  (ESC A/B/C/D cursor moves, 4 ESC Y edges per PITFALLS.md #3, ESC J / ESC K
  erase)

Neither prototype has a shorter or longer path to passing — they both arrive
at byte-identical state for every input, including every torn-chunk split.
The decision above is therefore purely a judgment on code clarity and
extensibility per D-03, not a correctness comparison.

## Implications for Plan 04

Plan 04 will:

1. Delete `crates/bestialitty-core/src/spike/hand_rolled.rs` and the
   `pub mod hand_rolled;` line in `spike/mod.rs`.
2. Promote `spike/vte_path.rs` to `crates/bestialitty-core/src/vt52.rs`,
   extending the `esc_dispatch` match to cover the full Phase 1 VT52 subset
   (ESC H home, ESC I reverse LF, ESC Z identify with host reply, ESC F/G/=/>/[\\
   silent no-ops) and the `execute` match to cover C0 control bytes (BS, HT,
   LF, CR, BEL setting `bell_pending`).
3. Reshape the boundary: production `Parser` wraps `vte::Parser` + a Perform
   impl whose `term` field points at the full `Terminal` struct (not the
   spike-scoped `SpikeTerminal`). `EscYPhase` sub-state moves onto
   `struct Parser` alongside `inner: vte::Parser` so it persists across
   `feed()` call boundaries.
4. Update `Cargo.toml`: remove `[features] spike = ["dep:vte"]`, promote
   `vte = { version = "=0.15", optional = true }` to `vte = "=0.15"` as a
   plain dep (no longer optional), remove the `spike = []` feature entry.
5. Keep the torn-chunk harness as a production test at
   `crates/bestialitty-core/tests/torn_chunk.rs` (or equivalent), re-running
   `assert_identical_across_splits` against the production `Terminal` +
   `Parser` on every multi-byte sequence including the full Phase 1
   extension set.
6. Delete `crates/bestialitty-core/src/spike/` in its entirety as the final
   step — nothing ships under `spike/` in production builds.

Phase 2 (wasm-pack) owns the bundle-size measurement that will either confirm
this ADR's bundle-cost assumption or reopen it.

## References

- `.planning/phases/01-rust-core-parser-grid-key-encoder/01-CONTEXT.md` —
  D-02 (locked 7-sequence minimum), D-03 (floor condition + readability
  criterion + dependency tiebreaker), D-04 (this ADR's existence requirement)
- `.planning/phases/01-rust-core-parser-grid-key-encoder/01-RESEARCH.md` —
  Pattern 1 (both prototype code sketches with the same signatures used here);
  ESC Y Decoding section (saturating arithmetic); Torn-Chunk Test Harness
  section (systematic split-at-every-offset pattern); Open Question #4
  (resolved: vte 0.15.0 verified current)
- `.planning/research/STACK.md` — "do NOT use vte wholesale" argument that
  this ADR overrules on correctness grounds
- `.planning/research/ARCHITECTURE.md` — "build on vte::Parser + Perform"
  argument that this ADR accepts
- `.planning/research/PITFALLS.md` #2 (torn chunks — both prototypes mitigated
  identically via the harness), #3 (ESC Y +32 offset — both prototypes use
  the shared `decode_esc_y_byte` formula)
- `crates/bestialitty-core/src/spike/tests.rs` — identical test matrix,
  floor condition satisfied (22/22)
- `crates/bestialitty-core/src/spike/hand_rolled.rs` — rejected alternative
  (cited inline at `hand_rolled.rs:65-101` and `hand_rolled.rs:89,95-100`)
- `crates/bestialitty-core/src/spike/vte_path.rs` — adopted approach (cited
  inline at `vte_path.rs:20-23` for the EscYPhase sub-state and
  `vte_path.rs:104-108` for the trait-obligation empty methods)
- [docs.rs — vte 0.15.0](https://docs.rs/vte/0.15.0/vte/)
