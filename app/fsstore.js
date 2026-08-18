/* app/fsstore.js — persistence: user files stored in IndexedDB (per-browser,
   survives reloads), mirrored into Octave's MEMFS by octfs.js.
   Exposed as `fsStore`. All methods return Promises. When IndexedDB is
   unavailable (some test harnesses / privacy modes) it transparently falls
   back to an in-memory map so the app still works for the session — that keeps
   the no-browser ui-unit harness green.

   Layout: one object store "files" keyed by full path string. Values are:
     { kind:'file', bytes: Uint8Array, ts: number }   (ts = mtime ms)
     { kind:'dir'                                    }
   Paths use "/" separators, start with "/", never end with "/" ("" is root). */

const DB_NAME = 'octave-server-fs';
const DB_VERSION = 1;

/* ---- in-memory fallback (no IndexedDB): same async API ---- */
function makeFallback() {
  const map = new Map(); // path string -> entry {kind, bytes?, ts?}
  map.set('', { kind: 'dir' });
  return {
    list() {
      const out = [];
      map.forEach((v, k) => out.push({ path: k, entry: v }));
      return Promise.resolve(out);
    },
    get(path) { return Promise.resolve(map.get(path) || null); },
    putFile(path, bytes) {
      map.set(path, { kind: 'file', bytes, ts: Date.now() });
      return Promise.resolve();
    },
    mkdir(path) { map.set(path, { kind: 'dir' }); return Promise.resolve(); },
    rm(path) {
      const prefix = path === '' ? '/' : path + '/';
      const victims = [];
      map.forEach((v, k) => {
        if (k === path || (path !== '' && k.indexOf(prefix) === 0)) victims.push(k);
      });
      victims.forEach((k) => map.delete(k));
      return Promise.resolve(victims.length);
    }
  };
}

/* ---- IndexedDB-backed store ---- */
function makeIdb() {
  let _dbp = null;
  function open() {
    if (!_dbp) {
      _dbp = new Promise((resolve, reject) => {
        const req = indexedDB.open(DB_NAME, DB_VERSION);
        req.onupgradeneeded = (ev) => {
          const d = ev.target.result;
          if (!d.objectStoreNames.contains('files')) d.createObjectStore('files');
        };
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
      });
    }
    return _dbp;
  }
  function tx(mode, fn) {
    return open().then((d) => {
      return new Promise((resolve, reject) => {
        const t = d.transaction('files', mode);
        const s = t.objectStore('files');
        fn(s);
        t.oncomplete = () => resolve();
        t.onerror = () => reject(t.error);
        t.onabort = () => reject(t.error || new Error('aborted'));
      });
    });
  }
  function list() {
    return open().then((d) => {
      return new Promise((resolve, reject) => {
        const items = [];
        const req = d.transaction('files', 'readonly').objectStore('files').openCursor();
        req.onsuccess = (ev) => {
          const cur = ev.target.result;
          if (cur) { items.push({ path: cur.key, entry: cur.value }); cur.continue(); }
          else resolve(items);
        };
        req.onerror = () => reject(req.error);
      });
    });
  }
  return {
    list,
    get(path) {
      return open().then((d) => {
        return new Promise((resolve, reject) => {
          const req = d.transaction('files', 'readonly').objectStore('files').get(path);
          req.onsuccess = () => resolve(req.result || null);
          req.onerror = () => reject(req.error);
        });
      });
    },
    putFile(path, bytes) {
      return tx('readwrite', (s) => {
        s.put({ kind: 'file', bytes, ts: Date.now() }, path);
      });
    },
    mkdir(path) {
      return tx('readwrite', (s) => { s.put({ kind: 'dir' }, path); });
    },
    rm(path) {
      return list().then((items) => {
        const prefix = path === '' ? '/' : path + '/';
        const victims = items
          .filter((i) => i.path === path || (path !== '' && i.path.indexOf(prefix) === 0))
          .map((i) => i.path);
        if (!victims.length) return 0;
        return tx('readwrite', (s) => {
          victims.forEach((k) => s.delete(k));
        }).then(() => victims.length);
      });
    }
  };
}

let impl = null;
function store() {
  if (!impl) {
    impl = (typeof indexedDB !== 'undefined' && indexedDB.open) ? makeIdb() : makeFallback();
  }
  return impl;
}

export const fsStore = {
  list: () => store().list(),
  get: (path) => store().get(path),
  putFile: (path, bytes) => store().putFile(path, bytes),
  mkdir: (path) => store().mkdir(path),
  rm: (path) => store().rm(path)
};
