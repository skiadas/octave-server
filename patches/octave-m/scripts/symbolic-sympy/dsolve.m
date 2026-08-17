## Copyright (C) 2026 Route G PoC
##
## This program is free software: you can redistribute it and/or modify
## it under the terms of the GNU General Public License as published by
## the Free Software Foundation, either version 3 of the License, or
## (at your option) any later version.

## -*- texinfo -*-
## @deftypefn {} {@var{sol} =} dsolve (@var{ode}[, @var{ic}@dots{}])
## Solve an ordinary differential equation (SymPy-backed shim).
##
## The ODE is a string using @code{D} for derivatives with respect to
## @code{x}, e.g. @code{dsolve ("D2y + y = 0")}.  Initial conditions are
## optional strings like @code{"y(0)=1"} and @code{"Dy(0)=0"}.
## @end deftypefn

function r = dsolve (varargin)

  if (nargin < 1 || !ischar (varargin{1}))
    error ("dsolve: usage: dsolve (ODE[, IC...]) with string arguments");
  end

  ode = varargin{1};
  ics = varargin(2:end);

  for k = 1:numel (ics)
    if (~ischar (ics{k}))
      error ("dsolve: initial conditions must be strings like 'y(0)=1'");
    end
  end

  qics = cellfun (@oo_pyquote, ics, "UniformOutput", false);
  ics_code = strcat ("[", strjoin (qics, ", "), "]");
  code = sprintf ("str(_oo_dsolve(%s, %s))", oo_pyquote (ode), ics_code);

  r = oo_sym_call (code);

end