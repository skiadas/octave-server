/* Octave-side gate check (Gate 1 + Gate 2): drives the app in headless Chrome,
   verifies octave readiness, gnuplot toolkit registration, and /plot.gp output.
   Does NOT depend on the gnuplot renderer being correct (that's Gate 3). */
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

const results = [];
function check(name, ok, detail) {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ' — ' + detail : ''}`);
  if (!ok) process.exitCode = 1;
}

async function main() {
  await startServer();
  const browser = await puppeteer.launch({ executablePath: CHROME, headless: true });
  const page = await browser.newPage();
  page.on('pageerror', (e) => console.error('[pageerror]', e.message));

  await page.goto(APP_URL, { waitUntil: 'load', timeout: 120000 });
  await page.waitForFunction('window.__oo && window.__oo.ready === true', { timeout: 180000 })
    .catch(async () => {
      const st = await page.$eval('#status', (e) => e.textContent).catch(() => '?');
      throw new Error('Timed out waiting for Octave ready. status=' + st);
    });
  console.log('octave ready\n');

  // Gate 1: plot/image m-files present & loadable
  const exist = await page.evaluate(() => {
    const m = window.__oo.module;
    return {
      plot: m.feval('exist', ['plot'], 1),
      hist: m.feval('exist', ['hist'], 1),
      surf: m.feval('exist', ['surf'], 1),
      imshow: m.feval('exist', ['imshow'], 1),
      boxplot: m.feval('exist', ['boxplot'], 1),
    };
  });
  check('Gate 1: plot.m loadable', exist.plot[0] > 0, JSON.stringify(exist));

  // Gate 2: gnuplot toolkit registered + default
  const tk = await page.evaluate(() => {
    const m = window.__oo.module;
    // graphics_toolkit("gnuplot") errors if gnuplot is not registered.
    const setWorks = m.eval_string('graphics_toolkit("gnuplot");') === 0;
    return { setWorks, current: m.feval('graphics_toolkit', [], 1) };
  });
  check('Gate 2: gnuplot registered', tk.setWorks, 'graphics_toolkit("gnuplot") succeeds');
  check('Gate 2: gnuplot default', tk.current[0] === 'gnuplot', JSON.stringify(tk.current));

  // Basic eval + plot -> does /plot.gp get written (no octave-side error)?
  const plot = await page.evaluate(async () => {
    const oo = window.__oo;
    oo.run('plot(sin(0:0.1:10))');
    await oo.awaitRender();
    return { error: oo.lastError, scriptBytes: oo.lastPlotLength(), svgCount: oo.plotSVGCount() };
  });
  check('Gate 1/3: plot() runs w/o error', !plot.error, plot.error || `script=${plot.scriptBytes}B`);
  check('Gate 3: /plot.gp produced', plot.scriptBytes > 0, `${plot.scriptBytes}B`);
  check('Gate 3: SVG injected', plot.svgCount >= 1, `svg=${plot.svgCount}`);

  await browser.close();
  server.kill();
  console.log('\ndone');
  process.exit(process.exitCode || 0);
}

main().catch(async (err) => {
  console.error(err.message || err);
  if (server) server.kill();
  process.exit(2);
});
