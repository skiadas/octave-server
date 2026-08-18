/* Single-file check (build gate): opens dist/single/index.html via the file://
   protocol in headless Chrome and asserts the app actually boots. This is the
   literal proof that the "self-contained / no web server needed" build works
   from the local filesystem. Requires `npm run build:single` first.

   Blocking idea in the codebase: the single-file HTML inlines the wasm
   binaries as base64 data: URIs (window.__OO_ASSETS__), which main.js resolves
   through locateFile — so no XHR/fetch over file:// is ever attempted for the
   app's own assets. Pyodide (symbolic) still needs the CDN, but numeric +
   plotting + gnuplot + the file system boot with zero network. */
import { spawn } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import puppeteer from 'puppeteer-core';

const ROOT = new URL('..', import.meta.url).pathname;
const CHROME = process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const FILE_URL = pathToFileURL(ROOT + 'dist/single/index.html').href;

let failures = 0;
function check(name, ok, detail) {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}: ${detail}`);
  if (!ok) failures = 1;
}

async function main() {
  const browser = await puppeteer.launch({
    executablePath: CHROME,
    headless: true,
    protocolTimeout: 600000,
    args: ['--allow-file-access-from-files'],
  });
  try {
    const page = await browser.newPage();
    page.on('pageerror', (e) => console.error('[pageerror]', e.message));
    await page.goto(FILE_URL, { waitUntil: 'load', timeout: 120000 });
    await page.waitForFunction('window.__oo && window.__oo.ready === true', { timeout: 180000 })
      .catch(() => { throw new Error('Octave not ready: ' + page.$eval('#status', (e) => e.textContent)); });

    const r = await page.evaluate(() => {
      const oo = window.__oo;
      const output = document.getElementById('output');
      const before = output.textContent.length;
      oo.runFile('printf("single-ok\\n");');
      const out = output.textContent.slice(before);
      return { ready: oo.ready, error: oo.lastError, out, hasAssets: !!window.__OO_ASSETS__ };
    });
    check('file:// single-file boots Octave', r.ready === true, `ready=${r.ready}`);
    check('embedded assets present (no fetch needed)', r.hasAssets === true, `__OO_ASSETS__=${r.hasAssets}`);
    check('runFile evaluates a script over file://', !r.error && /single-ok/.test(r.out), r.error || 'printed single-ok');
  } finally {
    try { await browser.close(); } catch (e) {}
  }
  console.log(failures ? '\nSingle-file check: FAILED' : '\nSingle-file check: all passed');
  process.exit(failures);
}
main().catch((e) => { console.error(e); process.exit(2); });