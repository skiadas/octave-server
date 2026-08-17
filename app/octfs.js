/* app/octfs.js — bridge between ooApp.fsStore (IndexedDB) and Octave's
   Emscripten MEMFS. The user's whole tree lives under ooApp.userPath
   (default /home/user). Store paths are RELATIVE to that root ("" = root,
   "dir/file.m"); every op is applied to the store AND live to MEMFS so Octave
   sees files immediately (load/run/csvread/imread).

   Exposed as ooApp.octfs. Needs ooApp.Module to be set (main.js wires it).

   MEMFS notes: it is writable and volatile (wiped each page load), which is
   why we persist in IDB and replay here on boot. writeFile must be binary-safe
   (encoding:'binary') so uploaded images survive for imread. */

(function () {
  'use strict';

  var ooApp = window.ooApp;
  var store = ooApp.fsStore;

  function FS() { return ooApp.Module.FS; }

  /* mempath(rel) -> full MEMFS path under the user root. */
  function mempath(rel) {
    var base = ooApp.userPath.replace(/\/+$/, '');
    if (!rel) return base;
    return base + '/' + String(rel).replace(/^\/+/, '');
  }
  function memdir(rel) {
    var p = mempath(rel);
    var i = p.lastIndexOf('/');
    return i <= 0 ? '/' : p.slice(0, i);
  }

  /* Create every directory component between userPath and the given FULL MEMFS
     path (used by writeFile: creates the file's parent dirs, NOT the file). */
  function ensureParents(full) {
    var fs = FS();
    if (typeof fs.mkdir !== 'function') return; // non-browser harness: no real MEMFS
    var rel = full.slice(mempath('').length).replace(/^\/+/, '');
    var parts = rel ? rel.split('/') : [];
    parts.pop();
    var cur = mempath('');
    for (var i = 0; i < parts.length; i++) {
      cur = cur + '/' + parts[i];
      try {
        fs.mkdir(cur);
      } catch (e) {
        if (!/exist/i.test(e && e.message ? e.message : String(e))) throw e;
      }
    }
  }

  /* Everything on disk (store + MEMFS) is a Uint8Array; text callers pass plain
     strings and we encode here. */
  function normalize(data) {
    if (data instanceof Uint8Array) return data;
    if (typeof data === 'string') return new TextEncoder().encode(data);
    if (data && data.buffer instanceof ArrayBuffer) return new Uint8Array(data);
    return new Uint8Array();
  }

  /* Ensure the user root dir exists in MEMFS (idempotent). Called before any
     write so a file can land before hydration finishes. */
  function ensureRoot() {
    var fs = FS();
    if (typeof fs.mkdir !== 'function') return;
    try { fs.mkdir(mempath('')); } catch (e) { /* exists */ }
  }

  /* ---- write a file entry to MEMFS (creating parents). Sync; binary-safe. */
  function writeFile(rel, entry) {
    var full = mempath(rel);
    var fs = FS();
    ensureRoot();
    ensureParents(full);
    var bytes = normalize((entry && entry.bytes) || new Uint8Array());
    try { fs.unlink(full); } catch (e) { /* not present yet */ }
    fs.writeFile(full, bytes, { encoding: 'binary' });
  }

  function mkdir(rel) {
    var full = mempath(rel);
    ensureRoot();
    ensureParents(full);
    try { FS().mkdir(full); } catch (e) { /* exists */ }
  }

  function remove(rel) {
    var full = mempath(rel);
    var fs = FS();
    var st;
    try { st = fs.stat(full); } catch (e) { return; } // already gone
    if (st && fs.isDir(st.mode)) removeDirRec(full);
    else { try { fs.unlink(full); } catch (e) { /* ignore */ } }
  }

  function removeDirRec(full) {
    var fs = FS();
    var names;
    try { names = fs.readdir(full); } catch (e) { return; }
    names.forEach(function (n) {
      if (n === '.' || n === '..') return;
      var child = full + '/' + n;
      var st = fs.stat(child);
      if (st && fs.isDir(st.mode)) removeDirRec(child);
      else { try { fs.unlink(child); } catch (e) { /* ignore */ } }
    });
    try { fs.rmdir(full); } catch (e) { /* ignore */ }
  }

  function exists(rel) {
    try { FS().stat(mempath(rel)); return true; } catch (e) { return false; }
  }

  /* Replay the whole store into MEMFS + point Octave's cwd at it, then tell
     the UI the filesystem is ready. Called once at boot (by main.js). */
  function hydrate() {
    return store.list().then(function (items) {
      try {
        var fs = FS();
        // Ensure the user root exists.
        try { fs.mkdir(mempath('')); } catch (e) { /* exists */ }
        // Create all directories first (files may be listed before their dir).
        var dirs = [], files = [];
        items.forEach(function (i) {
          if (i.entry.kind === 'dir') dirs.push(i.path);
          else files.push(i);
        });
        dirs.forEach(function (rel) { try { mkdir(rel); } catch (e) { /* exists */ } });
        files.forEach(function (i) { try { writeFile(i.path, i.entry); } catch (e) { /* skip */ } });
        // cd + addpath so relative load/run/source/csvread resolve here.
        try { ooApp.Module.eval_string('cd("' + mempath('') + '");'); } catch (e) { /* no-op */ }
        try { ooApp.Module.eval_string('addpath("' + mempath('') + '");'); } catch (e) { /* no-op */ }
      } catch (e) { /* FS surface missing (non-browser harness) — memory-only */ }
      ooApp.emit('fs:hydrated');
      return items.length;
    });
  }

  /* ---- Live op helpers — apply to store AND MEMFS ---- */
  /* MEMFS write is synchronous (so callers/Octave see it immediately); the
     IndexedDB persist is async and returned as the promise. */
  function putFile(rel, bytes) {
    var u8 = normalize(bytes);
    writeFile(rel, { kind: 'file', bytes: u8, ts: Date.now() });
    return store.putFile(rel, u8).then(function () { ooApp.emit('fs:change'); });
  }
  function putFileFromEntry(rel, entry) {
    return putFile(rel, normalize((entry && entry.bytes) || new Uint8Array()));
  }
  function mkdirBoth(rel) {
    return store.mkdir(rel).then(function () {
      try { mkdir(rel); } catch (e) { /* exists */ }
      ooApp.emit('fs:change');
    });
  }
  function rename(rel, newRel) {
    var oldFull = mempath(rel), newFull = mempath(newRel);
    var fs = FS();
    return store.list().then(function (items) {
      var prefix = rel === '' ? '/' : rel + '/';
      var affected = items.filter(function (i) { return i.path === rel || i.path.indexOf(prefix) === 0; });
      if (!affected.length) return Promise.resolve();
      var writes = affected.map(function (i) {
        var suffix = i.path === rel ? '' : i.path.slice(rel.length); // '' or "/child..."
        var newPath = newRel + suffix;
        if (i.entry.kind === 'dir') return store.mkdir(newPath);
        return store.putFile(newPath, i.entry.bytes);
      });
      return Promise.all(writes).then(function () {
        return store.rm(rel);
      }).then(function () {
        ensureDirs(newFull);
        if (exists(rel)) { try { fs.rename(oldFull, newFull); } catch (e) { /* ignore */ } }
        else {
          // Source vanished from MEMFS (not hydrated this session yet); recreate
          // the whole renamed subtree from the fresh store so Octave sees it.
          affected.forEach(function (i) {
            var suffix = i.path === rel ? '' : i.path.slice(rel.length);
            var newPath = newRel + suffix;
            if (i.entry.kind === 'dir') { try { mkdir(newPath); } catch (e) { /* ignore */ } }
            else writeFile(newPath, i.entry);
          });
        }
        ooApp.emit('fs:change');
      });
    });
  }
  function removeBoth(rel) {
    return store.rm(rel).then(function () {
      remove(rel);
      ooApp.emit('fs:change');
    });
  }

  ooApp.octfs = {
    userPath: mempath(''),
    mempath: mempath,
    hydrate: hydrate,
    writeFile: writeFile,
    putFile: putFile,
    putFileFromEntry: putFileFromEntry,
    mkdir: mkdir,
    mkdirBoth: mkdirBoth,
    rename: rename,
    remove: remove,
    removeBoth: removeBoth,
    exists: exists
  };
})();
