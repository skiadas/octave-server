/* PoC glue orchestrator: Octave (wasm) <-> gnuplot-wasm renderer, plus the
   file system (IndexedDB <-> MEMFS, via octfs) and plot gallery. This file is
   the wiring layer; the individual concerns live in the ES modules it imports
   (util, fsstore, octfs, gallery, filepanel). It is bundled to a classic
   script by scripts/build.mjs. */

import { Module, setModule, setReady, setAppend, userPath } from './runtime.js';
import { escapeHtml } from './util.js';
import { octfs } from './octfs.js';
import { gallery } from './gallery.js';
import { filepanel } from './filepanel.js';
import { editorpad } from './editorpad.js';
import './layout.js';

const outEl = document.getElementById('output');
const cmdEl = document.getElementById('cmd');
const statusEl = document.getElementById('status');
const plotEl = document.getElementById('plotPane');
const editorEl = document.getElementById('editor');
const filenameEl = document.getElementById('filename');
const runBtnEl = document.getElementById('runBtn');

let lastPlotLen = 0;        // length of the last figure bytes we rendered
let lastError = null;       // last eval error message (empty on success)
let ready = false;
let fsReady = false;
let gnuplotWasmPromise = null;
let renderInFlight = Promise.resolve();
let figState = {};          // figId -> {mtime, sig} of the last handled file
let activeRun = null;       // run token for the invocation currently evaluating

/* ---- embedded assets (single-file build) ----
   scripts/build.mjs can inline the wasm binaries as base64 `data:` URIs in
   window.__OO_ASSETS__. When present we use them (works from file://, no
   fetch); otherwise we fall back to fetching the sibling files. */
function embeddedDataUri(name) {
  const assets = (typeof window !== 'undefined' && window.__OO_ASSETS__) || {};
  return assets[name] || null;
}
function dataUriToBytes(uri) {
  const b64 = uri.split(',')[1];
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes.buffer;
}

/* Runtime fetches (octave.data / octave.wasm / gnuplot.wasm) are versioned
   with the ?v=<hash> baked into window.__OO_V__ by scripts/build.mjs so a
   browser cache can never replay stale wasm/data against a new build. */
function assetURL(path) {
  const v = (typeof window !== 'undefined' && window.__OO_V__) || {};
  const h = v[path];
  return h ? '../dist/' + path + '?v=' + h : '../dist/' + path;
}

/* gnuplot can render only once per module instance; cache the wasm bytes
   and instantiate a fresh module for every plot. */
function getGnuplotWasm() {
  if (!gnuplotWasmPromise) {
    const uri = embeddedDataUri('gnuplot.wasm');
    gnuplotWasmPromise = uri
      ? Promise.resolve(dataUriToBytes(uri))
      : fetch(assetURL('gnuplot-wasm/gnuplot.wasm')).then((r) => r.arrayBuffer());
  }
  return gnuplotWasmPromise;
}

function renderWithGnuplot(script, size) {
  return getGnuplotWasm().then((bytes) => {
    return createGnuplot((importObject, callback) => {
      WebAssembly.instantiate(bytes, importObject)
        .then((res) => callback(res.instance))
        .catch(() => callback(false));
      return {};
    });
  }).then((gnuplotFn) => {
    return gnuplotFn(script, size);
  });
}

function append(text, cls) {
  if (cls) text = '<span class="' + cls + '">' + escapeHtml(text) + '</span>';
  outEl.innerHTML += text;
  outEl.scrollTop = outEl.scrollHeight;
}
setAppend((text, cls) => append(text, cls));

/* The FreeType warning is benign in this wasm build (the gnuplot toolkit
   renders its own text; only Octave's auto label-extent probing triggers
   it) and has no warning identifier, so it cannot be targeted with
   warning("off", <id>) without disabling all warnings.  Suppress just this
   block in the stderr stream. */
let suppressFreetypeBlock = false;
function isFreetypeWarningLine(line) {
  return line.indexOf('render_text: support for rendering text (FreeType)') !== -1;
}
function isTracebackLine(line) {
  return /^warning: called from/.test(line) || /^ {4}/.test(line);
}
function filterStderrLine(line) {
  if (suppressFreetypeBlock) {
    if (isTracebackLine(line)) return null;
    suppressFreetypeBlock = false;
  }
  if (isFreetypeWarningLine(line)) {
    suppressFreetypeBlock = true;
    return null;
  }
  return line;
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
  const octaveConfig = {
    locateFile: function (path) {
      // Single-file build: return the embedded data URI when present.
      const uri = embeddedDataUri('octave-wasm/' + path) || embeddedDataUri(path);
      if (uri) return uri;
      return assetURL('octave-wasm/' + path);
    },
    print: function (text) { append(escapeHtml(String(text)) + '\n'); },
    printErr: function (text) {
      // Emscripten delivers one console line per call with the trailing
      // newline stripped; restore it, and drop the benign FreeType block.
      const line = filterStderrLine(String(text));
      if (line === null) return;
      append(escapeHtml(line) + '\n', 'err');
    },
    postRun: function () {
      // postRun fires before the OCTAVE() promise resolves, so the runtime
      // methods are attached to the config object itself at this point.
      setModule(octaveConfig);
      Module.execute_interp();
      initOctave();
    }
  };
  OCTAVE(octaveConfig).then((m) => {
    setModule(m);
  }).catch((err) => {
    setStatus('octave-wasm failed: ' + err.message);
  });
}

/* One-time Octave setup (terminal, toolkit, sizing), then hydrate the user
   filesystem (IndexedDB -> MEMFS) asynchronously. ready is set synchronously
   so callers depending on the old contract see it immediately; hydration is
   best-effort and non-blocking. */
function initOctave() {
  const setup = [
    'more off;',
    'setenv("GNUTERM", "svg");',
    'graphics_toolkit("gnuplot");',
    'set(0, "defaultfigureposition", [100 100 800 600]);',
    'page_screen_output(0);'
  ].join('\n');
  const st = Module.eval_string(setup);
  if (st !== 0) {
    append('\n' + Module.last_error_message(), 'err');
    setStatus('Octave init error');
    return;
  }
  ready = true;
  setReady(true);
  setStatus('Octave ready — try: plot(sin(0:0.1:10))');
  // Hydrate persisted user files into MEMFS (non-blocking; synced on next
  // octave eval via cd/addpath inside hydrate).
  octfs.hydrate().then(() => {
    fsReady = true;
  }).catch(() => {
    fsReady = true; // degrade to memory-only if hydration failed
  });
}

/* After every eval, pick up the per-figure gnuplot streams (/plot-fig-*.gp —
   see patches/octave-m/.../__gnuplot_open_stream__.m) and render each figure
   that changed with gnuplot-wasm. A figure file is "theirs" alone: it is
   truncated on every draw, so each figure renders as one clean SVG and
   multi-figure scripts keep every figure instead of clobbering a shared file.
   On a successful render, broadcast each SVG so the gallery can keep it in
   this invocation's run. */
function figSig(bytes) {
  let h = 2166136261;
  for (let i = 0; i < bytes.length; i++) h = ((h ^ bytes[i]) * 16777619) >>> 0;
  return bytes.length + ':' + h;
}

function renderPlot() {
  if (!Module || typeof createGnuplot !== 'function') return;
  if (!Module.FS || typeof Module.FS.readdir !== 'function') return;
  let names;
  try {
    names = Module.FS.readdir('/');
  } catch (e) {
    return;
  }
  const jobs = [];
  for (const n of names || []) {
    const m = /^plot-fig-(\d+)\.gp$/.exec(n);
    if (!m) continue;
    const fig = m[1];
    let bytes, st;
    try {
      bytes = Module.FS.readFile('/' + n);
      st = Module.FS.stat('/' + n);
    } catch (e) {
      continue; // not readable / disappearing mid-scan
    }
    if (!bytes || !bytes.length) continue;
    const s = figSig(bytes);
    const prev = figState[fig];
    const touched = !prev || Number(st.mtime) !== prev.mtime;
    const changed = !prev || prev.sig !== s;
    if (!touched && !changed) continue; // stale from an earlier run
    figState[fig] = { mtime: Number(st.mtime), sig: s };
    jobs.push({ fig, bytes });
  }
  if (!jobs.length) return;
  const run = activeRun;
  setStatus(jobs.length > 1 ? 'rendering ' + jobs.length + ' figures…'
                            : 'rendering figure ' + jobs[0].fig + '…');
  renderInFlight = renderInFlight
    .catch(() => {})
    .then(() => renderAll(jobs, run))
    .then(() => { setStatus('Octave ready — plot rendered'); })
    .catch((err) => {
      setStatus('render error');
      append('\nrender error: ' + escapeHtml(err && err.message ? err.message : String(err)) + '\n', 'err');
    });
}

async function renderAll(jobs, run) {
  for (const j of jobs) {
    const svg = await renderWithGnuplot(j.bytes, { x: 800, y: 600 });
    lastPlotLen = j.bytes.length;
    gallery.add(svg, j.fig, { run });
  }
}

function run(cmd) {
  if (!ready) {
    append('\nOctave not ready yet.\n');
    return;
  }
  append('>> ' + escapeHtml(cmd) + '\n');
  lastError = '';
  activeRun = gallery.beginRun();
  const st = Module.eval_string(cmd);
  if (st !== 0) {
    lastError = Module.last_error_message();
    append('\n' + lastError + '\n', 'err');
  }
  // This is a headless interpreter: plot() marks figures dirty but doesn't
  // draw, so flush any pending figure render ourselves.
  Module.eval_string('drawnow;');
  renderPlot();
}

cmdEl.addEventListener('keydown', (ev) => {
  if (ev.key === 'Enter') {
    run(cmdEl.value);
    cmdEl.value = '';
  }
});

/* Run a whole script file: persist the editor text into the user filesystem
   (IndexedDB + MEMFS at /home/user/<name>), then evaluate the text directly.
   (Octave's source() would be the natural fit, but in this wasm build it
   swallows errors — eval_string reports them just like run() does.) */
function runFile(text) {
  if (!ready) {
    append('\nOctave not ready yet.\n');
    return;
  }
  // Only a real string is writable; a DOM listener that calls us with a
  // click Event must fall back to the editor contents.
  if (typeof text !== 'string') text = editorEl.value;
  const name = (filenameEl.value || 'script.m').trim();
  if (!/^[A-Za-z0-9_.\/-]+$/.test(name)) {
    append('\nInvalid file name: ' + escapeHtml(name) + '\n', 'err');
    return;
  }
  const rel = name.replace(/^\/+/, '');
  // Persist into the user tree (MEMFS write is synchronous; store async).
  octfs.putFile(rel, text).catch((e) => {
    append('\nCould not save ' + escapeHtml(name) + ': ' +
      escapeHtml(e && e.message ? e.message : String(e)) + '\n', 'err');
  });
  append('>> run ' + escapeHtml(name) + '\n');
  lastError = '';
  activeRun = gallery.beginRun();
  const st = Module.eval_string(text.toString());
  if (st !== 0) {
    lastError = Module.last_error_message();
    append('\n' + lastError + '\n', 'err');
  }
  Module.eval_string('drawnow;');
  renderPlot();
}

runBtnEl.addEventListener('click', () => {
  runFile();
});
// The editor's own keys (Ctrl+Enter to run, Tab to indent/complete, Ctrl+Space
// completion) live in editorpad.js; runFile is injected here to keep the file
// as the wiring layer. Editor.value stays the single buffer source of truth.
editorpad.setRun(runFile);

append('Loading Octave (wasm)…\n');

/* ---- Pyodide / SymPy bootstrap (synchronous bridge for symbolic math) ----
   Octave runs on the main thread and Pyodide's runPython() is synchronous,
   so the __wasm_python__ builtin in the octave build can round-trip SymPy
   code text to window.__ooWasmPython below with no async plumbing.  Loaded
   from the JsDelivr CDN (pinned to v314.0.4); failures degrade gracefully —
   symbolic functions will raise a clear "bridge not available" error. */
function ooSymPySetupSource() {
  return [
    'from sympy import *',
    "x, y, t, s, z, n = symbols('x y t s z n')",
    'import re as _ore',
    'def _oo_dsolve(eqs, ics):',
    '    s = eqs.strip()',
    "    fns = set(m.group(2) for m in _ore.finditer(r'D(\\d*)([A-Za-z_]\\w*)', s))",
    "    s = _ore.sub(r'D(\\d*)([A-Za-z_]\\w*)',",
    "                lambda m: 'Derivative(%s(x), x, %s)' % (m.group(2), m.group(1) or '1'), s)",
    '    for fn in fns:',
    "        s = _ore.sub(r'(?<![A-Za-z_(.])%s(?!\\()' % fn, fn + '(x)', s)",
    "    lhs, _, rhs = s.partition('=')",
    "    ode = Eq(sympify(lhs, locals={'x': Symbol('x')}), sympify(rhs, locals={'x': Symbol('x')}))",
    '    ics_d = {}',
    '    for c in ics:',
    '        c = c.strip()',
    "        left, _, val = c.partition('=')",
    '        left = left.strip(); val = sympify(val)',
    "        m = _ore.match(r'D(\\d*)([A-Za-z_]\\w*)\\(([^)]*)\\)', left)",
    '        if m:',
    '            fn = m.group(2); pt = Symbol(m.group(3))',
    '            ics_d[Derivative(Function(fn)(pt), pt, int(m.group(1) or 1))] = val',
    '        else:',
    "            m = _ore.match(r'([A-Za-z_]\\w*)\\(([^)]*)\\)', left)",
    '            fn = m.group(1); pt = Symbol(m.group(2))',
    '            ics_d[Function(fn)(pt)] = val',
    '    sol = dsolve(ode, ics=ics_d) if ics_d else dsolve(ode)',
    '    if ics_d:',
    '        sol = simplify(sol)',
    '    return sol'
  ].join('\n');
}

function bootstrapSympy() {
  if (typeof loadPyodide !== 'function') {
    console.warn('Pyodide not loaded (CDN unreachable?) — symbolic disabled');
    return;
  }
  loadPyodide({ indexURL: 'https://cdn.jsdelivr.net/pyodide/v314.0.4/full/' })
    .then((py) => {
      return py.loadPackage('sympy').then(() => {
        py.runPython(ooSymPySetupSource());
        window.__ooWasmPython = (code) => String(py.runPython(code));
        window.__ooSympyReady = true;
        setStatus('Octave ready — symbolic (SymPy) loaded');
      });
    })
    .catch((err) => {
      const msg = (err && err.message) ? err.message : String(err);
      console.warn('SymPy init failed:', msg.slice(0, 500));
    });
}
bootstrapSympy();

/* Test hook for scripts/verify.mjs */
window.__oo = {
  get ready() { return ready; },
  get fsReady() { return fsReady; },
  get module() { return Module; },
  get lastError() { return lastError; },
  get status() { return statusEl.textContent; },
  run,
  runFile,
  editorpad,
  plotSVGCount: () => plotEl.querySelectorAll('svg').length,
  lastPlotLength: () => lastPlotLen,
  awaitRender: () => renderInFlight
};
