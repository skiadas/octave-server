/* app/gallery.js — plot history. main.js emits "plot:saved" with the SVG each
   time a figure is rendered; this module keeps a session list of thumbnails in
   a separate #galleryPane element. (IMPORTANT: it never writes into #plotPane;
   that element holds only the single current SVG, which the test harness's
   plotSVGCount() relies on.)

   Each entry: click to view in the main plot pane, download as SVG or PNG
   (SVG rendered to canvas), and remove individually; a Clear-all button wipes
   the session history. Gallery is session-scoped (not persisted to IDB) for
   now.

   Exposed as ooApp.gallery. */
(function () {
  'use strict';

  var ooApp = window.ooApp;
  var entries = [];   // { id, svg, name, ts }
  var nextId = 1;
  var pane = null;    // lazily resolved #galleryPane (container)
  var list = null;    // lazily resolved #galleryList (thumbnails live here)
  var plotPane = null;

  function el(id) { return document.getElementById(id); }
  function listEl() { return list || (list = el('galleryList')); }
  function plotEl() { return plotPane || (plotPane = el('plotPane')); }

  function fmtTime(ts) {
    var d = new Date(ts);
    function p(n) { return n < 10 ? '0' + n : String(n); }
    return p(d.getHours()) + ':' + p(d.getMinutes()) + ':' + p(d.getSeconds());
  }

  /* Download an SVG string as a file. */
  function downloadSvg(svg, name) {
    var blob = new Blob([svg], { type: 'image/svg+xml' });
    downloadBlob(blob, (name || 'plot') + '.svg');
  }

  function downloadBlob(blob, filename) {
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
  }

  /* Rasterize an SVG string to a PNG Blob in a fixed box (bounded by 1400px
     so line-heavy plots stay crisp). */
  function svgToPng(svg) {
    return new Promise(function (resolve, reject) {
      var box = 1400;
      var svgEl = document.createElement('div');
      svgEl.style.display = 'none';
      svgEl.innerHTML = svg;
      var svgNode = svgEl.querySelector('svg');
      if (!svgNode) { resolve(null); return; }
      var doc = new XMLSerializer().serializeToString(svgNode);
      var img = new Image();
      var url = URL.createObjectURL(new Blob([doc], { type: 'image/svg+xml' }));
      img.onload = function () {
        try {
          var canvas = document.createElement('canvas');
          var scale = Math.min(1, box / Math.max(img.width || box, 1));
          canvas.width = Math.max(1, Math.round((img.width || box) * scale));
          canvas.height = Math.max(1, Math.round((img.height || box) * scale));
          var ctx = canvas.getContext('2d');
          ctx.fillStyle = '#ffffff';
          ctx.fillRect(0, 0, canvas.width, canvas.height);
          ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
          canvas.toBlob(function (blob) {
            URL.revokeObjectURL(url);
            resolve(blob);
          }, 'image/png');
        } catch (e) { URL.revokeObjectURL(url); reject(e); }
      };
      img.onerror = function () { URL.revokeObjectURL(url); reject(new Error('svg decode failed')); };
      img.src = url;
    });
  }

  function view(entry) {
    plotEl().innerHTML = entry.svg;
    ooApp.emit('plot:view', entry);
  }

  function entryNode(entry) {
    var wrap = document.createElement('div');
    wrap.className = 'gal-item';

    var thumb = document.createElement('div');
    thumb.className = 'gal-thumb';
    thumb.innerHTML = entry.svg;

    var meta = document.createElement('div');
    meta.className = 'gal-meta';
    meta.textContent = entry.name + '  ' + fmtTime(entry.ts);

    var tools = document.createElement('div');
    tools.className = 'gal-tools';
    tools.appendChild(btn('svg', function () { downloadSvg(entry.svg, entry.name); }));
    tools.appendChild(btn('png', function () {
      svgToPng(entry.svg).then(function (blob) {
        if (blob) downloadBlob(blob, entry.name + '.png');
      });
    }));
    tools.appendChild(btn('×', function () { remove(entry.id); }));

    thumb.addEventListener('click', function () { view(entry); });
    wrap.appendChild(thumb);
    wrap.appendChild(meta);
    wrap.appendChild(tools);
    return wrap;
  }

  function btn(label, fn) {
    var b = document.createElement('button');
    b.type = 'button';
    b.className = 'gal-btn';
    b.textContent = label;
    b.addEventListener('click', fn);
    return b;
  }

  function render() {
    var root = listEl();
    if (!root) return;
    root.innerHTML = '';
    entries.forEach(function (e) { root.appendChild(entryNode(e)); });
    var empty = document.getElementById('galleryEmpty');
    if (empty) empty.style.display = entries.length ? 'none' : 'block';
  }

  function add(svg, name) {
    var e = { id: nextId++, svg: svg, name: name || 'plot', ts: Date.now() };
    entries.push(e);
    render();
    return e;
  }

  function remove(id) {
    entries = entries.filter(function (e) { return e.id !== id; });
    render();
  }

  function clear() {
    entries = [];
    render();
  }

  /* Wire the static "clear" button in the gallery toolbar. Safe even if the
     element is absent (unit harness returns null for unstubbed ids). */
  function init() {
    var clearBtn = document.getElementById('galleryClearBtn');
    if (clearBtn) clearBtn.addEventListener('click', clear);
  }

  ooApp.gallery = {
    add: add,
    remove: remove,
    clear: clear,
    view: view,
    count: function () { return entries.length; }
  };
  init();
})();
