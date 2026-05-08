# Phase 10: SLIDE Receiver & Cancellation - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-05-08
**Phase:** 10-slide-receiver-cancellation
**Mode:** discuss (--chain)
**Areas presented:** Receiver data API (Rust→JS), Multi-file download flow, Mid-session re-entry (SLIDE-34), Cancel UX + timing
**Areas selected by user:** Multi-file download flow

---

## Gray Area Selection

| Area | Description | Selected |
|------|-------------|----------|
| Receiver data API (Rust→JS) | How filename + per-frame payload bytes flow from Rust to JS. EVT_HEADER_RECEIVED + EVT_DATA_PAYLOAD events vs recv_ptr/_len/clear_recv triple vs slide.take_payload() per EVT_DATA_FRAME. | |
| Multi-file download flow | When does showDirectoryPicker prompt appear? Confirm anchor-click + 250ms gap for single-file path. | ✓ |
| Mid-session re-entry (SLIDE-34) | Where does ESC^SLIDE re-detection live during active recv: JS dispatchRecvMode wakeup matcher vs Rust framer extension vs hybrid. | |
| Cancel UX + timing | Pre-chip cancel surface (Esc-only, top-bar button, programmatic only) + confirm cancel timing windows from PITFALLS §5 + ADR-003. | |

**User's choice:** Multi-file download flow only.
**Notes:** Other three areas become Claude's Discretion; researcher and planner will read PITFALLS §5 + ADR-003 + 09-CONTEXT directly to fill in.

---

## Multi-file download flow

### Q1: When does the showDirectoryPicker prompt fire for a batch > 1 file?

| Option | Description | Selected |
|--------|-------------|----------|
| On 2nd file (lazy) | 1st file always anchor-click; on 2nd file, prompt "Save the rest to a folder?". Aligns with "opt-in fallback" wording. | |
| Proactive at recv-mode entry | Two-button modal at wakeup. Pro: no mid-stream interruption. Con: prompts on every single-file recv. | |
| User-controlled toggle | Settings pane row "Save received files to a folder" (off by default). On = pick directory at first session, remember for page lifetime. No mid-stream prompt. | ✓ |
| Always anchor-click; document the prompt | Skip showDirectoryPicker; rely on Chrome's "Allow multiple downloads" site-permission. | |

**User's choice:** User-controlled toggle.
**Notes:** Pulls one Settings row forward from Phase 11 (rest of Settings block stays Phase 11). Cleaner mental model than mid-stream interruptions.

### Q2: If the user dismisses (cancels) the directory picker, what happens?

| Option | Description | Selected |
|--------|-------------|----------|
| Fall back to anchor-click | Treat dismissal as "use individual downloads instead". Continue session via anchor-click + 250ms gap. Don't re-ask. | ✓ |
| Cancel the recv session | Treat dismissal as "I don't want these files". Emit CTRL_CAN, drain, exit. | |
| Re-prompt on next file | Dismiss applies to current file only; next file boundary re-prompts. | |

**User's choice:** Fall back to anchor-click.
**Notes:** Toggle stays on; next recv session re-attempts the picker. No CTRL_CAN.

### Q3: When showDirectoryPicker is in use and a target file already exists, what does v1.1 do?

| Option | Description | Selected |
|--------|-------------|----------|
| Overwrite silently | createWritable() truncates by default. Matches CP/M's silent-overwrite semantics. | |
| Append numeric suffix | MYFILE.TXT → MYFILE-1.TXT etc. Mirrors Phase 12 SLIDE-36 send-side. Breaks SLIDE-20 "verbatim" acceptance. | ✓ |
| Skip + log to chip later | Don't overwrite; emit a Phase-11 chip warning; continue with remaining files. | |

**User's choice:** Append numeric suffix.
**Notes:** Most data-safe; mirrors send-side collision UX for visual consistency.

### Q4: Does the toggle affect single-file recv too?

| Option | Description | Selected |
|--------|-------------|----------|
| Toggle gates all recv sessions | On = always use directory; off = always use anchor-click. Single mental model. | ✓ |
| Toggle gates only batches ≥ 2 | Single-file recv always uses anchor-click. Avoids prompting for one-off transfers. | |
| Two separate toggles | Independent toggles for single-file vs batches. | |

**User's choice:** Toggle gates all recv sessions.

### Q5: How long does the chosen directory persist?

| Option | Description | Selected |
|--------|-------------|----------|
| Page lifetime | FileSystemDirectoryHandle held in module memory for the tab. Reload → user picks again. | |
| Across reloads (IndexedDB) | Persist the handle to IndexedDB; re-request permission on next reload (Chrome shows one-click "Allow"). User picks once — ever. | ✓ |
| Per-recv-session | User picks at every recv session. Most explicit; most friction. | |

**User's choice:** Across reloads (IndexedDB).
**Notes:** Pulls IndexedDB into v1.1 (currently unused). Planner sizes a tiny `www/state/idb.js` module.

### Q6: SLIDE-20 vs collision policy reconciliation

| Option | Description | Selected |
|--------|-------------|----------|
| Suffix only on collision; verbatim otherwise | SLIDE-20 acceptance is "verbatim when no conflict". Annotate REQUIREMENTS.md with collision-exception clause. Pragmatic. | ✓ |
| Drop suffix, overwrite silently | Honour SLIDE-20 strictly. Same-name = overwrite (reverses Q3 pick). | |
| Drop suffix, skip + warn | Honour SLIDE-20. Skip colliding files (reverses Q3 pick). | |

**User's choice:** Suffix only on collision; verbatim otherwise.
**Notes:** Planner adds a one-line note to REQUIREMENTS.md SLIDE-20 referencing this CONTEXT decision.

### Q7: Where does the toggle UI live?

| Option | Description | Selected |
|--------|-------------|----------|
| Settings pane row + prefs key | New row in Settings pane: '[ ] Save received files to a folder' (off by default). prefs.js gains slideRecvToFolder boolean + slideRecvDirectoryHandle (IndexedDB). Click 'Choose folder…' next to checkbox. | ✓ |
| Top-bar button only | Add '[↓ Save to folder]' button to top-bar. Click cycles state. No Settings row. | |
| Settings + top-bar status pill | Settings owns toggle; top-bar shows status pill. Maximum visibility, more code. | |

**User's choice:** Settings pane row + prefs key.

### Q8: Suffix style format?

| Option | Description | Selected |
|--------|-------------|----------|
| REPORT~1.TXT (tilde) | Mirrors Phase 12 SLIDE-36 send-side auto-rename. Visual consistency across send/recv. Bounded ~9 collisions. | ✓ |
| REPORT-1.TXT (dash) | Plainer; slightly more readable. Diverges from Phase 12 convention. | |
| REPORT (1).TXT (parens) | Chrome/Finder convention. Familiar but parens are CP/M-invalid. | |

**User's choice:** REPORT~1.TXT (tilde).
**Notes:** Visual consistency with Phase 12 send-side collision UX.

### Q9: Suffix retry budget — what if 9+ collisions in a row?

| Option | Description | Selected |
|--------|-------------|----------|
| Bail → fall through to anchor-click | After ~9 fails, give up on directory mode for this file: trigger anchor-click as last-resort. | |
| Bail → cancel session | Treat as hard error; CTRL_CAN, drain, exit. | |
| Keep going (~999 then bail) | Higher bound — unlikely to ever trip. Marginal value over 9. | ✓ |

**User's choice:** Keep going (~999 then bail).
**Notes:** Hard ceiling so the loop can't run forever; ~999 is implausible in real workflow. After 999 failures, fall through to anchor-click for that single file.

---

## Claude's Discretion (areas not selected; deferred to research/planning)

- **Recv data API shape (Rust → JS)** — researcher reads slide-rs/recv.rs:172-180 + Phase 7 state.rs:466-555 and picks: new EVT_HEADER_RECEIVED + EVT_DATA_PAYLOAD events vs recv_ptr/_len/clear_recv triple vs hybrid. Default expectation: triple-accessor mirroring outbound triple, plus EVT_HEADER_RECEIVED for filename arrival.
- **Mid-session re-entry detection (SLIDE-34)** — default: JS dispatchRecvMode wakeup matcher (mirror of dispatchTerminalMode 7-byte matcher).
- **Cancel UX in Phase 10 (pre-chip)** — Esc-key (slot 2/4 in disambiguation chain) + window.__slide.cancelRecv() programmatic only. No top-bar button. Chip is Phase 11.
- **Esc disambiguation slot** — slot 2 of 4 per ROADMAP; insertion order locked (1) selection drag, 2) SLIDE cancel, 3) paste cancel, 4) 0x1B fallthrough).
- **Cancel timing windows** — adopt PITFALLS §5 + ADR-003 verbatim: 200ms allSettled / 500ms Z80 echo / 100ms drain / 2000ms force_idle absolute.
- **Hard-fail recovery (SLIDE-29)** — three failure modes (NAK_BUDGET / port lost / wire desync) all converge on: exit recv mode, set wire owner back to terminal, console.error, leave open for fresh recv session via next wakeup.
- **Receiver test mock** — extend Phase 9's mock-serial-slide-bot.js with sender role (single bot module, role parameter).
- **www/transport/slide-recv.js** — new sibling file vs in-place extension to slide.js. Default: new sibling (slide.js stays byte-routing authority).
- **prefs.js + IndexedDB layout** — slideRecvToFolder in DEFAULTS; FileSystemDirectoryHandle in IndexedDB store `bestialitty-handles` key `recv_directory`.
- **Suffix algorithm precise spec** — split on last `.`; insert `~N` immediately before the last dot.
- **Per-frame download trigger timing** — at EOF data frame ACK; Blob assembled once, anchor-click fires synchronously, chunks reset for next file.
- **Edge-case test corpus** — extend slide_torn_chunk.rs with zero-byte / sub-frame / binary / 1MB+ fixtures; Playwright slide-recv.spec.js + slide-cancel.spec.js for E2E.

---

## Deferred Ideas

(None mentioned during discussion that weren't already in Phase 11/12 scope per ROADMAP.)
