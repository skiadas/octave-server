# Build

All wasm artifacts are built inside Docker. **The host is Apple Silicon, and
`emscripten 3.1.24` ships no arm64 binaries**, so every build uses
`--platform linux/amd64` (runs under emulation; the wasm output is portable).

## Prerequisites

- Docker (with qemu emulation for amd64 — default on Docker Desktop)
- Network access to GHCR, GitHub, SourceForge, Docker Hub

## 1. octave-wasm (GNU Octave 7.2.0 → wasm)

Two stages — only the second runs locally:

- **Stage 1 (base — prebuilt & frozen):** Octave 7.2.0 compiled to wasm once
  and published to GHCR as `ghcr.io/skiadas/octave-base:7.2.0-1`
  (`sha256:0407d594a312…`). The build references it **by digest**, so
  relinks never depend on upstream `rwl/octave-wasm`. To recompile the base
  from source (rare; 30–90 min), run the **manual** `rebuild-base` workflow:
  it clones `rwl/octave-wasm` at the pinned commit `e584306c`, builds, tags
  `:7.2.0-<n>`, and pushes it back to GHCR.
- **Stage 2 (patched):** our `scripts/octave-wasm.Dockerfile` starts FROM the
  frozen base, then re-links the `web` target with all m-file categories
  preloaded, the Octave Forge `statistics` and `data-smoothing` packages
  baked in, our symbolic shim tree copied in, and our gnuplot-toolkit patches
  applied. Fast (relink only, ~5–15 min).

Outputs (extracted to `dist/octave-wasm/`): `octave.js`, `octave.wasm`,
`octave.data`.

**Base versioning & CI:** the published base is `ghcr.io/skiadas/octave-base`,
tagged `7.2.0-N` and freed by digest pinning; the package is public, so
deploys pull it anonymously (no secrets needed for deploy). Recompiling the
base is a manual, optional step — either the `Rebuild base image` workflow
(Actions → "Run workflow", requires a `GHCR_PAT` repo secret: a PAT with
`write:packages` on the owner account) or the documented `docker tag`/`push`
commands. It has not yet been run live; see `docs/verification.md`. With
`deploy.yml`, every push to `main` auto-rebuilds both wasm artifacts there and
deploys to GitHub Pages.

```bash
scripts/build-octave-wasm.sh
```

The patches live in `patches/`:

| File | What it does |
|---|---|
| `octave-src/Makefile` | adds the full set of m-file categories (incl. `plot/`, `image/`, `gui/`), the Forge `statistics-forge`/`data-smoothing-forge` trees, and our `symbolic-sympy` tree to the emscripten preload/embed lists; compiles/links `oo-toolkit.cc` + `wasm-python.cc` |
| `octave-src/main.cc` | sets the load path in **two** `addpath` passes — essentials first, then the PKG_ADD-bearing dirs (`optimization`, `statistics-forge`) — because a dir's `PKG_ADD` can't see functions from other dirs added in the same `addpath` call; calls `oo_register_gnuplot_toolkit` and registers the `__wasm_python__` builtin at startup |
| `octave-src/oo-toolkit.cc` | registers the `gnuplot` graphics toolkit directly (no dlopen/gnuplot-binary needed) |
| `octave-src/wasm-python.cc` | `DEFUN (__wasm_python__)` bridge: evaluates SymPy code in the host page's Pyodide runtime and returns a string (EM_JS → `window.__ooWasmPython`) |
| `octave-wasm.Dockerfile` | pinned downloads + sha256: **Octave Forge `statistics` 1.6.0** (last release requiring `octave >= 7.2.0`; pure-`.m` `inst/` tree only — its `src/` is libsvm `.oct`, not wasm-loadable) and **`data-smoothing` 1.3.0** (pure `.m`); also `COPY`s our `symbolic-sympy` shim tree |
| `octave-m/.../__gnuplot_open_stream__.m` | writes the gnuplot stream to **one file per figure** (`/plot-fig-<handle>.gp`, truncating on open) instead of `popen()`; `/plot.gp` is only the no-handle fallback |
| `octave-m/.../__gnuplot_drawnow__.m` | display branch always opens a fresh stream, so each draw truncates that figure's file (clean single block, no cross-figure clobbering, no accumulation) |
| `octave-m/.../__gnuplot_version__.m` | reports `5.4.10` without executing gnuplot |
| `octave-m/.../__gnuplot_has_terminal__.m` | reports any terminal as available |
| `octave-m/.../__gnuplot_get_var__.m` | reports `GPVAL_TERM = svg` without querying a live gnuplot |

The Forge package's own `PKG_ADD` (what `pkg load` runs) addpath's its
`datasets`, `dist_fit`, `dist_fun`, `dist_stat`, and `shadow9` (Octave < 9)
subdirs, so those are available without a `pkg load` step.

> **Gotcha:** `addpath` executes any `PKG_ADD` file in a directory being added.
> Octave's `optimization/PKG_ADD` (via `__all_opts__` → `optimset` → `unique`)
> fails if other categories' functions aren't on the load path yet — hence the
> two-pass `addpath` in `main.cc`.

## 2. gnuplot-wasm (gnuplot 5.4.10 → wasm)

`scripts/gnuplot-wasm.Dockerfile` builds the vendored `Eumeryx/gnuplot-wasm`
source (`vendor/gnuplot-wasm`) on `emscripten/emsdk:3.1.24` with our
stdin-fed wrapper `scripts/gnuplot-wasm/pre.js` overriding the upstream one.

**Why the wrapper override matters:** Octave's toolkit emits plot data inline
via `plot "-"` (data lines + `e`) in the same stream as the commands. Upstream
gnuplot-wasm feeds the script as a file argument, so `plot "-"` would read an
empty stdin. Our wrapper feeds the *entire* script through Emscripten stdin and
invokes gnuplot with `-` as the script source — exactly like a native pipe.

Outputs (extracted to `dist/gnuplot-wasm/`): `gnuplot.js`, `gnuplot.wasm`.

```bash
scripts/build-gnuplot-wasm.sh
```

## 3. All at once

```bash
scripts/build.sh        # builds both
scripts/build.sh octave # just octave
scripts/build.sh gnuplot
```

## 4. Run the PoC app

The app shell (`app/`) is plain ES modules; **esbuild** bundles them before
serving.

```bash
npm install        # once — root package.json (esbuild devDependency)
npm run build      # bundles app/ → dist/app/app.js  (and dist/single/index.html)
npm run serve      # http://localhost:8080/app/
```

`npm run build` runs `scripts/build.mjs`, which produces two profiles:

| Profile | Output | Use |
|---|---|---|
| `dist` | `dist/app/app.js` (~35 KB) | loaded by `app/index.html` next to the wasm loader scripts; served over HTTP |
| `single` | `dist/single/index.html` (~37 MB) | self-contained — inlines the bundle **and** both wasm binaries as base64, so it runs from `file://` with no server |

`dist/` is gitignored; the CI build step regenerates both before the test gate
and deploys the `dist/` profile's `app/` + `dist/` wasm outputs to Pages.

Loads `app/index.html` which wires both wasm modules together. Try:
`plot(sin(0:0.1:10))`, `hist(randn(1000,1), 30)`, `surf(peaks(30))`,
`imshow(rand(50,50))`, and the Forge stats ones:
`boxplot(randn(100,4))`, `[h,p]=ttest(randn(100,1))`, `pdf("norm",0,0,1)`,
`regdatasmooth(...)`, and the symbolic shim (needs one-time CDN load of
Pyodide/SymPy): `syms x; diff(sin(x))`, `int(1/(x^2+1))`, `dsolve("D2y + y = 0", "y(0)=1", "Dy(0)=0")`.

## 5. Symbolic shim (SymPy bridge)

`@sym`/`syms`/`dsolve` etc. (in `patches/octave-m/scripts/symbolic-sympy`)
round-trip SymPy code text to the browser's Pyodide runtime through the
`__wasm_python__` builtin; the CDN-warmup is triggered by `app/main.js`
(`bootstrapSympy`).  If Pyodide isn't loaded (offline/CDN blocked), symbolic
calls error cleanly and everything else still works.

## Troubleshooting

- **`wasm-binaries-arm64.tbz2: 404`** — you tried an arm64 build. Use
  `PLATFORM=linux/amd64` (the default in these scripts).
- **Flaky upstream build** (npm/network errors during stage 1): re-run; the
  Docker layer cache keeps completed steps.
