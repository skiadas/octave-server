/* Fast M2 check: exercises the stdin-fed gnuplot-wasm wrapper in Node.
   Verifies (1) basic render and (2) inline data via `plot "-"` — the exact
   pattern Octave's toolkit emits. gnuplot renders once per module instance,
   so each case instantiates a fresh module. Run: node test/gnuplot-node.mjs */
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const require = createRequire(import.meta.url);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dist = path.join(ROOT, 'dist/gnuplot-wasm');
const createGnuplot = require(path.join(dist, 'gnuplot.js'));
const wasmBytes = readFileSync(path.join(dist, 'gnuplot.wasm'));

async function render(script, size) {
  const fn = await createGnuplot((importObject, callback) => {
    WebAssembly.instantiate(wasmBytes, importObject)
      .then(({ instance }) => callback(instance))
      .catch(() => callback(false));
    return {};
  });
  return fn(script, size);
}

let failures = 0;
function check(name, ok, detail) {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ' — ' + detail : ''}`);
  if (!ok) failures++;
}

const cases = [
  ['basic render', 'plot x**2;\n'],
  ['inline plot "-" data', 'plot "-" with lines;\n1 2\n3 4\n5 6\ne\n'],
  ['octave-style (multiplot + set terminal)', [
    'unset multiplot;',
    'set terminal svg enhanced size 800,600;',
    'set multiplot;',
    'plot "-" with lines title "sin";',
    '0 0', '1 0.84', '2 0.91', '3 0.14',
    'e',
  ].join('\n') + '\n'],
  ['scatter (points)', 'plot "-" with points pointtype 7;\n1 2\n2 3\n3 5\ne\n'],
];

for (const [name, script] of cases) {
  try {
    const svg = await render(script, { x: 800, y: 600 });
    const dPaths = [...svg.matchAll(/d="([^"]{8,})"/g)].length;
    check(name, svg.includes('</svg>') && dPaths >= 2, `svg=${svg.length}B, data-paths=${dPaths}`);
  } catch (e) {
    check(name, false, e.message.split('\n')[0]);
  }
}

process.exit(failures ? 1 : 0);
