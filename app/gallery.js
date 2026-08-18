/* app/gallery.js — plot history + viewer. main.js renders each figure to its
   own SVG (see /plot-fig-*.gp) and calls gallery.add; this module keeps a
   session list of figures grouped into "runs" (each script/console invocation
   that plots opens one run). The main plot pane is a ONE-SVG viewer: the most
   recently added figure, with ◀/▶ prev/next, an i/N counter, a title, and
   clickable thumbnails + keyboard ←/→ navigation. (IMPORTANT: it only ever
   writes one SVG into #plotPane at a time — that's what the test harness's
   plotSVGCount() relies on.)

   Each entry: click thumbnail to view, download as SVG or PNG (SVG rendered
   to canvas), and remove individually; a Clear-all button wipes the session
   history. Gallery is session-scoped (not persisted to IDB) for now.

   Exposed as `gallery`. */

import { emit, downloadBlob } from './util.js';

let entries = [];   // { id, run, fig, svg, name, ts } — in add order
let runs = [];      // { id, label, ts } — materialized lazily on first add
let runToken = 0;   // monotonic token handed out by beginRun()
let nextId = 1;
let currentIndex = -1;
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

/* Open a new run group. Returns a token to pass to add(); the run only
   materializes (gets a label) once the first figure lands in it, so empty
   console invocations never create blank groups. Labels stay contiguous
   because they're numbered from `runs.length` at materialization time. */
function beginRun() {
  return { id: ++runToken };
}

function runFor(token) {
  if (!token || !token.id) return null;
  let r = runs.find((x) => x.id === token.id);
  if (!r) {
    r = { id: token.id, label: 'Run ' + (runs.length + 1) + ' · ' + fmtTime(Date.now()), ts: Date.now() };
    runs.push(r);
  }
  return r;
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

/* ---- viewer ---- */
function updateViewerControls() {
  const counter = el('plotCounter');
  const title = el('plotTitle');
  const prev = el('plotPrevBtn');
  const next = el('plotNextBtn');
  const total = entries.length;
  if (counter) counter.textContent = (currentIndex >= 0 ? currentIndex + 1 : 0) + ' / ' + total;
  if (title) {
    const e = entries[currentIndex];
    title.textContent = e ? e.name : '';
    title.title = e ? 'Fig ' + e.fig : '';
  }
  if (prev) prev.disabled = currentIndex <= 0;
  if (next) next.disabled = currentIndex < 0 || currentIndex >= total - 1;
  // Mark the active thumbnail (and scroll it into view so the history stays
  // in sync with the viewer).
  const thumbs = (listEl() && listEl().querySelectorAll ? listEl().querySelectorAll('.gal-item') : []) || [];
  for (let i = 0; i < thumbs.length; i++) {
    thumbs[i].classList.toggle('gal-active', i === currentIndex);
    if (i === currentIndex && thumbs[i].scrollIntoView) thumbs[i].scrollIntoView({ block: 'nearest' });
  }
}

function view(index) {
  if (index < 0 || index >= entries.length) return;
  const e = entries[index];
  currentIndex = index;
  plotEl().innerHTML = e.svg;
  updateViewerControls();
  emit('plot:view', e);
}

function next() { view(currentIndex + 1); }
function prev() { view(currentIndex - 1); }

/* ---- gallery DOM ---- */
function entryNode(entry, index) {
  const wrap = document.createElement('div');
  wrap.className = 'gal-item' + (index === currentIndex ? ' gal-active' : '');

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

  thumb.addEventListener('click', () => view(index));
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

/* Render the list segmented by run: a small header per run group, entries in
   add order underneath. Entries without a run land in a final unlabeled set. */
function render() {
  const root = listEl();
  if (!root) return;
  root.innerHTML = '';
  const withRun = entries
    .map((e, i) => ({ e, i }))
    .filter((x) => x.e.run);
  const bare = entries
    .map((e, i) => ({ e, i }))
    .filter((x) => !x.e.run);
  const groups = [];
  for (const x of withRun) {
    const last = groups[groups.length - 1];
    if (last && last.run && last.run.id === x.e.run.id) last.items.push(x);
    else groups.push({ run: x.e.run, items: [x] });
  }
  for (const g of groups) {
    if (g.run && g.run.label) {
      const head = document.createElement('div');
      head.className = 'gal-run';
      head.textContent = g.run.label;
      root.appendChild(head);
    }
    for (const x of g.items) root.appendChild(entryNode(x.e, x.i));
  }
  for (const x of bare) root.appendChild(entryNode(x.e, x.i));
  const empty = document.getElementById('galleryEmpty');
  if (empty) empty.style.display = entries.length ? 'none' : 'block';
  updateViewerControls();
}

function add(svg, fig, opts) {
  opts = opts || {};
  const run = runFor(opts.run);
  const e = {
    id: nextId++,
    run,
    fig: fig === undefined || fig === null ? '' : String(fig),
    svg,
    name: opts.name || (fig !== undefined && fig !== null ? 'Fig ' + fig : 'plot'),
    ts: Date.now(),
  };
  entries.push(e);
  render();
  view(entries.length - 1);
  return e;
}

function remove(id) {
  const at = entries.findIndex((e) => e.id === id);
  if (at < 0) return;
  entries = entries.filter((e) => e.id !== id);
  // Drop runs that no longer have any entries.
  const ids = new Set(entries.map((e) => e.run && e.run.id).filter(Boolean));
  runs = runs.filter((r) => ids.has(r.id));
  currentIndex = entries.length ? Math.min(currentIndex, entries.length - 1) : -1;
  render();
  if (entries.length) view(currentIndex); else plotEl().innerHTML = '';
}

function clear() {
  entries = [];
  runs = [];
  currentIndex = -1;
  runToken = 0;
  plotEl().innerHTML = '';
  render();
}

/* Wire the static buttons + keyboard navigation. Safe even if an element is
   absent (unit harness returns null for unstubbed ids). */
function init() {
  const clearBtn = el('galleryClearBtn');
  if (clearBtn) clearBtn.addEventListener('click', clear);
  const prevBtn = el('plotPrevBtn');
  if (prevBtn) prevBtn.addEventListener('click', prev);
  const nextBtn = el('plotNextBtn');
  if (nextBtn) nextBtn.addEventListener('click', next);
  const w = typeof window !== 'undefined' ? window : null;
  if (w && typeof w.addEventListener === 'function') {
    w.addEventListener('keydown', (ev) => {
      if (!entries.length) return;
      const tag = ev.target && ev.target.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
      if (ev.key === 'ArrowLeft') { ev.preventDefault(); prev(); }
      else if (ev.key === 'ArrowRight') { ev.preventDefault(); next(); }
    });
  }
}

export const gallery = {
  beginRun,
  add,
  remove,
  clear,
  view,
  next,
  prev,
  count: () => entries.length,
  runsCount: () => runs.length,
  index: () => currentIndex
};
init();