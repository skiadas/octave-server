/* editorpad.js — the code-editor layer for the Octave editor pane.

   #editor stays the real, value-carrying <textarea> (every legacy test talks
   to editor.value), but now rendered transparent with a syntax-highlight
   mirror <pre> behind it (#editorMirror, colored by highlight.js + the
   highlightjs-octave grammar) and a line-number gutter (#editorGutter).

   Also owns: Ctrl+Space completion popup (#ooComplete) fed from the curated
   octave function list, and a local draft of {text, filename} persisted to
   localStorage so an accidental reload doesn't wipe the buffer (the user-file
   tree in IndexedDB is left untouched — the draft is the unsaved buffer).

   Vendored deps (bundled by esbuild, no runtime CDN fetch):
   - highlight.js 11.x (BSD-3-Clause) — syntax-highlight engine, core only.
   - highlightjs-octave 0.1.0 (BSD-3-Clause) — Octave grammar, registered
     below; works against the v11 core (the package targets hljs 10 but the
     grammar API is compatible). */

import hljs from 'highlight.js/lib/core';
import octaveGrammar from 'highlightjs-octave/dist/highlightjs-octave.cjs.js';
import { OCTAVE_COMPLETIONS } from './octave-completions.js';

const DRAFT_KEY = 'oo-editor-draft';
const IDENT = /([A-Za-z_]\w*)$/;

hljs.registerLanguage('octave', (octaveGrammar.default || octaveGrammar));

function byId(id) {
  if (typeof document === 'undefined' || !document.getElementById) return null;
  return document.getElementById(id);
}

const editorEl = byId('editor');
const mirrorEl = byId('editorMirror');
const gutterEl = byId('editorGutter');
const completeEl = byId('ooComplete');
const probeEl = byId('ooCaretProbe');

let onRun = () => {};
let candidates = [];
let active = -1;

function storageOk() {
  try {
    return typeof localStorage !== 'undefined' ? localStorage : null;
  } catch (e) {
    return null;
  }
}

/* ---- highlight mirror + gutter ---- */
function lineNumbers(text) {
  const n = Math.max(1, text.split('\n').length);
  const rows = [];
  for (let i = 1; i <= n; i++) rows.push(String(i));
  return rows.join('\n');
}

function renderOverlay() {
  if (!editorEl || !mirrorEl || !gutterEl) return;
  const text = editorEl.value || '';
  let html = '';
  try {
    html = hljs.highlight(text, { language: 'octave', ignoreIllegals: true }).value;
  } catch (e) {
    html = '';
  }
  mirrorEl.innerHTML = html;
  gutterEl.textContent = lineNumbers(text);
}

function syncScroll() {
  editorEl.scrollTop = editorEl.scrollTop || 0;
  if (mirrorEl) { mirrorEl.scrollTop = editorEl.scrollTop; mirrorEl.scrollLeft = editorEl.scrollLeft; }
  if (gutterEl) gutterEl.scrollTop = editorEl.scrollTop;
}

/* ---- draft persistence (unsaved editor buffer) ---- */
function saveDraft() {
  const ls = storageOk();
  if (!ls || !editorEl) return;
  const fn = byId('filename');
  const draft = { text: editorEl.value, filename: fn ? fn.value : 'script.m' };
  try { ls.setItem(DRAFT_KEY, JSON.stringify(draft)); } catch (e) {}
}

function restoreDraft() {
  const ls = storageOk();
  if (!ls || !editorEl) return;
  let item = null;
  try { item = ls.getItem(DRAFT_KEY); } catch (e) { return; }
  if (!item) return;
  try {
    const d = JSON.parse(item);
    if (d && typeof d.text === 'string') {
      editorEl.value = d.text;
      const fn = byId('filename');
      if (fn && typeof d.filename === 'string') fn.value = d.filename;
      renderOverlay();
    }
  } catch (e) {}
}

/* ---- Ctrl+Space completion popup ---- */
function popupVisible() {
  return !!completeEl && completeEl.getAttribute('hidden') == null;
}

function wordAtCaret() {
  const upTo = editorEl.value.slice(0, editorEl.selectionStart);
  const m = IDENT.exec(upTo);
  return m ? m[1] : '';
}

function closePopup() {
  if (completeEl) completeEl.setAttribute('hidden', '');
  candidates = [];
  active = -1;
}

function renderPopup() {
  if (!completeEl) return;
  const rows = candidates.map((c, i) => {
    const el = document.createElement('div');
    el.className = 'oo-comp-row' + (i === active ? ' oo-comp-active' : '');
    el.textContent = c;
    el.addEventListener('click', () => { active = i; acceptPopup(); });
    return el;
  });
  completeEl.replaceChildren.apply(completeEl, rows);
}

function positionPopup() {
  if (!probeEl || !completeEl || !editorEl) return;
  try {
    const upTo = editorEl.value.slice(0, editorEl.selectionStart);
    const lineNo = upTo.split('\n').length; // 1-based
    const lineText = upTo.slice(upTo.lastIndexOf('\n') + 1);
    let lh = 16;
    if (typeof getComputedStyle === 'function') {
      const parsed = getComputedStyle(editorEl);
      const l = parsed && parseFloat(parsed.lineHeight);
      if (l > 0) lh = l;
    }
    probeEl.style.display = 'block';
    probeEl.textContent = lineText;
    const w = probeEl.offsetWidth || 0;
    probeEl.style.display = 'none';
    const pad = 8;
    completeEl.style.left = (w || lineText.length * 6) + pad + 'px';
    completeEl.style.top = (lineNo - 1) * lh + pad + 'px';
  } catch (e) {}
}

function openPopup(prefix) {
  if (!completeEl) return;
  const p = (prefix || '').toLowerCase();
  candidates = OCTAVE_COMPLETIONS
    .filter((c) => c.toLowerCase().indexOf(p) === 0)
    .slice(0, 50);
  if (!candidates.length) { closePopup(); return; }
  active = 0;
  renderPopup();
  completeEl.removeAttribute('hidden');
  positionPopup();
}

function movePopup(delta) {
  if (!candidates.length) return;
  active = (active + delta + candidates.length) % candidates.length;
  renderPopup();
}

function acceptPopup() {
  if (!editorEl || active < 0 || !candidates[active]) { closePopup(); return; }
  const c = candidates[active];
  const s = editorEl.selectionStart;
  const m = IDENT.exec(editorEl.value.slice(0, s));
  if (!m) { closePopup(); return; }
  const start = s - m[1].length;
  editorEl.value =
    editorEl.value.slice(0, start) + c + editorEl.value.slice(s);
  editorEl.selectionStart = editorEl.selectionEnd = start + c.length;
  closePopup();
  renderOverlay();
  saveDraft();
}

/* ---- editor key handling (Ctrl+Enter runs; Tab indents / completes) ---- */
function onEditKeydown(ev) {
  if (popupVisible()) {
    if (ev.key === 'Escape') { ev.preventDefault(); closePopup(); return; }
    if (ev.key === 'ArrowDown') { ev.preventDefault(); movePopup(1); return; }
    if (ev.key === 'ArrowUp') { ev.preventDefault(); movePopup(-1); return; }
    if (ev.key === 'Enter' || ev.key === 'Tab') { ev.preventDefault(); acceptPopup(); return; }
  }
  if (ev.key === 'Enter' && (ev.ctrlKey || ev.metaKey)) {
    ev.preventDefault();
    onRun();
    return;
  }
  if (ev.key === ' ' && ev.ctrlKey) {
    ev.preventDefault();
    openPopup(wordAtCaret());
    return;
  }
  if (ev.key === 'Tab') {
    ev.preventDefault();
    const word = wordAtCaret();
    if (word) { openPopup(word); return; }
    const s = editorEl.selectionStart;
    const e = editorEl.selectionEnd;
    editorEl.value = editorEl.value.slice(0, s) + '  ' + editorEl.value.slice(e);
    editorEl.selectionStart = editorEl.selectionEnd = s + 2;
    renderOverlay();
    saveDraft();
  }
}

function init() {
  if (!editorEl) return;
  editorEl.addEventListener('input', () => {
    if (popupVisible()) closePopup();
    renderOverlay();
    saveDraft();
  });
  editorEl.addEventListener('scroll', syncScroll);
  editorEl.addEventListener('keydown', onEditKeydown);
  restoreDraft();
  renderOverlay();
}

init();

/* Public handle for main.js + the test tiers. __oo gets this spread too, so
   the real app and the fast gates share one surface. */
export const editorpad = {
  setRun(fn) { if (typeof fn === 'function') onRun = fn; },
  renderOverlay,
  saveDraft,
  restoreDraft,
  openPopup,
  closePopup,
  popupVisible() { return popupVisible(); },
  completionCount() { return candidates.length; },
  activeCompletion() { return candidates[active] || null; },
};