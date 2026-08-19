# Feasibility Verdict & Production Boundary

Route G is **feasible**. This document records the verdict, the evidence, and
the explicitly-bounded work that remains between this PoC and a deployable
service — the enumeration promised in `docs/roadmap.md` ("What 'feasible' means
at the end").

## Verdict

- An unmodified-in-behavior GNU Octave interpreter (7.2.0) runs in the browser
  as WebAssembly and evaluates real course code.
- Its gnuplot graphics toolkit survives the `popen` removal and renders through
  a gnuplot-to-wasm SVG terminal: every plot family a stats/engineering course
  needs (line, scatter, histogram, boxplot, contour, surf/mesh, plot3, imshow,
  multi-figure, `hold on`) produces a correct-looking SVG in-browser.
- Octave Forge `statistics` 1.6.0 and `data-smoothing` 1.3.0 are baked in and
  exercised (`ttest`, `pdf`, `regdatasmooth`, …).
- Symbolic math works through a Pyodide/SymPy bridge (`syms`, `diff`, `int`,
  `solve`, `dsolve`, `laplace`, `taylor`, `subs`, …).
- The app is already course-usable for a single user: ES-module shell, user-file
  persistence (IndexedDB → wasm MEMFS), a run-grouped plot gallery + viewer,
  a full file panel (toolbar, breadcrumbs, create/upload/rename/delete,
  drag-drop, collapsible layout), and a highlighted editor with completion and
  unsaved-buffer drafts.
- The whole thing serves as static files at near-zero hosting cost (currently
  GitHub Pages); per-tab compute means cost scales with bytes served, not users.

Evidence: gates 1–4 are pass and documented in `docs/verification.md` (incl. the
fast `ui-unit`/`index-check`/`ui-dom` tiers and the `verify:fast` render
battery); the live demo is <https://skiadas.github.io/octave-server/app/>.

## Remaining to production (bounded, enumerated)

These are the concrete gaps between the PoC and a multi-user deployed service.
None of them is open-ended R&D.

1. **Server-side auth + cross-device persistence.** Today all user state is
   per-browser (IndexedDB + localStorage). Production needs an optional account
   layer and a server (or sync endpoint) that stores user files/plots across
   devices. This is the only architectural addition; it deliberately does not
   exist yet so the PoC stayed a static-host, no-server app.
2. **Deployment hardening.** The current deploy is raw GitHub Pages + a
   redirect. Production hardening: a proper host/CDN with auth, per-user quotas,
   HTTPS-only asset policies, and (optional) PWA caching of the ~18 MB wasm
   binaries.
3. **Plot export for reports.** SVG + browser-side PNG exist; PDF and
   multi-page export are missing.
4. **Plot interactivity.** `ginput`/zoom/`rotate3d` on gnuplot-wasm's SVG output
   is the single real technical gap. It is deferred as an R&D spike rather than
   planned work: the render path is CPU-bound (headless `surf` measured ~215 s
   under CI host load), so an interactive layer must be justified on real
   devices first.
5. **Upstream drift.** Two small community wasm projects are upstream
   (octave → wasm, gnuplot → wasm); Octave-version bumps and their patch
   surfaces are owned here (`patches/`, frozen base image).
6. **Known language gaps (documented workarounds in `capability-demo.m`).**
   - `regdatasmooth`'s default `lambda` optimizer is `optim`'s compiled
     `nelder_mead_min`, not wasm-portable; pass an explicit `"lambda"`.
   - Mixed scalar/sym operators (`5 * x`, `5 / x`) aren't overloaded in the
     `@sym` shim; use `sym("…")` string round-trips. (Fixing requires rebuilding
     the frozen octave base image — queued for whenever a rebuild is needed.)
   - `ztrans`/`iztrans` absent because SymPy ≥ 1.13 removed them.
   - Single-threaded Octave (Emscripten build disables threads/OpenMP).

## Suggested sequencing

1. Editor/export polish while the app stays static-hosted (current: editor
   overlay, gallery, file panel done).
2. Auth + persistence server as the first production commit — it is the only
   step that changes the architecture.
3. Deploy hardening on top of the chosen host.
4. Plot-interactivity spike on real hardware before committing to it.

## Appendix — why a server is out of the PoC scope (deliberately)

"Zero-to-cheap" is an architectural claim: compute 100% client-side, static
hosting, near-zero marginal cost. Adding the auth/sync server is the one change
that breaks that claim, so it was kept out until the feasibility question (does
the wasm pipeline render course plots at all?) was answered — which it now is.
