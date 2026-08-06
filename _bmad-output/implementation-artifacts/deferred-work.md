# Deferred Work

Findings surfaced incidentally during quick-dev runs that are **not** caused by the
change that found them. Each entry records where it came from so the context is
recoverable.

---

## From `spec-command-history-escape-hatch.md` (2026-08-06)

Surfaced by the three-reviewer pass over the command-history chord toggle. All were
judged pre-existing or out of scope; none blocked that change.

### Accessibility — transient live regions may never announce

`www/renderer/toast.js` and `www/renderer/paste-toast.js` both create their live region
with the `hidden` attribute set, then reveal it with text already in place. Screen
readers register live regions as they enter the accessibility tree, and a region that is
hidden at registration and unhidden with content present is commonly not announced —
NVDA and VoiceOver both drop this pattern intermittently. For the command-history toast
this matters more than usual: it is the *only* feedback that the chord landed, so a
screen-reader user may get nothing at all.

Related: both set `aria-label` to the same string as the child text on an
`aria-atomic="true"` region, which can produce a doubled announcement
("Command history off, Command history off") or suppress the text entirely.

Fixing either one in isolation would leave the two toasts inconsistent — worth doing as
one pass over both modules, ideally verified with a real screen reader rather than by
reading the spec.

### Preferences are not flushed on teardown

`savePrefs()` debounces its localStorage write by 250 ms (`www/state/prefs.js:192-196`)
and nothing flushes on `pagehide`. Any setting changed within 250 ms of a reload or tab
close is silently lost. Affects every preference, not just command history — it is
simply easy to hit with a keyboard chord, where the toast confirms a change that may
never reach storage.

### Settings checkbox goes stale while its menu is open

The chord writes `commandHistoryEnabled` directly and `savePrefs` deliberately does not
fan out. The Settings row re-projects when the menu opens
(`www/renderer/menu-bar.js:1194`), so the normal case self-corrects. But `menu-bar.js`
lets modifier chords through, so pressing the chord *while the Settings menu is open*
leaves the visible checkbox contradicting the stored value until the menu is closed and
reopened.

### `Ctrl+Shift+Esc` is claimed by Windows

The chord clears a selection and is now advertised in Help ▸ Keyboard Shortcuts. On
Windows it opens Task Manager and never reaches the page, so the modal promises
something that cannot work there. Previously it was merely undocumented and dead on that
platform; it is now a visible promise. Either qualify the row or pick a different chord.
Beastty is a Chromium-only daily driver, so this may simply not matter — worth a
decision rather than a silent inconsistency.

### Toast placement and overflow

`#toast` is bottom-centre; `#scrollback-indicator` is bottom-right, both at `bottom: 8px`.
At low zoom or a narrow window they can overlap. The CSS also pairs `white-space: nowrap`
with `max-width` and no `overflow`/`text-overflow`, so a long message would spill past the
rounded border rather than truncate. Neither bites the two short fixed strings shipped
today; both would bite the first caller that passes a longer message.

### `Ctrl+Shift+Esc` has no behavioural test

Pre-existing: no test drives the chord against a real selection, before or after its move
into the registry. The registry hit/miss probe pins the predicate but not the effect.

### Playwright suite has a pool of load-sensitive specs

A full `npm test` run flakes on 1–2 specs, and it is a *different* spec almost every run
— observed across five runs: `render/zoom.spec.js:51`, `input/file-source.spec.js:160`,
`input/keydown-arrows.spec.js:19`, `render/focus.spec.js:78`, `input/tx-sink.spec.js`.
All pass consistently in isolation under `--repeat-each`. Confirmed pre-existing by
running the untouched baseline, which flaked the same way. Worth a focused look at
`fullyParallel: true` and the boot-race guards several of these share.

### Auto-generated `www/` docs are stale beyond the lines this change touched

`docs/architecture-www.md` (generated 2026-07-01, gitignored) still claims: `FONTS` maps
5 ids (there are 11); `main.js` is ~1077 lines (1888); the app wires ~25 subsystem
modules (44); `slide.js` is the largest module (`pull-pane.js` now is); and its
"wiring in strict order" list omits ten `wireXxx` calls. `docs/component-inventory-www.md`
and `architecture-www.md` also describe `prefs.js` `DEFAULTS` without the three E8
command-history keys.

Note both files are gitignored as auto-generated, so the durable fix is to regenerate
them, not to hand-patch. `EXPERIENCE.md` is likewise gitignored as planning scratch,
which is worth questioning on its own — it is the UX contract every story cites.
