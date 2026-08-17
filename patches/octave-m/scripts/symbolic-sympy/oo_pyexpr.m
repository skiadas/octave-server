## Copyright (C) 2026 Route G PoC
##
## This program is free software: you can redistribute it and/or modify
## it under the terms of the GNU General Public License as published by
## the Free Software Foundation, either version 3 of the License, or
## (at your option) any later version.

## -*- texinfo -*-
## @deftypefn {} {@var{p} =} oo_pyexpr (@var{v})
## Internal: turn an Octave value (sym, char, or numeric scalar) into a
## SymPy-expression Python snippet: sym/char values become
## @code{sympify("...")}, numerics their decimal literal.
## @end deftypefn

function p = oo_pyexpr (v)

  if (isa (v, "sym"))
    p = strcat ("sympify(", oo_pyquote (v.e), ")");
  elseif (ischar (v))
    p = strcat ("sympify(", oo_pyquote (v), ")");
  elseif (isnumeric (v) && isscalar (v))
    p = num2str (v);
  else
    error ("oo_pyexpr: unsupported value (%s)", class (v));
  end

end