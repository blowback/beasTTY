# Milestones: Beastty

Historical record of shipped versions. Each entry is a self-contained
summary; full archival detail (per-phase plans, requirements traceability,
decisions) lives in `.planning/milestones/v{X.Y}-*.md`.

---

## v1.1 — SLIDE FileTransfer

**Shipped:** 2026-05-10
**Phases:** 7–12 (6 phases, 28 plans)
**Requirements:** 42 SLIDE-* (100% complete)
**Timeline:** 2026-05-06 → 2026-05-10 (5 days, ~239 commits)

### Delivered

Browser-side SLIDE protocol on top of the v1.0 substrate — bidirectional
file transfer between PC and MicroBeast (host-initiated send and
Z80-initiated receive) without leaving Beastty.

### Key accomplishments

1. Pure-Rust SLIDE state machine in a new `slide/` module — byte-fed
   framer, CRC-16-CCITT, sliding-window send/receive, RDY/ACK/NAK/CAN/FIN
   handshakes; torn-chunk safe; ZERO browser deps; native `cargo test`
   green at 283 tests.
2. JS dispatcher routes Web Serial chunks to terminal-parser-or-SLIDE
   based on session mode; 7-byte `ESC ^ S L I D E` wakeup matched
   across arbitrary chunk-boundary splits.
3. Host → Z80 send: multi-file picker + drag-drop, auto-typed
   `B:SLIDE R\r`, CP/M 8.3 filename normalisation + character validation,
   `writer.ready` backpressure discipline, byte-identical round-trip
   verified via 4-impl drift detection (Rust SM ↔ Rust mock ↔ JS mock ↔
   slide-rs reference).
4. Z80 → PC receive: per-file Chrome download (anchor-click default,
   opt-in `showDirectoryPicker` for batches), zero-byte / sub-frame /
   binary / 1 MB+ edge cases, memory-bounded reassembly, ADR-003 5-step
   CTRL_CAN cancel sequence, idempotent re-entrant wakeup.
5. v1.0 integration — floating SLIDE chip mirroring the Phase 6
   scrollback chip (opposite corner), Settings sub-block, session-log
   pause, paste-pump gate, port-lost symmetry, auto-typed-command echo
   swallow, Compatibility-mode 3-way pref (`auto`/`wakeup-required`/
   `force-start`) for legacy slide.com fallback.
6. Docs and real-hardware UAT — `docs/SLIDE_Z80_REQUIREMENT.md` (Z80
   patch requirement, v0.2.1 amendment, upstream PR target),
   `docs/SLIDE-UAT.md` (4-test hardware checklist), README "File
   transfer" section, RTS-on-connect prefs gate added during UAT-fix
   session.

### Known deferred items

| Category | Item | Status |
|----------|------|--------|
| Real-hardware UAT | `docs/SLIDE-UAT.md` end-to-end against patched MicroBeast | Gated on upstream `github.com/blowback/slide` PR merge — out-of-band |
| Test infra | log-download.spec.js filename drift (`bestialitty-` vs `beastty-`) from project rename | Pre-existing; logged in phase deferred-items |
| Test infra | 10-worker parallel test-suite flakes (slide-recv-settings, slide-recv-fsap, slide-cancel timing-window) | Green at `--workers=4`; logged in phase deferred-items |

### Archive

- `.planning/milestones/v1.1-ROADMAP.md` — full phase details + summary
- `.planning/milestones/v1.1-REQUIREMENTS.md` — 42 SLIDE-* requirements + traceability

### Tag

`v1.1` (annotated; pushed: TBD on user confirmation)

---

## v1.0 — MVP (informal)

**Shipped:** 2026-04-25 (code-complete after Phase 6)
**Phases:** 1–6
**Requirements:** 54 v1 (100% complete at code level)

The v1.0 MVP — Rust core (parser, terminal state, key encoder), wasm
boundary, canvas renderer (CRT + clean themes), keyboard input, Web Serial
transport, daily-driver polish (copy/paste, scrollback, session logging,
prefs, static deploy under MIT).

**Was not formally archived at the time** — closed retroactively as
historical context during the v1.1 milestone close on 2026-05-10. No
`v1.0` git tag was created; no `.planning/milestones/v1.0-*.md` archive
files exist. The v1.0 phases remain visible in the live `ROADMAP.md`
under a collapsed `<details>` section, and the v1 Requirements section
remains in the live `REQUIREMENTS.md` for traceability.

**Out-of-band sign-off items** carried forward to v1.1 deferred list
(now superseded by daily-driver use during v1.1 development):

- 24-h memory-flat soak (`06-SOAK.md`)
- Daily-driver full-session UAT (`06-HUMAN-UAT.md`)
- GitHub Pages first-deploy smoke check
