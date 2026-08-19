#!/usr/bin/env node
/* test/index-check.mjs — validates dist/app/index.html, the generated copy of
   the page that scripts/build.mjs emits for the dist profile (the one CI
   serves). It must carry ?v=<sha256/12> on every local asset URL and a
   window.__OO_V__ block hashing the wasm fetches identically, so a browser
   cache can never replay stale bytes against a new build. Content-addressed:
   unchanged files reuse the URL, changed files bust it.

   Artifact handling: when the real wasm binaries are present (deploy / heavy
   verify copy them into dist/ first) every asset is hashed and checked for a
   match. In an artifact-less UI-only CI job the wasm files don't exist, so the
   check degrades to structural validity + consistency for whatever IS present
   (missing assets warn, never fail). */

import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');

let failures = 0;
function check(name, ok, detail) {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}: ${detail}`);
  if (!ok) failures = 1;
}
function warn(name, detail) {
  console.log(`WARN  ${name}: ${detail}`);
}

const HTML = path.join(ROOT, 'dist', 'app', 'index.html');
let html;
try {
  html = await readFile(HTML, 'utf8');
} catch (e) {
  console.error('missing ' + HTML + ' — run `npm run build:dist` first');
  process.exit(1);
}

async function hashOf(rel) {
  try {
    const b = await readFile(path.join(ROOT, 'dist', rel));
    return createHash('sha256').update(b).digest('hex').slice(0, 12);
  } catch (e) {
    return null;
  }
}

const SCRIPT_ASSETS = [
  { rel: 'gnuplot-wasm/gnuplot.js', tag: '../dist/gnuplot-wasm/gnuplot.js' },
  { rel: 'octave-wasm/octave.js', tag: '../dist/octave-wasm/octave.js' },
  { rel: 'app/app.js', tag: '../dist/app/app.js' },
];
const WASM_ASSETS = [
  'gnuplot-wasm/gnuplot.wasm',
  'octave-wasm/octave.wasm',
  'octave-wasm/octave.data',
];

const srcCount = (html.match(/script src="[^"]+"/g) || []).length;
check('generated page references the loader + app scripts', srcCount === 4,
  (html.match(/script src="([^"]+)"/g) || []).join(', '));

// ---- the local <script> tags: ?v=<sha256/12> whenever the file exists ----
let scriptHasOk = true;
for (const { rel, tag } of SCRIPT_ASSETS) {
  const esc = tag.replace(/[.\\/]/g, '\\$&');
  const m = html.match(new RegExp('src="' + esc + '(\\?v=[0-9a-f]{12})?"'));
  const used = m && m[1] ? m[1].slice(3) : null;
  const want = await hashOf(rel);
  if (want) {
    if (used !== want) {
      scriptHasOk = false;
      check('script ' + tag + ' carries the matching ?v=', false,
        JSON.stringify({ used: used || '(none)', want }));
    }
  } else if (used) {
    warn('script ' + tag + ' versioned but ' + rel + ' is missing on disk');
  }
}
check('shipped <script> srcs are ?v=-hashed to their bytes', scriptHasOk, 'hashes match');

// Pyodide stays a plain pinned CDN URL (never versioned here).
check('Pyodide CDN script untouched',
  html.indexOf('src="https://cdn.jsdelivr.net/pyodide/v314.0.4/full/pyodide.js"') !== -1,
  'pinned CDN script referenced');

// ---- window.__OO_V__ block (wasm fetches resolved by main.js assetURL) ----
const vartSrc = html.match(/window\.__OO_V__ = (\{[^}]*\});/);
check('__OO_V__ block injected before app.js',
  !!vartSrc && html.indexOf('window.__OO_V__') < html.indexOf('../dist/app/app.js'),
  vartSrc ? 'found' : 'missing');
const artifacts = Object.fromEntries(await Promise.all(WASM_ASSETS.map(async (k) => [k, await hashOf(k)])));
const allShip = Object.values(artifacts).every(Boolean);
let varOk = true;
if (vartSrc) {
  let vart = null;
  try {
    vart = JSON.parse(vartSrc[1]);
  } catch (e) {
    check('__OO_V__ block parses as JSON', false, e.message);
  }
  if (vart) {
    const keys = Object.keys(vart);
    if (allShip) {
      varOk = keys.length === 3;
      check('__OO_V__ covers all three wasm keys (artifacts shipped)', varOk, keys.join(', ') || '(empty)');
    }
    for (const k of keys) {
      const want = artifacts[k] || null;
      const ok = /^[0-9a-f]{12}$/.test(vart[k]) && (want === null || want === vart[k]);
      if (want !== null && vart[k] !== want) varOk = false;
      check('__OO_V__[' + JSON.stringify(k) + '] matches the artifact bytes', ok,
        JSON.stringify({ stored: vart[k], file: want }));
    }
  }
}
check('__OO_V__ values hash the real wasm artifacts', varOk, 'hashes match');

console.log(failures ? '\nindex check: FAILED' : '\nindex check: all passed');
process.exit(failures);