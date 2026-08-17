#!/usr/bin/env bash
# Builds the octave-wasm web artifacts (with our plot patches) into dist/octave-wasm/
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
PLATFORM="${PLATFORM:-linux/amd64}"

# The frozen base (FROM ... @sha256) is pulled automatically by the build
# below; see rebuild-base.yml if you need to recompile Octave itself.
echo "[octave-wasm] patched web build (FROM frozen ghcr/skiadas/octave-base) ..."
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
