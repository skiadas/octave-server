/* app/util.js — shared foundation for the octave-server UI.
   Loaded first (before all other app modules). Creates the `window.ooApp`
   namespace that the other modules and main.js share: DOM helpers, string
   escaping, and a tiny pub/sub so modules can stay decoupled.

   Plain script (no modules/imports): the app is static with no build step. */
(function () {
  'use strict';

  var ooApp = {
    /* Settled by main.js as boot progresses. Modules read these lazily inside
       functions, never at load time, so load order does not matter. */
    Module: null,       // octave runtime (after OCTAVE() resolves)
    ready: false,       // octave booted + FS hydrated
    append: null,       // fn(text, cls) -> console
    userPath: '/home/user', // writable user dir inside MEMFS, mirrored to IDB

    _listeners: {},
    on: function (evt, fn) {
      (this._listeners[evt] = this._listeners[evt] || []).push(fn);
    },
    emit: function (evt, payload) {
      var list = this._listeners[evt] || [];
      for (var i = 0; i < list.length; i++) list[i](payload);
    }
  };

  ooApp.escapeHtml = function (s) {
    return String(s).replace(/[&<>"]/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c];
    });
  };

  /* Create an element with attributes, children, and text helper. Keeps the
     DOM-building in one place instead of fiddly innerHTML strings. */
  ooApp.el = function (tag, attrs, children) {
    var node = document.createElement(tag);
    if (attrs) {
      for (var k in attrs) {
        if (!Object.prototype.hasOwnProperty.call(attrs, k)) continue;
        var v = attrs[k];
        if (k === 'class') node.className = v;
        else if (k === 'text') node.textContent = v;
        else if (k === 'html') node.innerHTML = v;
        else if (k === 'style') node.style.cssText = v;
        else node.setAttribute(k, v);
      }
    }
    (children || []).forEach(function (c) {
      if (c !== null && c !== undefined) node.appendChild(c);
    });
    return node;
  };

  window.ooApp = ooApp;

  /* Shared Blob download helper (used by gallery + file panel). */
  function downloadBlob(blob, filename) {
    if (typeof URL !== 'undefined' && URL.createObjectURL) {
      var url = URL.createObjectURL(blob);
      var a = document.createElement('a');
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
    }
  }
  ooApp.downloadBlob = downloadBlob;
})();
