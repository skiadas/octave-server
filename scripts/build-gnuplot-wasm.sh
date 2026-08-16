#!/usr/bin/env bash
# Builds the gnuplot-wasm artifacts (with our stdin-fed wrapper) into dist/gnuplot-wasm/
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
PLATFORM="${PLATFORM:-linux/amd64}"

echo "[gnuplot-wasm] build ..."
docker build --platform "$PLATFORM" --progress=plain \
  -f "$ROOT/scripts/gnuplot-wasm.Dockerfile" \
  -t oo-gnuplot-wasm:latest \
  "$ROOT"

echo "[gnuplot-wasm] extracting artifacts ..."
OUT="$ROOT/dist/gnuplot-wasm"
rm -rf "$OUT" && mkdir -p "$OUT"
docker create --name oo-gnuplot-extract oo-gnuplot-wasm:latest
docker cp "oo-gnuplot-extract:/src/dist/." "$OUT/"
docker rm oo-gnuplot-extract >/dev/null

echo "[gnuplot-wasm] done:"
ls -lh "$OUT"
