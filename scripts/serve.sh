#!/usr/bin/env bash
# Serves the PoC app + wasm artifacts from the repo root.
# Uses scripts/serve.py (not plain `python3 -m http.server`) so every response
# carries Cache-Control: no-store — otherwise Chrome heuristically caches the
# 10 MB octave.data on localhost, replaying stale builds and corrupting boot.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
PORT="${PORT:-8080}"
echo "Serving $ROOT at http://localhost:$PORT/app/"
cd "$ROOT" && exec python3 scripts/serve.py "$PORT"
