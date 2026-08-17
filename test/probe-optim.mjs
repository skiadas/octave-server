/* probe-optim.mjs — verify the nelder_mead_min gap is closed, without a full
   octave-wasm rebuild. Writes patches/octave-m/scripts/data-smoothing-forge/
   nelder_mead_min.m into the running wasm MEMFS at the baked data-smoothing-
   forge path (already on the addpath), rehashes, then:
     1. which('nelder_mead_min') resolves to that path (was NOT-FOUND before)
     2. regdatasmooth(x, y, "d", 2) succeeds with NO explicit lambda — the
        default GCV auto-tune path that previously errored.
   A green here means the Dockerfile ship + rebuild will close the gate gap,
   given the same byte-for-byte file. */
import { spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';
import puppeteer from 'puppeteer-core';

const ROOT = new URL('..', import.meta.url).pathname;
const HERE = new URL('.', import.meta.url).pathname;
const PORT = 8096;
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const APP_URL = `http://127.0.0.1:${PORT}/app/`;
const SRC = readFileSync(HERE + '..' + '/patches/octave-m/scripts/data-smoothing-forge/nelder_mead_min.m', 'utf8');
const DST = '/usr/src/octave/m/data-smoothing-forge/nelder_mead_min.m';

const server = spawn('python3', ['-m', 'http.server', String(PORT)], { cwd: ROOT });
await new Promise((r) => server.once('spawn', r));
const browser = await puppeteer.launch({ executablePath: CHROME, headless: true });
const page = await browser.newPage();
page.on('pageerror', (e) => console.error('[pageerror]', e.message));
await page.goto(APP_URL, { waitUntil: 'load', timeout: 120000 });
await page.waitForFunction('window.__oo && window.__oo.ready === true', { timeout: 180000 });

const out = await page.evaluate(async (src, dst) => {
  const m = window.__oo.module;
  const r = {};
  try {
    m.FS.writeFile(dst, src); // inject the compat file at the baked path
    r.wrote = true;
  } catch (e) { r.wrote = false; r.writeErr = String(e); }

  // Force the function table to notice the new file.
  try { m.eval_string('rehash;'); } catch (e) { r.rehashErr = String(e); }

  try {
    const w = m.feval('which', ['nelder_mead_min'], 1);
    r.which = Array.isArray(w) ? String(w[0]) : String(w);
  } catch (e) { r.whichErr = String(e); }

  // Default path: NO explicit lambda -> must auto-tune via nelder_mead_min.
  r.regdatasmooth_ok = false;
  r.regdatasmooth_err = '';
  try {
    m.eval_string('x = (-10:0.2:10).\';');
    m.eval_string('y = sin(x) + 0.2*randn(numel(x),1);');
    const st = m.eval_string('ys = regdatasmooth(x, y, "d", 2);');
    if (st !== 0) {
      r.regdatasmooth_err = m.last_error_message();
    } else {
      // Evaluate expressions that reference workspace vars (feval args would
      // pass the *string* 'ys', not the variable — numel('ys') is 2).
      r.regdatasmooth_len = Number((m.feval('eval', ['numel(ys)'], 1) || [0])[0]);
      r.regdatasmooth_valid = Number((m.feval('eval', ['all(isfinite(ys)) && isequal(size(ys), size(x))'], 1) || [0])[0]);
      r.regdatasmooth_ok = !!(r.regdatasmooth_len === 101 && r.regdatasmooth_valid === 1);
    }
  } catch (e) { r.regdatasmooth_err = String(e); }
  return r;
}, SRC, DST);

console.log(JSON.stringify(out, null, 2));
await browser.close();
server.kill();
process.exit(0);