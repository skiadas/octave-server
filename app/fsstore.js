/* app/fsstore.js — persistence: user files stored in IndexedDB (per-browser,
   survives reloads), mirrored into Octave's MEMFS by octfs.js.
   Exposed as ooApp.fsStore. All methods return Promises. When IndexedDB is
   unavailable (some test harnesses / privacy modes) it transparently falls
   back to an in-memory map so the app still works for the session — that keeps
   the no-browser ui-unit harness green.

   Layout: one object store "files" keyed by full path string. Values are:
     { kind:'file', bytes: Uint8Array, ts: number }   (ts = mtime ms)
     { kind:'dir'                                    }
   Paths use "/" separators, start with "/", never end with "/" ("" is root). */
(function () {
  'use strict';

  var ooApp = window.ooApp;
  var DB_NAME = 'octave-server-fs';
  var DB_VERSION = 1;

  /* ---- in-memory fallback (no IndexedDB): same async API ---- */
  function makeFallback() {
    var map = new Map(); // path string -> entry {kind, bytes?, ts?}
    map.set('', { kind: 'dir' });
    return {
      list: function () {
        var out = [];
        map.forEach(function (v, k) {
          out.push({ path: k, entry: v });
        });
        return Promise.resolve(out);
      },
      get: function (path) { return Promise.resolve(map.get(path) || null); },
      putFile: function (path, bytes) {
        map.set(path, { kind: 'file', bytes: bytes, ts: Date.now() });
        return Promise.resolve();
      },
      mkdir: function (path) { map.set(path, { kind: 'dir' }); return Promise.resolve(); },
      rm: function (path) {
        var prefix = path === '' ? '/' : path + '/';
        var victims = [];
        map.forEach(function (v, k) {
          if (k === path || (path !== '' && k.indexOf(prefix) === 0)) victims.push(k);
        });
        victims.forEach(function (k) { map.delete(k); });
        return Promise.resolve(victims.length);
      }
    };
  }

  /* ---- IndexedDB-backed store ---- */
  function makeIdb() {
    var _dbp = null;
    function open() {
      if (!_dbp) {
        _dbp = new Promise(function (resolve, reject) {
          var req = indexedDB.open(DB_NAME, DB_VERSION);
          req.onupgradeneeded = function (ev) {
            var d = ev.target.result;
            if (!d.objectStoreNames.contains('files')) d.createObjectStore('files');
          };
          req.onsuccess = function () { resolve(req.result); };
          req.onerror = function () { reject(req.error); };
        });
      }
      return _dbp;
    }
    function tx(mode, fn) {
      return open().then(function (d) {
        return new Promise(function (resolve, reject) {
          var t = d.transaction('files', mode);
          var s = t.objectStore('files');
          fn(s);
          t.oncomplete = function () { resolve(); };
          t.onerror = function () { reject(t.error); };
          t.onabort = function () { reject(t.error || new Error('aborted')); };
        });
      });
    }
    function list() {
      return open().then(function (d) {
        return new Promise(function (resolve, reject) {
          var items = [];
          var req = d.transaction('files', 'readonly').objectStore('files').openCursor();
          req.onsuccess = function (ev) {
            var cur = ev.target.result;
            if (cur) { items.push({ path: cur.key, entry: cur.value }); cur.continue(); }
            else resolve(items);
          };
          req.onerror = function () { reject(req.error); };
        });
      });
    }
    return {
      list: list,
      get: function (path) {
        return open().then(function (d) {
          return new Promise(function (resolve, reject) {
            var req = d.transaction('files', 'readonly').objectStore('files').get(path);
            req.onsuccess = function () { resolve(req.result || null); };
            req.onerror = function () { reject(req.error); };
          });
        });
      },
      putFile: function (path, bytes) {
        return tx('readwrite', function (s) {
          s.put({ kind: 'file', bytes: bytes, ts: Date.now() }, path);
        });
      },
      mkdir: function (path) {
        return tx('readwrite', function (s) { s.put({ kind: 'dir' }, path); });
      },
      rm: function (path) {
        return list().then(function (items) {
          var prefix = path === '' ? '/' : path + '/';
          var victims = items
            .filter(function (i) { return i.path === path || (path !== '' && i.path.indexOf(prefix) === 0); })
            .map(function (i) { return i.path; });
          if (!victims.length) return 0;
          return tx('readwrite', function (s) {
            victims.forEach(function (k) { s.delete(k); });
          }).then(function () { return victims.length; });
        });
      }
    };
  }

  var impl = null;
  function store() {
    if (!impl) {
      impl = (typeof indexedDB !== 'undefined' && indexedDB.open) ? makeIdb() : makeFallback();
    }
    return impl;
  }

  ooApp.fsStore = {
    list: function () { return store().list(); },
    get: function (path) { return store().get(path); },
    putFile: function (path, bytes) { return store().putFile(path, bytes); },
    mkdir: function (path) { return store().mkdir(path); },
    rm: function (path) { return store().rm(path); }
  };
})();
