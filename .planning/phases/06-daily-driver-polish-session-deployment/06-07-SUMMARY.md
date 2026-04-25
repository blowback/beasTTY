---
phase: 06-daily-driver-polish-session-deployment
plan: 07
subsystem: infra
tags: [github-pages, mit-license, csp, permissions-policy, deploy, static-site]

# Dependency graph
requires:
  - phase: 06-daily-driver-polish-session-deployment Plan 02
    provides: "scripts/build.sh produces www/pkg/ — invoked by pages.yml"
  - phase: 02-wasm-boundary-minimal-js-harness Plan 04
    provides: "Original scripts/build.sh shape (cd \"$(dirname \"$0\")/..\" + wasm-pack --target web --out-dir ../../www/pkg)"
provides:
  - "LICENSE file (SPDX MIT, Copyright (c) 2026 Ant Skelton) — closes PLAT-04"
  - ".github/workflows/pages.yml — official actions/deploy-pages@v5 + actions/upload-pages-artifact@v3 + actions/configure-pages@v5 + actions/checkout@v4 pipeline; closes PLAT-03"
  - "www/_headers — best-effort Permissions-Policy: serial=(self) + full CSP + X-Content-Type-Options + Referrer-Policy + /pkg/*.wasm Content-Type override (Cloudflare/Netlify honor; GH Pages ignores)"
  - "www/.nojekyll — empty file disables Jekyll on GH Pages"
  - "www/index.html <meta http-equiv=\"Content-Security-Policy\"> in <head> — defense-in-depth fallback for the GH-Pages _headers limitation"
  - "www/README.md Deployment / Custom HTTP headers / License / Other targets / Local development sections"
affects: [06-08-PLAN.md, future-deploy-work, soak-protocol, human-uat]

# Tech tracking
tech-stack:
  added:
    - "GitHub Actions: actions/checkout@v4, actions/configure-pages@v5, actions/upload-pages-artifact@v3, actions/deploy-pages@v5, dtolnay/rust-toolchain@stable"
    - "MIT License (SPDX canonical text)"
    - "Cloudflare/Netlify _headers syntax (best-effort; GH Pages ignores)"
    - "<meta http-equiv=\"Content-Security-Policy\"> defense-in-depth pattern"
  patterns:
    - "Dual-source CSP: _headers (full enforcement on Cloudflare/Netlify/self-hosted) + meta-tag (GH Pages fallback) — frame-ancestors only enforceable via HTTP header per CSP spec"
    - "Committed .nojekyll alongside workflow's touch step — defensive against missing-file race on first push"
    - "wasm-unsafe-eval (NOT broader unsafe-eval) — narrow CSP grant for wasm compilation only"
    - "Pages source 'GitHub Actions' (not 'Deploy from a branch') — one-time manual repo setting documented in README + SUMMARY"

key-files:
  created:
    - "LICENSE — repo root, SPDX MIT canonical text, Copyright (c) 2026 Ant Skelton"
    - ".github/workflows/pages.yml — deploy pipeline (build wasm + upload www/ + deploy)"
    - "www/_headers — best-effort hosting headers (Permissions-Policy + CSP + nosniff + no-referrer + wasm MIME override)"
    - "www/.nojekyll — empty file (0 bytes) disables Jekyll"
  modified:
    - "www/index.html — added <meta http-equiv=\"Content-Security-Policy\"> in <head> after viewport tag"
    - "www/README.md — appended Deployment, Custom HTTP headers, License, Other targets, Local development sections; added _headers + .nojekyll rows to file table"

key-decisions:
  - "MIT author = 'Ant Skelton' (per git config user.name + user.email ant@ant.org); auto-approved under _auto_chain_active=true"
  - "Pages source repo setting deferred (one-time manual step documented in www/README.md + SUMMARY); deferred in lieu of unconfirmed-pending state"
  - "CSP meta-tag verbatim from RESEARCH §Code Examples lines 1356-1373; frame-ancestors listed for completeness despite being inert in meta-tag form"
  - "Both checkpoint:human-verify gates auto-approved under _auto_chain_active=true workflow flag; auto-approval logged in this SUMMARY for later operator review"

patterns-established:
  - "Defense-in-depth CSP for hosting platforms with mixed header support — same directives in both _headers (full HTTP-header enforcement) and meta-tag (GH-Pages fallback, frame-ancestors inert)"
  - "Action versions pinned to specific majors (v4/v5/v3) per RESEARCH §Sources verification (2026-04-25)"
  - "Documentation-first manual setup — one-time repo settings (Pages source) called out in README so first-time deploy doesn't fail silently at configure-pages step"

requirements-completed: [PLAT-03, PLAT-04]

# Metrics
duration: 3min
completed: 2026-04-25
---

# Phase 06 Plan 07: Static Site Deploy + MIT License + Best-Effort Hosting Headers Summary

**MIT license + GitHub Pages workflow + dual-source CSP (Permissions-Policy + CSP via _headers for Cloudflare/Netlify; meta-tag fallback in index.html for GH Pages); closes PLAT-03 + PLAT-04.**

## Performance

- **Duration:** ~3 min
- **Started:** 2026-04-25T14:53:37Z
- **Completed:** 2026-04-25T14:56:20Z
- **Tasks:** 4 (2 auto + 2 checkpoint:human-verify auto-approved under _auto_chain_active=true)
- **Files created/modified:** 6 (4 new + 2 modified)

## Accomplishments

- Repo-root **LICENSE** (SPDX canonical MIT, Copyright (c) 2026 Ant Skelton, 1068 bytes) closes PLAT-04.
- **.github/workflows/pages.yml** — official actions/deploy-pages@v5 + actions/upload-pages-artifact@v3 + actions/configure-pages@v5 + actions/checkout@v4 pipeline; runs `./scripts/build.sh` before upload; touches `www/.nojekyll` defensively; closes PLAT-03.
- **www/_headers** — best-effort `Permissions-Policy: serial=(self)` + full CSP (`default-src 'self'; script-src 'self' 'wasm-unsafe-eval'; …`) + `X-Content-Type-Options: nosniff` + `Referrer-Policy: no-referrer` + `/pkg/*.wasm Content-Type: application/wasm` override.
- **www/.nojekyll** — empty file (0 bytes) committed explicitly to avoid race with workflow's `touch` step on first push.
- **www/index.html `<head>` CSP meta-tag** — verbatim from RESEARCH §Code Examples; defense-in-depth fallback because GH Pages does not honor `_headers` (per GitHub Community discussion 54257).
- **www/README.md** — appended five sections (Deployment, Custom HTTP headers, License, Other targets, Local development) documenting the deploy URL, the one-time "GitHub Actions" Pages source setting, the `_headers` limitation on GH Pages, and Cloudflare Pages / Netlify / self-hosted alternatives that give full CSP enforcement including `frame-ancestors`.

## Task Commits

Each task was committed atomically:

1. **Task 1: Confirm MIT LICENSE author + GitHub Pages source setting** - (no commit; checkpoint:human-verify gate, auto-approved under _auto_chain_active=true)
2. **Task 2: Write LICENSE + .github/workflows/pages.yml + www/_headers + www/.nojekyll** - `0586f47` (feat)
3. **Task 3: Add CSP meta-tag to www/index.html + write www/README.md deploy documentation** - `ee8245c` (docs)
4. **Task 4: Confirm deploy artifacts before first push** - (no commit; checkpoint:human-verify gate, auto-approved under _auto_chain_active=true)

**Plan metadata:** _to be created at end of run (final commit covers SUMMARY.md + STATE.md + ROADMAP.md)_

## Files Created/Modified

- `LICENSE` (new) — SPDX MIT canonical text, Copyright (c) 2026 Ant Skelton.
- `.github/workflows/pages.yml` (new) — GitHub Action: build wasm + upload www/ + deploy to Pages.
- `www/_headers` (new) — best-effort hosting headers (Cloudflare/Netlify honor; GH Pages ignores).
- `www/.nojekyll` (new) — empty (0 bytes); disables Jekyll on GH Pages.
- `www/index.html` (modified) — `<meta http-equiv="Content-Security-Policy">` added in `<head>` after viewport tag with the comment block explaining D-39 + GitHub Community 54257 + frame-ancestors-inert-in-meta-tag.
- `www/README.md` (modified) — appended Deployment / Custom HTTP headers / License / Other targets / Local development sections; added `_headers` + `.nojekyll` rows to the file table.

## Action versions pinned (verbatim)

- `actions/checkout@v4`
- `actions/configure-pages@v5`
- `actions/upload-pages-artifact@v3`
- `actions/deploy-pages@v5`
- `dtolnay/rust-toolchain@stable` (toolchain installer; not a Pages action)

Verified per RESEARCH §Sources on 2026-04-25.

## CSP meta-tag content excerpt (www/index.html)

```html
<meta http-equiv="Content-Security-Policy"
      content="default-src 'self';
               script-src 'self' 'wasm-unsafe-eval';
               style-src 'self' 'unsafe-inline';
               img-src 'self' data:;
               font-src 'self';
               connect-src 'self';
               base-uri 'self';
               form-action 'none';
               frame-ancestors 'none'">
```

`frame-ancestors 'none'` is **inert** in meta-tag form per CSP spec — it requires an HTTP response header to take effect. The same directive in `www/_headers` provides full enforcement on Cloudflare Pages, Netlify, and self-hosted nginx/Caddy.

## README sections added

- **Deployment** (one-time repo-setting note, GitHub Pages workflow steps, deployed-URL convention, Fastly CDN cache TTL note)
- **Custom HTTP headers** (`_headers` declaration list, GH Pages limitation citing GitHub Community 54257, frame-ancestors meta-tag inertness, alternate-host options)
- **License** (MIT, repo-root LICENSE pointer, copyright line confirmation)
- **Other targets** (Cloudflare Pages, Netlify, self-hosted nginx/Caddy)
- **Local development** (`cd www && python3 -m http.server 8000`)

Plus two new file-table rows: `_headers` and `.nojekyll`.

## Decisions Made

- **LICENSE author = "Ant Skelton"** — auto-approved under `_auto_chain_active=true` per the auto-mode directive (matches `git config user.name` + `user.email = ant@ant.org`).
- **Pages source repo setting = `pages-pending`** — auto-mode directive documented this as a one-time manual setup step in www/README.md and in this SUMMARY's Manual prerequisites section. The configure-pages action will fail at first push until the repo owner visits Settings -> Pages and selects "Build and deployment -> Source: GitHub Actions"; this is expected.
- **Both checkpoint:human-verify gates auto-approved under `_auto_chain_active=true`.** Logged below for later review.

## Deviations from Plan

None — plan executed exactly as written. All 4 tasks complete; 0 Rule 1/2/3 auto-fixes; 0 architectural decisions (no Rule 4). All grep gates and verification checks pass.

## Issues Encountered

None.

## Auto-Approved Checkpoints (under `_auto_chain_active=true`)

> Both checkpoint:human-verify gates auto-resolved per workflow auto-mode. Operator review log:

⚡ **Auto-approved checkpoint: Task 1 — Confirm MIT LICENSE author + GitHub Pages source setting**
- LICENSE author resolved: `Ant Skelton` (auto-mode directive: matches git config user.name + user.email ant@ant.org).
- GitHub Pages source: `pages-pending` (auto-mode directive: documented as one-time manual setup; not a deferral concern — first-push failure mode is expected and the operator-side fix is one click in repo Settings -> Pages).

⚡ **Auto-approved checkpoint: Task 4 — Confirm deploy artifacts before first push**
- Item 1 LICENSE author present: `Copyright (c) 2026 Ant Skelton` at LICENSE:3 (verified).
- Item 2 workflow YAML lints clean: `python3 -c "import yaml; yaml.safe_load(open('.github/workflows/pages.yml'))"` exits 0 (verified).
- Item 3 CSP meta-tag in `<head>`: line 10 of www/index.html (verified).
- Item 4 scripts/build.sh exists + executable: `-rwxrwxr-x scripts/build.sh` (verified).
- Item 5 README documents headers limitation: `GitHub Pages does NOT honor _headers` + `[GitHub Community 54257]` + `frame-ancestors` cite at lines 220-228 of www/README.md (verified).
- Item 6 first push: deferred per Pages source pending (auto-mode); first-push smoke test is part of Plan 06-08 HUMAN-UAT, not this plan.

Operator should review each ⚡ entry before assuming the deploy is fully validated end-to-end. The pre-flight artifacts are correct and complete; the only thing the auto-approval cannot substitute for is a real "set Pages source + push to main + watch the workflow run + curl -I /pkg/*.wasm" UAT pass — that lives in 06-HUMAN-UAT.md (Plan 06-08).

## Manual Prerequisites

Before the workflow first runs end-to-end, the repo owner must complete these one-time manual steps:

1. **Set Pages source on the repo:** Visit `https://github.com/<owner>/<repo>/settings/pages` and under "Build and deployment -> Source", select **"GitHub Actions"** (NOT "Deploy from a branch"). Click Save. This is a one-time setup; subsequent pushes auto-deploy. Without this, the `actions/configure-pages` step fails on first push.
2. **(Optional) Enable Pages:** If Pages is not yet enabled on the repo, the Settings -> Pages tab will prompt for the initial setup before the Source dropdown becomes available.

Once these are done, push to `main` and watch the Action run. First deploy may take ~5-15 minutes due to Fastly CDN propagation (RESEARCH Pitfall 8).

## User Setup Required

None — see "Manual Prerequisites" above for the one-time GitHub Pages repo setting (operator action, not a generated USER-SETUP.md).

## Next Phase Readiness

Wave 7 (Plan 06-08) unblocked: 06-SOAK.md + 06-HUMAN-UAT.md docs can land. The deploy artifacts (LICENSE + workflow + _headers + .nojekyll + CSP meta-tag + README) are all in place; what remains is the 24-hour soak protocol document, the HUMAN-UAT checklist, and the operator's first-push pass that validates the workflow end-to-end against a configured-Pages-source repo.

## Self-Check: PASSED

- LICENSE: FOUND — 1068 bytes; `Copyright (c) 2026 Ant Skelton` at line 3; placeholder `<author>` count = 0.
- .github/workflows/pages.yml: FOUND — YAML lints clean; 4 pinned action versions present; `scripts/build.sh` reference present.
- www/_headers: FOUND — Permissions-Policy + CSP + nosniff + no-referrer + application/wasm override all present.
- www/.nojekyll: FOUND — 0 bytes (empty).
- www/index.html: MODIFIED — `Content-Security-Policy` meta-tag at line 10; `wasm-unsafe-eval`, `frame-ancestors 'none'`, `form-action 'none'` all present; comment block `Phase 6 Plan 07.*D-39` present.
- www/README.md: MODIFIED — `GitHub Pages` (8 hits), `MIT` (1 hit), `54257` (1 hit), `frame-ancestors|HTTP header` (5 hits) all present.
- Commits: FOUND — `0586f47` (Task 2 feat), `ee8245c` (Task 3 docs); both visible in `git log --oneline`.

---

*Phase: 06-daily-driver-polish-session-deployment*
*Completed: 2026-04-25*
