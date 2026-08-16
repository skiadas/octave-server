#!/usr/bin/env bash
# Build both wasm artifacts. Usage: scripts/build.sh [octave|gnuplot]
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
TARGET="${1:-all}"

case "$TARGET" in
  octave|gnuplot)
    "$ROOT/scripts/build-$TARGET-wasm.sh"
    ;;
  all)
    "$ROOT/scripts/build-octave-wasm.sh"
    "$ROOT/scripts/build-gnuplot-wasm.sh"
    ;;
  *)
    echo "usage: $0 [octave|gnuplot|all]" >&2
    exit 2
    ;;
esac
