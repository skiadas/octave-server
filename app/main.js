/* PoC glue: Octave (wasm) <-> gnuplot-wasm renderer. */
(function () {
  'use strict';

  var outEl = document.getElementById('output');
  var cmdEl = document.getElementById('cmd');
  var statusEl = document.getElementById('status');
  var plotEl = document.getElementById('plotPane');

  var Module = null;          // octave runtime (after OCTAVE() resolves)
  var gnuplot = null;         // gnuplot-wasm render function
  var lastPlot = null;        // last /plot.gp contents we rendered
  var ready = false;

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
    createGnuplot().then(function (fn) {
      gnuplot = fn;
      setStatus('gnuplot-wasm ready');
    }).catch(function (err) {
      setStatus('gnuplot-wasm failed: ' + err.message);
    });
  }

  /* ---- octave-wasm ---- */
  if (typeof OCTAVE !== 'function') {
    setStatus('FATAL: octave.js not loaded (run scripts/build-octave-wasm.sh)');
  } else {
    var config = {
      print: function (text) { append(text); },
      printErr: function (text) { append(text, 'err'); },
      postRun: function () {
        Module.execute_interp();
        initOctave();
      }
    };
    OCTAVE(config).then(function (m) {
      Module = m;
    }).catch(function (err) {
      setStatus('octave-wasm failed: ' + err.message);
    });
  }

  /* One-time Octave setup (paths, terminal, toolkit, sizing). */
  function initOctave() {
    var setup = [
      'more off;',
      "addpath('/usr/src/octave/m/plot', '-end');",
      "addpath('/usr/src/octave/m/image', '-end');",
      'setenv("GNUTERM", "svg");',
      'graphics_toolkit("gnuplot");',
      'set(0, "defaultfigureposition", [100 100 800 600]);',
      'set(0, "defaultfigurevisible", "off");',
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
    if (!Module || !gnuplot) return;
    var script;
    try {
      script = Module.FS.readFile('/plot.gp', { encoding: 'utf8' });
    } catch (e) {
      return; // no plot written yet
    }
    if (!script || script === lastPlot) return;
    lastPlot = script;
    try {
      var svg = gnuplot(script, { x: 800, y: 600 });
      plotEl.innerHTML = svg;
    } catch (err) {
      plotEl.innerHTML = '<p style="color:#c33">gnuplot render error: ' +
        escapeHtml(err.message) + '</p>';
    }
  }

  function run(cmd) {
    if (!ready) {
      append('\nOctave not ready yet.\n');
      return;
    }
    append('>> ' + cmd + '\n');
    var st = Module.eval_string(cmd);
    if (st !== 0) {
      append('\n' + Module.last_error_message() + '\n', 'err');
    }
    renderPlot();
  }

  cmdEl.addEventListener('keydown', function (ev) {
    if (ev.key === 'Enter') {
      run(cmdEl.value);
      cmdEl.value = '';
    }
  });

  append('Loading Octave (wasm)…\n');
})();
