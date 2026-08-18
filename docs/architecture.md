# Architecture

This document describes the architecture for **Route G**: a fully client-side
Octave environment for the browser, with plotting rendered by gnuplot-wasm.

Status: **in progress** — written ahead of/during the M1–M3 PoC; corrected
against actual findings as they land.

## 1. Context and goals

- Serve ~30 concurrent users (applied stats + undergrad engineering) without
  MATLAB licensing costs.
- Push compute to the client so the "server" is a static file host → hosting
  cost ~$0–10/mo and near-unlimited scaling (only CDN egress).
- Run a real, unmodified-in-behavior GNU Octave interpreter (not a reimplementation).

Non-goals (PoC): auth, deployment target, interactivity, a polished shell.
These are deliberately left open.

**In scope (added 2026-08-17):** *user file persistence* and a *plot gallery*.
These were folded into the PoC because they make the app usable as a
course/scratchpad workspace — upload data, save scripts, recover them on
reload — at zero extra server cost (files live client-side in IndexedDB). See
§4 Layer 2 for the FS design. Auth and deploy remain out of scope.

## 2. Components

| Component | Origin | Role |
|---|---|---|
| `octave.wasm` | our frozen rebuild of `rwl/octave-wasm` (Octave 7.2.0, Emscripten) on `ghcr.io/skiadas/octave-base` | Interpreter + numeric core + graphics object model |
| `gnuplot.wasm` | `Eumeryx/gnuplot-wasm` (gnuplot 5.4.10, Emscripten) | SVG renderer; consumes gnuplot scripts |
| Pyodide/SymPy | JsDelivr CDN (v314.0.4, pinned) | In-browser Python + SymPy for the symbolic shim |
| App shell (`app/`) | ours | Console, plot panel, worker orchestration |
| JS bridge | ours | Moves gnuplot scripts + SVG between the two wasm modules |

> **Runtime network surface:** the web build is fully client-side; the *only*
> runtime network fetch is the symbolic shim's Pyodide/SymPy bundle from the
> JsDelivr CDN (pinned `v314.0.4/full/` — script tag in `app/index.html`,
> `loadPyodide({ indexURL })` + `loadPackage('sympy')` in `app/main.js`).
> Numeric, plotting, gnuplot rendering, and Forge stats all run with no
> network once the assets are served over HTTP; symbolic degrades cleanly
> whenever Pyodide can't load (offline / CDN blocked).

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

### Layer 1 — Octave patch (`.m` + C++ registration + build flags)

- `__gnuplot_open_stream__.m`: write commands to **one file per figure**
  (`/plot-fig-<handle>.gp`) in the Emscripten virtual filesystem instead of
  `popen()`. `/plot.gp` remains only as a no-handle fallback.
- `__gnuplot_drawnow__.m` (display branch): always open a **fresh** stream
  instead of reusing the stored one, so each draw truncates that figure's file
  — every figure renders as one clean, single-block stream and files never
  accumulate across runs.
- drawnow flush: the JS layer scans `/plot-fig-*.gp` after every eval.
- Probe stubs: `__gnuplot_version__.m` → 5.4.10; `__gnuplot_has_terminal__.m`
  → true; `__gnuplot_get_var__.m` → `GPVAL_TERM = svg`; all without executing
  a binary.
- **Toolkit registration (Gate 2):** the upstream `__init_gnuplot__` `.oct`
  cannot load in a static wasm build (no `dlopen`) and refuses to run without
  a gnuplot binary on `PATH`. A tiny C++ module (`oo-toolkit.cc`) is compiled
  into the wasm binary and calls `gtk_manager::register_toolkit("gnuplot")`
  + `load_toolkit(...)` at interpreter startup, so
  `graphics_toolkit("gnuplot")` works and `gnuplot` becomes the default
  toolkit.
- Build flags: all m-file categories appended to the emscripten preload lists
  and to the load path in `main.cc`, plus the Octave Forge `statistics` 1.6.0
  `inst/` tree (`statistics-forge`) — baked in at image build, preloaded, and
  addpath'd in **two passes** (essentials first, then the PKG_ADD-bearing
  `optimization`/`statistics-forge` dirs).
- `statistics-forge`'s `PKG_ADD` addpath's `datasets`, `dist_fit`,
  `dist_fun`, `dist_stat`, and `shadow9` at startup, mirroring `pkg load`
  (libsvm `.oct` in the package's `src/` is not wasm-loadable and is excluded).
- `data-smoothing-forge` (data-smoothing 1.3.0, pure `.m` `inst/` tree, no
  `PKG_ADD`) → first-pass addpath; provides `regdatasmooth` and friends for
  smoothing noisy lab-style data.  **Caveat:** `regdatasmooth`'s default
  auto-tuning calls `nelder_mead_min` from the `optim` package, whose compiled
  `.oct` parts can't run in wasm — pass an explicit `"lambda"` value to use
  the non-optimizing path (verified: `regdatasmooth(x, y, "lambda", 1e3)`).
- `symbolic-sympy` — our own SymPy-backed symbolic shim (`patches/
  octave-m/scripts/symbolic-sympy`): a `classdef sym` with operator/function
  overloads plus `syms`, `dsolve`, and helpers, all round-tripping SymPy code
  **text** to the host browser via the `__wasm_python__` builtin.

### Layer 1b — Symbolic math (Pyodide/SymPy bridge)

The Octave Forge `symbolic` package cannot run in wasm (its core is a
popen/pexpect bridge to a real `python` subprocess).  Instead, because the
app runs Octave on the **main thread** and Pyodide's `py.runPython()` is
**synchronous**, we bridge in-process:

```
sym.m method  →  oo_sym_call("str(sympify('...').diff(...))")
             →  __wasm_python__  (wasm-python.cc, DEFUN, EM_JS)
             →  window.__ooWasmPython(code)  →  pyodide.runPython(code)
             →  string back through the same path
```

- `wasm-python.cc` defines the `__wasm_python__` builtin (registered at
  interpreter init in `main.cc` via `symbol_table::install_built_in_function`,
  mirroring `install_dld_function`, because standalone `DEFUN`s are not in the
  generated `builtin-defun-decls.h`).
- Pyodide 314.0.4 (Python 3.14, ships SymPy 1.13.3) is loaded from the JsDelivr
  CDN in `app/main.js` in parallel with the Octave boot; a warmup snippet
  installs `x,y,t,s,z,n` symbols and the `_oo_dsolve` ODE translator.  Failures
  degrade gracefully: symbolic calls raise a clear "bridge not available"
  error, and Octave/plotting still works.
- Scope: undergrad-level CAS (`syms`, `diff`, `int`, `solve`, `simplify`,
  `expand`, `factor`, `limit`, `taylor`, `laplace`/`ilaplace`, `fourier`,
  `fourier`, `dsolve`, `subs`, `pretty`, `latex`, `double`).  Not a full
  MATLAB Symbolic Toolbox replacement, and no `symfun`/matrix-sym support yet.

#### Known quirks (learned the hard way, 2026-08-16)

- **Octave 7.2 parser rejects `[ "…" func() "…" ]`** — i.e. string
  concatenation in square brackets whose second element is a function call
  (`["[" strjoin (x, ", ") "]"]`).  Use `strcat (...)` or `sprintf` instead
  (see `oo_pyquote.m`, `oo_pyexpr.m`, `dsolve.m`).
- **`"'"` (a double-quoted string containing a single quote) is fine only
  inside `strcat`/`sprintf` args; combined with the bracket-concat above it
  triggers the same parse failure.  Prefer `char (39)` / `strcat` for quote
  IDKs.
- **SymPy 1.13 removed `ztrans`/`iztrans`** — so `ztrans`/`iztrans` are not in
  the shim (they'd be `NameError`s).
- String literals use `"…"` with `\\` escapes, not bare `\` (a lone `\"`
  escapes the quote and corrupts the token stream).
- **Mixed scalar/sym operators are not overloaded:** `double * sym` (`mtimes`)
  and `double / sym` (`mrdivide`) raise "scalar cannot be indexed with .".
  Build expressions via `sym("…")` string round-trips (`solve(sym("x**2 - 5*x
  + 6"))`, `int(sym("1/(x^2+1)"), sym("x"))`) or keep both operands sym.

### Package importability tier list (pinned to core 7.2.0)

- **Drop-in (pure `.m`, our pipeline):** `statistics` 1.6.0 (imported),
  `data-smoothing` 1.3.0 (imported), `financial` 0.5.3 (would drag in `io`).
- **Compiled `.oct` in `src/` — NOT importable as-is (needs mkoctfile→wasm +
  dlopen, out of scope):** `optim` 1.6.3 (needs `struct`+`statistics`),
  `signal` 1.4.6 (needs `control` ≥2.4), `control` 3.5.0 (Fortran SLICOT —
  worst case), `image` 2.18.0 (the newest release compatible with Octave 7.2;
  anything newer needs ≥8), `io` 2.7.2 (also Java for Excel), `econometrics`.
- **Infeasible in-browser:** `symbolic` (subprocess+SymPy → replaced by our
  shim), anything with a Java/OS runtime dependency.  Note `image 2.18.0` is
  *the* version to use if we ever port the compiled parts.

### Layer 2 — JS bridge

- After each Octave `eval`, scan Octave's MEMFS for `/plot-fig-*.gp` files.
- Read each figure's bytes (`module.FS.readFile`, via rwl's wrapper which
  already exposes `FS_readFile`); skip files untouched since last render
  (checked by mtime + content signature), so re-runs render every figure that
  was redrawn and stale figures are ignored.
- Pass each script string to `gnuplot-wasm` (its API takes a script string and
  returns SVG) — one SVG per figure per run.
- Inject the returned SVGs into the gallery (each figure becomes an entry in
  the current run's group) and show the newest in the viewer.

The two wasm modules never call each other; JS is the only glue.

### Layer 2b — User filesystem + plot gallery (client persistence)

To ride on the zero-server-cost model, user data lives entirely in the
browser and is mirrored into Octave's Emscripten MEMFS (which is volatile,
wiped each page load) so Octave sees uploaded files and saved scripts
immediately (`load`/`run`/`csvread`/`imread`).

- **Store (`app/fsstore.js`):** IndexedDB object store `files` keyed by full
  path (`""` = root, `"dir/file.m"`), values `{kind:'file', bytes:Uint8Array,
  ts}` or `{kind:'dir'}`. All methods return Promises. When IndexedDB is
  unavailable it falls back to an in-memory `Map` with the same async API so
  the app still works for the session (and the no-browser unit harness stays
  green).
- **Bridge (`app/octfs.js`):** applies every op to the store **and** live
  MEMFS under the user root (exported from `runtime.js` as `userPath`,
  default `/home/user`); `hydrate()` replays the whole store into MEMFS at
  boot and points Octave's cwd there via `cd` + `addpath`. MEMFS writes are
  synchronous (so Octave sees files instantly); the IndexedDB persist is
  async and returned as the promise. Parent directories are created
  idempotently via `FS.analyzePath` (Emscripten's `mkdir` on an existing dir
  throws a generic `"FS error"` with no errno code — matching error text is
  unreliable, existence checks are not).
- **Panel (`app/filepanel.js`):** a collapsible file tree rendered from the
  store. A folder is *selected* by clicking its name (bar shows the target
  `⟶ folder/`); bar actions **new folder / new file / upload / refresh** act
  inside the target, `new file` opens the file in the editor (pre-filled
  path, empty buffer, focused). Folder rows get hover actions `+file`, `+dir`,
  `up` and are themselves drag-drop targets, so everything works at arbitrary
  nesting depth. Also: upload (picker + drag/drop), download, rename, delete,
  refresh, and click-to-preview (image via blob URL, text/`.m` as source).
  Mutations funnel through `octfs` so store and MEMFS stay in sync; it
  re-renders on the `fs:change` / `fs:hydrated` events.
- **Gallery + viewer (`app/gallery.js`, `app/main.js`):** session-scoped
  figure history grouped into **runs** (each `run`/`runFile` invocation that
  plots opens one group, labelled `Run N · HH:MM:SS`). `#plotPane` is a
  one-SVG **viewer** (the most recent figure, with `◀ i / N ▶` prev/next,
  a title, keyboard `←`/`→`, and clickable thumbnails that navigate to the
  matching entry). Thumbnails also support individual SVG/PNG download (PNG
  via canvas rasterization), per-item remove, and a clear-all. It never writes
  more than one SVG into `#plotPane` at a time (the harness's plotSVGCount
  relies on that).
- **Panel (`app/filepanel.js`):** see §Layer 2b — icons for row actions and a
  clickable **breadcrumb target bar** (`./` › `sub/` › …) plus an up-to-parent
  button for navigation.
- **Shared (`app/util.js`) and runtime (`app/runtime.js`):** ES-module
  helpers — DOM building (`el`), pub/sub (`emit`/`on`), blob download, HTML
  escaping, and the wasm runtime handle (`Module`, `userPath`, `setReady`,
  `setAppend`). The app shell is a set of ES modules (`main.js` entry point)
  bundled by esbuild — see §Layer 3.

### Layer 3 — Build

- octave-wasm: Docker stage-2 relink FROM the frozen GHCR base
  (`ghcr.io/skiadas/octave-base@sha256:0407…`, see `docs/build.md`); the base
  itself is recompiled rarely via the manual `rebuild-base` workflow.
- gnuplot-wasm: Docker build using an Emscripten SDK image + `build.sh`
  (no local emcc install needed).
- App: ES modules under `app/` (`main.js` entry) bundled with **esbuild**
  (root `package.json`, `npm run build`). Two profiles in
  `scripts/build.mjs`: `dist` → `dist/app/app.js` (small; loaded by
  `app/index.html` next to the wasm loader scripts, over HTTP; the deployed
  page is `dist/app/index.html`, a generated copy whose asset URLs carry
  `?v=<hash>` — see `docs/build.md`) and `single`
  → `dist/single/index.html` (a single self-contained HTML that inlines the
  bundle *and* the wasm binaries as base64 so the app runs straight from
  `file://` without a server). `dist/` is gitignored; CI builds it before
  the test gate. Tests import the real module graph directly (no bundle
  needed for the fast tier).

## 5. Data flow / figure lifecycle

```
User types  surf(peaks(30))  in console
  └─▶ Octave (wasm, Web Worker)
        ├─ builds figure/axes/surface objects
        └─ drawnow → __gnuplot_drawnow__ opens a fresh stream
             _figure 1_ → /plot-fig-1.gp   (truncated + rewritten)
             _figure 2_ → /plot-fig-2.gp   (its own file)
               └─ gnuplot command text (one clean block per figure)
  └─▶ JS bridge (after eval returns)
        ├─ scans / → plot-fig-*.gp, renders each changed figure
        ├─ gnuplot(plot-fig-N.gp) [gnuplot-wasm] → SVG per figure
        └─ gallery.add(SVG, fig N, run) → run-grouped thumbnails
  └─▶ Viewer: newest figure in #plotPane, ◀ i / N ▶ to navigate
```

Multiple figures → one SVG per figure per run (subplots/hold stay one figure).
Files are truncated on every draw, so a re-run replaces a figure's file
instead of appending to it — gallery history grows one entry per figure per
run, never an endless collage.

## 6. Scaling & cost model

- Compute: 100% client-side (one wasm instance per tab).
- Server: static file host (CDN).
- Cost scales with bytes served (wasm binaries + page + SVG), not with users.
- ~30 concurrent users → trivially within any free CDN tier.

## 7. Known limitations (PoC-scope)

- SVG rendering with browser-side PNG export via the plot gallery (no
  server-side render; no PDF export yet).
- No plot interactivity (ginput/zoom/rotation).
- Single-threaded Octave (Emscripten build disables threads/OpenMP).
- Two small community wasm projects are upstream; we own integration and
  future Octave-version bumps.

## 8. Verification gates

See `docs/roadmap.md`. The critical one (Gate 3) is empirical: do Octave's
generated gnuplot commands render correctly through gnuplot-wasm for the plot
families a stats/engineering course needs (line, scatter, boxplot, histogram,
surf/contour, imshow)?
