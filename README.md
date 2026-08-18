# octave-server

Feasibility PoC for **Route G**: GNU Octave compiled to WebAssembly, with plotting
rendered in-browser by gnuplot compiled to WebAssembly.

**Status: M0–M3 done — scaffolding, vendor pinning, patch set, wasm builds,
app shell (ES modules + esbuild), test harness, user file persistence + plot
gallery + file panel (selected-folder model). Render battery 9/9 `verify:fast`.**

See `docs/roadmap.md` for milestones and `docs/verification.md` for gates.

## Goal

Prove that Octave-in-wasm can execute real plotting commands (`plot`, `surf`,
`hist`, `imshow`, …) and render actual plots in the browser, at near-zero
hosting cost, using a fully client-side pipeline:

```
Octave (wasm) ── gnuplot script ──▶ gnuplot (wasm) ── SVG ──▶ browser DOM
```

The long-term goal is a zero-to-cheap self-hosted Octave for ~30 concurrent
users (applied stats + undergrad engineering), avoiding MATLAB license costs.

## Why Route G

Octave's gnuplot toolkit is mostly `.m` scripts that generate gnuplot commands
and pipe them to a `gnuplot` process. In a browser you cannot `popen()`, but the
command generation survives — only the process spawn must be replaced. This PoC
replaces it with a file-based hand-off to `gnuplot-wasm`, which renders the
commands to SVG.

See `docs/architecture.md` for the full picture and `docs/roadmap.md` for the
verification gates.

## Repository layout

```
.
├── README.md
├── docs/
│   ├── architecture.md   # component/data-flow/integration design
│   ├── build.md          # how to build the wasm artifacts + app bundle
│   ├── roadmap.md        # milestones + verification gates
│   └── verification.md   # gate results + how to run the test tiers
├── app/                  # web app — ES modules (main.js entry), bundled by esbuild
├── scripts/              # build.mjs (esbuild), Dockerfiles, wasm build scripts
├── vendor/
│   └── gnuplot-wasm/     # vendored gnuplot → wasm source (Eumeryx/gnuplot-wasm)
│                         # octave base is frozen on GHCR: ghcr.io/skiadas/octave-base
├── patches/              # our patches applied on top of vendored sources
└── test/                 # FAST/SLOW test tiers (ui-unit, ui-smoke, verify battery)
```

## Quick start (PoC)

```bash
scripts/build.sh        # build both wasm artifacts (dist/octave-wasm, dist/gnuplot-wasm)
npm install             # once — esbuild for the app bundle
npm run build           # bundle app/ → dist/app/app.js (+ dist/single/index.html)
npm run serve           # http://localhost:8080/app/
```

`dist/single/index.html` is a self-contained build (bundle + both wasm
binaries inlined as base64) that runs straight off `file://` with no server.

Tests: see `docs/verification.md`. Fast tiers need no Chrome:
`cd test && npm run test:ui` (<1 s) and `npm run test:smoke` (1–2 min, real
Octave boot); the render battery is `npm run verify:fast`.

## Test tiers (`cd test`)

| Tier | Command | Needs | Time |
|---|---|---|---|
| UI unit | `npm run test:ui` | none | <1 s |
| Single-file gate | `npm run check:single` | build only | ~5 s |
| Smoke | `npm run test:smoke` | Chrome + built app | 1–2 min |
| Render battery (fast) | `npm run verify:fast` | Chrome + built app | a few min |
| Render battery (full) | `npm run verify` | Chrome + built app | slow 3-D cases |

## License notes

- GNU Octave: GPL-3.0+
- gnuplot: permissive "gnuplot license"
- This project's own code: see LICENSE (TBD — not pinned for the PoC)
