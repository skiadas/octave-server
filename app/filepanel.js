/* app/filepanel.js — the left file tree. Renders the user's tree from
   fsStore (relative paths under userPath) as a collapsible nested list, and
   wires: new folder / new file (inside the current target folder), upload
   (picker + drag/drop, also per-folder), download, rename, delete, and
   click-to-preview (images via blob URL, text/.m as source).

   A folder is "selected" by clicking its name; the bar shows the current
   target (⟶ <folder>/) and the bar buttons (new folder, new file, upload)
   act inside it. Folder rows get their own hover actions (+file, +dir, up)
   and a drop target too. Every mutation goes through octfs so the store and
   Octave's MEMFS stay in sync; it re-renders on the "fs:change" event.
   Exposed as `filepanel`. */

import { fsStore } from './fsstore.js';
import { octfs } from './octfs.js';
import { el, downloadBlob, on } from './util.js';
import { getAppend } from './runtime.js';

let panel = null;       // #filesPane
let fileInput = null;   // hidden <input type=file>
let selected = '';      // target folder (relative path; '' = root)
const collapsed = new Set(); // expanded-state kept across re-renders

function byId(id) { return document.getElementById(id); }
function panelEl() { return panel || (panel = byId('filesPane')); }

const IMG_EXT = /\.(png|jpe?g|gif|bmp|webp|svg)$/i;
const TXT_EXT = /\.(m|txt|md|oct|log|dat|csv|tsv|json|yaml|yml)$/i;

function mimeFor(name) {
  if (/\.png$/i.test(name)) return 'image/png';
  if (/\.jpe?g$/i.test(name)) return 'image/jpeg';
  if (/\.gif$/i.test(name)) return 'image/gif';
  if (/\.webp$/i.test(name)) return 'image/webp';
  if (/\.svg$/i.test(name)) return 'image/svg+xml';
  if (/\.bmp$/i.test(name)) return 'image/bmp';
  if (/\.txt$|\.m$|\.csv$|\.tsv$|\.log$|\.dat$|\.json$/i.test(name)) return 'text/plain';
  return 'application/octet-stream';
}

/* Relative path join: dir + '/' + leaf when a folder is targeted. */
function joinPath(dir, name) {
  return dir ? dir + '/' + name : name;
}

/* A leaf name (no slashes — nesting is done by selecting a folder). */
function validLeaf(name) {
  if (!name || name !== name.trim()) return false;
  if (name === '.' || name === '..' || name === '') return false;
  if (/[\x00-\x1f]/.test(name)) return false;
  if (name.indexOf('/') !== -1) return false;
  return true;
}

function report(fn, action) {
  fn().catch((e) => {
    const append = getAppend();
    if (append) append(action + ' failed: ' + (e && e.message ? e.message : e), 'err');
  });
}

/* ---- preview ---- */
function preview(fileEntry, name) {
  const view = byId('previewPane');
  if (!view) return;
  const img = byId('previewImg');
  const pre = byId('previewText');
  const label = byId('previewTitle');
  if (img) img.style.display = 'none';
  if (pre) pre.style.display = 'none';
  if (IMG_EXT.test(name)) {
    const blob = new Blob([fileEntry.bytes], { type: mimeFor(name) });
    const url = URL.createObjectURL(blob);
    if (img) { img.src = url; img.style.display = 'block'; }
    if (label) label.textContent = name + ' (image)';
  } else if (TXT_EXT.test(name)) {
    const text = new TextDecoder('utf-8').decode(fileEntry.bytes || new Uint8Array());
    if (pre) { pre.textContent = text; pre.style.display = 'block'; }
    if (label) label.textContent = name + ' (text/' + (fileEntry.bytes ? fileEntry.bytes.length : 0) + ' B)';
  } else {
    if (label) label.textContent = name + ' (binary — use Download to view)';
    if (pre) { pre.textContent = ''; pre.style.display = 'block'; }
  }
  view.style.display = 'block';
  const close = byId('previewClose');
  if (close) close.style.display = 'inline';
}

function closePreview() {
  const view = byId('previewPane');
  if (view) view.style.display = 'none';
  const close = byId('previewClose');
  if (close) close.style.display = 'none';
  const img = byId('previewImg');
  if (img) img.removeAttribute('src');
}

/* ---- download a file entry ---- */
function downloadFile(entry, path) {
  const name = path.split('/').pop();
  const blob = new Blob([entry.bytes], { type: mimeFor(name) });
  downloadBlob(blob, name);
}

/* ---- rename ---- */
function renamePrompt(oldPath) {
  const name = oldPath.split('/').pop();
  const base = oldPath.slice(0, oldPath.length - name.length);
  const newName = window.prompt('Rename "' + name + '" to:', name);
  if (newName === null || newName === '' || newName === name) return;
  const newPath = base + newName;
  report(() => octfs.rename(oldPath, newPath), 'rename');
  // octfs emits "fs:change" -> render().
}

/* ---- delete ---- */
function deletePrompt(path, isDir) {
  if (!window.confirm('Delete ' + (isDir ? 'folder ' : 'file ') + path + '?')) return;
  report(() => octfs.removeBoth(path), 'delete');
}

/* ---- create file inside a folder, then open it in the editor ---- */
function newFileIn(dir) {
  const name = window.prompt('New file name:', 'script.m');
  if (!validLeaf(name)) return;
  const rel = joinPath(dir, name);
  report(() => octfs.putFile(rel, '').then(() => {
    openInEditor(rel);
  }), 'create file');
}

function openInEditor(rel) {
  const fn = byId('filename');
  const ed = byId('editor');
  if (fn) fn.value = rel;
  if (ed) { ed.value = ''; ed.focus(); }
}

function newFolderIn(dir) {
  const name = window.prompt('New folder name:', 'folder');
  if (!validLeaf(name)) return;
  report(() => octfs.mkdirBoth(joinPath(dir, name)).then(render), 'mkdir');
}

/* ---- upload (to the target dir; drag/drop + picker) ---- */
function handleFiles(files, dir) {
  let chain = Promise.resolve();
  Array.prototype.forEach.call(files, (file) => {
    chain = chain.then(() => {
      return new Promise((resolve, reject) => {
        const fr = new FileReader();
        fr.onload = () => {
          const bytes = new Uint8Array(fr.result);
          octfs.putFile(joinPath(dir, file.name), bytes).then(resolve).catch(reject);
        };
        fr.onerror = () => reject(fr.error);
        fr.readAsArrayBuffer(file);
      });
    });
  });
  chain.then(render).catch((e) => {
    const append = getAppend();
    if (append) append('upload failed: ' + (e && e.message ? e.message : e), 'err');
  });
}

function uploadTarget(dir) {
  if (fileInput) fileInput.click();
  fileInput._uploadDir = dir;
}

/* ---- build tree rows ---- */
function sortKey(name) { return name.toLowerCase(); }

function buildTree(items) {
  // items: [{path, entry}]. Build nested {name, entry, children[]}.
  const root = { name: '', entry: { kind: 'dir' }, children: [], path: '' };
  const map = { '': root };
  items.forEach((i) => {
    const segs = i.path.split('/').filter(Boolean);
    let cur = root;
    let acc = '';
    for (let idx = 0; idx < segs.length; idx++) {
      acc = acc ? acc + '/' + segs[idx] : segs[idx];
      if (!map[acc]) {
        const node = { name: segs[idx], entry: { kind: 'dir' }, children: [], path: acc };
        map[acc] = node;
        cur.children.push(node);
      }
      cur = map[acc];
    }
    cur.entry = i.entry;
    cur.path = i.path;
  });
  sortRec(root);
  return root;
}
function sortRec(node) {
  node.children.sort((a, b) => {
    const ad = a.entry && a.entry.kind === 'dir' ? 0 : 1;
    const bd = b.entry && b.entry.kind === 'dir' ? 0 : 1;
    if (ad !== bd) return ad - bd;
    return sortKey(a.name) < sortKey(b.name) ? -1 : 1;
  });
  node.children.forEach(sortRec);
}

function makeRow(node, depth) {
  const isDir = node.entry && node.entry.kind === 'dir';
  const isSel = isDir && node.path === selected;
  const row = el('div', {
    class: 'fs-row' + (isSel ? ' fs-selected' : ''),
    style: 'padding-left:' + (depth * 14) + 'px'
  });
  const glyph = document.createElement('span');
  glyph.className = 'fs-glyph';
  glyph.textContent = isDir ? (collapsed.has(node.path) ? '▸' : '▾') : '·';

  const nameEl = document.createElement('span');
  nameEl.className = 'fs-name' + (isDir ? ' fs-dir' : ' fs-file');
  nameEl.textContent = node.name || '/';
  nameEl.title = node.path;

  // Folder name click = select as the target; glyph click = collapse/expand.
  nameEl.addEventListener('click', () => {
    if (!isDir) return;
    selected = (selected === node.path) ? '' : node.path;
    render();
  });
  glyph.addEventListener('click', () => {
    if (!isDir) return;
    if (collapsed.has(node.path)) collapsed.delete(node.path);
    else collapsed.add(node.path);
    render();
  });

  const actionsEl = document.createElement('span');
  actionsEl.className = 'fs-actions';

  if (!isDir) {
    addAction(actionsEl, 'open', () => {
      fsStore.get(node.path).then((ent) => { if (ent) preview(ent, node.name); });
    });
    addAction(actionsEl, 'dl', () => {
      fsStore.get(node.path).then((ent) => { if (ent) downloadFile(ent, node.path); });
    });
  } else {
    addAction(actionsEl, '+file', () => newFileIn(node.path));
    addAction(actionsEl, '+dir', () => newFolderIn(node.path));
    addAction(actionsEl, 'up', () => uploadTarget(node.path));
    attachDrop(row, () => node.path);
  }
  addAction(actionsEl, 'ren', () => renamePrompt(node.path));
  addAction(actionsEl, 'del', () => deletePrompt(node.path, isDir));

  row.appendChild(glyph);
  row.appendChild(nameEl);
  row.appendChild(actionsEl);
  return row;
}

function addAction(parent, label, fn) {
  const b = document.createElement('button');
  b.type = 'button';
  b.className = 'fs-btn';
  b.title = label;
  b.setAttribute('aria-label', label);
  b.appendChild(icon(ACTION_ICONS[label] || 'file'));
  b.addEventListener('click', (ev) => { ev.stopPropagation(); fn(); });
  parent.appendChild(b);
}

/* Icons live as zero-dependency SVG <symbol> defs in index.html; this helper
   renders a <use> reference for one. */
const ACTION_ICONS = {
  open: 'eye', dl: 'download', '+file': 'file-plus', '+dir': 'folder-plus',
  up: 'upload', ren: 'pencil', del: 'trash', 'new folder': 'folder-plus',
  'new file': 'file-plus', upload: 'upload', refresh: 'refresh', root: 'root', updir: 'up',
};
function icon(name) {
  const s = document.createElement('span');
  s.className = 'fs-ic';
  s.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><use href="#ic-' + name + '"/></svg>';
  return s;
}

/* Breadcrumb target bar: "./" (root, clickable) › sub/ › … each segment jumps
   to that folder; an "up" button moves to the parent. */
function barTarget() {
  const span = el('span', { class: 'fs-target', title: 'active folder' });
  const segs = selected ? selected.split('/') : [];
  const root = el('button', { class: 'fs-crumb', type: 'button', title: 'Go to the top level' });
  root.appendChild(icon('root'));
  root.appendChild(document.createTextNode('./'));
  root.addEventListener('click', () => setSelected(''));
  span.appendChild(root);
  let acc = '';
  segs.forEach((seg) => {
    acc = acc ? acc + '/' + seg : seg;
    span.appendChild(el('span', { class: 'fs-crumb-sep', text: '›' }));
    const b = el('button', { class: 'fs-crumb', type: 'button', title: 'Go to ' + acc + '/' });
    b.appendChild(icon('folder'));
    b.appendChild(document.createTextNode(seg + '/'));
    b.addEventListener('click', () => setSelected(acc));
    span.appendChild(b);
  });
  return span;
}

function upBtn() {
  const b = el('button', { class: 'fs-btn fs-up', type: 'button', title: 'Up to parent folder' });
  b.appendChild(icon('updir'));
  b.disabled = !selected;
  b.addEventListener('click', () => {
    if (!selected) return;
    const i = selected.lastIndexOf('/');
    setSelected(i < 0 ? '' : selected.slice(0, i));
  });
  return b;
}

function btn(label, fn) {
  const b = document.createElement('button');
  b.type = 'button';
  b.className = 'fs-bar-btn';
  const ico = ACTION_ICONS[label];
  if (ico) b.appendChild(icon(ico));
  b.appendChild(document.createTextNode(label));
  b.addEventListener('click', fn);
  return b;
}

function render() {
  const rootEl = panelEl();
  if (!rootEl) return;
  fsStore.list().then((items) => {
    // If the selected folder vanished (rename/delete), drop back to root.
    if (selected && !items.some((i) => i.path === selected)) selected = '';
    const tree = buildTree(items);
    rootEl.replaceChildren();
    const bar = el('div', { class: 'fs-bar' },
      [barTarget(), upBtn(), btn('new folder', () => newFolderIn(selected)),
       btn('new file', () => newFileIn(selected)),
       btn('upload', () => uploadTarget(selected)),
       btn('refresh', () => render())]);
    rootEl.appendChild(bar);
    const body = el('div', { class: 'fs-body' });
    const rows = [];
    (function walk(node, depth) {
      node.children.forEach((c) => {
        rows.push(makeRow(c, depth));
        if (c.entry && c.entry.kind === 'dir' && !collapsed.has(c.path)) walk(c, depth + 1);
      });
    })(tree, 0);
    if (!rows.length) body.appendChild(el('div', { class: 'fs-empty', text: 'No files yet. Upload or create a folder.' }));
    rows.forEach((r) => body.appendChild(r));
    rootEl.appendChild(body);
  });
}

/* ---- drag and drop: target fn resolves the folder at drop time ---- */
function attachDrop(target, dirFn) {
  target.addEventListener('dragover', (ev) => { ev.preventDefault(); ev.dataTransfer.dropEffect = 'copy'; });
  target.addEventListener('drop', (ev) => {
    ev.preventDefault();
    if (ev.dataTransfer && ev.dataTransfer.files && ev.dataTransfer.files.length) {
      handleFiles(ev.dataTransfer.files, dirFn());
    }
  });
}

function setSelected(path) {
  selected = path || '';
  render();
}

function init() {
  fileInput = byId('fileInput');
  if (fileInput) {
    fileInput.addEventListener('change', () => {
      const dir = fileInput._uploadDir || selected;
      fileInput._uploadDir = undefined;
      if (fileInput.files && fileInput.files.length) handleFiles(fileInput.files, dir);
      fileInput.value = '';
    });
  }
  const closeBtn = byId('previewClose');
  if (closeBtn) closeBtn.addEventListener('click', closePreview);
  const dropZone = byId('filesPane');
  if (dropZone) attachDrop(dropZone, () => selected);
  on('fs:change', render);
  on('fs:hydrated', render);
  render(); // show the persisted tree immediately, before Octave has booted
}

export const filepanel = {
  render,
  setSelected,
  get selected() { return selected; }
};
init();