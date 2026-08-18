# Verification

Status: **M0–M3 done — app shell refactored to ES modules + esbuild build (dist + single-file profiles); per-figure plot pipeline live: each figure renders to its own `/plot-fig-*.gp` stream (truncated on redraw), JS renders every changed figure into run-grouped gallery entries with a one-SVG viewer (◀ i / N ▶); file panel hardened with an icon toolbar + clickable breadcrumb target bar + up-to-parent; render battery `verify:fast` 10/10 green; UI unit 35/35, smoke 5/5, single-file 3/3 green; Octave Forge `statistics` 1.6.0 + `data-smoothing` 1.3.0 baked in; symbolic (SymPy) shim green.**

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
| 4 | Multi-figure / `hold on` correctness — does a 2-figure script keep **both** figures (two gallery items, one run)? | pass (hold-on case + multi-figure battery case) |

## How to run

```bash
scripts/build.sh          # build both wasm artifacts (only needed when they change)
cd test && npm install     # once
npm run build             # bundle app/ (must run before any browser-tier test)
npm run test:ui           # FAST tier: UI glue logic with stubbed runtime (<1 s, no Chrome)
npm run test:smoke        # FAST tier: real octave-wasm boot, non-plot cases only (~1-2 min)
npm run check:single      # gate: dist/single/index.html evaluates over file://
node octave-check.mjs     # Gates 1/1b/2 + plot smoke (one render)
npm run verify:fast       # Gates 3/4 battery (fast subset) in the bundled app
npm run verify            # full render battery incl. CPU-bound mesh/surf/boxplot/imshow
node symbolic-check.mjs   # Gate 1c/1d/1e + symbolic smoke (Puppeteer, needs network once for Pyodide/SymPy CDN)
```

For day-to-day UI work the wasm artifacts don't change, so the full battery is
overkill: `npm run verify:fast` (battery minus the CPU-bound `mesh`/`surf`/
`boxplot`/`imshow` render cases, with a tighter per-case cap of 2.5 min) covers
everything else in a few minutes. Run the full `verify.mjs` only when
`octave.wasm`/`gnuplot.wasm` change.

The harness (`test/verify.mjs`) runs this battery in `app/index.html`. It is
hardened against the CPU-bound gnuplot-wasm renderer: each case has a hard
timeout (7 min full battery, 2.5 min `verify:fast`), a hung/crashed case is
retried once on a fresh headless Chrome (host-load crashes are often
transient), the HTTP server is revived if it died alongside the renderer, and
Chrome + the HTTP server are always torn down (a bounded shutdown, plus stale
Chrome/servers from aborted runs are killed on startup). A stall-guard
force-exits if no progress line appears for 3 min, so a truly wedged run can
never pin the shell.

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
| whole-file source | `runFile` of a multi-line `.m` (for loop + `printf` + `plot`) via the file editor hook |
| multi-figure | `figure(1); plot(sin…); figure(2); plot(cos…)` → 2 gallery items, 1 run header, viewer "N / N" |
| run button click | real click on `#runBtn` (Event guard) |

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
  an SVG; verified individually: plot, hist, scatter, surf, mesh, contour,
  plot3, bar, boxplot (Forge stats), imshow, hold-on).  `surf(peaks(30))`
  alone: octave eval 0.3 s, gnuplot render ~215 s.
- **Fast render battery** `SKIP_SLOW=1 node verify.mjs` / `npm run verify:fast`
  (2026-08-17): **9/9 pass** — plot, histogram, scatter, contour, plot3, bar,
  hold-on, whole-file source, and the run-button click, on one headless Chrome
  (~5 min; a couple of cases restarted+retried cleanly under host load).
- **Per-figure pipeline** (2026-08-18, after the `__gnuplot_open_stream__` →
  `/plot-fig-<h>.gp` + fresh-drawnow patch and a relink): a 2-figure script
  writes **two separate files** (no `/plot.gp`), the JS renders **both** into
  the gallery as one run (2 items, counter `2 / 2`); re-running the identical
  script **replaces** the files (identical byte sizes, no growth) and adds a
  second run group (4 items / 2 runs). `verify:fast` now **10/10 pass**
  (includes the new multi-figure case) — `plot`, `hist`, `scatter`, `contour`,
  `plot3`, `bar`, `hold-on`, whole-file, run-button, multi-figure.
- **UI unit** `node ui-unit.mjs`: **35/35 pass**, including the new Phase D
  cases — breadcrumb `./ › sub/ › inner/` segments, `./` returns to root, the
  up-to-parent button, single-figure → one entry in Run 1, re-run → history
  kept under Run 2, two figures in one run → two entries / one group, and
  viewer `◀/▶` navigation updating the `i / N` counter.
- **Statistics:** `ttest` returns `h=0, p=1` on a symmetric sample;
  `pdf("norm",0,0,1)` returns `0.39894228…`.
- **Symbolic values:** `syms x; diff(sin(x))` → `cos(x)`;
  `int(1/(x^2+1))` → `atan(x)`; `solve(x^2-4)` → `[-2 2]`;
  `laplace(t^2)` → `2/s**3`; `dsolve("D2y+y=0")` → `C1*sin(x)+C2*cos(x)`;
  `double(sym("sqrt(2)"))^2` → `2.0000`.
  Exercise `app/examples/capability-demo.m` (whole-file run) passes end to end;
  it documents workarounds for the two known shim gaps it hits: `regdatasmooth`
  needs an explicit `"lambda"` (default optimizer is `optim`'s compiled
  `nelder_mead_min`, not wasm-portable), and scalar/sym `mtimes`/`mrdivide`
  aren't overloaded (use `sym("…")` string round-trips).

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
> regression; the eval side is fast (fraction of a second).  Under host load
> the harness's per-case cap trips on the slow renders (`surf`, `boxplot`,
> `mesh`, …); it restarts Chrome and retries each case once before reporting a
> fail. Use `npm run verify:fast` to drop those cases from routine runs.
