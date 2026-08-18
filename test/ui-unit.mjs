/* UI unit tests (fast tier, <1s): drives the app's real ES modules with a
   stubbed Module/OCTAVE and a minimal fake DOM — no Chrome, no wasm, no
   gnuplot renders. Catches UI wiring regressions (e.g. the click-Event bug)
   without the integration battery.

   Uses the actual module graph: we stub the browser globals the modules
   expect (document, window, OCTAVE, createGnuplot, ...) on globalThis, then
   `await import('../app/main.js')` resolves the whole graph (util -> fsstore
   -> octfs -> gallery -> filepanel -> main) exactly as the esbuild bundle
   does. IndexedDB is absent in Node, so fsStore uses its in-memory fallback. */

// ---- fake DOM ----
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
    id, tagName: 'DIV', value: '', scrollTop: 0, scrollHeight: 0,
    style: {}, className: '', handlers: {}, children: [], attrs: {},
    title: '', type: 'button', src: '',
    addEventListener(type, fn) { this.handlers[type] = fn; },
    removeEventListener(type) { delete this.handlers[type]; },
    click() { if (this.handlers.click) this.handlers.click({ preventDefault() {}, stopPropagation() {}, target: this }); },
    appendChild(c) { this.children.push(c); return c; },
    replaceChildren(...cs) { this.children = cs; },
    removeChild(c) { const i = this.children.indexOf(c); if (i >= 0) this.children.splice(i, 1); },
    querySelector() { return null; },
    querySelectorAll() { return []; },
    setAttribute(k, v) { this.attrs[k] = String(v); },
    getAttribute(k) { return this.attrs[k]; },
    removeAttribute(k) { delete this.attrs[k]; },
    focus() {}, blur() {},
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

const ELEM_IDS = [
  'output', 'cmd', 'status', 'plotPane', 'editor', 'filename', 'runBtn',
  'filesPane', 'galleryPane', 'galleryList', 'galleryEmpty', 'galleryClearBtn',
  'previewPane', 'previewTitle', 'previewImg', 'previewText', 'previewClose',
  'fileInput',
];
const elements = {};
for (const id of ELEM_IDS) elements[id] = makeElement(id);

const document = {
  getElementById: (id) => elements[id] || null,
  createElement: (tag) => {
    const e = makeElement('');
    e.tagName = String(tag).toUpperCase();
    return e;
  },
  body: makeElement('body'),
};

// ---- stubbed wasm runtime ----
const state = {
  writes: {},   // MEMFS path -> last data written
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

// ---- browser globals the app modules reference ----
globalThis.window = globalThis;
globalThis.document = document;
globalThis.OCTAVE = OCTAVE;
globalThis.createGnuplot = () => Promise.resolve(() => Promise.resolve(''));
globalThis.fetch = () => Promise.resolve({ arrayBuffer: () => Promise.resolve(new ArrayBuffer(0)) });
globalThis.prompt = () => null;
globalThis.confirm = () => true;

// ---- load the real module graph (same as the esbuild bundle) ----
await import('../app/main.js');

const oo = globalThis.__oo;
const output = elements.output;
const editor = elements.editor;
const filename = elements.filename;
const runBtn = elements.runBtn;

let failures = 0;
function check(name, ok, detail) {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}: ${detail}`);
  if (!ok) failures = 1;
}

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
  const m = oo.module;
  check('__oo.module is the configured runtime', m && typeof m.eval_string === 'function', typeof m && m.eval_string ? 'attached' : 'missing');
}

// FS round-trip through the real module chain: putFile persisted the editor
// scripts to the store (via octfs + fsStore), and the store lists them back.
{
  const { fsStore } = await import('../app/fsstore.js');
  check('fsStore wired', fsStore && typeof fsStore.list === 'function', fsStore ? 'attached' : 'missing');
  const items = await fsStore.list();
  const paths = items.map((i) => i.path);
  check('runFile scripts persisted to the store', paths.indexOf('script.m') !== -1,
    'stored: ' + paths.join(', '));
}

// ---- Phase C: selected-folder model + create-in-folder via the real UI ----
{
  const { fsStore } = await import('../app/fsstore.js');
  const { filepanel } = await import('../app/filepanel.js');
  const { octfs } = await import('../app/octfs.js');
  const pane = elements.filesPane;
  const tick = (ms) => new Promise((r) => setTimeout(r, ms || 5));
  const barBtn = (label) => pane.children[0].children.find((c) => c.tagName === 'BUTTON' && c.textContent === label);
  const rowFor = (label) => pane.children[1].children.find((c) => c.children[1] && c.children[1].textContent === label);
  const storedPaths = async () => (await fsStore.list()).map((i) => i.path);

  check('bar target starts at root', pane.children[0].children[0].textContent === '⟶ /',
    pane.children[0].children[0].textContent);

  globalThis.prompt = () => 'sub';
  barBtn('new folder').click();
  await tick();
  let paths = await storedPaths();
  check('create folder at root via bar → "sub" in store', paths.indexOf('sub') !== -1,
    'stored: ' + paths.join(', '));

  rowFor('sub').children[1].click(); // folder name click selects it
  await tick();
  check('clicking folder name selects it',
    filepanel.selected === 'sub' && pane.children[0].children[0].textContent === '⟶ sub/',
    `selected=${filepanel.selected}, target=${pane.children[0].children[0].textContent}`);
  check('selected folder row marked .fs-selected',
    pane.children[1].children[0].className.indexOf('fs-selected') !== -1,
    pane.children[1].children[0].className);

  globalThis.prompt = () => 'x.m';
  barBtn('new file').click();
  await tick();
  paths = await storedPaths();
  check('new file created inside the selected folder',
    paths.indexOf('sub/x.m') !== -1, 'stored: ' + paths.join(', '));
  check('new file opens in the editor (path + focus)',
    filename.value === 'sub/x.m' && editor.value === '',
    `filename=${JSON.stringify(filename.value)}, editor=${JSON.stringify(editor.value)}`);

  globalThis.prompt = () => 'inner';
  barBtn('new folder').click();
  await tick();
  paths = await storedPaths();
  check('nested folder created inside sub', paths.indexOf('sub/inner') !== -1,
    'stored: ' + paths.join(', '));

  const fileRow = rowFor('x.m');
  check('nested rows rendered (file x.m visible under sub)',
    !!fileRow, fileRow ? fileRow.children[1].textContent : 'not found');
  const delBtn = fileRow.children[2].children.find((c) => c.textContent === 'del');
  globalThis.confirm = () => true;
  delBtn.click();
  await tick();
  paths = await storedPaths();
  check('hover delete removes nested file and re-renders',
    paths.indexOf('sub/x.m') === -1 && paths.indexOf('sub') !== -1,
    'stored: ' + paths.join(', '));

  const { filepanel: fp2 } = await import('../app/filepanel.js');
  fp2.setSelected('');
  await tick();
  check('setSelected("") resets target to root',
    fp2.selected === '' && pane.children[0].children[0].textContent === '⟶ /',
    `selected=${fp2.selected}, target=${pane.children[0].children[0].textContent}`);

  // Nested structure persists via the real store->octfs chain.
  await octfs.putFile('sub/inner/deep.m', 'deep=1;\n').then(async () => setImmediate && await tick());
  await tick();
  paths = await storedPaths();
  check('deeply nested file persists (sub/inner/deep.m)',
    paths.indexOf('sub/inner/deep.m') !== -1, 'stored: ' + paths.join(', '));
  check('octfs+fsStore agree on nested path (MEMFS write)',
    state.writes['/home/user/sub/inner/deep.m'] === 'deep=1;\n',
    `memfs=${JSON.stringify(state.writes['/home/user/sub/inner/deep.m'])}`);
}

console.log(failures ? '\nUI unit tests: FAILED' : '\nUI unit tests: all passed');
process.exit(failures);