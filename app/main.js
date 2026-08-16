/* PoC glue: Octave (wasm) <-> gnuplot-wasm renderer. */
(function () {
  'use strict';

  var outEl = document.getElementById('output');
  var cmdEl = document.getElementById('cmd');
  var statusEl = document.getElementById('status');
  var plotEl = document.getElementById('plotPane');

  var Module = null;          // octave runtime (after OCTAVE() resolves)
  var lastPlotLen = 0;        // length of last /plot.gp bytes we rendered
  var lastError = null;       // last eval error message (empty on success)
  var ready = false;
  var gnuplotWasmPromise = null;
  var renderInFlight = Promise.resolve();

  /* gnuplot can render only once per module instance; cache the wasm bytes
     and instantiate a fresh module for every plot. */
  function getGnuplotWasm() {
    if (!gnuplotWasmPromise) {
      gnuplotWasmPromise = fetch('../dist/gnuplot-wasm/gnuplot.wasm')
        .then(function (r) { return r.arrayBuffer(); });
    }
    return gnuplotWasmPromise;
  }

  function renderWithGnuplot(script, size) {
    return getGnuplotWasm().then(function (bytes) {
      return createGnuplot(function (importObject, callback) {
        WebAssembly.instantiate(bytes, importObject)
          .then(function (res) { callback(res.instance); })
          .catch(function () { callback(false); });
        return {};
      });
    }).then(function (gnuplotFn) {
      return gnuplotFn(script, size);
    });
  }

  function append(text, cls) {
    if (cls) text = '<span class="' + cls + '">' + escapeHtml(text) + '</span>';
    outEl.innerHTML += text;
    outEl.scrollTop = outEl.scrollHeight;
  }

  function escapeHtml(s) {
    return String(s).replace(/[&<>"]/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c];
    });
  }

  function setStatus(msg) {
    statusEl.textContent = msg;
  }

  /* ---- gnuplot-wasm ---- */
  if (typeof createGnuplot !== 'function') {
    setStatus('FATAL: gnuplot.js not loaded (run scripts/build-gnuplot-wasm.sh)');
  } else {
    setStatus('gnuplot-wasm loaded');
  }

  /* ---- octave-wasm ---- */
  if (typeof OCTAVE !== 'function') {
    setStatus('FATAL: octave.js not loaded (run scripts/build-octave-wasm.sh)');
  } else {
    var octaveConfig;
    octaveConfig = {
      locateFile: function (path) { return '../dist/octave-wasm/' + path; },
      print: function (text) { append(text); },
      printErr: function (text) { append(text, 'err'); },
      postRun: function () {
        // postRun fires before the OCTAVE() promise resolves, so the runtime
        // methods are attached to the config object itself at this point.
        Module = octaveConfig;
        Module.execute_interp();
        initOctave();
      }
    };
    OCTAVE(octaveConfig).then(function (m) {
      Module = m;
    }).catch(function (err) {
      setStatus('octave-wasm failed: ' + err.message);
    });
  }

  /* One-time Octave setup (terminal, toolkit, sizing). */
  function initOctave() {
    var setup = [
      'more off;',
      'setenv("GNUTERM", "svg");',
      'graphics_toolkit("gnuplot");',
      'set(0, "defaultfigureposition", [100 100 800 600]);',
      'page_screen_output(0);'
    ].join('\n');
    var st = Module.eval_string(setup);
    if (st !== 0) {
      append('\n' + Module.last_error_message(), 'err');
      setStatus('Octave init error');
      return;
    }
    ready = true;
    setStatus('Octave ready — try: plot(sin(0:0.1:10))');
  }

  /* After every eval, pick up /plot.gp and render it with gnuplot-wasm. */
  function renderPlot() {
    if (!Module || typeof createGnuplot !== 'function') return;
    var script;
    try {
      // Raw bytes: Octave's stream can embed binary palette/image data.
      script = Module.FS.readFile('/plot.gp');
    } catch (e) {
      return; // no plot written yet
    }
    if (!script || !script.length || script.length === lastPlotLen) return;
    lastPlotLen = script.length;
    setStatus('rendering plot…');
    renderInFlight = renderWithGnuplot(script, { x: 800, y: 600 }).then(function (svg) {
      plotEl.innerHTML = svg;
      setStatus('Octave ready — plot rendered');
    }).catch(function (err) {
      plotEl.innerHTML = '<p style="color:#c33">gnuplot render error: ' +
        escapeHtml(err.message) + '</p>';
      setStatus('render error');
      throw err;
    });
    renderInFlight.catch(function () { /* surfaced above */ });
  }

  function run(cmd) {
    if (!ready) {
      append('\nOctave not ready yet.\n');
      return;
    }
    append('>> ' + cmd + '\n');
    lastError = '';
    var st = Module.eval_string(cmd);
    if (st !== 0) {
      lastError = Module.last_error_message();
      append('\n' + lastError + '\n', 'err');
    }
    // This is a headless interpreter: plot() marks figures dirty but doesn't
    // draw, so flush any pending figure render ourselves.
    Module.eval_string('drawnow;');
    renderPlot();
  }

  cmdEl.addEventListener('keydown', function (ev) {
    if (ev.key === 'Enter') {
      run(cmdEl.value);
      cmdEl.value = '';
    }
  });

  append('Loading Octave (wasm)…\n');

  /* Test hook for scripts/verify.mjs */
  window.__oo = {
    get ready() { return ready; },
    get module() { return Module; },
    get lastError() { return lastError; },
    get status() { return statusEl.textContent; },
    run: run,
    plotSVGCount: function () { return plotEl.querySelectorAll('svg').length; },
    lastPlotLength: function () { return lastPlotLen; },
    awaitRender: function () { return renderInFlight; }
  };
})();
