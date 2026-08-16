// WEBASSEMBLY OVERRIDE
// --------------------
// Upstream gnuplot-wasm feeds the script to gnuplot as a FILE argument and
// leaves stdin closed.  GNU Octave's gnuplot toolkit emits plot data *inline*
// via `plot "-"` (data lines followed by `e`) interleaved with the commands in
// the same stream, so gnuplot must read commands AND data from stdin — exactly
// like a native pipe.
//
// This override:
//   1. sets Module["stdin"] (before instantiation) so Emscripten wires fd 0
//      to a plain char device (non-tty => gnuplot runs in batch mode) that
//      feeds the whole script — commands and `plot "-"` data alike;
//   2. invokes gnuplot with '-' as the script source;
//   3. returns the SVG written to the "output" file.
//
// IMPORTANT: gnuplot's global state is not reset between `main()` runs, so a
// single module instance renders only ONE plot.  Callers must instantiate a
// fresh module per render (the JS bridge does this).

var errInfo;
var pendingInput = [];

Module['printErr'] = (err) => errInfo += `${err}\n`;

// Feeds one byte (0-255) or null at EOF.  Input may be a string or a
// Uint8Array (Octave's stream can contain binary palette/image data).
Module['stdin'] = function () {
  return pendingInput.length ? pendingInput.shift() : null;
};

function toBytes(input) {
  if (input instanceof Uint8Array) return Array.from(input);
  if (typeof input === 'string') return input.split('').map(function (c) { return c.charCodeAt(0); });
  return [];
}

Module['onAbort'] = reject;

Module['onRuntimeInitialized'] = () => resolve((input, size) => {
    errInfo = '';
    size = size ? `size ${size.x},${size.y}` : '';

    // Octave's accumulated stream can end while `set multiplot` is still
    // active; gnuplot then exits without finalizing the SVG. Close it first.
    var cleanup = '\nunset multiplot;\n';
    pendingInput = toBytes(input).concat(cleanup.split('').map(function (c) { return c.charCodeAt(0); }));

    callMain(['-e', `set o "output";set t svg ${size} dynamic enhanced;`, '-']);
    var output = FS.readFile('output', { encoding: 'utf8' });

    FS.unlink('output');

    if (errInfo) throw new Error(errInfo);

    return output;
});

Module['instantiateWasm'] = typeof instantiateWasm === 'function' ? instantiateWasm : undefined;
