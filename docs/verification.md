# Verification

Status: **in progress** — results will be filled in as M1–M4 complete.

## Gates

| Gate | Question | Result |
|---|---|---|
| 1 | Are `plot/` + `image/` m-files present & loadable in the wasm build? | pending |
| 2 | Is the `gnuplot` graphics toolkit registered? | pending |
| 3 | Do Octave-generated gnuplot commands render through gnuplot-wasm? | pending |
| 4 | Multi-figure / `hold on` correctness | pending |

## How to run

```bash
scripts/build.sh          # build both wasm artifacts
cd test && npm install     # once
npm run verify            # drives app in headless Chrome
```

The harness (`test/verify.mjs`) runs this battery in `app/index.html`:

| Case | Command |
|---|---|
| numeric eval | `x = 5` |
| 1-D line | `plot(sin(0:0.1:10))` |
| histogram | `hist(randn(1000,1), 30)` |
| scatter | `scatter(randn(50,1), randn(50,1))` |
| 3-D surf | `surf(peaks(30))` |
| 3-D mesh | `mesh(peaks(20))` |
| contour | `contour(peaks(20))` |
| plot3 | `plot3(rand(10,1), rand(10,1), rand(10,1))` |
| boxplot | `boxplot(randn(100,4))` |
| imshow | `imshow(rand(50,50))` |
| hold on | `plot(1:10); hold on; plot(1:5, "r-")` |

## Results

(Filled in after M3.)
