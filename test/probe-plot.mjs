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
await page.waitForFunction('window.__oo && window.__oo.ready === true', { timeout: 180000 });

const out = await page.evaluate(async () => {
  const oo = window.__oo;
  const m = oo.module;
  const r = {};
  r.before = (() => { try { const st = m.FS.stat('/plot.gp'); return 'exists ' + st.size; } catch (e) { return 'absent'; } })();
  const st = m.eval_string('plot(1:10);');
  r.evalStatus = st;
  r.err = m.last_error_message();
  r.afterPlot = (() => { try { const st = m.FS.stat('/plot.gp'); return 'exists ' + st.size; } catch (e) { return 'absent'; } })();
  const st2 = m.eval_string('drawnow;');
  r.drawnowStatus = st2;
  r.err2 = m.last_error_message();
  r.afterDrawnow = (() => { try { const st = m.FS.stat('/plot.gp'); return 'exists ' + st.size; } catch (e) { return 'absent'; } })();
  // try explicit graphics_toolkit + figure to force the stream
  const st3 = m.eval_string('graphics_toolkit("gnuplot"); h = figure("visible","off"); plot(h, 1:10, 1:10); drawnow;');
  r.forcedStatus = st3;
  r.err3 = m.last_error_message();
  r.afterForced = (() => { try { const st = m.FS.stat('/plot.gp'); return 'exists ' + st.size; } catch (e) { return 'absent'; } })();
  // does /plot.gp have content?
  r.content = (() => { try { return m.FS.readFile('/plot.gp', { encoding: 'utf8' }).slice(0, 200); } catch (e) { return 'ERR ' + e.message; } })();
  return r;
});
console.log(JSON.stringify(out, null, 2));
await browser.close();
server.kill();
process.exit(0);
