/* Route G verification battery (M1/M3): drives the PoC app in headless Chrome.
   Hardened so a CPU-bound gnuplot render can't run away:
   - per-case hard timeout (CASE_TIMEOUT_MS), restarting Chrome on a hang
   - one retry per case on a fresh Chrome (host-load crashes are often transient)
   - browser + server always torn down (finally + catch)
   - stall-guard force-exits if no progress line appears for 3 min
   - stale headless Chrome from aborted runs killed at startup */
import { spawn, execSync } from 'node:child_process';
import puppeteer from 'puppeteer-core';

const ROOT = new URL('..', import.meta.url).pathname;
const PORT = 8080;
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const APP_URL = `http://127.0.0.1:${PORT}/app/`;

/* gnuplot-wasm rendering is CPU-bound (see docs/verification.md); a single
   render can take minutes (surf alone ~215s, more under host load). Cap each
   case so a hung render can't pin a core indefinitely — we restart Chrome
   and move on. The cap is smaller under SKIP_SLOW so a slothful render fails
   the fast tier loudly rather than stalling it. The cap is computed after
   SKIP_SLOW (below). */

/* Upper bound for chrome.close() / server teardown so a wedged connection
   can never block the harness from exiting. */
const TEARDOWN_MS = 15000;

/* Last-resort escape hatch: if the harness ever stalls on a wedged CDP
   connection that even the bounded teardown can't settle, force-exit so the
   run can never pin the shell. Unlike a fixed total-time cap, the timer
   resets on every progress line, so slow-but-working renders (which legitimately
   take minutes) don't trip it — only dead air does. unref()d so a healthy
   finished run isn't kept alive. */
let stallTimer;
function stallGuard() {
  clearTimeout(stallTimer);
  stallTimer = setTimeout(() => {
    console.error('[stall-guard] no progress for 3 min — force exiting');
    process.exit(9);
  }, 180000);
  stallTimer.unref();
}

const FULL_CASES = [
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

/* SKIP_SLOW=1 drops the CPU-bound gnuplot cases (surf/boxplot/imshow) plus
   mesh, which intermittently takes minutes under host load. Use for routine
   UI work to keep the battery in minutes; run the full set only when the
   wasm artifacts change. */
const SKIP_SLOW_CASES = new Set(['mesh (3-D)', 'surf (3-D)', 'boxplot (statistics-forge)', 'imshow']);
const SKIP_SLOW = process.env.SKIP_SLOW === '1';
const CASES = SKIP_SLOW ? FULL_CASES.filter(([n]) => !SKIP_SLOW_CASES.has(n)) : FULL_CASES;
const CASE_TIMEOUT_MS = SKIP_SLOW ? 150000 : 420000;

let server;
let browser;
let page;

function startServer() {
  return new Promise((resolve, reject) => {
    server = spawn('python3', ['-m', 'http.server', String(PORT)], { cwd: ROOT });
    server.once('error', reject);
    server.once('spawn', resolve);
  });
}

/* Wait until http.server is actually accepting connections (spawn resolves
   before python has bound the port, which can race a page load). */
async function waitForServer(url, ms) {
  const deadline = Date.now() + ms;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(2000) });
      if (res.ok) return true;
    } catch (e) { /* not up yet */ }
    await new Promise((r) => setTimeout(r, 300));
  }
  return false;
}

/* Kill headless Chrome left behind by an aborted run (puppeteer's temp
   profiles are uniquely named, so this can't touch a user's own Chrome). */
function killStaleChrome() {
  try {
    execSync("pkill -f 'puppeteer_dev_chrome_profile' || true", { stdio: 'ignore' });
  } catch (e) { /* pkill unavailable — nothing to do */ }
}

/* The harness owns PORT; drop stale listeners (e.g. a leftover python
   http.server from an aborted run) so the fresh server actually binds. */
function killStaleServer(port) {
  try {
    execSync(`lsof -ti :${port} 2>/dev/null | xargs kill 2>/dev/null || true`, { stdio: 'ignore' });
  } catch (e) { /* lsof unavailable — nothing to do */ }
}

function launchBrowser() {
  return puppeteer.launch({
    executablePath: CHROME,
    headless: true,
    args: ['--no-first-run', '--no-default-browser-check'],
    protocolTimeout: 600000,
  });
}

async function newReadyPage() {
  page = await browser.newPage();
  page.setDefaultTimeout(CASE_TIMEOUT_MS);
  page.on('pageerror', (e) => console.error('[pageerror]', e.message));
  page.on('console', (msg) => {
    if (msg.type() === 'error') console.error('[console.error]', msg.text());
  });
  console.log('Loading app…');
  try {
    await page.goto(APP_URL, { waitUntil: 'load', timeout: 120000 });
  } catch (err) {
    // Sandbox proxy can transiently refuse a fresh connection; retry once.
    await new Promise((r) => setTimeout(r, 3000));
    await page.goto(APP_URL, { waitUntil: 'load', timeout: 120000 });
  }
  await page.waitForFunction('window.__oo && window.__oo.ready === true', { timeout: 180000 })
    .catch(() => {
      throw new Error('Timed out waiting for Octave ready. Status: ' + page.$eval('#status', (e) => e.textContent));
    });
}

async function restartChrome() {
  stallGuard();
  if (browser) {
    await Promise.race([
      browser.close().catch(() => {}),
      new Promise((resolve) => setTimeout(resolve, TEARDOWN_MS)),
    ]);
  }
  browser = await launchBrowser();
  // A crash sometimes coincides with the HTTP server dying; revive it before
  // pointing a fresh Chrome at it.
  if (!(await waitForServer(`http://127.0.0.1:${PORT}/`, 6000))) {
    console.error('[restart] server went away — restarting it');
    killStaleServer(PORT);
    await startServer();
    if (!(await waitForServer(`http://127.0.0.1:${PORT}/`, 15000))) {
      throw new Error(`HTTP server on port ${PORT} did not come back`);
    }
  }
  await newReadyPage();
  console.log('Octave ready. Continuing battery…\n');
}

function withTimeout(promise, ms) {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error('timed out after ' + (ms / 1000) + 's')), ms);
    promise.then(
      (v) => { clearTimeout(t); resolve(v); },
      (e) => { clearTimeout(t); reject(e); });
  });
}

const results = [];
function record(name, ok, detail) {
  results.push({ name, ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}: ${detail}`);
  stallGuard();
}

/* Bounded teardown: always runs, never blocks the harness from exiting.
   A wedged CDP connection (renderer crash) can make browser.close() hang, so
   race it against a hard deadline. */
async function teardown() {
  if (browser) {
    await Promise.race([
      browser.close().catch(() => {}),
      new Promise((resolve) => setTimeout(resolve, TEARDOWN_MS)),
    ]);
  }
  if (server) server.kill('SIGKILL');
}

/* Attempt one render. Returns { ok, detail } — on a hang/crash it returns
   ok=false with the failure detail. */
async function runOnce(script, useFile) {
  try {
    const r = await withTimeout(page.evaluate(async (code, asFile) => {
      const oo = window.__oo;
      if (asFile) oo.runFile(code);
      else oo.run(code);
      await oo.awaitRender();
      return { error: oo.lastError, svgCount: oo.plotSVGCount(), scriptBytes: oo.lastPlotLength() };
    }, script, useFile), CASE_TIMEOUT_MS);
    const ok = !r.error && r.svgCount >= 1 && r.scriptBytes > 0;
    return { ok, detail: r.error ? r.error.split('\n')[0] : `svg=${r.svgCount} script=${r.scriptBytes}B` };
  } catch (err) {
    return { ok: false, detail: 'ABORT: ' + (err && err.message ? err.message : String(err)) };
  }
}

/* Run one battery entry: one attempt, and if the render/harness wedged under
   host load, one retry on a fresh Chrome. Records the final result only. */
async function runCase(name, script, useFile) {
  let r = await runOnce(script, useFile);
  if (!r.ok) {
    await restartChrome();
    r = await runOnce(script, useFile);
  }
  record(name, r.ok, r.detail);
  return !r.ok;
}

async function main() {
  killStaleChrome();
  killStaleServer(PORT);
  let code = 0;
  try {
    await startServer();
    if (!(await waitForServer(`http://127.0.0.1:${PORT}/`, 15000))) {
      throw new Error(`HTTP server on port ${PORT} never came up`);
    }
    if (SKIP_SLOW) console.log(`SKIP_SLOW=1 — skipping slow render cases: ${[...SKIP_SLOW_CASES].join(', ')}\n`);
    await restartChrome();
    console.log('Running battery…\n');
    stallGuard();

    for (const [name, cmd] of CASES) {
      if (await runCase(name, cmd, false)) await restartChrome();
    }

    // Whole-file editing: run a multi-line script (loop + plot) via runFile.
    const fileScript = [
      'tot = 0;',
      'for k = 1:10',
      '  tot += k;',
      'endfor',
      'printf("sum=%d\\n", tot);',
      'plot(sin(0:0.1:10));',
    ].join('\n');
    if (await runCase('whole-file source', fileScript, true)) await restartChrome();

    // Run-button path: a real click on #runBtn (not the __oo hook). Browsers
    // pass the click Event to the listener; this guards the regression where
    // that Event reached FS.writeFile as "Unsupported data type".
    {
      let r;
      try {
        r = await withTimeout(page.evaluate(() => {
          const editor = document.getElementById('editor');
          editor.value = 'printf("button-click-ok\\n");\n';
          document.getElementById('runBtn').click();
          return {
            error: window.__oo.lastError,
            out: document.getElementById('output').innerText.slice(-200),
          };
        }), CASE_TIMEOUT_MS);
      } catch (err) {
        record('run button click', false, 'ABORT: ' + (err && err.message ? err.message : String(err)));
        await restartChrome();
        r = null;
      }
      if (r) {
        const ok = !r.error && /button-click-ok/.test(r.out);
        record('run button click', ok, ok ? 'click wrote + evaluated the editor file' : (r.error || 'marker not printed'));
      }
    }

    console.log('\n=== Summary ===');
    let fail = 0;
    for (const r of results) {
      if (!r.ok) { fail++; console.log(`FAIL  ${r.name}: ${r.detail}`); }
    }
    console.log(`${results.length - fail}/${results.length} passed`);
    code = fail ? 1 : 0;
  } catch (err) {
    console.error(err);
    code = 2;
  } finally {
    await teardown();
  }
  process.exit(code);
}

main().catch((err) => {
  console.error(err);
  if (server) server.kill('SIGKILL');
  process.exit(2);
});
