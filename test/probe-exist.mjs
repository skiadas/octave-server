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
await page.goto('http://127.0.0.1:8080/app/', { waitUntil: 'load', timeout: 120000 });
await page.waitForFunction('window.__oo && window.__oo.module', { timeout: 120000 });
await new Promise((r) => setTimeout(r, 5000));

const out = await page.evaluate(() => {
  const m = window.__oo.module;
  const r = {};
  const feval = (fn, args, n) => {
    try { return m.feval(fn, args || [], n || 1); }
    catch (e) { return 'ERR:' + e.message; }
  };
  // Is plot.m physically in the FS?
  const FS = m.FS;
  const plotDraw = (() => { try { return FS.readdir('/usr/src/octave/m/plot/draw'); } catch (e) { return 'ERR'; } })();
  r.plot_m_in_fs = plotDraw.includes('plot.m');
  r.draw_count = Array.isArray(plotDraw) ? plotDraw.length : 'ERR';
  r.sample_draw = Array.isArray(plotDraw) ? plotDraw.filter((x) => /\.m$/.test(x)).slice(0, 12) : plotDraw;
  // exist() results
  r.exist_plot = feval('exist', ['plot']);
  r.exist_plot_m = feval('exist', ['plot.m']);
  r.exist_area = feval('exist', ['area']);
  r.exist_mean = feval('exist', ['mean']);
  r.exist_hist = feval('exist', ['hist']);
  r.exist_surf = feval('exist', ['surf']);
  r.exist_imshow = feval('exist', ['imshow']);
  r.exist_histc = feval('exist', ['histc']);
  // Try which()
  r.which_plot = feval('which', ['plot']);
  r.which_area = feval('which', ['area']);
  return r;
});
console.log(JSON.stringify(out, null, 2));
await browser.close();
server.kill();
process.exit(0);
