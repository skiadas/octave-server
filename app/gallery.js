/* app/gallery.js — plot history. main.js emits "plot:saved" with the SVG each
   time a figure is rendered; this module keeps a session list of thumbnails in
   a separate #galleryPane element. (IMPORTANT: it never writes into #plotPane;
   that element holds only the single current SVG, which the test harness's
   plotSVGCount() relies on.)

   Each entry: click to view in the main plot pane, download as SVG or PNG
   (SVG rendered to canvas), and remove individually; a Clear-all button wipes
   the session history. Gallery is session-scoped (not persisted to IDB) for
   now.

   Exposed as `gallery`. */

import { emit, downloadBlob } from './util.js';

let entries = [];   // { id, svg, name, ts }
let nextId = 1;
let pane = null;    // lazily resolved #galleryPane (container)
let list = null;    // lazily resolved #galleryList (thumbnails live here)
let plotPane = null;

function el(id) { return document.getElementById(id); }
function listEl() { return list || (list = el('galleryList')); }
function plotEl() { return plotPane || (plotPane = el('plotPane')); }

function fmtTime(ts) {
  const d = new Date(ts);
  function p(n) { return n < 10 ? '0' + n : String(n); }
  return p(d.getHours()) + ':' + p(d.getMinutes()) + ':' + p(d.getSeconds());
}

/* Download an SVG string as a file. */
function downloadSvg(svg, name) {
  const blob = new Blob([svg], { type: 'image/svg+xml' });
  downloadBlob(blob, (name || 'plot') + '.svg');
}

/* Rasterize an SVG string to a PNG Blob in a fixed box (bounded by 1400px
   so line-heavy plots stay crisp). */
function svgToPng(svg) {
  return new Promise((resolve, reject) => {
    const box = 1400;
    const svgEl = document.createElement('div');
    svgEl.style.display = 'none';
    svgEl.innerHTML = svg;
    const svgNode = svgEl.querySelector('svg');
    if (!svgNode) { resolve(null); return; }
    const doc = new XMLSerializer().serializeToString(svgNode);
    const img = new Image();
    const url = URL.createObjectURL(new Blob([doc], { type: 'image/svg+xml' }));
    img.onload = () => {
      try {
        const canvas = document.createElement('canvas');
        const scale = Math.min(1, box / Math.max(img.width || box, 1));
        canvas.width = Math.max(1, Math.round((img.width || box) * scale));
        canvas.height = Math.max(1, Math.round((img.height || box) * scale));
        const ctx = canvas.getContext('2d');
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
        canvas.toBlob((blob) => {
          URL.revokeObjectURL(url);
          resolve(blob);
        }, 'image/png');
      } catch (e) { URL.revokeObjectURL(url); reject(e); }
    };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('svg decode failed')); };
    img.src = url;
  });
}

function view(entry) {
  plotEl().innerHTML = entry.svg;
  emit('plot:view', entry);
}

function entryNode(entry) {
  const wrap = document.createElement('div');
  wrap.className = 'gal-item';

  const thumb = document.createElement('div');
  thumb.className = 'gal-thumb';
  thumb.innerHTML = entry.svg;

  const meta = document.createElement('div');
  meta.className = 'gal-meta';
  meta.textContent = entry.name + '  ' + fmtTime(entry.ts);

  const tools = document.createElement('div');
  tools.className = 'gal-tools';
  tools.appendChild(btn('svg', () => downloadSvg(entry.svg, entry.name)));
  tools.appendChild(btn('png', () => {
    svgToPng(entry.svg).then((blob) => {
      if (blob) downloadBlob(blob, entry.name + '.png');
    });
  }));
  tools.appendChild(btn('×', () => remove(entry.id)));

  thumb.addEventListener('click', () => view(entry));
  wrap.appendChild(thumb);
  wrap.appendChild(meta);
  wrap.appendChild(tools);
  return wrap;
}

function btn(label, fn) {
  const b = document.createElement('button');
  b.type = 'button';
  b.className = 'gal-btn';
  b.textContent = label;
  b.addEventListener('click', fn);
  return b;
}

function render() {
  const root = listEl();
  if (!root) return;
  root.innerHTML = '';
  entries.forEach((e) => root.appendChild(entryNode(e)));
  const empty = document.getElementById('galleryEmpty');
  if (empty) empty.style.display = entries.length ? 'none' : 'block';
}

function add(svg, name) {
  const e = { id: nextId++, svg, name: name || 'plot', ts: Date.now() };
  entries.push(e);
  render();
  return e;
}

function remove(id) {
  entries = entries.filter((e) => e.id !== id);
  render();
}

function clear() {
  entries = [];
  render();
}

/* Wire the static "clear" button in the gallery toolbar. Safe even if the
   element is absent (unit harness returns null for unstubbed ids). */
function init() {
  const clearBtn = document.getElementById('galleryClearBtn');
  if (clearBtn) clearBtn.addEventListener('click', clear);
}

export const gallery = {
  add,
  remove,
  clear,
  view,
  count: () => entries.length
};
init();
