/* UI unit tests (fast tier, <1s): drives app/main.js's glue logic with a
   stubbed Module/OCTAVE and a minimal fake DOM — no Chrome, no wasm, no
   gnuplot renders. Catches UI wiring regressions (e.g. the click-Event bug)
   without the integration battery. */
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const APP_JS = readFileSync(new URL('../app/main.js', import.meta.url), 'utf8');
const ELEM_IDS = ['output', 'cmd', 'status', 'plotPane', 'editor', 'filename', 'runBtn'];

function innerTextFrom(html) {
  return String(html)
    .replace(/<[^>]*>/g, '')
    .replace(/&gt;/g, '>').replace(/&lt;/g, '<').replace(/&amp;/g, '&').replace(/&quot;/g, '"');
}

function makeElement(id) {
  let selectionStart = 0;
  let selectionEnd = 0;
  let _html = '';
  let _text = '';
  let _textSet = false;
  const el = {
    id, value: '', scrollTop: 0, scrollHeight: 0,
    style: {}, className: '', handlers: {},
    addEventListener(type, fn) { this.handlers[type] = fn; },
    click() { if (this.handlers.click) this.handlers.click({ preventDefault() {}, target: this }); },
    querySelectorAll() { return []; },
    get selectionStart() { return selectionStart; },
    set selectionStart(v) { selectionStart = v; },
    get selectionEnd() { return selectionEnd; },
    set selectionEnd(v) { selectionEnd = v; },
  };
  Object.defineProperty(el, 'innerHTML', {
    get() { return _html; },
    set(v) { _html = String(v); },
  });
  Object.defineProperty(el, 'textContent', {
    get() { return _textSet ? _text : innerTextFrom(_html); },
    set(v) { _text = String(v); _textSet = true; },
  });
  return el;
}

const elements = {};
for (const id of ELEM_IDS) elements[id] = makeElement(id);

const state = {
  writes: {},   // MEMFS path -> last string written
  lastErr: '',
  evalStatus(code) {
    if (code.indexOf('more off') !== -1) return 0;            // initOctave setup
    if (code.indexOf('drawnow') !== -1) return 0;
    if (code.indexOf('SMOKE_FAIL') !== -1) {
      state.lastErr = 'boom: SMOKE_FAIL near line 1';
      return -2;
    }
    return 0;
  },
  fs: {
    writeFile(path, data) { state.writes[path] = String(data); },
    readFile(path) {
      if (Object.prototype.hasOwnProperty.call(state.writes, path)) {
        return new TextEncoder().encode(state.writes[path]);
      }
      const e = new Error('ENOENT: no such file or directory, open \'' + path + '\'');
      e.errno = 44;
      throw e;
    },
  },
};

/* Stand-in for the wasm runtime: attaches the API surface the app expects,
   then fires postRun (which in the real build is triggered before OCTAVE()
   resolves, and which runs the one-time init). eval_string is driven by
   state.evalStatus so tests can simulate failures. */
function OCTAVE(cfg) {
  cfg.FS = { writeFile: state.fs.writeFile, readFile: state.fs.readFile };
  cfg.eval_string = (code) => state.evalStatus(code);
  cfg.last_error_message = () => state.lastErr;
  cfg.execute_interp = () => {};
  cfg.postRun();
  return Promise.resolve(cfg);
}

const document = { getElementById: (id) => elements[id] || null };
const windowObj = {};
windowObj.__oo = null;

const context = {
  document,
  window: windowObj,
  console: { log: () => {}, warn: () => {}, error: () => {} },
  OCTAVE,
  createGnuplot: function () { return Promise.resolve(() => Promise.resolve('')); },
  fetch: () => Promise.resolve({ arrayBuffer: () => Promise.resolve(new ArrayBuffer(0)) }),
};
context.window.__oo = () => null; // replaced below by main.js (placeholder kept for the vm run)

let failures = 0;
function check(name, ok, detail) {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}: ${detail}`);
  if (!ok) failures = 1;
}

vm.runInNewContext(APP_JS, context);
const oo = windowObj.__oo;
const output = elements.output;
const editor = elements.editor;
const filename = elements.filename;
const runBtn = elements.runBtn;

check('app boots & is ready (initOctave ran)', oo && oo.ready === true, `ready=${oo && oo.ready}`);

check('__oo.runFile exposed', typeof oo.runFile === 'function', typeof oo.runFile);

{
  const before = output.textContent.length;
  oo.runFile('printf("unit-ok\\n");');
  const out = output.textContent.slice(before);
  check('runFile writes script.m and evaluates',
    state.writes['/script.m'] === 'printf("unit-ok\\n");' && out.indexOf('>> run script.m') !== -1 && !oo.lastError,
    `wrote=${JSON.stringify(state.writes['/script.m'])} lastError=${oo.lastError || '(none)'}`);
}

{
  // Regression: a DOM click passes an Event (non-string) to the listener.
  editor.value = 'printf("click-ok\\n");\n';
  runBtn.click();
  check('run button click writes editor contents (Event bug guard)',
    state.writes['/script.m'] === editor.value && !oo.lastError,
    `wrote=${JSON.stringify(state.writes['/script.m'])} lastError=${oo.lastError || '(none)'}`);
}

{
  editor.value = '';
  oo.runFile(123); // non-string falls back to the editor text
  check('non-string runFile arg falls back to editor text',
    Object.prototype.hasOwnProperty.call(state.writes, '/script.m') && typeof state.writes['/script.m'] === 'string',
    `wrote=${JSON.stringify(state.writes['/script.m'])}`);
}

{
  const before = output.textContent.length;
  filename.value = 'bad name!';
  oo.runFile('x=1;');
  filename.value = 'script.m';
  const out = output.textContent.slice(before);
  check('invalid file name rejected',
    out.indexOf('Invalid file name') !== -1 && !state.writes['/bad name!'],
    out.slice(out.indexOf('Invalid file name'), out.indexOf('\n', out.indexOf('Invalid file name') + 20) + 1).trim());
}

{
  const before = output.textContent.length;
  oo.runFile('SMOKE_FAIL()');
  const out = output.textContent.slice(before);
  check('eval error surfaced via lastError + console',
    oo.lastError && out.indexOf('boom: SMOKE_FAIL') !== -1,
    oo.lastError ? oo.lastError.split('\n')[0] : '(no error)');
  state.lastErr = '';
}

{
  const m = windowObj.__oo.module;
  check('__oo.module is the configured runtime', m && typeof m.eval_string === 'function', typeof m && m.eval_string ? 'attached' : 'missing');
}

console.log(failures ? '\nUI unit tests: FAILED' : '\nUI unit tests: all passed');
process.exit(failures);