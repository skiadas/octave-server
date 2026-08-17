## Copyright (C) 2026 Route G PoC
##
## This program is free software: you can redistribute it and/or modify
## it under the terms of the GNU General Public License as published by
## the Free Software Foundation, either version 3 of the License, or
## (at your option) any later version.

## -*- texinfo -*-
## @deftypefn {} {@var{q} =} oo_pyquote (@var{s})
## Internal: quote an Octave string as a single-quoted Python literal.
## @end deftypefn

function q = oo_pyquote (s)

  if (nargin != 1 || ~ischar (s))
    error ("oo_pyquote: expected a string");
  end

  ## NOTE: no "[...]" concatenation here — Octave's parser rejects bracket
  ## string-concat when the first element is a function call (a 7.2 quirk).
  q = strcat (char (39), strrep (strrep (s, "\\", "\\\\"), "'", "\\'"), char (39));

end