/* Route G verification battery (M1/M3): drives the PoC app in headless Chrome. */
import { spawn } from 'node:child_process';
import puppeteer from 'puppeteer-core';

const ROOT = new URL('..', import.meta.url).pathname;
const PORT = 8080;
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const APP_URL = `http://127.0.0.1:${PORT}/app/`;

const CASES = [
  ['plot (1-D line)', 'plot(sin(0:0.1:10))'],
  ['histogram', 'hist(randn(1000,1), 30)'],
  ['scatter', 'scatter(randn(50,1), randn(50,1))'],
  ['surf (3-D)', 'surf(peaks(30))'],
  ['mesh (3-D)', 'mesh(peaks(20))'],
  ['contour', 'contour(peaks(20))'],
  ['plot3', 'plot3(rand(10,1), rand(10,1), rand(10,1))'],
  ['bar', 'bar(randn(5,1))'],
  ['boxplot (statistics-forge)', 'boxplot(randn(100,4))'],
  ['imshow', 'imshow(rand(50,50))'],
  ['hold on (multi-line)', 'plot(1:10); hold on; plot(1:5, "r-")'],
];

let server;
function startServer() {
  return new Promise((resolve) => {
    server = spawn('python3', ['-m', 'http.server', String(PORT)], { cwd: ROOT });
    server.once('spawn', resolve);
  });
}

const results = [];

async function main() {
  await startServer();
  const browser = await puppeteer.launch({
    executablePath: CHROME,
    headless: true,
    args: ['--no-first-run', '--no-default-browser-check'],
    protocolTimeout: 600000,
  });

  const page = await browser.newPage();
  page.on('pageerror', (e) => console.error('[pageerror]', e.message));
  page.on('console', (msg) => {
    const t = msg.type();
    if (t === 'error') console.error('[console.error]', msg.text());
  });

  console.log('Loading app…');
  await page.goto(APP_URL, { waitUntil: 'load', timeout: 120000 });

  // Wait for Octave to be ready (module load + init).
  await page.waitForFunction('window.__oo && window.__oo.ready === true', { timeout: 180000 })
    .catch(() => {
      throw new Error('Timed out waiting for Octave ready. Status: ' + page.$eval('#status', (e) => e.textContent));
    });

  console.log('Octave ready. Running battery…\n');

  for (const [name, cmd] of CASES) {
    const r = await page.evaluate(async (c) => {
      const oo = window.__oo;
      oo.run(c);
      await oo.awaitRender();
      return {
        error: oo.lastError,
        svgCount: oo.plotSVGCount(),
        scriptBytes: oo.lastPlotLength(),
        status: oo.status,
      };
    }, cmd);

    const ok = !r.error && r.svgCount >= 1 && r.scriptBytes > 0;
    results.push({ name, ok, detail: r.error || `svg=${r.svgCount} script=${r.scriptBytes}B` });
    console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}: ${r.error ? r.error.split('\n')[0] : `svg=${r.svgCount}, ${r.scriptBytes}B`}`);
  }

  await browser.close();
  server.kill();

  console.log('\n=== Summary ===');
  let fail = 0;
  for (const r of results) {
    if (!r.ok) { fail++; console.log(`FAIL  ${r.name}: ${r.detail}`); }
  }
  console.log(`${results.length - fail}/${results.length} passed`);
  process.exit(fail ? 1 : 0);
}

main().catch((err) => {
  console.error(err);
  if (server) server.kill();
  process.exit(2);
});
