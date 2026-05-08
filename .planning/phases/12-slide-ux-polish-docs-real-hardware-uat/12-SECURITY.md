---
phase: 12
slug: slide-ux-polish-docs-real-hardware-uat
status: verified
threats_open: 0
asvs_level: 1
created: 2026-05-09
---

# Phase 12 — Security

> Per-phase security contract: threat register, accepted risks, and audit trail.
> Phase 12 closes the v1.1 SLIDE FileTransfer milestone. All threats declared
> in PLAN 12-01..12-05 `<threat_model>` blocks are verified mitigated, accepted
> with documented rationale, or closed via documented known limitation.

---

## Trust Boundaries

Union of trust boundaries from PLANs 12-01..12-05.

| Boundary | Description | Data Crossing |
|----------|-------------|---------------|
| User → DOM (pointer events) | Browser pointer event stream entering selection.js's canvas event handler | Pointer button + coordinates (untrusted) |
| file-source.js → DOM (`[data-drop-target]` attribute writer) | Setter for the cross-module signal that selection.js reads | String literal `'true'` (owned by file-source.js) |
| selection.js → DOM (`[data-drop-target]` attribute reader) | Strict-equality read in onPointerDown | Attribute value (string or null) |
| User → file picker / drag-drop | Untrusted filenames + bytes enter the JS shell | Filenames (string), bytes (Uint8Array) |
| file-source.js → SLIDE wire (via slide.js enterSendMode) | Filenames + bytes cross to the Rust state machine | CP/M 8.3 names + file bytes |
| User → modal three-action button row | User choice resolves the Promise tagged result | `'send' \| 'first-only' \| 'refuse' \| null` |
| User → Settings input (auto-send command) | Configuration input enters localStorage and slide.js read path | String (validated against SAFE_AUTO_SEND_RE) |
| prefs.js → wire (auto-send bytes) | Validated command flows through use-time gate before `TextEncoder.encode` | UTF-8 bytes |
| User → first-use-confirm chip ([Confirm] / [Reset to default]) | Acknowledgement of non-default auto-send command | Promise resolution (boolean) |
| Doc author → Doc readers | Information flow only; no code, no DOM, no runtime | Markdown |
| Cross-references → External URLs | github.com/blowback/slide is an external dependency | URL strings |
| UAT author → human tester | Doc-only contract; tester relies on doc accuracy when running real-hardware tests | Markdown + procedures |
| UAT-12-04 → upstream slide.asm | The blocked test depends on an external repo's PR landing | Protocol behavior (out-of-band) |

---

## Threat Register

Phase 12 threats from PLAN `<threat_model>` blocks. Status verified 2026-05-09.

| Threat ID | Category | Component | Disposition | Mitigation | Status |
|-----------|----------|-----------|-------------|------------|--------|
| T-12-01 | Spoofing | selection.js onPointerDown vs file-source drop overlay | mitigate | Strict-equality `getAttribute('data-drop-target') === 'true'` predicate at top of `onPointerDown` (Pitfall 4). `getAttribute` returns null when absent → predicate fails-closed. Verified at `www/input/selection.js:119`. | closed |
| T-12-08 | Tampering | DOM `[data-drop-target]` attribute injection via untrusted scripts | accept | Beastty is a static site with no untrusted scripts; CSP locks origins. Attribute owned exclusively by file-source.js's `setDropTarget` (`www/input/file-source.js:291-298`). See Accepted Risks Log. | closed |
| T-12-02 | Tampering | Filename collision detection in `processFiles` | mitigate | Detection runs AFTER `validateCpmFilename` rejection (line 309) AND `truncateCpm83` (line 313). Key = `item.name.toUpperCase()` at `www/input/file-source.js:330` per D-01 catches case-insensitive + 8.3-truncation collisions. | closed |
| T-12-05 (12-02 surface) | Information Disclosure | XSS via filename in modal innerHTML | mitigate | Filename rendering uses `spanText(value, false, ...)` (escape-by-construction via `document.createTextNode`) and `document.createTextNode(...)` directly at `www/input/file-source.js:446-453`; aria-label set via `setAttribute` (line 451), not innerHTML. Helper at line 520-527. No template-string interpolation into HTML for user-controlled values. | closed |
| T-12-06 | Denial of Service | computeRenameScheme infinite loop on degenerate input | mitigate | Helper guards `!Array.isArray(group) \|\| group.length === 0` returns `[]`; bounded `for (let i = 1; i < group.length; i++)`; `Math.max(0, 8 - suffixDigits.length)` clamps baseLimit; no recursion, no while loops. Verified at `www/input/file-source.js:615-629`. | closed |
| T-12-09 | Repudiation | User clicks `[Refuse batch]` but files still ship | mitigate | `applyFirstOnlyFilter` (lines 390-400) actually drops K-1 files per group via index-based filter (Pitfall 3). `'refuse'` returnValue causes `processFiles` early-return BEFORE `enterSendMode`: `if (!action \|\| action === 'refuse') return;` at `www/input/file-source.js:348`; enterSendMode call at line 360-362 is gated on truthy finalFiles. | closed |
| T-12-10 | Tampering | clearSelectionFn callback throws and breaks drop | mitigate | onDrop wraps callback in `try { clearSelectionFnRef(); } catch { /* ignore */ }` at `www/input/file-source.js:281-283`. Defense-in-depth: main.js boot wiring also wraps `selection.clearSelection()` in try/catch at `www/main.js:721`. Drop wins per CONTEXT default. | closed |
| T-12-03 | Tampering / Elevation of Privilege | Auto-send command injection reaches Z80 prompt | mitigate | `SAFE_AUTO_SEND_RE = /^[A-Za-z0-9: ]*\r$/` at `www/state/prefs.js:174` (post-Rule-1 fix per 12-03-SUMMARY — adds space to char class so default `B:SLIDE R\r` passes; semicolons, pipes, LF, multiple CR, control chars, backslash all still rejected). Use-time hard gate in `slide.js readAutoSendCommandBytes` at `www/transport/slide.js:232-242` returns zero-length Uint8Array on rejection. `isAutoSendSafe` defensive against non-string types (`prefs.js:182-186`). | closed |
| T-12-04 | Spoofing | Hostile-config injection via shared prefs export / typed value | mitigate | First-use confirmation chip surfaces only at session start when `prefs.slideAutoSendCommandConfirmed !== current value` (`shouldSurfaceFirstUseConfirm` at `www/transport/slide.js:262-265`). Chip API `enterFirstUseConfirm({ value, onConfirm, onReset })` at `www/renderer/slide-chip.js:403`. User must click `[Confirm]` before bytes hit wire; `[Reset to default]` aborts and restores DEFAULTS. | closed |
| T-12-05 (12-03 surface) | Information Disclosure | XSS via auto-send command in chip text | mitigate | `escapeHtml` helper at `www/renderer/slide-chip.js:269-277` escapes `& < > " '` before innerHTML write at line 204-206. Defense-in-depth: SAFE_AUTO_SEND_RE rejects all HTML-relevant chars (`<`, `>`, `&`, `"`, `'`) at the gate, so any value reaching the chip is already HTML-safe; the escape pass is belt-and-braces. | closed |
| T-12-07 | Repudiation | First-use chip Esc / 30s timeout dismissal leaves dispatcher Promise unresolved | mitigate (known limitation) | 30s `setTimeout` calls `hide()` at `www/renderer/slide-chip.js:411-417`; awaiting Promise from `surfaceFirstUseConfirm` is left unresolved. Documented as known limitation in `12-03-SUMMARY.md` §Known Limitations with Phase 12.1 cleanup recommendation. No user-visible misbehaviour (user simply retries). Disposition language in PLAN 12-03 threat register explicitly classifies this as `mitigate (known limitation)`. | closed |
| T-12-11 | Denial of Service | Use-time gate fires DOM mutations on every send attempt | accept | O(1) per-send cost (single getElementById + attribute set + hint toggle). See Accepted Risks Log. | closed |
| T-12-doc-01 | Information Disclosure | Hardcoded PR # in SLIDE-40 doc creates dead link if PR closed/replaced | mitigate | Doc links to `https://github.com/blowback/slide` repo root only (verified at `docs/SLIDE_Z80_REQUIREMENT.md:99, 129, 131`); `grep -c '/pull/'` returns 0. "Status: pending upstream merge" banner at line 99 makes dependency explicit. Pitfall 7 honoured. | closed |
| T-12-doc-02 | Information Disclosure | README claims behavior that has not shipped | mitigate | "File transfer (SLIDE)" section at `README.md:91` describes only shipped behaviors from Plans 12-01..12-03 (drag-drop overlay, collision modal with `~N` rename, three-action footer, first-use-confirm chip, `B:SLIDE R\r` auto-send, ESC^SLIDE wakeup detection, Esc-cancel). Out-of-scope P2 differentiators (preset dropdown, ETA, NAK counter) absent — `grep -E 'preset\|ETA\|NAK'` returns 0 hits. | closed |
| T-12-doc-03 | Repudiation | Doc fails to cite ADR-003 + upstream sources | accept | §5 Cross-link section at `docs/SLIDE_Z80_REQUIREMENT.md:127-131` enumerates ADR-003 (relative-path link), upstream repo, SPEC-v0.2.md. Beastty's `.planning/` archive preserves history regardless. See Accepted Risks Log. | closed |
| T-12-uat-01 | Information Disclosure | UAT promises behavior that has not shipped | mitigate | UAT references SLIDE-12 / SLIDE-36 / SLIDE-38 shipped behaviors only (`docs/SLIDE-UAT.md` UAT-12-01..04 headers at lines 42, 74, 105, 130). UAT-12-04 carries `result: blocked` line at line 151 until upstream slide.asm patch lands. | closed |
| T-12-uat-02 | Repudiation | UAT-12-04 falsely passes against unpatched Z80 | mitigate | `result: blocked` line is mandatory in scaffold (`docs/SLIDE-UAT.md:151`). Setup section at line 23 explicitly identifies patched `slide.com` requirement and the legacy slide.com fallback path. Inherits UAT-10-01 blocked-result idiom. | closed |
| T-12-uat-03 | Spoofing | A 5th test added drifting scope | mitigate | `grep -c '^### UAT-12-' docs/SLIDE-UAT.md` returns exactly `4` (verified 2026-05-09). Scope locked at exactly 4 tests per Pitfall 8. | closed |

*Status: open · closed*
*Disposition: mitigate (implementation required) · accept (documented risk) · transfer (third-party)*

---

## Accepted Risks Log

| Risk ID | Threat Ref | Rationale | Accepted By | Date |
|---------|------------|-----------|-------------|------|
| R-12-08 | T-12-08 | Beastty is a Chromium-only static site with no server runtime and no untrusted-script injection vector. CSP locks origins. The `[data-drop-target]` attribute is owned exclusively by `file-source.js setDropTarget` (`www/input/file-source.js:291-298`) and read exclusively by `selection.js onPointerDown`. Tampering would require XSS, which the wider CSP gates. No mitigation work assigned in Phase 12; revisit only if CSP posture changes. | gsd-security-auditor (PLAN 12-01) | 2026-05-09 |
| R-12-11 | T-12-11 | The use-time DOM mutations (single getElementById + setAttribute + hidden toggle) execute only on `enterSendMode` invocation — once per user-initiated send action. O(1) cost; no per-frame or per-byte amplification. Browser repaint cost negligible against the SLIDE wire baseline. No mitigation work assigned. | gsd-security-auditor (PLAN 12-03) | 2026-05-09 |
| R-12-doc-03 | T-12-doc-03 | Cross-link enumeration in `docs/SLIDE_Z80_REQUIREMENT.md` §5 (lines 127-131) cites ADR-003, SPEC-v0.2.md (upstream), and the upstream repo. Beastty's project archive (`.planning/`) preserves the full decision history regardless of the doc surface. The repudiation surface is informational, not authoritative. | gsd-security-auditor (PLAN 12-04) | 2026-05-09 |

*Accepted risks do not resurface in future audit runs.*

---

## Security Audit Trail

| Audit Date | Threats Total | Closed | Open | Run By |
|------------|---------------|--------|------|--------|
| 2026-05-09 | 18 | 18 | 0 | gsd-security-auditor (Opus 4.7) |

Notes for 2026-05-09 run:
- 5 PLANs reviewed: 12-01, 12-02, 12-03, 12-04, 12-05.
- T-12-05 appears twice in the register (12-02 filename surface + 12-03 chip surface) — both surfaces verified independently.
- No unregistered threat flags. Both 12-02-SUMMARY.md and 12-03-SUMMARY.md `## Threat Flags` sections explicitly state "no new threat surface introduced." 12-04 / 12-05 are markdown-only deliverables with no runtime surface.
- T-12-07 documented known limitation (Promise leak on first-use-confirm timeout) carried forward to Phase 12.1 cleanup per 12-03-SUMMARY §Known Limitations; closed in this audit per the `mitigate (known limitation)` disposition declared in the PLAN 12-03 threat register.
- 12-03 PLAN-time regex `/^[A-Za-z0-9:]*\r$/` was widened to `/^[A-Za-z0-9: ]*\r$/` during execution (12-03-SUMMARY Rule 1 deviation) so the default value `B:SLIDE R\r` passes the gate. Threat model preserved: semicolons (0x3B), pipes (0x7C), LF (0x0A), backslash (0x5C), and control chars (0x00..0x1F except CR) all remain outside the character class and are still rejected. T-12-03 mitigation strength unchanged.

---

## Sign-Off

- [x] All threats have a disposition (mitigate / accept / transfer)
- [x] Accepted risks documented in Accepted Risks Log (R-12-08, R-12-11, R-12-doc-03)
- [x] `threats_open: 0` confirmed
- [x] `status: verified` set in frontmatter

**Approval:** verified 2026-05-09
