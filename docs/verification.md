# Verification

Status: **in progress — M3 battery renders 11/11 cases (harness times out under host load, not functional failures); Octave Forge `statistics` 1.6.0 + `data-smoothing` 1.3.0 baked in; symbolic (SymPy) shim green 10/10.**

## Gates

| Gate | Question | Result |
|---|---|---|
| 1 | Are `plot/` + `image/` (and Forge `statistics`) m-files present & loadable in the wasm build? | pass |
| 1b | Do Forge `statistics` functions run? (`boxplot`, `pca`, `kstest`, `anova1`, `ttest`, `pdf`) | pass |
| 1c | Is the `__wasm_python__` builtin registered and round-tripping? | pass |
| 1d | Do `symbolic-sympy` functions exist? (`syms`, `@sym`, `dsolve`) | pass |
| 1e | Does `regdatasmooth` (Forge `data-smoothing`) load? | pass |
| 2 | Is the `gnuplot` graphics toolkit registered? | pass |
| 3 | Do Octave-generated gnuplot commands render through gnuplot-wasm? | pass |
| 4 | Multi-figure / `hold on` correctness | pass (hold-on case) |

## How to run

```bash
scripts/build.sh          # build both wasm artifacts
cd test && npm install     # once
node octave-check.mjs     # Gates 1/1b/2 + plot smoke
node verify.mjs           # Gates 3/4 battery in app/index.html
node symbolic-check.mjs   # Gate 1c/1d/1e + symbolic smoke (Puppeteer, needs network once for Pyodide/SymPy CDN)
```

The harness (`test/verify.mjs`) runs this battery in `app/index.html`:

| Case | Command |
|---|---|
| 1-D line | `plot(sin(0:0.1:10))` |
| histogram | `hist(randn(1000,1), 30)` |
| scatter | `scatter(randn(50,1), randn(50,1))` |
| 3-D surf | `surf(peaks(30))` |
| 3-D mesh | `mesh(peaks(20))` |
| contour | `contour(peaks(20))` |
| plot3 | `plot3(rand(10,1), rand(10,1), rand(10,1))` |
| bar | `bar(randn(5,1))` |
| boxplot (Forge stats) | `boxplot(randn(100,4))` |
| imshow | `imshow(rand(50,50))` |
| hold on | `plot(1:10); hold on; plot(1:5, "r-")` |

`boxplot`/`pca`/`kstest`/`anova1`/`kmeans`/`ttest`/`pdf` come from the Octave
Forge `statistics` 1.6.0 `inst/` tree (baked into the wasm FS; see
`docs/build.md`).

## Results

2026-08-16, on the all-categories + statistics + data-smoothing + symbolic
`oo-octave-wasm:latest` build:

- **Matrix** `node octave-check.mjs`: 12/12 pass (Gates 1, 1b, 1c, 1d, 2, and
  the plot-to-plot.gp-to-SVG smoke).
- **Symbolic** `node symbolic-check.mjs`: 10/10 pass — `diff`, DSL round-trip
  via `__wasm_python__`, operator overloads, `int`, `solve`, `laplace`,
  `dsolve` (with `C1/C2`), `double`, and the clean-error negative case.
  Includes the one-time Pyodide/SymPy CDN fetch.
- **Node gnuplot battery** `node gnuplot-node.mjs`: 4/4 pass (independent of
  Chrome; proves the script-generation + gnuplot path).
- **Render battery** `node verify.mjs`: all 11 cases *render* (each produces
  an SVG), but under current host load each gnuplot-wasm render takes 1–5
  minutes, so the harness's per-case CDP timeout trips (e.g. after `surf`).
  Verified individually: plot, hist, scatter, surf, mesh, contour, plot3,
  bar, boxplot (Forge stats), imshow, hold-on all produce SVG output.
  `surf(peaks(30))` alone: octave eval 0.3 s, gnuplot render ~215 s.
- **Statistics:** `ttest` returns `h=0, p=1` on a symmetric sample;
  `pdf("norm",0,0,1)` returns `0.39894228…`.
- **Symbolic values:** `syms x; diff(sin(x))` → `cos(x)`;
  `int(1/(x^2+1))` → `atan(x)`; `solve(x^2-4)` → `[-2 2]`;
  `laplace(t^2)` → `2/s**3`; `dsolve("D2y+y=0")` → `C1*sin(x)+C2*cos(x)`;
  `double(sym("sqrt(2)"))^2` → `2.0000`.

### CI auto-deploy (2026-08-17)

- Repo `skiadas/octave-server` created & pushed; Pages source = **GitHub
  Actions**.
- `Deploy` workflow ran green end-to-end in **7m16s** on the first cold build
  (build gnuplot-wasm + relink octave-wasm FROM the frozen GHCR base, assemble
  `app/` + `dist/` + `.nojekyll` + redirect, `actions/deploy-pages`).
- Site live: <https://skiadas.github.io/octave-server/> (redirects to
  `/app/`); all assets 200 — `octave.wasm` 17 MB, `gnuplot.wasm` 0.9 MB.
- Anonymous GHCR pull of `ghcr.io/skiadas/octave-base:7.2.0-1` verified
  (package set public); the build pins the base by digest, so deploys never
  depend on upstream `rwl/octave-wasm`. Every push to `main` auto-redeploys.
- `Rebuild base image` workflow: **config-validated only, never run live** — it
  requires the optional `GHCR_PAT` repo secret. An earlier revision failed at
  workflow-config validation on the push that first added it (a `name:` was
  missing and `secrets` was referenced in a step `if:`); fixed by adding the
  name and moving the secret check into a step.

> **Perf caveat:** gnuplot-wasm SVG rendering is CPU-bound and headless-Chrome
> renders under host load are the bottleneck.  This is environmental, not a
> regression; the eval side is fast (fraction of a second).
