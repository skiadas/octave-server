#!/usr/bin/env bash
# Builds the octave-wasm web artifacts (with our plot patches) into dist/octave-wasm/
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
PLATFORM="${PLATFORM:-linux/amd64}"

echo "[octave-wasm] stage 1/2: base image (vendor Makefile build) ..."
docker build --platform "$PLATFORM" --progress=plain \
  --target builder \
  -t ghcr.io/rwl/octave-wasm:latest \
  "$ROOT/vendor/octave-wasm"

echo "[octave-wasm] stage 2/2: patched web build ..."
docker build --platform "$PLATFORM" --progress=plain \
  -f "$ROOT/scripts/octave-wasm.Dockerfile" \
  -t oo-octave-wasm:latest \
  "$ROOT"

echo "[octave-wasm] extracting artifacts ..."
OUT="$ROOT/dist/octave-wasm"
rm -rf "$OUT" && mkdir -p "$OUT"
docker create --name oo-octave-extract oo-octave-wasm:latest
docker cp "oo-octave-extract:/usr/src/octave-wasm/src/web/." "$OUT/"
docker rm oo-octave-extract >/dev/null

echo "[octave-wasm] done:"
ls -lh "$OUT"
