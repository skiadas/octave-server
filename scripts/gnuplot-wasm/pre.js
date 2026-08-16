// WEBASSEMBLY OVERRIDE
// --------------------
// Upstream gnuplot-wasm feeds the script to gnuplot as a FILE argument and
// leaves stdin closed.  GNU Octave's gnuplot toolkit emits plot data *inline*
// via `plot "-"` (data lines followed by `e`) interleaved with the commands in
// the same stream, so gnuplot must read commands AND data from stdin — exactly
// like a native pipe.
//
// This override:
//   1. feeds the whole script through Emscripten stdin by populating the tty
//      device's input queue for fd 0 (FS.streams[0].X.input);
//   2. invokes gnuplot with '-' as the script source.  gnuplot is forced into
//      batch mode by our `batch-mode.patch` (Emscripten's isatty(0) would
//      otherwise turn on interactive prompting and break line-buffered reads);
//   3. returns the SVG written to the "output" file.

var errInfo;

Module['printErr'] = (err) => errInfo += `${err}\n`;

Module['onAbort'] = reject;

Module['onRuntimeInitialized'] = () => resolve((input, size) => {
    errInfo = '';
    size = size ? `size ${size.x},${size.y}` : '';

    var stdinStream = FS.streams[0];
    if (stdinStream && stdinStream.X) {
      stdinStream.X.input = input ? input.split('') : [];
    }

    callMain(['-e', `set o "output";set t svg ${size} dynamic enhanced;`, '-']);
    var output = FS.readFile('output', { encoding: 'utf8' });

    FS.unlink('output');

    if (errInfo) throw new Error(errInfo);

    return output;
});

Module['instantiateWasm'] = typeof instantiateWasm === 'function' ? instantiateWasm : undefined;
