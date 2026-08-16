# Roadmap & Verification Gates

PoC milestones for Route G. Each gate has a crisp pass/fail criterion.

## Milestones

| # | Milestone | Exit criterion |
|---|---|---|
| M0 | Repo + docs scaffold | README + architecture + build + roadmap committed; vendors pinned as submodules |
| M1 | octave-wasm builds & runs | `octave.wasm` loads in browser; interpreter evaluates `1+1` and `rand(3,3)` |
| M2 | gnuplot-wasm builds & renders | `gnuplot('plot x**2;', …)` returns a non-empty SVG in browser |
| M3 | Integration pipeline | `plot`/`surf`/`hist`/`imshow` produce correct-looking SVG in the app's plot panel |
| M4 | Verification + verdict | Gates 1–4 documented; feasibility verdict written |

## Verification gates (theory → evidence)

### Gate 1 — plot `.m` files present and loadable
- **Question:** Are `scripts/plot/**` (and friends) embedded in the wasm FS and on
  the load path? (`main.cc`'s `addpath` list omits plot/graphics/image.)
- **Fail fix:** embed the missing dirs via Emscripten `--embed-file` and/or extend
  the addpath in `src/main.cc`.
- **Pass:** `which plot` / `exist("plot")` returns true in the wasm interpreter;
  `available_graphics_toolkits()` lists `gnuplot`.

### Gate 2 — gnuplot toolkit registered
- **Question:** Is `__init_gnuplot__` linked as a builtin in the static wasm build?
- **Fail fix:** register a `gnuplot`-named toolkit ourselves (small) or link the
  module as a builtin.
- **Pass:** `graphics_toolkit("gnuplot")` succeeds; default toolkit is gnuplot.

### Gate 3 — Octave-generated gnuplot commands render (the critical gate)
- **Question:** Does the toolkit's command output survive `popen` removal and
  render through gnuplot-wasm's SVG terminal?
- **Battery:** `plot`, `plot3`, scatter, boxplot, `hist`, `surf`/`mesh`/`contour`,
  `imshow`, `hold on`, multiple figures, `.octaverc`-free basics.
- **Fail fix:** targeted `.m` patches (terminal forcing, quoting, data embedding).

### Gate 4 — Multi-figure and flush correctness
- **Question:** one SVG per figure per drawnow; `figure`/`hold on` behave.
- **Pass:** two figures → two distinct SVGs; replot updates the right panel.

## What "feasible" means at the end

- Octave (wasm) + gnuplot (wasm) render course-typical plots in-browser.
- All four gates pass.
- Remaining work to production is bounded and enumerated (app shell polish,
  persistence, auth/deployment) rather than open-ended R&D.

## Notes

- Long builds: octave-wasm ~30–90 min one-off (Docker cache afterwards);
  gnuplot-wasm ~15–30 min. Build scripts live in `docs/build.md` / `./scripts`.
- Flaky first build: rerun-and-continue policy.
