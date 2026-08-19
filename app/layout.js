/* app/layout.js — workspace chrome. The file panel (240px) is collapsed by
   default so code + output get the full width; a header toggle button or
   Ctrl/Cmd+B flips it, and the state persists in localStorage across reloads
   (the head inline script applies it before first paint to avoid a flash).

   The visible state is a single `fs-collapsed` class on <html>, read by CSS
   (`html.fs-collapsed #filesPane { display: none }`). Safe with no/missing
   DOM nodes or a throwing localStorage (file:// sandboxes, unit harness).

   Exposed as `layout`. */

const STORAGE_KEY = 'oo-files-pane';

function storage() {
  try { return typeof localStorage !== 'undefined' ? localStorage : null; }
  catch (e) { return null; }
}

function rootEl() {
  const d = typeof document !== 'undefined' ? document : null;
  return d && d.documentElement ? d.documentElement : null;
}

/* Class-toggling helper: real DOM has classList; the unit harness may not. */
function toggleClass(root, add) {
  const cl = root.classList;
  if (cl && typeof cl.toggle === 'function') cl.toggle('fs-collapsed', add);
  else {
    const has = root.className && root.className.split(/\s+/).indexOf('fs-collapsed') !== -1;
    if (add && !has) root.className = (root.className ? root.className + ' ' : '') + 'fs-collapsed';
    else if (!add && has) root.className = root.className.split(/\s+/).filter((c) => c).filter((c) => c !== 'fs-collapsed').join(' ');
  }
}

function hasClass(root) {
  if (root.classList && typeof root.classList.contains === 'function') return root.classList.contains('fs-collapsed');
  return (root.className || '').split(/\s+/).indexOf('fs-collapsed') !== -1;
}

export function isFilesPaneCollapsed() {
  const root = rootEl();
  return root ? hasClass(root) : true; // no document => treat as collapsed
}

export function toggleFilesPane() {
  const hidden = !isFilesPaneCollapsed();
  const root = rootEl();
  if (root) toggleClass(root, hidden);
  const ls = storage();
  if (ls) { try { ls.setItem(STORAGE_KEY, hidden ? '1' : '0'); } catch (e) { /* non-persistent */ } }
  syncButton();
  return hidden;
}

function syncButton() {
  const b = document && document.getElementById ? document.getElementById('filesToggle') : null;
  if (!b) return;
  const hidden = isFilesPaneCollapsed();
  b.textContent = 'Files ' + (hidden ? '▸' : '▾');
  b.setAttribute('aria-pressed', hidden ? 'false' : 'true');
  if (b.title) b.title = 'Toggle file panel (Ctrl+B)';
}

/* Apply the stored (or default: collapsed) state. Idempotent — agrees with
   the head inline script in the real page, and seeds the class in any
   environment where that script didn't run (single-file harness, fixtures). */
function applyStoredState() {
  const ls = storage();
  let hidden = true;
  if (ls) {
    try {
      const v = ls.getItem(STORAGE_KEY);
      hidden = v === null || v !== '0';
    } catch (e) { hidden = true; }
  }
  const root = rootEl();
  if (root) toggleClass(root, hidden);
}

/* Wire the header button + the Ctrl/Cmd+B shortcut (never fights the editor,
   where only Ctrl/Cmd+Enter is used). */
function init() {
  applyStoredState();
  const b = document && document.getElementById ? document.getElementById('filesToggle') : null;
  if (b) {
    if (typeof b.addEventListener === 'function') b.addEventListener('click', (ev) => { ev.preventDefault(); toggleFilesPane(); });
    syncButton();
  }
  const w = typeof window !== 'undefined' ? window : null;
  if (w && typeof w.addEventListener === 'function') {
    w.addEventListener('keydown', (ev) => {
      if ((ev.ctrlKey || ev.metaKey) && ev.key === 'b' && !ev.repeat) {
        ev.preventDefault();
        toggleFilesPane();
      }
    });
  }
}

init();

export const layout = { toggleFilesPane, isFilesPaneCollapsed };