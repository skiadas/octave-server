/* Fast M2 check: exercises the stdin-fed gnuplot-wasm wrapper in Node.
   Verifies (1) basic render and (2) inline data via `plot "-"` — the exact
   pattern Octave's toolkit emits. Run: node test/gnuplot-node.mjs */
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const require = createRequire(import.meta.url);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dist = path.join(ROOT, 'dist/gnuplot-wasm');
const createGnuplot = require(path.join(dist, 'gnuplot.js'));

let failures = 0;
function check(name, ok, detail) {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ' — ' + detail : ''}`);
  if (!ok) failures++;
}

createGnuplot((importObject, callback) => {
  WebAssembly.instantiate(readFileSync(path.join(dist, 'gnuplot.wasm')), importObject)
    .then(({ instance }) => callback(instance))
    .catch(() => callback(false));
  return {};
}).then((gnuplot) => {
  const svg = gnuplot('plot x**2;', { x: 400, y: 700 });
  check('basic render', svg.includes('</svg>'), `${svg.length}B`);

  const dataSvg = gnuplot('plot "-" with lines;\n1 2\n3 4\n5 6\ne\n', { x: 400, y: 700 });
  check('inline plot "-" data', dataSvg.includes('</svg>'), `${dataSvg.length}B`);

  // A bigger, Octave-style script (set terminal + set output via preamble, surf-ish data).
  const octaveStyle = [
    'unset multiplot;',
    'set terminal svg enhanced size 800,600;',
    'set multiplot;',
    'plot "-" with lines title "sin";',
    '0 0',
    '1 0.84',
    '2 0.91',
    '3 0.14',
    '4 -0.76',
    'e',
    'set terminal svg enhanced;',
    'plot "-" with points title "pts";',
    '0 1',
    '1 2',
    '2 3',
    'e',
  ].join('\n') + '\n';
  const styleSvg = gnuplot(octaveStyle, { x: 800, y: 600 });
  check('octave-style script', styleSvg.includes('</svg>'), `${styleSvg.length}B`);

  process.exit(failures ? 1 : 0);
}).catch((e) => {
  console.error('FAIL', e.message);
  process.exit(1);
});
