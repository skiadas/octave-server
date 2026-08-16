# Builds gnuplot-wasm (Eumeryx/gnuplot-wasm) with our stdin-fed wrapper
# override.  emsdk 3.1.24 has no arm64 binaries, so build amd64:
#
#   docker build --platform linux/amd64 -f scripts/gnuplot-wasm.Dockerfile \
#     -t oo-gnuplot-wasm:latest .
FROM emscripten/emsdk:3.1.24

RUN apt-get update && apt-get install -y --no-install-recommends wget \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /src
COPY vendor/gnuplot-wasm /src

# Our build.sh applies an extra gnuplot patch (force batch mode); our pre.js
# feeds the script through stdin.  Pass --build-arg PRE_JS=vendor/gnuplot-wasm/template/pre.js
# and BUILD_SH=vendor/gnuplot-wasm/build.sh for a vanilla build.
ARG PRE_JS=scripts/gnuplot-wasm/pre.js
ARG BUILD_SH=scripts/gnuplot-wasm/build.sh
COPY ${PRE_JS} /src/template/pre.js
COPY ${BUILD_SH} /src/build.sh
COPY patches/gnuplot/batch-mode.patch /src/batch-mode.patch

RUN bash build.sh install
