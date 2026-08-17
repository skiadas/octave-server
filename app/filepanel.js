/* app/filepanel.js — the left file tree. Renders the user's tree from
   ooApp.fsStore (relative paths under ooApp.userPath) as a collapsible nested
   list, and wires: new folder, upload (picker + drag/drop), download, rename,
   delete, and click-to-preview (images via blob URL, text/.m as source).

   Every mutation goes through ooApp.octfs so the store and Octave's MEMFS stay
   in sync; it re-renders on the ooApp "fs:change" event. Exposed as
   ooApp.filepanel. */
(function () {
  'use strict';

  var ooApp = window.ooApp;
  var store = ooApp.fsStore;
  var octfs = ooApp.octfs;

  var panel = null;       // #filesPane
  var fileInput = null;   // hidden <input type=file>
  var collapsed = new Set(); // expanded-state kept across re-renders

  function el(id) { return document.getElementById(id); }
  function panelEl() { return panel || (panel = el('filesPane')); }

  var IMG_EXT = /\.(png|jpe?g|gif|bmp|webp|svg)$/i;
  var TXT_EXT = /\.(m|txt|md|oct|log|dat|csv|tsv|json|yaml|yml)$/i;

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

  /* ---- preview ---- */
  function preview(fileEntry, name) {
    var view = el('previewPane');
    if (!view) return;
    var img = el('previewImg');
    var pre = el('previewText');
    var label = el('previewTitle');
    if (img) img.style.display = 'none';
    if (pre) pre.style.display = 'none';
    if (IMG_EXT.test(name)) {
      var blob = new Blob([fileEntry.bytes], { type: mimeFor(name) });
      var url = URL.createObjectURL(blob);
      if (img) { img.src = url; img.style.display = 'block'; }
      if (label) label.textContent = name + ' (image)';
    } else if (TXT_EXT.test(name)) {
      var text = new TextDecoder('utf-8').decode(fileEntry.bytes || new Uint8Array());
      if (pre) { pre.textContent = text; pre.style.display = 'block'; }
      if (label) label.textContent = name + ' (text/' + (fileEntry.bytes ? fileEntry.bytes.length : 0) + ' B)';
    } else {
      if (label) label.textContent = name + ' (binary — use Download to view)';
      if (pre) { pre.textContent = ''; pre.style.display = 'block'; }
    }
    view.style.display = 'block';
    var close = el('previewClose');
    if (close) close.style.display = 'inline';
  }

  function closePreview() {
    var view = el('previewPane');
    if (view) view.style.display = 'none';
    var close = el('previewClose');
    if (close) close.style.display = 'none';
    var img = el('previewImg');
    if (img) img.removeAttribute('src');
  }

  /* ---- download a file entry ---- */
  function downloadFile(entry, path) {
    var name = path.split('/').pop();
    var blob = new Blob([entry.bytes], { type: mimeFor(name) });
    ooApp.downloadBlob(blob, name);
  }

  /* ---- rename ---- */
  function renamePrompt(oldPath) {
    var name = oldPath.split('/').pop();
    var base = oldPath.slice(0, oldPath.length - name.length);
    var newName = window.prompt('Rename "' + name + '" to:', name);
    if (newName === null || newName === '' || newName === name) return;
    var newPath = base + newName;
    octfs.rename(oldPath, newPath).catch(function (e) {
      if (ooApp.append) ooApp.append('rename failed: ' + (e && e.message ? e.message : e), 'err');
    });
    // octfs emits "fs:change" -> render().
  }

  /* ---- delete ---- */
  function deletePrompt(path, isDir) {
    if (!window.confirm('Delete ' + (isDir ? 'folder ' : 'file ') + path + '?')) return;
    octfs.removeBoth(path).catch(function (e) {
      if (ooApp.append) ooApp.append('delete failed: ' + (e && e.message ? e.message : e), 'err');
    });
  }

  /* ---- upload (v1: files land at the user root; drag/drop + picker) ---- */
  function handleFiles(files) {
    var chain = Promise.resolve();
    Array.prototype.forEach.call(files, function (file) {
      chain = chain.then(function () {
        return new Promise(function (resolve, reject) {
          var fr = new FileReader();
          fr.onload = function () {
            var bytes = new Uint8Array(fr.result);
            octfs.putFile(file.name, bytes).then(resolve).catch(reject);
          };
          fr.onerror = function () { reject(fr.error); };
          fr.readAsArrayBuffer(file);
        });
      });
    });
    chain.then(render).catch(function (e) {
      if (ooApp.append) ooApp.append('upload failed: ' + (e && e.message ? e.message : e), 'err');
    });
  }

  /* ---- build tree rows ---- */
  function sortKey(name) { return name.toLowerCase(); }

  function buildTree(items) {
    // items: [{path, entry}]. Build nested {name, entry, children[]}.
    var root = { name: '', entry: { kind: 'dir' }, children: [], path: '' };
    var map = { '': root };
    items.forEach(function (i) {
      var segs = i.path.split('/').filter(Boolean);
      var cur = root;
      var acc = '';
      for (var idx = 0; idx < segs.length; idx++) {
        acc = acc ? acc + '/' + segs[idx] : segs[idx];
        if (!map[acc]) {
          var node = { name: segs[idx], entry: { kind: 'dir' }, children: [], path: acc };
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
    node.children.sort(function (a, b) {
      var ad = a.entry && a.entry.kind === 'dir' ? 0 : 1;
      var bd = b.entry && b.entry.kind === 'dir' ? 0 : 1;
      if (ad !== bd) return ad - bd;
      return sortKey(a.name) < sortKey(b.name) ? -1 : 1;
    });
    node.children.forEach(sortRec);
  }

  function makeRow(node, depth, collapsedSet) {
    var row = ooApp.el('div', { class: 'fs-row', style: 'padding-left:' + (depth * 14) + 'px' });
    var isDir = node.entry && node.entry.kind === 'dir';
    var glyph = document.createElement('span');
    glyph.className = 'fs-glyph';
    glyph.textContent = isDir ? (collapsedSet.has(node.path) ? '▸' : '▾') : '·';

    var nameEl = document.createElement('span');
    nameEl.className = 'fs-name' + (isDir ? ' fs-dir' : ' fs-file');
    nameEl.textContent = node.name || '/';
    nameEl.title = node.path;

    // Open a folder: collapse/expand. Open a file: preview.
    glyph.addEventListener('click', function () {
      if (!isDir) return;
      if (collapsedSet.has(node.path)) collapsedSet.delete(node.path);
      else collapsedSet.add(node.path);
      render();
    });

    var actionsEl = document.createElement('span');
    actionsEl.className = 'fs-actions';

    if (!isDir) {
      addAction(actionsEl, 'open', function () {
        store.get(node.path).then(function (ent) { if (ent) preview(ent, node.name); });
      });
      addAction(actionsEl, 'dl', function () {
        store.get(node.path).then(function (ent) { if (ent) downloadFile(ent, node.path); });
      });
    }
    addAction(actionsEl, 'ren', function () { renamePrompt(node.path); });
    addAction(actionsEl, 'del', function () { deletePrompt(node.path, isDir); });

    row.appendChild(glyph);
    row.appendChild(nameEl);
    row.appendChild(actionsEl);
    return row;
  }

  function addAction(parent, label, fn) {
    var b = document.createElement('button');
    b.type = 'button';
    b.className = 'fs-btn';
    b.textContent = label;
    b.title = label;
    b.addEventListener('click', function (ev) { ev.stopPropagation(); fn(); });
    parent.appendChild(b);
  }

  function render() {
    var rootEl = panelEl();
    if (!rootEl) return;
    store.list().then(function (items) {
      var tree = buildTree(items);
      rootEl.replaceChildren();
      var bar = ooApp.el('div', { class: 'fs-bar' },
        [btn('new folder', function () { newFolder(); }),
         btn('upload', function () { if (fileInput) fileInput.click(); }),
         btn('refresh', function () { render(); })]);
      rootEl.appendChild(bar);
      var body = ooApp.el('div', { class: 'fs-body' });
      if (!tree.children.length) body.appendChild(ooApp.el('div', { class: 'fs-empty', text: 'No files yet. Upload or create a folder.' }));
      tree.children.forEach(function (c) { body.appendChild(makeRow(c, 0, collapsed)); });
      rootEl.appendChild(body);
    });
  }

  function btn(label, fn) {
    var b = document.createElement('button');
    b.type = 'button';
    b.className = 'fs-bar-btn';
    b.textContent = label;
    b.addEventListener('click', fn);
    return b;
  }

  function newFolder() {
    var name = window.prompt('New folder name:', 'folder');
    if (!name || !/^[^/]+$/.test(name)) return;
    octfs.mkdirBoth(name).then(render).catch(function (e) {
      if (ooApp.append) ooApp.append('mkdir failed: ' + (e && e.message ? e.message : e), 'err');
    });
  }

  /* ---- drag and drop ---- */
  function attachDrop(target) {
    target.addEventListener('dragover', function (ev) { ev.preventDefault(); ev.dataTransfer.dropEffect = 'copy'; });
    target.addEventListener('drop', function (ev) {
      ev.preventDefault();
      if (ev.dataTransfer && ev.dataTransfer.files && ev.dataTransfer.files.length) {
        handleFiles(ev.dataTransfer.files);
      }
    });
  }

  function init() {
    fileInput = el('fileInput');
    if (fileInput) {
      fileInput.addEventListener('change', function () {
        if (fileInput.files && fileInput.files.length) handleFiles(fileInput.files);
        fileInput.value = '';
      });
    }
    var closeBtn = el('previewClose');
    if (closeBtn) closeBtn.addEventListener('click', closePreview);
    var dropZone = el('filesPane');
    if (dropZone) attachDrop(dropZone);
    ooApp.on('fs:change', render);
    ooApp.on('fs:hydrated', render);
  }

  ooApp.filepanel = { render: render };
  init();
})();
