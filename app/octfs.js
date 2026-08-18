/* app/octfs.js — bridge between fsStore (IndexedDB) and Octave's Emscripten
   MEMFS. The user's whole tree lives under userPath (default /home/user).
   Store paths are RELATIVE to that root ("" = root, "dir/file.m"); every op
   is applied to the store AND live to MEMFS so Octave sees files immediately
   (load/run/csvread/imread).

   Exposed as `octfs`. Needs `Module` from runtime.js to be set (main.js wires
   it).

   MEMFS notes: it is writable and volatile (wiped each page load), which is
   why we persist in IDB and replay here on boot. writeFile must be binary-safe
   (encoding:'binary') so uploaded images survive for imread. */

import { fsStore } from './fsstore.js';
import { Module, userPath } from './runtime.js';
import { emit } from './util.js';

function FS() { return Module.FS; }

/* mkdir unless it already exists (Emscripten's mkdir error for an existing
   dir surfaces as a generic "FS error", so we guard with analyzePath instead
   of matching error text). Throws only on real failures. */
function createDir(fs, full) {
  if (typeof fs.mkdir !== 'function') return;
  if (fs.analyzePath && fs.analyzePath(full).exists) return;
  try { fs.mkdir(full); } catch (e) {
    try { if (fs.analyzePath && fs.analyzePath(full).exists) return; } catch (e2) { /* fall through */ }
    throw e;
  }
}

/* mempath(rel) -> full MEMFS path under the user root. */
function mempath(rel) {
  const base = userPath.replace(/\/+$/, '');
  if (!rel) return base;
  return base + '/' + String(rel).replace(/^\/+/, '');
}
function memdir(rel) {
  const p = mempath(rel);
  const i = p.lastIndexOf('/');
  return i <= 0 ? '/' : p.slice(0, i);
}

/* Create every directory component between userPath and the given FULL MEMFS
   path (used by writeFile: creates the file's parent dirs, NOT the file). */
function ensureParents(full) {
  const fs = FS();
  if (typeof fs.mkdir !== 'function') return; // non-browser harness: no real MEMFS
  const rel = full.slice(mempath('').length).replace(/^\/+/, '');
  const parts = rel ? rel.split('/') : [];
  parts.pop();
  let cur = mempath('');
  for (let i = 0; i < parts.length; i++) {
    cur = cur + '/' + parts[i];
    createDir(fs, cur);
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
  const fs = FS();
  if (typeof fs.mkdir !== 'function') return;
  try { fs.mkdir(mempath('')); } catch (e) { /* exists */ }
}

/* ---- write a file entry to MEMFS (creating parents). Sync; binary-safe. */
function writeFile(rel, entry) {
  const full = mempath(rel);
  const fs = FS();
  ensureRoot();
  ensureParents(full);
  const bytes = normalize((entry && entry.bytes) || new Uint8Array());
  try { fs.unlink(full); } catch (e) { /* not present yet */ }
  fs.writeFile(full, bytes, { encoding: 'binary' });
}

function mkdir(rel) {
  const full = mempath(rel);
  const fs = FS();
  ensureRoot();
  ensureParents(full);
  createDir(fs, full);
}

function remove(rel) {
  const full = mempath(rel);
  const fs = FS();
  let st;
  try { st = fs.stat(full); } catch (e) { return; } // already gone
  if (st && fs.isDir(st.mode)) removeDirRec(full);
  else { try { fs.unlink(full); } catch (e) { /* ignore */ } }
}

function removeDirRec(full) {
  const fs = FS();
  let names;
  try { names = fs.readdir(full); } catch (e) { return; }
  names.forEach((n) => {
    if (n === '.' || n === '..') return;
    const child = full + '/' + n;
    const st = fs.stat(child);
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
  return fsStore.list().then((items) => {
    try {
      const fs = FS();
      // Ensure the user root exists.
      try { fs.mkdir(mempath('')); } catch (e) { /* exists */ }
      // Create all directories first (files may be listed before their dir).
      const dirs = [], files = [];
      items.forEach((i) => {
        if (i.entry.kind === 'dir') dirs.push(i.path);
        else files.push(i);
      });
      dirs.forEach((rel) => { try { mkdir(rel); } catch (e) { /* exists */ } });
      files.forEach((i) => { try { writeFile(i.path, i.entry); } catch (e) { /* skip */ } });
      // cd + addpath so relative load/run/source/csvread resolve here.
      try { Module.eval_string('cd("' + mempath('') + '");'); } catch (e) { /* no-op */ }
      try { Module.eval_string('addpath("' + mempath('') + '");'); } catch (e) { /* no-op */ }
    } catch (e) { /* FS surface missing (non-browser harness) — memory-only */ }
    emit('fs:hydrated');
    return items.length;
  });
}

/* ---- Live op helpers — apply to store AND MEMFS ---- */
/* MEMFS write is synchronous (so callers/Octave see it immediately); the
   IndexedDB persist is async and returned as the promise. */
function putFile(rel, bytes) {
  const u8 = normalize(bytes);
  writeFile(rel, { kind: 'file', bytes: u8, ts: Date.now() });
  return fsStore.putFile(rel, u8).then(() => emit('fs:change'));
}
function putFileFromEntry(rel, entry) {
  return putFile(rel, normalize((entry && entry.bytes) || new Uint8Array()));
}
function mkdirBoth(rel) {
  return fsStore.mkdir(rel).then(() => {
    try { mkdir(rel); } catch (e) { /* exists */ }
    emit('fs:change');
  });
}
function rename(rel, newRel) {
  const oldFull = mempath(rel), newFull = mempath(newRel);
  const fs = FS();
  return fsStore.list().then((items) => {
    const prefix = rel === '' ? '/' : rel + '/';
    const affected = items.filter((i) => i.path === rel || i.path.indexOf(prefix) === 0);
    if (!affected.length) return Promise.resolve();
    const writes = affected.map((i) => {
      const suffix = i.path === rel ? '' : i.path.slice(rel.length); // '' or "/child..."
      const newPath = newRel + suffix;
      if (i.entry.kind === 'dir') return fsStore.mkdir(newPath);
      return fsStore.putFile(newPath, i.entry.bytes);
    });
    return Promise.all(writes).then(() => {
      return fsStore.rm(rel);
    }).then(() => {
      ensureDirs(newFull);
      if (exists(rel)) { try { fs.rename(oldFull, newFull); } catch (e) { /* ignore */ } }
      else {
        // Source vanished from MEMFS (not hydrated this session yet); recreate
        // the whole renamed subtree from the fresh store so Octave sees it.
        affected.forEach((i) => {
          const suffix = i.path === rel ? '' : i.path.slice(rel.length);
          const newPath = newRel + suffix;
          if (i.entry.kind === 'dir') { try { mkdir(newPath); } catch (e) { /* ignore */ } }
          else writeFile(newPath, i.entry);
        });
      }
      emit('fs:change');
    });
  });
}
function removeBoth(rel) {
  return fsStore.rm(rel).then(() => {
    remove(rel);
    emit('fs:change');
  });
}

export const octfs = {
  userPath: mempath(''),
  mempath,
  hydrate,
  writeFile,
  putFile,
  putFileFromEntry,
  mkdir,
  mkdirBoth,
  rename,
  remove,
  removeBoth,
  exists
};
