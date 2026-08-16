# Derived from rwl/octave-wasm's Dockerfile (builder stage).
#
# Adds the plot/ and image/ m-file categories to the web wasm build and
# applies our gnuplot-toolkit patches.  Build with the amd64 platform
# (emscripten 3.1.24 ships no arm64 binaries):
#
#   docker build --platform linux/amd64 -f scripts/octave-wasm.Dockerfile \
#     -t oo-octave-wasm:latest .
FROM ghcr.io/rwl/octave-wasm:latest

COPY patches/octave-src/Makefile /usr/src/octave-wasm/src/Makefile
COPY patches/octave-src/main.cc /usr/src/octave-wasm/src/main.cc
COPY patches/octave-src/oo-toolkit.cc /usr/src/octave-wasm/src/oo-toolkit.cc
COPY patches/octave-m/scripts/plot/util/private/__gnuplot_open_stream__.m \
     /usr/src/octave-wasm/target/share/octave/7.2.0/m/plot/util/private/__gnuplot_open_stream__.m
COPY patches/octave-m/scripts/plot/util/private/__gnuplot_version__.m \
     /usr/src/octave-wasm/target/share/octave/7.2.0/m/plot/util/private/__gnuplot_version__.m
COPY patches/octave-m/scripts/plot/util/private/__gnuplot_has_terminal__.m \
     /usr/src/octave-wasm/target/share/octave/7.2.0/m/plot/util/private/__gnuplot_has_terminal__.m
COPY patches/octave-m/scripts/plot/util/private/__gnuplot_get_var__.m \
     /usr/src/octave-wasm/target/share/octave/7.2.0/m/plot/util/private/__gnuplot_get_var__.m

WORKDIR /usr/src/octave-wasm/src
RUN make web/octave.js
