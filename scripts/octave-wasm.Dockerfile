# Derived from rwl/octave-wasm's Dockerfile (builder stage).
#
# Adds the plot/ and image/ m-file categories to the web wasm build and
# applies our gnuplot-toolkit patches.  Build with the amd64 platform
# (emscripten 3.1.24 ships no arm64 binaries):
#
#   docker build --platform linux/amd64 -f scripts/octave-wasm.Dockerfile \
#     -t oo-octave-wasm:latest .
# Our frozen copy of <where>/octave-wasm's builder stage, published once to
# GHCR and referenced by digest so rebuilds never depend on upstream.
# Redecompile the base on demand via .github/workflows/rebuild-base.yml
# (clones rwl/octave-wasm @ e584306c715e869448f32bb3c0dc395b89a4846d).
FROM ghcr.io/skiadas/octave-base@sha256:0407d594a312050dc4dc8ca423b3ff5b6f8432cceba5d98a417281a10d03c5cd

# Octave Forge "statistics" 1.6.0 (the last release supporting core 7.2.0;
# 1.7.x needs Octave >= 8).  Only the pure-.m inst/ tree is shipped: the src/
# tree is libsvm (.oct) only, which the static wasm module cannot dlopen.
# PKG_ADD tells us the directories a "pkg load" would addpath (datasets,
# dist_fit/fun/stat, shadow9 for Octave < 9); main.cc mirrors that so the
# functions are on the load path without running pkg.
RUN curl -fsSL -o /tmp/statistics-1.6.0.tar.gz \
      https://github.com/gnu-octave/statistics/archive/refs/tags/release-1.6.0.tar.gz \
  && echo "c8e7d32e473465d7bcda751a25ce55ed918ac9b7d9740e5ada3d36b7e66b5810  /tmp/statistics-1.6.0.tar.gz" | sha256sum -c - \
  && tar -xzf /tmp/statistics-1.6.0.tar.gz -C /tmp \
  && cp -a /tmp/statistics-release-1.6.0/inst \
      /usr/src/octave-wasm/target/share/octave/7.2.0/m/statistics-forge \
  && rm -rf /tmp/statistics-1.6.0.tar.gz /tmp/statistics-release-1.6.0

# Octave Forge "data-smoothing" 1.3.0: smoothing of noisy lab-style data.
# Pure-.m inst/ tree (no compiled parts), no PKG_ADD.
RUN curl -fsSL -o /tmp/data-smoothing-1.3.0.tar.gz \
      "https://downloads.sourceforge.net/project/octave/Octave%20Forge%20Packages/Individual%20Package%20Releases/data-smoothing-1.3.0.tar.gz" \
  && echo "012bd7a9681619ed33d8643f3785ba9b17a82febab9b242674fe79746bc31b60  /tmp/data-smoothing-1.3.0.tar.gz" | sha256sum -c - \
  && tar -xzf /tmp/data-smoothing-1.3.0.tar.gz -C /tmp \
  && cp -a /tmp/data-smoothing/inst \
      /usr/src/octave-wasm/target/share/octave/7.2.0/m/data-smoothing-forge \
  && rm -rf /tmp/data-smoothing-1.3.0.tar.gz /tmp/data-smoothing

# Single-file compat import: nelder_mead_min (GPL-3, optim-1.6.2 inst/) is the
# pure-.m function behind regdatasmooth's auto-lambda (GCV) path. It has no
# dependencies, so we ship just this file rather than the whole `optim`
# package (whose m-layer needs its compiled .oct core, the `struct` package,
# and process/parallel features the wasm sandbox can't provide). Lives here so
# it rides the data-smoothing-forge preload + addpath with zero Makefile/main
# changes.
COPY patches/octave-m/scripts/data-smoothing-forge/nelder_mead_min.m \
     /usr/src/octave-wasm/target/share/octave/7.2.0/m/data-smoothing-forge/nelder_mead_min.m

# Our SymPy-backed symbolic shim (patches/octave-m/scripts/symbolic-sympy).
COPY patches/octave-m/scripts/symbolic-sympy/ \
     /usr/src/octave-wasm/target/share/octave/7.2.0/m/symbolic-sympy/

COPY patches/octave-src/Makefile /usr/src/octave-wasm/src/Makefile
COPY patches/octave-src/main.cc /usr/src/octave-wasm/src/main.cc
COPY patches/octave-src/oo-toolkit.cc /usr/src/octave-wasm/src/oo-toolkit.cc
COPY patches/octave-src/wasm-python.cc /usr/src/octave-wasm/src/wasm-python.cc
COPY patches/octave-m/scripts/plot/util/private/__gnuplot_open_stream__.m \
     /usr/src/octave-wasm/target/share/octave/7.2.0/m/plot/util/private/__gnuplot_open_stream__.m
COPY patches/octave-m/scripts/plot/util/private/__gnuplot_version__.m \
     /usr/src/octave-wasm/target/share/octave/7.2.0/m/plot/util/private/__gnuplot_version__.m
COPY patches/octave-m/scripts/plot/util/private/__gnuplot_has_terminal__.m \
     /usr/src/octave-wasm/target/share/octave/7.2.0/m/plot/util/private/__gnuplot_has_terminal__.m
COPY patches/octave-m/scripts/plot/util/private/__gnuplot_get_var__.m \
     /usr/src/octave-wasm/target/share/octave/7.2.0/m/plot/util/private/__gnuplot_get_var__.m

WORKDIR /usr/src/octave-wasm/src
# Force recompilation of main.cc: layer mtimes can leave octave.o "up to date"
# against the patched sources otherwise.
RUN rm -f octave.o oo-toolkit.o && make web/octave.js
