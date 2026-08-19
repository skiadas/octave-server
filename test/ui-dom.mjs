#!/usr/bin/env node
/* UI DOM shell check (fast tier, ~5-10 s): loads app/index.html in a real
   headless Chrome but BLOCKS every heavy fetch (octave.data / octave.wasm /
   gnuplot.wasm / the Pyodide CDN), so the Octave binary never boots. This
   verifies the static wiring that ui-unit can't reach — script tags load, the
   loader globals (OCTAVE / createGnuplot) are defined, and every panel in the
   app shell is present with its controls — in seconds instead of a 1-2 min
   smoke, which is what UI-only iterations should pay. */

import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import puppeteer from 'puppeteer-core';

const ROOT = new URL('..', import.meta.url).pathname;
const PORT = 8096;
const CHROME = process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const APP_URL = `http://127.0.0.1:${PORT}/app/`;

// The emscripten loader scripts only exist after a real wasm build. In the
// artifact-less UI-only CI job they 404, so the loader-global assertions are
// conditional on them being on disk; the static-shell checks always run.
const loadersPresent =
  existsSync(`${ROOT}dist/gnuplot-wasm/gnuplot.js`) &&
  existsSync(`${ROOT}dist/octave-wasm/octave.js`);

let server;
function startServer() {
  // allow_reuse_address lets reruns rebind while the previous socket is in
  // TIME_WAIT (plain `python -m http.server` fails with EADDRINUSE right
  // after a SIGKILL'd run).
  const PY = [
    'import sys, socketserver, http.server',
    'class ReusableServer(socketserver.ThreadingTCPServer):',
    '    allow_reuse_address = True',
    '    daemon_threads = True',
    "ReusableServer(('', int(sys.argv[1])), http.server.SimpleHTTPRequestHandler).serve_forever()",
  ].join('\n');
  return new Promise((resolve, reject) => {
    server = spawn('python3', ['-c', PY, String(PORT)], { cwd: ROOT });
    server.once('error', reject);
    server.once('spawn', resolve);
  });
}

let failures = 0;
function check(name, ok, detail) {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}: ${detail}`);
  if (!ok) failures = 1;
}

async function main() {
  await startServer();
  for (let i = 0; i < 50; i++) {
    try { const r = await fetch(`http://127.0.0.1:${PORT}/`, { signal: AbortSignal.timeout(2000) }); if (r.ok) break; } catch (e) {}
    await new Promise((r) => setTimeout(r, 300));
  }

  const browser = await puppeteer.launch({
    executablePath: CHROME,
    headless: true,
    protocolTimeout: 120000,
  });
  try {
    const page = await browser.newPage();
    const pageErrors = [];
    page.on('pageerror', (e) => pageErrors.push(e.message));

    // Block the heavy fetches so Octave never boots (that's the whole point
    // of this fast tier): Pyodide CDN + the three wasm/data blobs.
    await page.setRequestInterception(true);
    page.on('request', (req) => {
      const u = req.url();
      if (/jsdelivr\.net/.test(u) || /octave\.(data|wasm)(\?|$)/.test(u) || /gnuplot\.wasm(\?|$)/.test(u)) req.abort();
      else req.continue();
    });

    await page.goto(APP_URL, { waitUntil: 'load', timeout: 60000 });
    // gnuplot.js + the app bundle evaluate synchronously on load, so both
    // loader globals are set right away (before any wasm boot / fetch fail).
    // We wait on the globals, NOT on the status string: with octave.data
    // aborted, status races on from "gnuplot-wasm loaded" to the octave
    // fetch-failure message.
    if (loadersPresent) {
      await page.waitForFunction(
        "typeof window.OCTAVE === 'function' && typeof window.createGnuplot === 'function'",
        { timeout: 30000 }
      ).catch(() => {
        throw new Error('app shell never evaluated; status=' +
          page.$eval('#status', (e) => e.textContent) + '; pageerrors=' + JSON.stringify(pageErrors));
      });
    } else {
      // No loader scripts (artifact-less job): main.js still runs and reports
      // the missing loaders; the file-panel bar below proves the bundle ran.
      await page.waitForFunction(
        "typeof window !== 'undefined' && document.getElementById('status')",
        { timeout: 30000 }
      ).catch(() => {
        throw new Error('app bundle never evaluated; pageerrors=' + JSON.stringify(pageErrors));
      });
    }
    // The file-panel bar renders asynchronously once the fs store opens.
    await page.waitForFunction(
      "document.querySelectorAll('#filesPane .fs-bar button').length > 0",
      { timeout: 15000 }
    ).catch(() => {});

    const shell = await page.evaluate(() => {
      const has = (id) => document.getElementById(id) !== null;
      const ids = ['output', 'status', 'editor', 'filename', 'runBtn', 'filesPane',
        'galleryPane', 'galleryList', 'galleryEmpty', 'plotBar', 'plotPrevBtn',
        'plotNextBtn', 'plotCounter', 'plotTitle', 'fileInput', 'previewPane',
        'editorGutter', 'editorMirror', 'ooComplete', 'ooCaretProbe'];
      const missing = ids.filter((id) => !has(id));
      const editor = document.getElementById('editor');
      const paneBarBtns = document.getElementById('filesPane').querySelectorAll('.fs-bar button').length;
      return {
        octaveLoader: typeof window.OCTAVE === 'function',
        gnuplotLoader: typeof window.createGnuplot === 'function',
        noEmbed: window.__OO_ASSETS__ === undefined,
        missing,
        editorIsTextarea: editor && editor.tagName === 'TEXTAREA',
        paneBarBtns,
        status: document.getElementById('status').textContent,
        hasPlotControls:
          has('plotPrevBtn') && has('plotNextBtn') && has('plotCounter') && has('plotTitle'),
        collapsed: document.documentElement.classList.contains('fs-collapsed'),
        hasEditorOverlay:
          has('editorGutter') && has('editorMirror') && has('ooComplete') && has('ooCaretProbe'),
      };
    });

    if (loadersPresent) {
      check('octave loader script wired (window.OCTAVE)', shell.octaveLoader, typeof shell.octaveLoader);
      check('gnuplot loader script wired (window.createGnuplot)', shell.gnuplotLoader, typeof shell.gnuplotLoader);
      check('status shows a non-fatal pre-boot state (wasm fetch blocked by design)',
        /FATAL/.test(shell.status) === false, shell.status);
    } else {
      // Artifact-less job: the loader scripts 404 and main.js reports them
      // missing — inspect that degraded state explicitly.
      check('loader scripts wired — skipped (artifacts absent)', true,
        'gnuplot.js / octave.js not on disk; app.js reports loaders missing');
    }
    check('dist profile runs without embedded assets', shell.noEmbed, String(shell.noEmbed));
    check('all app-shell panels present', shell.missing.length === 0, shell.missing.join(', ') || 'all present');
    check('editor is a textarea', shell.editorIsTextarea, String(shell.editorIsTextarea));
    check('editor overlay elements present (gutter/mirror/popup/probe)',
      shell.hasEditorOverlay, 'gutter/mirror/popup/probe');
    check('file-panel bar renders its buttons', shell.paneBarBtns >= 4, 'buttons=' + shell.paneBarBtns);
    check('viewer controls present', shell.hasPlotControls, 'prev/next/counter/title');
    check('file panel collapsed by default', shell.collapsed, 'fs-collapsed on <html>');

    // Editor overlay actually highlights + counts lines in a real browser.
    const edState = await page.evaluate(() => {
      const ed = document.getElementById('editor');
      ed.value = '% hi\nx = 1;';
      ed.dispatchEvent(new Event('input', { bubbles: true }));
      return {
        mirrorHasTokens: document.getElementById('editorMirror').innerHTML.includes('hljs-comment'),
        gutter: document.getElementById('editorGutter').textContent,
      };
    });
    check('editor mirror highlights typed text (token classes)',
      edState.mirrorHasTokens, 'mirror has hljs-comment');
    check('editor gutter counts lines',
      edState.gutter === '1\n2', 'gutter=' + JSON.stringify(edState.gutter));

    // Ctrl+Space completion popup opens with candidates in a real browser.
    await page.evaluate(() => {
      const ed = document.getElementById('editor');
      ed.value = 'pl';
      ed.selectionStart = ed.selectionEnd = 2;
      ed.dispatchEvent(new KeyboardEvent('keydown', {
        key: ' ', ctrlKey: true, bubbles: true, cancelable: true }));
    });
    const popupRows = await page.evaluate(() => {
      const p = document.getElementById('ooComplete');
      if (!p || p.hidden === true) return 0;
      return p.querySelectorAll('.oo-comp-row').length;
    });
    check('Ctrl+Space shows the completion popup with candidates', popupRows > 0,
      'rows=' + popupRows);

    // Toggle via the header button: the panel becomes visible (real layout).
    await page.click('#filesToggle');
    await page.waitForFunction("!document.documentElement.classList.contains('fs-collapsed')", { timeout: 10000 });
    const shown = await page.evaluate(() => getComputedStyle(document.getElementById('filesPane')).display !== 'none');
    check('toggle button reveals the file panel', shown, 'filesPane computed display');

    // Ctrl+B recolapses it.
    await page.keyboard.down('Control');
    await page.keyboard.press('KeyB');
    await page.keyboard.up('Control');
    const recollapsed = await page.evaluate(() =>
      document.documentElement.classList.contains('fs-collapsed'));
    check('Ctrl+B recolapses the panel', recollapsed, 'fs-collapsed restored');
    if (pageErrors.length) console.log('(captured pageerrors:', JSON.stringify(pageErrors), ')');
    void pageErrors;
  } finally {
    try { await browser.close(); } catch (e) {}
    if (server) server.kill('SIGKILL');
  }

  console.log(failures ? '\nUI DOM shell: FAILED' : '\nUI DOM shell: all passed');
  process.exit(failures);
}

main().catch((e) => { console.error(e); if (server) server.kill('SIGKILL'); process.exit(2); });