#!/usr/bin/env node
/* scripts/build.mjs — bundles app/ and produces the deployable artifacts.

   Two profiles (run `npm run build` for both):

   dist   → dist/app/app.js  (a single classic IIFE script, esbuild-bundled)
            consumed by app/index.html together with the vendored wasm loader
            scripts (octave.js / gnuplot.js) and the Pyodide CDN script. This
            is what GitHub Pages serves, via dist/app/index.html — a generated
            copy of the page with ?v=<hash> on every local asset URL and a
            window.__OO_V__ block (see buildDistIndex).

   single → dist/single/index.html : a fully self-contained single file that
            runs from file:// with no web server. Everything is inlined: the
            bundled app, the gnuplot/octave loader scripts, and the wasm
            binaries as base64 data: URIs (exposed via window.__OO_ASSETS__,
            which main.js resolves through locateFile / getGnuplotWasm).
            Pyodide stays a CDN script (symbolic math needs network anyway).

   Usage: node scripts/build.mjs [--profile=dist|single|both]
*/

import { build } from 'esbuild';
import { createHash } from 'node:crypto';
import { readFile, writeFile, mkdir, stat } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const APP_DIR = path.join(ROOT, 'app');
const DIST_DIR = path.join(ROOT, 'dist');

function arg(name, dflt) {
  const hit = process.argv.find((a) => a.startsWith('--' + name + '='));
  return hit ? hit.split('=')[1] : dflt;
}
const profile = arg('profile', 'both');

async function bundleApp() {
  const outfile = path.join(DIST_DIR, 'app', 'app.js');
  await build({
    entryPoints: [path.join(APP_DIR, 'main.js')],
    bundle: true,
    format: 'iife',
    platform: 'browser',
    target: ['es2017'],
    outfile,
    logLevel: 'info',
  });
  return outfile;
}

/* SHA-256 short hash of a file's bytes, used for ?v= cache-busting. */
async function fileHash(rel) {
  const b = await readFile(path.join(DIST_DIR, rel));
  return createHash('sha256').update(b).digest('hex').slice(0, 12);
}

/* Emit dist/app/index.html: a copy of the page whose local <script> URLs and
   the wasm fetches (via window.__OO_V__, consumed by main.js assetURL) carry
   ?v=<hash>. Content-addressed, so unchanged bytes reuse the URL and any real
   change busts the browser cache. Cross-deploy staleness -- which previously
   replayed old octave.data against a new loader -- becomes impossible. */
async function buildDistIndex(appBundleRel) {
  const html = await readFile(path.join(APP_DIR, 'index.html'), 'utf8');
  const gnuplotJs = await fileHash('gnuplot-wasm/gnuplot.js');
  const octaveJs = await fileHash('octave-wasm/octave.js');
  const appJs = await fileHash(appBundleRel);
  const vart = {
    'gnuplot-wasm/gnuplot.wasm': await fileHash('gnuplot-wasm/gnuplot.wasm'),
    'octave-wasm/octave.wasm': await fileHash('octave-wasm/octave.wasm'),
    'octave-wasm/octave.data': await fileHash('octave-wasm/octave.data'),
  };
  const script = Object.entries(vart).map(
    ([key, v]) => '    ' + JSON.stringify(key) + ': ' + JSON.stringify(v)
  ).join(',\n');
  const withV = (f) => f + '?v=' + (f === '../dist/gnuplot-wasm/gnuplot.js' ? gnuplotJs
    : f === '../dist/octave-wasm/octave.js' ? octaveJs : appJs);
  const out = html
    .replace(
      '<script src="../dist/gnuplot-wasm/gnuplot.js"></script>',
      '<script src="' + withV('../dist/gnuplot-wasm/gnuplot.js') + '"></script>'
    )
    .replace(
      '<script src="../dist/octave-wasm/octave.js"></script>',
      '<script src="' + withV('../dist/octave-wasm/octave.js') + '"></script>'
    )
    .replace(
      '<script src="../dist/app/app.js"></script>',
      '<script>window.__OO_V__ = {\n' + script + '\n};\n</script>\n' +
      '<script src="' + withV('../dist/app/app.js') + '"></script>'
    );
  const outFile = path.join(DIST_DIR, 'app', 'index.html');
  await writeFile(outFile, out);
  console.log('dist →', path.relative(ROOT, outFile));
}

function b64(file) {
  return readFile(file).then((b) => b.toString('base64'));
}
function dataUri(mime, b64str) {
  return 'data:' + mime + ';base64,' + b64str;
}

async function ensureDistDirs() {
  for (const d of ['app', 'single']) {
    await mkdir(path.join(DIST_DIR, d), { recursive: true });
  }
}

async function buildSingle(appBundleFile) {
  const html = await readFile(path.join(APP_DIR, 'index.html'), 'utf8');

  const [octaveJs, gnuplotJs, octaveWasm, octaveData, gnuplotWasm] = await Promise.all([
    readFile(path.join(DIST_DIR, 'octave-wasm', 'octave.js'), 'utf8'),
    readFile(path.join(DIST_DIR, 'gnuplot-wasm', 'gnuplot.js'), 'utf8'),
    b64(path.join(DIST_DIR, 'octave-wasm', 'octave.wasm')),
    b64(path.join(DIST_DIR, 'octave-wasm', 'octave.data')),
    b64(path.join(DIST_DIR, 'gnuplot-wasm', 'gnuplot.wasm')),
  ]);
  const appBundle = await readFile(appBundleFile, 'utf8');

  // Assets map keyed the way main.js looks them up: gnuplot.wasm by basename,
  // octave files by "octave-wasm/<name>" (main.js prefixes the locateFile
  // path with "octave-wasm/").
  const assets = {
    'gnuplot.wasm': dataUri('application/wasm', gnuplotWasm),
    'octave-wasm/octave.wasm': dataUri('application/wasm', octaveWasm),
    'octave-wasm/octave.data': dataUri('application/octet-stream', octaveData),
  };

  // Inline everything, preserving a normal <script> execution order: loader
  // scripts first (they define createGnuplot/OCTAVE/loadPyodide), then the
  // app bundle, with the assets map injected just before it.
  const single = html
    .replace(
      '<script src="../dist/gnuplot-wasm/gnuplot.js"></script>',
      '<script>\n' + gnuplotJs + '\n</script>'
    )
    .replace(
      '<script src="../dist/octave-wasm/octave.js"></script>',
      '<script>\n' + octaveJs + '\n</script>'
    )
    .replace(
      '<script src="../dist/app/app.js"></script>',
      '<script>window.__OO_ASSETS__ = ' + JSON.stringify(assets) + ';</script>\n' +
      '<script>\n' + appBundle + '\n</script>'
    );

  const out = path.join(DIST_DIR, 'single', 'index.html');
  await writeFile(out, single);
  console.log('single →', path.relative(ROOT, out),
    '(' + (single.length / 1024 / 1024).toFixed(1) + ' MB)');
}

async function main() {
  await ensureDistDirs();
  if (profile === 'dist' || profile === 'both') {
    const out = await bundleApp();
    await buildDistIndex(path.relative(DIST_DIR, out));
    console.log('dist →', path.relative(ROOT, out));
  }
  if (profile === 'single' || profile === 'both') {
    // The single profile needs the wasm artifacts present.
    for (const f of ['octave-wasm/octave.js', 'octave-wasm/octave.wasm',
      'octave-wasm/octave.data', 'gnuplot-wasm/gnuplot.js',
      'gnuplot-wasm/gnuplot.wasm']) {
      try { await stat(path.join(DIST_DIR, f)); } catch (e) {
        console.error('missing dist artifact:', f,
          '(run scripts/build.sh first)');
        process.exit(1);
      }
    }
    const bundle = path.join(DIST_DIR, 'app', 'app.js');
    if (profile === 'single') {
      await bundleApp();
    }
    await buildSingle(bundle);
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
