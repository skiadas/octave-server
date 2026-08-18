/* app/util.js — shared foundation for the octave-server UI: DOM helpers,
   string escaping, a tiny pub/sub, and the shared blob-download helper.
   Modern ES module; the bundle step turns it into a classic script, so the
   page still works with no build artifacts committed. */

export function escapeHtml(s) {
  return String(s).replace(/[&<>"]/g, function (c) {
    return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c];
  });
}

/* Create an element with attributes, children, and text helper. Keeps the
   DOM-building in one place instead of fiddly innerHTML strings. */
export function el(tag, attrs, children) {
  const node = document.createElement(tag);
  if (attrs) {
    for (const k in attrs) {
      if (!Object.prototype.hasOwnProperty.call(attrs, k)) continue;
      const v = attrs[k];
      if (k === 'class') node.className = v;
      else if (k === 'text') node.textContent = v;
      else if (k === 'html') node.innerHTML = v;
      else if (k === 'style') node.style.cssText = v;
      else node.setAttribute(k, v);
    }
  }
  (children || []).forEach((c) => {
    if (c !== null && c !== undefined) node.appendChild(c);
  });
  return node;
}

/* ---- tiny pub/sub so modules stay decoupled ---- */
const _listeners = {};
export function on(evt, fn) {
  (_listeners[evt] = _listeners[evt] || []).push(fn);
}
export function emit(evt, payload) {
  const list = _listeners[evt] || [];
  for (let i = 0; i < list.length; i++) list[i](payload);
}

/* Shared Blob download helper (used by gallery + file panel). */
export function downloadBlob(blob, filename) {
  if (typeof URL !== 'undefined' && URL.createObjectURL) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
}
