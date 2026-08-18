/* app/runtime.js — mutable runtime references shared between modules.
   main.js populates these as the Octave boot progresses; modules read them
   lazily inside functions (never at load time), which is why a plain mutable
   binding works even though load order differs between browser bundle and the
   Node unit harness. Replaces the old `window.ooApp.Module`/`ooApp.append`
   fields. */

export let Module = null;        // octave runtime (after OCTAVE() resolves)
export let ready = false;        // octave booted + FS hydrated
export const userPath = '/home/user'; // writable user dir inside MEMFS, mirrored to IDB

let appendFn = null;             // fn(text, cls) -> console (set by main.js)

export function setModule(m) { Module = m; }
export function setReady(v) { ready = v; }
export function setAppend(fn) { appendFn = fn; }
export function getAppend() { return appendFn; }
