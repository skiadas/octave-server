#!/usr/bin/env bash
# Serves the PoC app + wasm artifacts from the repo root.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
PORT="${PORT:-8080}"
echo "Serving $ROOT at http://localhost:$PORT/app/"
cd "$ROOT" && python3 -m http.server "$PORT"
