## Copyright (C) 2026 Route G PoC
##
## This program is free software: you can redistribute it and/or modify
## it under the terms of the GNU General Public License as published by
## the Free Software Foundation, either version 3 of the License, or
## (at your option) any later version.

## -*- texinfo -*-
## @deftypefn {} {@var{out} =} oo_sym_call (@var{code})
## Internal: evaluate SymPy @var{code} in the host page's python runtime
## (Pyodide) via the @code{__wasm_python__} builtin and return the resulting
## string.  Errors are converted into proper Octave errors.
## @end deftypefn

function out = oo_sym_call (code)

  if (nargin != 1 || ~ischar (code))
    error ("oo_sym_call: expected a single code string");
  end

  try
    out = __wasm_python__ (code);
  catch
    error ("symbolic:bridge", ...
           "SymPy bridge is not available in this build (Pyodide/__wasm_python__ missing).");
  end

  if (ischar (out) && numel (out) >= 5 && strcmp (out(1:5), "PYERR"))
    if (numel (out) > 7)
      error ("symbolic:eval", "SymPy error: %s", out(8:end));
    else
      error ("symbolic:eval", "SymPy error: unknown");
    end
  end

end