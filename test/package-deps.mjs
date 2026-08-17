/* Dependency audit for the m-trees baked into octave.wasm (the anti-whack-a-
   mole gate). Two modes:

     node package-deps.mjs [--update-allowlist]
       Boots the app in headless Chrome and sweeps the *shipped* wasm FS —
       every .m in statistics-forge / data-smoothing-forge / symbolic-sympy.
       Every call-site identifier is resolved at runtime with `which` against
       the real build and bucketed: BUILTIN / CORE / BAKED / NOT-FOUND.
       NOT-FOUND ids not covered by test/package-deps.allowlist.json are GAPS;
       the gate exits 1. Baking a package whose m-tree reaches into another
       package (nelder_mead_min-style) fails until fixed or explicitly
       allowlisted. Also flags shell-outs and compiled artifacts in the trees.

     node package-deps.mjs --triage-src <dir>
       No browser needed. Static scan of a package source tree (inst/ + src/)
       classifying each source file as HARD-NO (browser-impossible: process /
       shell / network / native-dl / thread usage) vs PORTABLE (S1/S2: Octave
       API + libc + LAPACK) vs PORTABLE-with-foreign-libs (S3). Use before
       deciding whether a "really important" compiled package is worth porting.

   Needs the same harness as octave-check.mjs (Node + puppeteer-core + Chrome). */
import { readFileSync, writeFileSync, readdirSync, existsSync } from 'node:fs';
import { join, relative } from 'node:path';
import { spawn, execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import puppeteer from 'puppeteer-core';

const ROOT = new URL('..', import.meta.url).pathname;
const HERE = fileURLToPath(new URL('.', import.meta.url));
const PORT = 8081;
const CHROME = process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const APP_URL = `http://127.0.0.1:${PORT}/app/`;
const ALLOWLIST = join(HERE, 'package-deps.allowlist.json');

/* Baked trees, by their virtual-FS paths (see patches/octave-src/Makefile). */
const TREES = [
  ['statistics-forge', '/usr/src/octave/m/statistics-forge'],
  ['data-smoothing-forge', '/usr/src/octave/m/data-smoothing-forge'],
  ['symbolic-sympy', '/usr/src/octave/m/symbolic-sympy'],
];

/* ------------------------------------------------------------------ */
/* Harness                                                            */
/* ------------------------------------------------------------------ */
let server;
function startServer() {
  return new Promise((resolve) => {
    server = spawn('python3', ['-m', 'http.server', String(PORT)], { cwd: ROOT });
    server.once('spawn', resolve);
    server.on('error', (e) => console.error('[server error]', e.message));
    server.on('exit', (c, s) => console.error(`[server exit] code=${c} signal=${s}`));
  });
}
function killStale() {
  try { execSync("pkill -f 'puppeteer_dev_chrome_profile' || true", { stdio: 'ignore' }); } catch (e) {}
  try { execSync(`lsof -ti :${PORT} 2>/dev/null | xargs kill 2>/dev/null || true`, { stdio: 'ignore' }); } catch (e) {}
}
async function teardown(browser) {
  if (browser) { try { await browser.close(); } catch (e) {} }
  if (server) server.kill('SIGKILL');
}

/* ------------------------------------------------------------------ */
/* --triage-src mode (no browser): static classification              */
/* ------------------------------------------------------------------ */
const HARD_NO = [
  ['process', /\b(fork|vfork|execve?|execl|execv|execle|execvp|posix_spawn|waitpid|wait4|getpid|kill|raise|alarm|getuid|geteuid|setuid|setgid|ptrace|unshare)\s*\(/g],
  ['shell', /\b(system|popen|pclose|dos|unix|shell)\s*\(/g],
  ['net', /\b(socket|bind|connect|listen|accept|recv|send|gethostbyname|getaddrinfo|ntohl|htonl|select)\s*\(/g],
  ['native-dl', /\b(dlopen|dlclose|dlsym|dlinfo)\s*\(|#include\s*<dlfcn/gi],
  ['threads', /\b(pthread_create|pthread_join|omp_get_num_threads|#pragma\s*oMP|OpenMP)/gi],
  ['fs-os', /\b(fchmod|chown|chroot|mkfifo|mknod|mount|socketpair)\b/g],
  ['octave-parallel', /\b(parcellfun|pararrayfun|netarrayfun|__parallel_package_version__)\b/g],
  ['shell-m', /^!|`[^`]*`/gm],
];
const FOREIGN_LIB = /#include\s*<\s*(gsl|glpk|hdf5|netcdf|curl|mpfr|gmp|z3|opengl|GL(?!S|UTIL)|gtk[^>]*|blas|lapacke|cblas|ocl)[^>]*>/i;
const OCTAVE_API = /#include\s*<\s*(octave\/[^>]+|oct\.h|mex\.h|f77-fcn\.h|lo-[a-z-]+\.h|oct-[a-z-]+\.h)\s*>/i;

function walkSourceFiles(dir, out = []) {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) walkSourceFiles(p, out);
    else if (/\.(m|cc|cpp|c|h|hpp)$/.test(e.name)) out.push(p);
  }
  return out;
}

function triageSrc(dir) {
  const base = dir.replace(/\/+$/, '');
  const files = walkSourceFiles(base);
  const rows = [];
  let hardNo = 0, portable = 0, foreign = 0;
  const hasConfigure = existsSync(join(base, 'configure.ac')) || existsSync(join(base, 'CMakeLists.txt'));
  const prebuilt = walkSourceFiles(base).filter((p) => /\.(oct|mex|o|so|dylib|dll)$/.test(p));

  for (const f of files) {
    const text = readFileSync(f, 'utf8');
    const rel = relative(base, f) || f;
    const hits = [];
    for (const [label, re] of HARD_NO) {
      for (const m of text.matchAll(re)) hits.push(label + ': ' + m[0].replace(/\s+/g, ' ').slice(0, 45));
    }
    let verdict = 'PORTABLE';
    if (hits.length) { verdict = 'HARD-NO'; hardNo++; }
    else if (FOREIGN_LIB.test(text) && !OCTAVE_API.test(text)) { verdict = 'PORTABLE (foreign lib: S3)'; foreign++; }
    else portable++;
    rows.push({ file: rel, verdict, hits });
  }

  rows.sort((a, b) => (a.verdict.startsWith('HARD') ? -1 : b.verdict.startsWith('HARD') ? 1 : 0));
  console.log(`triage-src: ${base}`);
  console.log(`  ${files.length} source files | ${hasConfigure ? 'autotools/CMake present (S2 hint)' : 'no configure step'}` +
    (prebuilt.length ? `| ships ${prebuilt.length} prebuilt .oct/.so (unloadable as-is — port the source)` : ''));
  console.log(`  verdicts: HARD-NO=${hardNo} PORTABLE=${portable} PORTABLE(S3)=${foreign}\n`);
  for (const r of rows) {
    if (r.verdict !== 'PORTABLE' || process.env.VERBOSE) {
      console.log(`  [${r.verdict}] ${r.file}`);
      for (const h of r.hits) console.log(`      ${h}`);
    }
  }
  return hardNo > 0 ? 1 : 0;
}

/* ------------------------------------------------------------------ */
/* Audit mode: in-page sweep of the shipped wasm FS. Serialized to     */
/* page.evaluate as-is, so no string escaping for the regexes.         */
/* ------------------------------------------------------------------ */
async function sweepPage(trees) {
  const M = window.__oo.module;
  function walk(dir, out) {
    let entries;
    try { entries = M.FS.readdir(dir); } catch (e) { return out; }
    entries.sort();
    for (let i = 0; i < entries.length; i++) {
      const n = entries[i];
      if (n === '.' || n === '..') continue;
      const p = dir + '/' + n;
      let st;
      try { st = M.FS.stat(p); } catch (e) { continue; }
      if (M.FS.isDir(st.mode)) walk(p, out);
      else if (n.endsWith('.m')) out.push(p);
    }
    return out;
  }
  const files = {};
  let compiled = [];
  for (const [name, dir] of trees) {
    files[name] = walk(dir, []);
    // any non-.m artifacts in the baked tree would be a packaging red flag
    const all = walk(dir, []);
    compiled = compiled.concat(all.filter((p) => /\.(oct|mex|o|so|dylib|dll)$/.test(p)).map((p) => name + ': ' + p));
  }

  // Language keywords — never callable, never locals.
  const KEYWORDS = new Set(('if elseif else endif endfor endwhile endfunction endswitches endswitch switch case otherwise ' +
    'for while do until end until classdef properties methods events enumeration endclassdef endproperties endmethods ' +
    'endevents endenumeration package endpackage function return try catch end_try_catch unwind_protect ' +
    'unwind_protect_cleanup end_unwind_protect break continue global persistent import arguments ' +
    'endwhile whilevar end start endfor loopsize loopbody').split(' ').filter(Boolean));

  const callRe = /\b([A-Za-z_]\w*)\s*\(/g;
  const fevalRe = /feval\s*\(\s*['"]([A-Za-z_]\w*)['"]/gi;
  const localAssign = /(?:^|[;,}]\s*|\breturn\s+)([A-Za-z_]\w*)\s*=/gm;
  const assignAny = /\b([A-Za-z_]\w*)\s*(?:\([^;=]*\)|\{[^;={}]*\})?\s*=(?!=)/gm;
  const multiOut = /\b[^;=\n]*\[([A-Za-z_\s,]+)\]\s*=(?!=)|(?:^|[;,]\s*)([A-Za-z_]\w*)\s*=\s*\{/gm;
  const localLoop = /\b(?:for|while)\s+([A-Za-z_]\w*)\s*(?:=| in )/gm;
  const localArg = /\bfunction\b[^\n]*?\(([^)]*)\)/gm;
  const localSub = /\bfunction\s+(?:\[[^\]]*\]\s*=\s*|[A-Za-z_]\w*\s*=\s*)?([A-Za-z_]\w*)\s*\(/gm;
  const shellRe = /\b(system|popen|pclose|dos|unix|perl)\s*\(|\bcmd\b/gm;

  // Every m-file basename shipping inside the three trees. A token matching one
  // of these (incl. @sym/class method names) can always be satisfied in-browser.
  const bakedNames = new Set();
  for (const name of Object.keys(files)) {
    for (const f of files[name]) bakedNames.add(f.slice(f.lastIndexOf('/') + 1).replace(/\.m$/, ''));
  }

  // `%` / `#` / `##` strip: comments/help text routinely contain "call-looking"
  // fragments (Copyright (C)…, usage examples with real datasets…).
  function stripComments(src) {
    return src.split('\n').map((l) => {
      let out = l;
      const ci = l.search(/[%#]/);
      if (ci >= 0) out = out.slice(0, ci);
      return out;
    }).join('\n');
  }

  // Octave string literals carry payload that is NOT resolved by Octave: the
  // shim embeds Pyodide/SymPy code ("str(fourier_transform(...))"), `eval` /
  // `feval` / `system` string bodies, help text, etc. Mask the *contents* (keep
  // the quotes) so call-site extraction can't mistake a Python/SymPy function
  // name for an Octave dependency. Handles the common forms: '…', "…", `` … ``.
  function stripStrings(src) {
    return src.replace(/'(?:''|[^'])*'|"(?:[^"\\]|\\.)*"|`(?:[^`\\]|\\.)*`/g, (m) => {
      return m[0] + m.slice(1, -1).replace(/\S/g, ' ') + m[m.length - 1];
    });
  }

  function localNames(src) {
    const s = new Set();
    let m;
    while ((m = localAssign.exec(src))) s.add(m[1]);
    while ((m = assignAny.exec(src))) s.add(m[1]);       // y = …, y(i) = …
    while ((m = multiOut.exec(src))) {                    // [a, b] = …
      if (m[1]) m[1].split(',').forEach((t) => { t = t.trim(); if (t) s.add(t); });
      if (m[2]) s.add(m[2]);
    }
    while ((m = localLoop.exec(src))) s.add(m[1]);
    while ((m = localArg.exec(src))) {
      m[1].split(',').forEach((a) => { const t = (a || '').replace(/[^\w]/g, ''); if (t) s.add(t); });
    }
    while ((m = localSub.exec(src))) s.add(m[1]);
    return s;
  }

  const counts = Object.create(null); // token -> { n, files:[...] }
  const shellouts = [];               // { file, line, hit }
  let mFiles = 0;
  const classMethods = new Set(); // method names from baked classdef files
  // classdef method header: `function [o1,o2] = name(self, ...)` / `function name(self, ...)`
  const classMethodRe = /\bfunction\s+(?:\[[^\]]*\]\s*=\s*|[A-Za-z_]\w*\s*=\s*)?([A-Za-z_]\w*)\s*\(/gm;
  for (const name of Object.keys(files)) {
    for (const f of files[name]) {
      mFiles++;
      let src = '';
      try { src = M.FS.readFile(f, { encoding: 'utf8' }); } catch (e) { continue; }
      if (f.indexOf('/@') >= 0) {
        let mm; classMethodRe.lastIndex = 0;
        while ((mm = classMethodRe.exec(src))) classMethods.add(mm[1]);
      }
      const lines = src.split('\n');
      for (let i = 0; i < lines.length; i++) {
        if (shellRe.test(stripComments(lines[i]))) shellouts.push({ file: f, line: i + 1, hit: lines[i].trim().slice(0, 70) });
      }
      const locals = localNames(src);
      // strip comments, THEN mask string contents: order matters (strings can
      // contain `%`, and comments are gone before we care about quotes).
      const code = stripStrings(stripComments(src));
      const seen = new Set();
      function add(tok) {
        if (seen.has(tok)) return;
        seen.add(tok);
        if (locals.has(tok) || KEYWORDS.has(tok) || classMethods.has(tok)) return;
        counts[tok] = counts[tok] || { n: 0, files: [] };
        counts[tok].n++;
        if (counts[tok].files.length < 3) counts[tok].files.push(f);
      }
      let m;
      callRe.lastIndex = 0; fevalRe.lastIndex = 0;
      while ((m = callRe.exec(code))) {
        // obj.method(...) / field-style access is not a global call.
        if (m.index > 0 && code[m.index - 1] === '.') continue;
        add(m[1]);
      }
      while ((m = fevalRe.exec(code))) add(m[1]);
    }
  }

  // Resolve every candidate at runtime against the shipped build.
  const tokens = Object.keys(counts);
  const cats = { BUILTIN: 0, CORE: 0, BAKED: 0, VARIABLE: 0, NOTFOUND: 0, OTHER: 0 };
  const gaps = Object.create(null); // token -> { n, files }
  for (const tok of tokens) {
    let w = null;
    try { w = M.feval('which', [tok], 1); } catch (e) { w = null; }
    const s = Array.isArray(w) && w.length ? String(w[0]) : '';
    if (!s) {
      // which() may print an error to stderr for unknown names; if the name is
      // nonetheless the basename of a shipped m-file, or a method on a baked
      // classdef object (dispatches at runtime), it resolves in the tree.
      if (bakedNames.has(tok) || classMethods.has(tok)) {
        cats.BAKED++;
        continue;
      }
      cats.NOTFOUND++; gaps[tok] = counts[tok];
    } else if (/is a variable/.test(s)) {
      cats.VARIABLE++;
    } else if (/built-in/.test(s) || /@\$(?:gt|lt)/.test(s)) {
      cats.BUILTIN++;
    } else if (s.indexOf('/usr/src/octave/m/') === 0) {
      const cat = s.split('/')[5]; // /usr/src/octave/m/<cat>/...
      if (trees.some((t) => t[0] === cat)) cats.BAKED++;
      else cats.CORE++;
    } else {
      cats.OTHER++;
    }
  }

  return { files: Object.fromEntries(Object.entries(files).map(([k, v]) => [k, v.length])),
    mFiles, cats, gaps, shellouts, compiled };
}

async function runAudit(updateAllowlist) {
  const browser = await puppeteer.launch({ executablePath: CHROME, headless: true, protocolTimeout: 300000 });
  let page;
  try {
    page = await browser.newPage();
    page.on('pageerror', (e) => console.error('[pageerror]', e.message));
    try {
      await page.goto(APP_URL, { waitUntil: 'load', timeout: 120000 });
    } catch (err) {
      // Sandbox proxies can transiently refuse a fresh connection; retry once.
      await new Promise((r) => setTimeout(r, 3000));
      await page.goto(APP_URL, { waitUntil: 'load', timeout: 120000 });
    }
    await page.waitForFunction('window.__oo && window.__oo.ready === true', { timeout: 180000 })
      .catch(() => { throw new Error('Octave not ready'); });

    const r = await page.evaluate(sweepPage, TREES);

    console.log('Shipped m-trees: ' + Object.entries(r.files).map(([k, v]) => `${k}=${v}`).join(' ') + ` (${r.mFiles} .m files)`);
    if (r.compiled.length) {
      console.log('\nCOMPILED ARTIFACTS IN BAKED TREES (should be none):');
      r.compiled.forEach((c) => console.log('  ' + c));
    }
    if (r.shellouts.length) {
      console.log('\nSHELL-OUTS in baked .m (wasm system() returns ENOSYS — flag if live; showing first 10):');
      for (const s of r.shellouts.slice(0, 10)) console.log(`  ${s.file}:${s.line}  ${s.hit}`);
      if (r.shellouts.length > 10) console.log(`  … (${r.shellouts.length - 10} more)`);
    }

    const cats = r.cats;
    console.log(`\nCandidate classification (runtime which): ` +
      Object.entries(cats).map(([k, v]) => `${k}=${v}`).join(' '));

    let allow = {};
    try { allow = JSON.parse(readFileSync(ALLOWLIST, 'utf8')); } catch (e) { allow = {}; }
    const gaps = Object.keys(r.gaps).sort((a, b) => r.gaps[b].n - r.gaps[a].n);

    if (updateAllowlist) {
      for (const t of gaps) if (!allow[t]) allow[t] = { reason: 'AUTO-SNAPSHOT — review before committing' };
      writeFileSync(ALLOWLIST, JSON.stringify(allow, null, 2) + '\n');
      console.log('\n--update-allowlist: wrote ' + ALLOWLIST + ` (${Object.keys(allow).length} entries). REVIEW> every reason before committing.`);
      return 0;
    }

    const unallowed = gaps.filter((t) => !allow[t]);
    console.log(`\nNot-found identifiers: ${gaps.length} total, ${unallowed.length} un-allowlisted GAPS.\n`);
    for (const t of unallowed) {
      const g = r.gaps[t];
      console.log(`  GAP ${String(g.n).padStart(4)}  ${t}  refs: ${g.files.join(', ')}`);
    }
    if (unallowed.length === 0) console.log('  (none)');
    const listed = gaps.filter((t) => allow[t]);
    if (listed.length) console.log(`  (${listed.length} allowlisted — reasons cached in ${ALLOWLIST.split('/').pop()})`);

    // Maintenance: allowlist entries whose identifier is no longer NOT-FOUND
    // (reclassified BAKED/CORE/etc. by a rebuild or audit improvement) are
    // stale and can be pruned.
    const gapSet = new Set(gaps);
    const stale = Object.keys(allow).filter((t) => !t.startsWith('_') && !gapSet.has(t));
    if (stale.length) {
      console.log(`\nSTALE allowlist entries (no longer NOT-FOUND — safe to prune): ${stale.length}`);
      console.log('  ' + stale.sort().join(', '));
    }

    console.log('\n' + (unallowed.length ? `GATE FAIL: ${unallowed.length} un-allowlisted dependencies.` : 'GATE PASS: no un-allowlisted dependencies.'));
    return unallowed.length ? 1 : 0;
  } finally {
    await Promise.race([browser.close().catch(() => {}), new Promise((r) => setTimeout(r, 10000))]);
  }
}

/* ------------------------------------------------------------------ */
async function main() {
  const args = process.argv.slice(2);
  const triageIx = args.indexOf('--triage-src');
  const updateAllowlist = args.includes('--update-allowlist');

  if (triageIx >= 0) {
    const dir = args[triageIx + 1];
    if (!dir) { console.error('usage: node package-deps.mjs --triage-src <dir>'); process.exit(2); }
    killStale();
    process.exit(triageSrc(dir));
  }

  killStale();
  try {
    await startServer();
    const code = await runAudit(updateAllowlist);
    await teardown(null);
    process.exit(code);
  } catch (err) {
    console.error(err);
    await teardown(null);
    process.exit(2);
  }
}

main();