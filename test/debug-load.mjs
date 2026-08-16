import { spawn } from 'node:child_process';
import puppeteer from 'puppeteer-core';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const server = spawn('python3', ['-m', 'http.server', '8080'], { cwd: ROOT });
await new Promise((r) => server.once('spawn', r));
const browser = await puppeteer.launch({
  executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  headless: true,
});
const page = await browser.newPage();
page.on('console', (m) => console.log('[console.' + m.type() + ']', m.text().slice(0, 200)));
page.on('pageerror', (e) => console.log('[pageerror]', e.message.slice(0, 200)));
page.on('requestfailed', (r) => console.log('[reqfail]', r.url().slice(0, 120), r.failure()?.errorText));
page.on('response', (r) => { if (r.status() >= 400) console.log('[resp]', r.status(), r.url().slice(0, 140)); });

await page.goto('http://127.0.0.1:8080/app/', { waitUntil: 'load', timeout: 120000 });
await new Promise((r) => setTimeout(r, 45000));

const st = await page.evaluate(() => ({
  status: document.getElementById('status')?.textContent,
  out: document.getElementById('output')?.textContent?.slice(0, 1500),
  hasOCTAVE: typeof window.OCTAVE,
  hasGnuplot: typeof window.createGnuplot,
  hasOO: !!window.__oo,
  ready: window.__oo?.ready,
  hasModule: !!(window.__oo && window.__oo.module),
}));

const probes = await page.evaluate(() => {
  const m = window.__oo.module;
  if (!m) return { error: 'no module' };
  const r = {};
  for (const f of ['graphics_toolkit', 'plot', 'surf', 'hist', 'imshow', 'boxplot', 'gnuplot_binary', '__gnuplot_drawnow__', 'available_graphics_toolkits']) {
    try { r[f] = m.feval('exist', [f], 1)[0]; } catch (e) { r[f] = 'err:' + e.message; }
  }
  try {
    r['path'] = m.feval('path', [], 1);
    r['pathList'] = Array.isArray(r['path']) && r['path'][0] ? String(r['path'][0]).split(':').filter(x => x.includes('/m/')) : [];
  } catch (e) { r['pathErr'] = e.message; }
  return r;
});
console.log('PROBES:', JSON.stringify(probes, null, 2));
console.log('STATE:', JSON.stringify(st, null, 2));
await browser.close();
server.kill();
process.exit(0);
