#!/usr/bin/env python3
"""Local dev server for the PoC (scripts/serve.sh).

Serves the repo root like `python3 -m http.server`, but sends
`Cache-Control: no-store` on every response. http.server sends no cache headers
at all, and browsers heuristically cache responses like the 10 MB octave.data
for a long time on localhost — hard reloads do not reliably evict them, which
mixes stale wasm/data with the current loader and breaks the page (garbled
m-file parse errors, "octave is not ready"). no-store keeps local dev honest.
CORS is also enabled, matching the packaged dist/octave-wasm/server3.py.
"""
import sys
import socketserver
from http.server import SimpleHTTPRequestHandler


class Handler(SimpleHTTPRequestHandler):

    def end_headers(self):
        self.send_header('Cache-Control', 'no-store')
        self.send_header('Access-Control-Allow-Origin', '*')
        super().end_headers()


if sys.version_info < (3, 7, 5):
    # Fix for WASM MIME type for older Python versions
    Handler.extensions_map['.wasm'] = 'application/wasm'


if __name__ == '__main__':
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 8080
    with socketserver.TCPServer(("127.0.0.1", port), Handler) as httpd:
        print("Serving at: http://127.0.0.1:{}".format(port))
        httpd.serve_forever()