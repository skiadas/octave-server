/* UI smoke test (fast tier, ~1-2 min): boots the real octave-wasm once and
   exercises the UI wiring with only NON-plot scripts, so no gnuplot render is
   ever triggered. The Pyodide/SymPy CDN is blocked for determinism (the app
   degrades gracefully). When the wasm artifacts change, add the full battery
   (verify.mjs) — not this file. */
import { spawn } from 'node:child_process';
import puppeteer from 'puppeteer-core';

const ROOT = new URL('..', import.meta.url).pathname;
const PORT = 8095;
const CHROME = process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const APP_URL = `http://127.0.0.1:${PORT}/app/`;

let server;
function startServer() {
  return new Promise((resolve, reject) => {
    server = spawn('python3', ['-m', 'http.server', String(PORT)], { cwd: ROOT });
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
    protocolTimeout: 600000,
  });
  try {
    const page = await browser.newPage();
    page.on('pageerror', (e) => console.error('[pageerror]', e.message));
    // Block the Pyodide/SymPy CDN: deterministic, offline, no slow fetch.
    await page.setRequestInterception(true);
    page.on('request', (req) => {
      if (/jsdelivr\.net/.test(req.url())) req.abort();
      else req.continue();
    });

    await page.goto(APP_URL, { waitUntil: 'load', timeout: 120000 }).catch(async (e) => {
      // Sandbox proxies can transiently refuse a fresh connection; retry once.
      await new Promise((r) => setTimeout(r, 3000));
      await page.goto(APP_URL, { waitUntil: 'load', timeout: 120000 });
    });
    await page.waitForFunction('window.__oo && window.__oo.ready === true', { timeout: 180000 })
      .catch(() => { throw new Error('Octave not ready: ' + page.$eval('#status', (e) => e.textContent)); });

    const r = await page.evaluate(() => {
      const oo = window.__oo;
      const output = document.getElementById('output');
      const before = output.textContent.length;
      oo.runFile('printf("smoke-ok\\n");');
      const out = output.textContent.slice(before);
      return { error: oo.lastError, out, svgs: oo.plotSVGCount() };
    });
    check('runFile evaluates a script', !r.error && /smoke-ok/.test(r.out), r.error || 'printed smoke-ok');
    check('no gnuplot render triggered', r.svgs === 0, `svg count=${r.svgs}`);

    const click = await page.evaluate(() => {
      document.getElementById('editor').value = 'printf("click-ok\\n");\n';
      document.getElementById('runBtn').click();
      return { error: window.__oo.lastError, out: document.getElementById('output').innerText.slice(-200) };
    });
    check('run button click evaluates editor', !click.error && /click-ok/.test(click.out), click.error || 'printed click-ok');

    const bad = await page.evaluate(() => {
      document.getElementById('filename').value = 'bad name!';
      window.__oo.runFile('x=1;');
      document.getElementById('filename').value = 'script.m';
      return { error: window.__oo.lastError, out: document.getElementById('output').innerText.slice(-200) };
    });
    check('invalid file name rejected', /Invalid file name/.test(bad.out), bad.out.match(/Invalid file name[^\n]*/)?.[0] || 'no message');

    const err = await page.evaluate(() => {
      window.__oo.runFile('undefined_function_check_smoke();');
      return { error: window.__oo.lastError };
    });
    check('eval error is surfaced to JS', typeof err.error === 'string' && err.error.length > 0, err.error.split('\n')[0]);
  } finally {
    try { await browser.close(); } catch (e) {}
    if (server) server.kill('SIGKILL');
  }

  console.log(failures ? '\nUI smoke: FAILED' : '\nUI smoke: all passed');
  process.exit(failures);
}

main().catch((e) => { console.error(e); if (server) server.kill('SIGKILL'); process.exit(2); });