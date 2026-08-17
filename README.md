# octave-server

Feasibility PoC for **Route G**: GNU Octave compiled to WebAssembly, with plotting
rendered in-browser by gnuplot compiled to WebAssembly.

**Status: M0/M1 done — scaffolding, vendor pinning, patch set, build scripts,
app shell, test harness. M1/M2 wasm builds in progress (Docker).**

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
│   ├── build.md          # how to build the wasm artifacts
│   ├── roadmap.md        # milestones + verification gates
│   └── verification.md   # gate results (M4)
├── app/                  # minimal PoC web app (console + inline plots)
├── vendor/
│   └── gnuplot-wasm/     # vendored gnuplot → wasm source (Eumeryx/gnuplot-wasm)
│                         # octave base is frozen on GHCR: ghcr.io/skiadas/octave-base
└── patches/              # our patches applied on top of vendored sources
```

## License notes

- GNU Octave: GPL-3.0+
- gnuplot: permissive "gnuplot license"
- This project's own code: see LICENSE (TBD — not pinned for the PoC)

## Quick start (PoC)

(Will be filled in as M1/M2 complete.)
