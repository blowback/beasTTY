#!/usr/bin/env bash
# scripts/build.sh — build the beastty-core wasm into www/pkg
#
# Invariants (per Phase 2 RESEARCH Pitfall #5):
# - `cd "$(dirname "$0")/.."` makes the script idempotent under any cwd.
# - `--out-dir ../../www/pkg` is resolved RELATIVE TO THE CRATE's Cargo.toml
#   directory (crates/beastty-core/), which places files in
#   <repo-root>/www/pkg/ regardless of where the script is invoked from.
# - `--target web` emits an ES-module-loadable pkg/ (no bundler, no Node).
# - `--release` is default; listed explicitly.
# - Add `--no-opt` if wasm-opt is not on PATH (RESEARCH Pitfall #6).
#
# Usage:
#   ./scripts/build.sh
#   bash scripts/build.sh
#
# Output files (all gitignored):
#   www/pkg/beastty_core.js          — ES-module glue
#   www/pkg/beastty_core_bg.wasm     — compiled wasm binary
#   www/pkg/beastty_core.d.ts        — TypeScript type defs
#   www/pkg/beastty_core_bg.wasm.d.ts
#   www/pkg/package.json                 — emitted but not used (no npm)

set -euo pipefail
cd "$(dirname "$0")/.."

wasm-pack build crates/beastty-core \
    --target web \
    --out-dir ../../www/pkg \
    --release

echo
echo "Built www/pkg/ — serve with either:"
echo "  python3 -m http.server -d www 8000"
echo "  basic-http-server www"
echo
echo "Then open http://localhost:8000/ (python) or :4000 (basic-http-server)."
