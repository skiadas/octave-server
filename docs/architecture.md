# Architecture

This document describes the architecture for **Route G**: a fully client-side
Octave environment for the browser, with plotting rendered by gnuplot-wasm.

Status: **draft** — written ahead of the M1–M3 PoC; will be corrected against
actual findings.

## 1. Context and goals

- Serve ~30 concurrent users (applied stats + undergrad engineering) without
  MATLAB licensing costs.
- Push compute to the client so the "server" is a static file host → hosting
  cost ~$0–10/mo and near-unlimited scaling (only CDN egress).
- Run a real, unmodified-in-behavior GNU Octave interpreter (not a reimplementation).

Non-goals (PoC): auth, deployment target, file persistence, interactivity,
a polished shell. These are deliberately left open.

## 2. Components

| Component | Origin | Role |
|---|---|---|
| `octave.wasm` | `rwl/octave-wasm` (Octave 7.2.0, Emscripten) | Interpreter + numeric core + graphics object model |
| `gnuplot.wasm` | `Eumeryx/gnuplot-wasm` (gnuplot 5.4.10, Emscripten) | SVG renderer; consumes gnuplot scripts |
| App shell (`app/`) | ours | Console, plot panel, worker orchestration |
| JS bridge | ours | Moves gnuplot scripts + SVG between the two wasm modules |

## 3. Why Octave's gnuplot toolkit is the right lever

In Octave 7.x the gnuplot graphics toolkit is implemented mostly in Octave
`.m` scripts:

- `scripts/plot/util/__gnuplot_drawnow__.m`
- `scripts/plot/util/private/__gnuplot_draw_figure__.m`, `__gnuplot_draw_axes__.m`
- `scripts/plot/util/private/__gnuplot_open_stream__.m` — **the only process
  spawn**: `popen()` / `popen2()` on `gnuplot_binary()`
- `scripts/plot/util/private/__gnuplot_version__.m`, `__gnuplot_has_terminal__.m`,
  `__gnuplot_has_feature__.m` — probe the gnuplot binary
- `libinterp/dldfcn/__init_gnuplot__.cc` — small C++ registration module

Because the command generation lives in `.m` files, we do **not** need to port
Octave's C++ rendering code. We only need to change where the generated commands
go and how they are flushed.

## 4. The three integration layers

### Layer 1 — Octave patch (`.m` + build flags)

- `__gnuplot_open_stream__.m`: write commands to a file in the Emscripten
  virtual filesystem instead of `popen()`.
- drawnow flush: close the command file, write `plot.gp`, force
  `set term svg size <W>x<H> dynamic enhanced`, then signal the JS layer
  (marker file).
- Probe stubs: `__gnuplot_version__.m` → report 5.4; `__gnuplot_has_terminal__.m`
  → report svg/dynamic/enhanced; `__gnuplot_has_feature__.m` → report needed
  features — all without executing a binary.
- Build flags: embed `scripts/plot/**` (and likely `scripts/image`,
  `scripts/statistics`) into the wasm FS and onto the load path; ensure
  `__init_gnuplot__` registers the `gnuplot` toolkit (or register it manually).

### Layer 2 — JS bridge

- After each Octave `eval`, check for a pending plot marker.
- Read `plot.gp` from Octave's FS (rwl's wrapper already exposes `FS_readFile`).
- Pass the script string to `gnuplot-wasm` (its API takes a script string and
  returns SVG).
- Inject the returned SVG into the plot panel.

The two wasm modules never call each other; JS is the only glue.

### Layer 3 — Build

- octave-wasm: Docker build (from `vendor/octave-wasm`, `make build`).
- gnuplot-wasm: Docker build using an Emscripten SDK image + `build.sh`
  (no local emcc install needed).
- App: static assets only (no framework commitment in the PoC).

## 5. Data flow / figure lifecycle

```
User types  surf(peaks(30))  in console
  └─▶ Octave (wasm, Web Worker)
        ├─ builds figure/axes/surface objects
        └─ drawnow →
             __gnuplot_draw_figure__ / __gnuplot_draw_axes__
               └─ gnuplot command text → plot.gp (virtual FS) + marker
  └─▶ JS bridge (after eval returns)
        ├─ sees marker, reads plot.gp
        └─ gnuplot(plot.gp) [gnuplot-wasm] → SVG string
  └─▶ Plot panel: SVG injected into DOM
```

Multiple figures → one SVG per figure per flush.

## 6. Scaling & cost model

- Compute: 100% client-side (one wasm instance per tab).
- Server: static file host (CDN).
- Cost scales with bytes served (wasm binaries + page + SVG), not with users.
- ~30 concurrent users → trivially within any free CDN tier.

## 7. Known limitations (PoC-scope)

- SVG-only output (no PNG/PDF export yet).
- No plot interactivity (ginput/zoom/rotation).
- Single-threaded Octave (Emscripten build disables threads/OpenMP).
- Two small community wasm projects are upstream; we own integration and
  future Octave-version bumps.

## 8. Verification gates

See `docs/roadmap.md`. The critical one (Gate 3) is empirical: do Octave's
generated gnuplot commands render correctly through gnuplot-wasm for the plot
families a stats/engineering course needs (line, scatter, boxplot, histogram,
surf/contour, imshow)?
