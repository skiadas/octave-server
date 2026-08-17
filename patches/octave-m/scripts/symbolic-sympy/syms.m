## Copyright (C) 2026 Route G PoC
##
## This program is free software: you can redistribute it and/or modify
## it under the terms of the GNU General Public License as published by
## the Free Software Foundation, either version 3 of the License, or
## (at your option) any later version.

## -*- texinfo -*-
## @deftypefn {} {} syms var1 var2 @dots{}
## Declare symbolic variables in the caller workspace (SymPy-backed shim).
## Example: @code{syms x y; f = sin (x) + y^2; diff (f, x)}
## @end deftypefn

function syms (varargin)

  for k = 1:numel (varargin)
    name = varargin{k};
    if (~(ischar (name) && isvarname (name)))
      error ("syms: '%s' is not a valid symbol name", num2str (name));
    end
    assignin ("caller", name, sym (name));
  end

end