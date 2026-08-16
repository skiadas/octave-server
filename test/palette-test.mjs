/* Verifies gnuplot can render an Octave-style stream containing BINARY
   palette data (float32, as emitted by __gnuplot_draw_axes__). */
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const require = createRequire(import.meta.url);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dist = path.join(ROOT, 'dist/gnuplot-wasm');
const createGnuplot = require(path.join(dist, 'gnuplot.js'));
const wasmBytes = readFileSync(path.join(dist, 'gnuplot.wasm'));

const enc = new TextEncoder();

// Mimic draw_axes: record=2, using 1:2:3:4 -> 2 records x 4 floats (float32).
const floats = [1, 1, 0, 0, 2, 0, 1, 0];
const buf = new ArrayBuffer(floats.length * 4);
const dv = new DataView(buf);
floats.forEach((v, i) => dv.setFloat32(i * 4, v, true));
const palette = new Uint8Array(buf);

const head = enc.encode(
  'unset multiplot;\n' +
  'set terminal svg enhanced size 800,600;\n' +
  'set multiplot;\n' +
  'set palette positive color model RGB maxcolors 2;\n' +
  'set palette file "-" binary record=2 using 1:2:3:4;\n');
const tail = enc.encode(
  '\nunset colorbox;\n' +
  'plot "-" with lines title "sin";\n' +
  '0 0\n1 0.84\n2 0.91\ne\n');

const scriptBytes = new Uint8Array(head.length + palette.length + tail.length);
scriptBytes.set(head, 0);
scriptBytes.set(palette, head.length);
scriptBytes.set(tail, head.length + palette.length);

const fn = await createGnuplot((importObject, callback) => {
  WebAssembly.instantiate(wasmBytes, importObject)
    .then(({ instance }) => callback(instance))
    .catch(() => callback(false));
  return {};
});
const svg = fn(scriptBytes, { x: 400, y: 700 });
const dPaths = [...svg.matchAll(/d="([^"]{8,})"/g)].length;
console.log(`binary-palette render: complete=${svg.includes('</svg>')} len=${svg.length} datapaths=${dPaths}`);
process.exit(svg.includes('</svg>') && dPaths >= 2 ? 0 : 1);
