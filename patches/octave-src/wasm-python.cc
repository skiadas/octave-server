// Route G: "__wasm_python__" bridge builtin.
//
// GNU Octave has no way to spawn a subprocess in a wasm build, so the Octave
// Forge "symbolic" package (a popen/pexpect bridge to a real python) cannot
// run here.  Instead the host page runs Pyodide/SymPy on the main thread next
// to the (also main-thread) Octave interpreter, and exposes it as a
// synchronous JS function window.__ooWasmPython(code) -> string.  This builtin
// round-trips SymPy code text to that function and returns the result string
// (or "PYERR: ..." on failure, which the .m shim converts into a proper
// octave error).  See patches/octave-m/scripts/symbolic-sympy/ for the shim.

#include <cstdlib>
#include <string>

#include "defun.h"
#include "error.h"
#include "ovl.h"

#include <emscripten.h>

// Call window.__ooWasmPython (when Pyodide/SymPy finished loading) with CODE
// and return its string result in a malloc'd buffer.  The buffer is freed by
// the caller.  Any JS/python exception is folded into a "PYERR: ..." string.
EM_JS(char*, oo_wasm_python_call, (const char* code), {
  var fn = (typeof window === 'undefined') ? undefined : window.__ooWasmPython;
  var result;
  if (typeof fn !== 'function') {
    result = 'PYERR: __ooWasmPython is not available (Pyodide/SymPy not loaded)';
  } else {
    try {
      result = fn(UTF8ToString(code));
    } catch (e) {
      result = 'PYERR: ' + ((e && e.message) ? e.message : String(e));
    }
  }
  result = String(result);
  var len = lengthBytesUTF8(result) + 1;
  var out = _malloc(len);
  stringToUTF8(result, out, len);
  return out;
});

DEFUN (__wasm_python__, args, nargout,
       "-*- texinfo -*-\n\
@deftypefn {} {@var{res} =} __wasm_python__ (@var{code})\n\
Evaluate SymPy @var{code} in the host page's Python runtime and return the\n\
result as a string.  Returns @code{\"PYERR: ...\"} when the bridge is\n\
unavailable or the python code raises.\n\
@end deftypefn")
{
  if (args.length () != 1)
    error ("__wasm_python__: usage: __wasm_python__ (CODE)");

  std::string code = args(0).string_value ();

  std::string retval;
  char* buf = oo_wasm_python_call (code.c_str ());
  if (buf)
    {
      retval = buf;
      std::free (buf);
    }

  return ovl (retval);
}