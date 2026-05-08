#!/usr/bin/env bash
# scripts/smoke-wasm-build.sh -- CI-friendly gate that wasm-pack still builds.
#
# Distinct from scripts/build.sh:
# - Writes to a throwaway temp dir (not www/pkg/), so it never mutates the
#   dev-loop's working output.
# - Tries to use --no-opt so wasm-opt is optional (Pitfall #6 -- some CI
#   environments lack Binaryen; Phase 2 does not require optimization for
#   correctness). The --no-opt flag was added in wasm-pack 0.13.0; we feature-
#   detect it so this script works against the project's currently-pinned
#   wasm-pack 0.12.1 too. In 0.12.1, if wasm-opt is missing, wasm-pack emits
#   a warning and continues the build successfully -- the functional intent
#   of --no-opt is already satisfied on that version.
# - Verifies every expected output file exists; exits non-zero with a readable
#   diagnostic if any is missing.
#
# Runtime: ~15s warm, ~60s cold (per VALIDATION.md Estimated runtime).
#
# Usage:
#   ./scripts/smoke-wasm-build.sh
#   bash scripts/smoke-wasm-build.sh

set -euo pipefail
cd "$(dirname "$0")/.."

TMPDIR_OUT="$(mktemp -d -t beastty-smoke-XXXXXX)"
trap 'rm -rf "$TMPDIR_OUT"' EXIT

# Feature-detect --no-opt (wasm-pack >= 0.13.0). On older wasm-pack (e.g.
# 0.12.1, which this project currently pins), pass nothing extra: missing
# wasm-opt is already handled by wasm-pack's warn-and-continue fallback.
NOOPT_ARG=()
if wasm-pack build --help 2>&1 | grep -q -- "--no-opt"; then
    NOOPT_ARG=(--no-opt)
fi

echo "[smoke] Building to $TMPDIR_OUT ..."
wasm-pack build crates/beastty-core \
    --target web \
    --out-dir "$TMPDIR_OUT" \
    "${NOOPT_ARG[@]}"

MISSING=()
for f in beastty_core.js beastty_core_bg.wasm beastty_core.d.ts beastty_core_bg.wasm.d.ts; do
    if [ ! -f "$TMPDIR_OUT/$f" ]; then
        MISSING+=("$f")
    fi
done

if [ "${#MISSING[@]}" -ne 0 ]; then
    echo "[smoke] FAIL: wasm-pack did not produce expected files:" >&2
    for f in "${MISSING[@]}"; do
        echo "  - $TMPDIR_OUT/$f" >&2
    done
    echo "[smoke] Directory contents:" >&2
    ls -la "$TMPDIR_OUT" >&2 || true
    exit 1
fi

WASM_SIZE="$(wc -c < "$TMPDIR_OUT/beastty_core_bg.wasm")"
echo "[smoke] OK: all expected files present."
echo "[smoke]   beastty_core_bg.wasm: ${WASM_SIZE} bytes"
echo "[smoke] (Cleaned up $TMPDIR_OUT on exit.)"
