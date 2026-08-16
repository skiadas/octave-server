// WEBASSEMBLY OVERRIDE
// --------------------
// Upstream gnuplot-wasm feeds the script to gnuplot as a FILE argument and
// reads stdin only from a closed stream.  GNU Octave's gnuplot toolkit emits
// plot data *inline* via `plot "-"` (data lines followed by `e`) interleaved
// with the commands in the same stream.  For that to work, gnuplot must read
// commands AND data from stdin, exactly like a native pipe.
//
// This override feeds the entire script through Emscripten stdin
// (FS.init) and invokes gnuplot with '-' as the script source, then reads
// the SVG written to the "output" file.

var errInfo;

Module['printErr'] = (err) => errInfo += `${err}\n`;

Module['onAbort'] = reject;

Module['onRuntimeInitialized'] = () => resolve((input, size) => {
    errInfo = '';
    size = size ? `size ${size.x},${size.y}` : '';

    var pending = input ? input.split('') : [];
    FS.init(
      () => { return pending.length ? pending.shift().charCodeAt(0) : null; },
      null,
      (c) => errInfo += String.fromCharCode(c)
    );

    callMain(['-e', `set o "output";set t svg ${size} dynamic enhanced;`, '-']);
    var output = FS.readFile('output', { encoding: 'utf8' });

    FS.unlink('output');

    if (errInfo) throw new Error(errInfo);

    return output;
});

Module['instantiateWasm'] = typeof instantiateWasm === 'function' ? instantiateWasm : undefined;
