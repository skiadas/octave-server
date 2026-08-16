# Build

All wasm artifacts are built inside Docker. **The host is Apple Silicon, and
`emscripten 3.1.24` ships no arm64 binaries**, so every build uses
`--platform linux/amd64` (runs under emulation; the wasm output is portable).

## Prerequisites

- Docker (with qemu emulation for amd64 — default on Docker Desktop)
- Network access to GitHub, SourceForge, Docker Hub, Google Storage

## 1. octave-wasm (GNU Octave 7.2.0 → wasm)

Two stages:

- **Stage 1 (base):** upstream `rwl/octave-wasm` `builder` image. Long:
  compiles LAPACK/SuiteSparse/Octave with emscripten (~30–90 min, cached
  afterwards).
- **Stage 2 (patched):** our `scripts/octave-wasm.Dockerfile` re-links the
  `web` target with the `plot/` and `image/` m-file categories preloaded and
  our gnuplot-toolkit patches applied. Fast (relink only).

Outputs (extracted to `dist/octave-wasm/`): `octave.js`, `octave.wasm`,
`octave.data`.

```bash
scripts/build-octave-wasm.sh
```

The patches live in `patches/`:

| File | What it does |
|---|---|
| `octave-src/Makefile` | adds `plot/` + `image/` to the emscripten preload/embed lists; compiles/links `oo-toolkit.cc` |
| `octave-src/main.cc` | adds `plot/` + `image/` to the load path; calls `oo_register_gnuplot_toolkit` at startup |
| `octave-src/oo-toolkit.cc` | registers the `gnuplot` graphics toolkit directly (no dlopen/gnuplot-binary needed) |
| `octave-m/.../__gnuplot_open_stream__.m` | writes the gnuplot stream to `/plot.gp` instead of `popen()` |
| `octave-m/.../__gnuplot_version__.m` | reports `5.4.10` without executing gnuplot |
| `octave-m/.../__gnuplot_has_terminal__.m` | reports any terminal as available |
| `octave-m/.../__gnuplot_get_var__.m` | reports `GPVAL_TERM = svg` without querying a live gnuplot |

## 2. gnuplot-wasm (gnuplot 5.4.10 → wasm)

`scripts/gnuplot-wasm.Dockerfile` builds `Eumeryx/gnuplot-wasm` on
`emscripten/emsdk:3.1.24` with our stdin-fed wrapper
(`scripts/gnuplot-wasm/pre.js`) overriding the upstream one.

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

```bash
scripts/serve.sh        # http://localhost:8080/app/
```

Loads `app/index.html` which wires both wasm modules together. Try:
`plot(sin(0:0.1:10))`, `hist(randn(1000,1), 30)`, `surf(peaks(30))`,
`imshow(rand(50,50))`.

## Troubleshooting

- **`wasm-binaries-arm64.tbz2: 404`** — you tried an arm64 build. Use
  `PLATFORM=linux/amd64` (the default in these scripts).
- **Flaky upstream build** (npm/network errors during stage 1): re-run; the
  Docker layer cache keeps completed steps.
