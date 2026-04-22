# Phase 3: Canvas Renderer - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-04-22
**Phase:** 03-canvas-renderer
**Areas discussed:** Font strategy, Theme architecture & cursor, Bell/zoom/CRT effects, Canvas chrome & harness

---

## Font strategy (both themes)

### CRT pixel-font sourcing

| Option | Description | Selected |
|--------|-------------|----------|
| Hand-drawn 8×16 table (Uint8Array) | ~4 KB inlined JS module; zero network; pixel-perfect integer scaling | ✓ |
| Freely-licensed bitmap font (Terminus / Cozette, WOFF2 or PNG atlas) | Authentic but larger; introduces font-load step that must block first paint | |
| PNG glyph sheet | Pre-baked 128-char atlas; async decode; per-phosphor tinting is awkward | |
| You decide | Claude picks based on license + weight + authenticity | |

**User's choice:** Hand-drawn 8×16 table — zero network, pixel-perfect scaling.
**Notes:** CONTEXT.md D-01 allows IBM VGA public-domain ROM as reference source; Claude finalises during planning.

### Clean theme font loading

| Option | Description | Selected |
|--------|-------------|----------|
| Self-hosted WOFF2 + system fallback (font-display: block) | JetBrains Mono as subset WOFF2; up-to-3-s block to avoid SC-1 fallback flash | ✓ |
| System monospace only | Zero network, zero flash, but loses JetBrains Mono per ROADMAP | |
| Google Fonts CDN | Single `<link>`; adds third-party network dependency; privacy implications | |
| You decide | Claude picks honoring SC-1 no-flash | |

**User's choice:** Self-hosted WOFF2 with system fallback.
**Notes:** `font-display: block` specifically to satisfy SC-1 "no font-fallback flash on first paint".

### Glyph atlas code path

| Option | Description | Selected |
|--------|-------------|----------|
| Unified atlas, different rasterisers | One `Map<(ch, fg, theme), OffscreenCanvas>`; two rasteriser fns (bitmap vs vector); shared dirty-row repaint | ✓ |
| Separate atlases per theme | Two caches; simpler mental model; higher memory | |
| You decide | Claude picks based on divergence of rasterisation paths | |

**User's choice:** Unified atlas.

---

## Theme architecture & cursor

### Theme definition/structure

| Option | Description | Selected |
|--------|-------------|----------|
| Plain JS object descriptors | `THEMES` map in `www/renderer/themes.js`; swap = reference swap + atlas evict; zero CSS coupling to canvas | ✓ |
| CSS custom properties + JS config | CSS vars for chrome; JS config for canvas values; split model | |
| You decide | Claude picks based on how much DOM chrome the phase ends up with | |

**User's choice:** Plain JS object descriptors. Chrome-side CSS vars are permitted for the top bar + bell overlay; canvas drawing is pure JS-config driven.

### Theme state location in v1

| Option | Description | Selected |
|--------|-------------|----------|
| Module-local only, no persistence | localStorage is explicitly Phase 6 (PREF-01); Phase 3 stays focused on rendering | ✓ |
| localStorage in Phase 3 | Simpler for testing but duplicates Phase 6 work | |
| You decide | Claude picks respecting Phase 6 scope | |

**User's choice:** Module-local only. Reload resets to default (CRT / green / 1×).

### Phosphor color structure

| Option | Description | Selected |
|--------|-------------|----------|
| Fixed 3-slot enum inside CRT theme | `'green' \| 'amber' \| 'white'`; three pre-computed palettes; matches RENDER-08 verbatim | ✓ |
| Arbitrary hex color picker | Overkill for v1 | |
| You decide | Claude picks | |

**User's choice:** Fixed 3-slot enum.

### Cursor blink + focus behavior

| Option | Description | Selected |
|--------|-------------|----------|
| Blink ON focused (530 ms), steady outlined on blur | Classic DEC VT cadence; matches xterm; rAF-driven phase counter; theme colors differ | ✓ |
| Steady block always | Simpler; no animation loop; weaker aesthetic | |
| Blink always (focused or blurred) | Simpler state machine; weaker focus affordance | |
| You decide | Claude picks honoring RENDER-03 | |

**User's choice:** Blink-on-focus with 530 ms cadence, steady outlined on blur.

---

## Bell, zoom, & CRT effects

### Bell flash mechanism

| Option | Description | Selected |
|--------|-------------|----------|
| CSS overlay div with opacity pulse | `position: absolute` overlay; CSS transition; zero canvas damage; theme-aware via CSS var | ✓ |
| Canvas full-palette invert for one frame (~6 frames) | Authentic CRT flash; evicts atlas twice | |
| Background color flip for 100 ms | Simpler but subtle with filled backgrounds | |
| You decide | Claude picks | |

**User's choice:** CSS overlay div.

### Title-bar '(!)' indicator

| Option | Description | Selected |
|--------|-------------|----------|
| Append only when `document.hidden`, clear on visibilitychange=visible | Matches ROADMAP SC-3 "when the tab is backgrounded" | ✓ |
| Always append on BEL; user clicks to clear | Louder but more annoying; foreground BEL already has screen flash | |
| You decide | Claude picks | |

**User's choice:** `document.hidden`-scoped behavior with visibilitychange listener.

### Zoom range & control

| Option | Description | Selected |
|--------|-------------|----------|
| 1×–4× integer, Ctrl +/−/0 keyboard only | Covers laptop→external display; matches SC-3 keyboard-only wording; integer-only for pixel-perfect bitmap scaling | ✓ |
| 1×–6× integer + UI corner buttons | Wider range; dual surface; scope creep | |
| Fractional zoom (0.5×, 1×, 1.5×, …) | Breaks pixel-perfect bitmap scaling | |
| You decide | Claude picks honoring keyboard-only | |

**User's choice:** 1×–4× integer, keyboard-only.

### Scanlines/glow in v1 CRT

| Option | Description | Selected |
|--------|-------------|----------|
| Fixed subtle scanlines, no slider, no glow | 15% opacity CSS gradient; v2-RENDER-01 stays v2; no `shadowBlur` perf cost | ✓ |
| Scanlines + subtle glow | Requires shadowBlur or separate glow canvas; perf cost high | |
| Defer all scanline/glow to v2 | Cleanest but visually less retro | |
| You decide | Claude picks aiming for CRT-ish with minimal perf cost | |

**User's choice:** Fixed subtle scanlines, no slider, no glow.

---

## Canvas chrome & harness

### Toolbar/chrome layout

| Option | Description | Selected |
|--------|-------------|----------|
| Minimal top bar (theme toggle + phosphor selector only) | Phosphor visible only in CRT; zoom keyboard-only; no status bar | ✓ |
| Full toolbar (theme + phosphor + zoom + status) | More scope and visual noise | |
| Invisible chrome (keyboard-only) | Purest aesthetic; discoverability suffers | |
| You decide | Claude picks favoring minimalism + discoverability | |

**User's choice:** Minimal top bar.

### Focus indicator

| Option | Description | Selected |
|--------|-------------|----------|
| 1 px theme-accent border + cursor blink on | Cheap, theme-aware, honors RENDER-03 (both border AND cursor change) | ✓ |
| Browser default outline only | Inconsistent with canvas themes (blue outline clashes with phosphor) | |
| You decide | Claude picks | |

**User's choice:** 1 px theme-accent border + cursor blink.

### Phase 2 harness disposition

| Option | Description | Selected |
|--------|-------------|----------|
| Retire `<pre>` readouts; move textarea + Feed + 64 KB Stress to collapsible Debug `<details>` | Canvas replaces pre-text; SC-4 demo still runnable; matches 02-06-SUMMARY deferred-sources rationale | ✓ |
| Retire ALL harness UI | Requires different test-feeding mechanism (URL query, console API); cleaner aesthetic | |
| Keep harness visible alongside canvas | Makes Phase 3 look unfinished; Phase 5 would retire it anyway | |
| You decide | Claude picks balancing aesthetics vs debug ergonomics | |

**User's choice:** Retire pre-text, collapse Feed + 64 KB Stress behind a `<details>` "Debug" section.

### Theme-toggle shortcut

| Option | Description | Selected |
|--------|-------------|----------|
| Ctrl+Shift+T (per ROADMAP example) | Matches SC-2 "e.g., Ctrl-Shift-T"; `preventDefault()` needed for Chromium reopen-closed-tab | ✓ |
| Alt+T | Simpler, not reserved; diverges from ROADMAP example | |
| Ctrl+` (backtick) | Not reserved; less mnemonic | |
| You decide | Claude picks least collision-prone | |

**User's choice:** Ctrl+Shift+T.

---

## Claude's Discretion

Items left to Claude during planning (CONTEXT.md §decisions → "Claude's Discretion"):
- Specific public-domain 8×16 ROM source for bitmap font (IBM VGA / Amiga Topaz / EGA / hand-draw).
- Exact CRT phosphor RGB values for green/amber/white presets.
- Cell size at 1× zoom (8×16 CSS pixels vs 16×32) — must satisfy "readable at 80×24 on typical laptop".
- CSS specifics for top-bar chrome (layout, spacing, typography) within the "minimal + theme-consistent" constraint.
- Whether OffscreenCanvas is used in a Worker or main thread (main thread is fine at 80×24 budget).
- DOM update mechanism for theme-toggle button label (direct `.textContent` mutation is the default given no framework).

## Deferred Ideas

Carried into CONTEXT.md §deferred:
- Scanline/phosphor intensity slider (v2-RENDER-01).
- VT52 graphics-mode glyphs (v2-RENDER-02).
- Phosphor glow / bloom.
- Custom phosphor hex color picker.
- Audible bell.
- User-selectable cursor shape.
- Fractional zoom.
- UI zoom buttons.
- localStorage persistence (Phase 6).
- Mouse selection / copy (Phase 6).
