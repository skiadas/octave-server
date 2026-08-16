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

Module['stdin'] = function () {
  return pendingInput.length ? pendingInput.shift().charCodeAt(0) : null;
};

Module['onAbort'] = reject;

Module['onRuntimeInitialized'] = () => resolve((input, size) => {
    errInfo = '';
    size = size ? `size ${size.x},${size.y}` : '';

    // Octave's accumulated script can end while `set multiplot` is still
    // active; gnuplot then exits without finalizing the SVG. Close it first.
    pendingInput = ((input || '') + '\nunset multiplot;\n').split('');

    callMain(['-e', `set o "output";set t svg ${size} dynamic enhanced;`, '-']);
    var output = FS.readFile('output', { encoding: 'utf8' });

    FS.unlink('output');

    if (errInfo) throw new Error(errInfo);

    return output;
});

Module['instantiateWasm'] = typeof instantiateWasm === 'function' ? instantiateWasm : undefined;
