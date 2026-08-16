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

# Which template/pre.js to build with. Default = our stdin-fed override.
# Pass --build-arg PRE_JS=vendor/gnuplot-wasm/template/pre.js for upstream.
ARG PRE_JS=scripts/gnuplot-wasm/pre.js
COPY ${PRE_JS} /src/template/pre.js

RUN bash build.sh install
