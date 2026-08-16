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
//   2. marks fd 0 as NOT a tty, so gnuplot runs in batch mode instead of
//      interactive mode (which otherwise echoes `gnuplot>` prompts to stderr
//      and mishandles EOF);
//   3. invokes gnuplot with '-' as the script source;
//   4. filters benign prompt/warning noise from stderr before throwing;
//   5. returns the SVG written to the "output" file.

var errInfo;

Module['printErr'] = (err) => errInfo += `${err}\n`;

Module['onAbort'] = reject;

Module['onRuntimeInitialized'] = () => resolve((input, size) => {
    errInfo = '';
    size = size ? `size ${size.x},${size.y}` : '';

    var stdinStream = FS.streams[0];
    if (stdinStream && stdinStream.X) {
      stdinStream.X.input = input ? input.split('') : [];
      stdinStream.tty = 0; // force gnuplot into batch (non-interactive) mode
    }

    callMain(['-e', `set o "output";set t svg ${size} dynamic enhanced;`, '-']);
    var output = FS.readFile('output', { encoding: 'utf8' });

    FS.unlink('output');

    // Interactive gnuplot echoes `gnuplot>` prompts to stderr; ignore those
    // and any other benign chatter, but surface real errors.
    var realErr = errInfo.split('\n')
      .filter(function (l) { l = l.trim(); return l && !/^gnuplot>/.test(l); })
      .join('\n');
    if (realErr) throw new Error(realErr);

    return output;
});

Module['instantiateWasm'] = typeof instantiateWasm === 'function' ? instantiateWasm : undefined;
