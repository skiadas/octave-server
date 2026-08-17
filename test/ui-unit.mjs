/* UI unit tests (fast tier, <1s): drives the app's glue logic with a stubbed
   Module/OCTAVE and a minimal fake DOM — no Chrome, no wasm, no gnuplot
   renders. Catches UI wiring regressions (e.g. the click-Event bug) without
   the integration battery.

   Loads the app modules in their real load order (util -> fsstore -> octfs ->
   gallery -> filepanel -> main) into one shared VM context so cross-module
   wiring through window.ooApp is exercised the same as in the browser. */
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const MODULES = ['util', 'fsstore', 'octfs', 'gallery', 'filepanel', 'main'];
const ELEM_IDS = [
  'output', 'cmd', 'status', 'plotPane', 'editor', 'filename', 'runBtn',
  'filesPane', 'galleryPane', 'galleryList', 'galleryEmpty', 'galleryClearBtn',
  'previewPane', 'previewTitle', 'previewImg', 'previewText', 'previewClose',
  'fileInput',
];

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
    style: {}, className: '', handlers: {}, children: [],
    addEventListener(type, fn) { this.handlers[type] = fn; },
    click() { if (this.handlers.click) this.handlers.click({ preventDefault() {}, target: this }); },
    querySelectorAll() { return []; },
    appendChild(c) { this.children.push(c); return c; },
    replaceChildren(...cs) { this.children = cs; },
    removeAttribute() {},
    querySelector() { return null; },
    get selectionStart() { return selectionStart; },
    set selectionStart(v) { selectionStart = v; },
    get selectionEnd() { return selectionEnd; },
    set selectionEnd(v) { selectionEnd = v; },
    blur() {},
    focus() {},
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
    if (code.startsWith('cd("')) return 0;                    // octfs hydrate cd
    if (code.startsWith('addpath("')) return 0;               // octfs hydrate addpath
    if (code.indexOf('SMOKE_FAIL') !== -1) {
      state.lastErr = 'boom: SMOKE_FAIL near line 1';
      return -2;
    }
    return 0;
  },
  fs: {
    writeFile(path, data) {
      // octfs writes Uint8Array (binary-safe); decode back to string for
      // the textual scripts the tests assert on.
      state.writes[path] = typeof data === 'string'
        ? data
        : new TextDecoder().decode(data);
    },
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
  TextEncoder,
  TextDecoder,
  URL,
  Blob,
  Map,
  Uint8Array,
};
context.window.__oo = null;

// Run the app modules in real order into the shared context.
for (const name of MODULES) {
  const src = readFileSync(new URL('../app/' + name + '.js', import.meta.url), 'utf8');
  vm.runInNewContext(src, context, { filename: 'app/' + name + '.js' });
}

let failures = 0;
function check(name, ok, detail) {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}: ${detail}`);
  if (!ok) failures = 1;
}

const oo = windowObj.__oo;
const output = elements.output;
const editor = elements.editor;
const filename = elements.filename;
const runBtn = elements.runBtn;

check('app modules load & __oo exposed', !!oo, typeof oo);
check('app boots & is ready (initOctave ran)', oo && oo.ready === true, `ready=${oo && oo.ready}`);

check('__oo.runFile exposed', typeof oo.runFile === 'function', typeof oo.runFile);

{
  const before = output.textContent.length;
  oo.runFile('printf("unit-ok\\n");');
  const out = output.textContent.slice(before);
  check('runFile writes user-FS script.m and evaluates',
    state.writes['/home/user/script.m'] === 'printf("unit-ok\\n");' && out.indexOf('>> run script.m') !== -1 && !oo.lastError,
    `wrote=${JSON.stringify(state.writes['/home/user/script.m'])} lastError=${oo.lastError || '(none)'}`);
}

{
  // Regression: a DOM click passes an Event (non-string) to the listener.
  editor.value = 'printf("click-ok\\n");\n';
  runBtn.click();
  check('run button click writes editor contents (Event bug guard)',
    state.writes['/home/user/script.m'] === editor.value && !oo.lastError,
    `wrote=${JSON.stringify(state.writes['/home/user/script.m'])} lastError=${oo.lastError || '(none)'}`);
}

{
  editor.value = '';
  oo.runFile(123); // non-string falls back to the editor text
  check('non-string runFile arg falls back to editor text',
    Object.prototype.hasOwnProperty.call(state.writes, '/home/user/script.m') && typeof state.writes['/home/user/script.m'] === 'string',
    `wrote=${JSON.stringify(state.writes['/home/user/script.m'])}`);
}

{
  const before = output.textContent.length;
  filename.value = 'bad name!';
  oo.runFile('x=1;');
  filename.value = 'script.m';
  const out = output.textContent.slice(before);
  check('invalid file name rejected',
    out.indexOf('Invalid file name') !== -1 && !state.writes['/home/user/bad name!'],
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

// FS round-trip: putFile persisted the editor scripts to the store (via the
// module chain's octfs + fsStore), and the store lists them back.
{
  const ooApp = windowObj.ooApp;
  check('ooApp + fsStore wired', ooApp && ooApp.fsStore && typeof ooApp.fsStore.list === 'function', ooApp ? 'attached' : 'missing');
  await ooApp.fsStore.list().then(function (items) {
    const paths = items.map(function (i) { return i.path; });
    check('runFile scripts persisted to the store', paths.indexOf('script.m') !== -1,
      'stored: ' + paths.join(', '));
  });
}

console.log(failures ? '\nUI unit tests: FAILED' : '\nUI unit tests: all passed');
process.exit(failures);
