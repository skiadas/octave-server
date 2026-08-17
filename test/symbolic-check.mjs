/* Symbolic gate check: drives the app in headless Chrome, waits for BOTH the
   Octave runtime and the Pyodide/SymPy bridge, then exercises the symbolic
   shim (syms, diff, int, solve, laplace, dsolve, double, negative case).
   Network is required the first time (Pyodide + SymPy wheel from JsDelivr). */
import { spawn } from 'node:child_process';
import puppeteer from 'puppeteer-core';

const ROOT = new URL('..', import.meta.url).pathname;
const PORT = 8080;
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const APP_URL = `http://127.0.0.1:${PORT}/app/`;

let server;
function startServer() {
  return new Promise((resolve) => {
    server = spawn('python3', ['-m', 'http.server', String(PORT)], { cwd: ROOT });
    server.once('spawn', resolve);
  });
}

let failures = 0;
function check(name, ok, detail) {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ' — ' + detail : ''}`);
  if (!ok) failures++;
}

async function main() {
  await startServer();
  const browser = await puppeteer.launch({ executablePath: CHROME, headless: true });
  const page = await browser.newPage();
  page.on('pageerror', (e) => console.error('[pageerror]', e.message));

  await page.goto(APP_URL, { waitUntil: 'load', timeout: 120000 });
  await page.waitForFunction('window.__oo && window.__oo.ready === true', { timeout: 180000 });
  console.log('octave ready');
  await page.waitForFunction('window.__ooSympyReady === true', { timeout: 600000 })
    .catch(() => { throw new Error('Timed out waiting for Pyodide/SymPy'); });
  console.log('sympy ready\n');

  const out = await page.$eval('#output', (e) => e.innerText);
  console.log('sympy warmup console:\n' + out.split('\n').slice(-3).join('\n') + '\n');

  // Each case: run(octave cmd) then pull everything written to #output.
  async function runOctave(label, cmd) {
    await page.evaluate(async (c) => {
      const oo = window.__oo;
      oo.run(c);
      await oo.awaitRender();
    }, cmd);
    const txt = await page.$eval('#output', (e) => e.innerText);
    return { label, cmd, txt };
  }

  let r = await runOctave('diff', 'syms x; disp(diff(sin(x), x))');
  check('symbolic: diff(sin(x),x) = cos(x)', /cos\(x\)/.test(r.txt), 'see console');
  console.log('  >', r.txt.split('\n').slice(-5).join('\n'), '\n');

  r = await runOctave('bridge', 'disp(__wasm_python__("str(int(1))"))');
  check('gate 1c: __wasm_python__ bridge round-trips', /(^|\n)1\s*$/m.test(r.txt), 'see console');
  console.log('  >', r.txt.split('\n').slice(-5).join('\n'), '\n');

  r = await runOctave('ops', 'syms x; disp(double(subs(expand((x+1)^2), x, 1)))');
  check('symbolic: operator overloads (expand((x+1)^2)@x=1) = 4', /(^|\n)4\s*$/m.test(r.txt), 'see console');
  console.log('  >', r.txt.split('\n').slice(-5).join('\n'), '\n');

  r = await runOctave('regdatasmooth', 'if exist("regdatasmooth"), disp("found"), else disp("missing"), end');
  check('gate 1e: regdatasmooth (data-smoothing) loadable', /found/.test(r.txt), 'see console');
  console.log('  >', r.txt.split('\n').slice(-5).join('\n'), '\n');

  r = await runOctave('int', 'disp(int(sym("exp(-x**2)"), sym("x"), sym("-oo"), sym("oo")))');
  check('symbolic: int(exp(-x^2),-inf,inf) = sqrt(pi)',
    /sqrt\(pi\)/.test(r.txt), 'see console');
  console.log('  >', r.txt.split('\n').slice(-5).join('\n'), '\n');

  r = await runOctave('solve', 'disp(solve(sym("x**2 - 5*x + 6")))');
  check('symbolic: solve(x^2-5x+6) has 2 and 3',
    /\[2, 3\]/.test(r.txt), 'see console');
  console.log('  >', r.txt.split('\n').slice(-5).join('\n'), '\n');

  r = await runOctave('laplace', 'disp(laplace(sin(sym("t")), sym("t"), sym("s")))');
  check('symbolic: laplace(sin(t)) = 1/(s^2+1)',
    /1\/\(s\*\*2 \+ 1\)/.test(r.txt), 'see console');
  console.log('  >', r.txt.split('\n').slice(-5).join('\n'), '\n');

  r = await runOctave('dsolve', 'disp(dsolve("D2y + y = 0"))');
  check('symbolic: dsolve(D2y + y = 0) has C1',
    /C1/.test(r.txt) && !/error/i.test(r.txt), 'see console');
  console.log('  >', r.txt.split('\n').slice(-5).join('\n'), '\n');

  r = await runOctave('double', 'disp(double(sym("sqrt(2)"))^2)');
  check('symbolic: double(sqrt(2))^2 ~= 2',
    /2\.\d+[^\n]*/.test(r.txt.split('\n').slice(-4).join('\n')), 'see console');
  console.log('  >', r.txt.split('\n').slice(-5).join('\n'), '\n');

  // Negative case: malformed SymPy expression must produce an Octave error,
  // not a crash.
  await page.evaluate(async () => {
    const oo = window.__oo;
    oo.run('disp(sym("2 +"))');
    await oo.awaitRender();
  });
  const neg = await page.evaluate(() => ({ err: window.__oo.lastError }));
  check('symbolic: bad expression -> clean Octave error',
    neg.err && !/rangeerror/i.test(neg.err) && !/undefined/i.test(neg.err), neg.err || 'no error');
  console.log('  > lastError:', neg.err);

  await browser.close();
  server.kill();
  console.log('\ndone');
  process.exit(failures ? 1 : 0);
}

main().catch(async (err) => {
  console.error(err.message || err);
  if (server) server.kill();
  process.exit(2);
});