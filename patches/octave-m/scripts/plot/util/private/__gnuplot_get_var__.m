########################################################################
##
## Copyright (C) 2009-2022 The Octave Project Developers
##
## See the file COPYRIGHT.md in the top-level directory of this
## distribution or <https://octave.org/copyright/>.
##
## This file is part of Octave.
##
## Octave is free software: you can redistribute it and/or modify it
## under the terms of the GNU General Public License as published by
## the Free Software Foundation, either version 3 of the License, or
## (at your option) any later version.
##
## Octave is distributed in the hope that it will be useful, but
## WITHOUT ANY WARRANTY; without even the implied warranty of
## MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
## GNU General Public License for more details.
##
## You should have received a copy of the GNU General Public License
## along with Octave; see the file COPYING.  If not, see
## <https://www.gnu.org/licenses/>.
##
########################################################################

## -*- texinfo -*-
## @deftypefn {} {@var{gp_var_value} =} __gnuplot_get_var__ (@var{h}, @var{gp_var_name}, @var{fmt})
## Undocumented internal function.
## @end deftypefn

## WEBASSEMBLY OVERRIDE
## --------------------
## The stock implementation queries a live gnuplot process via mkfifo +
## popen; neither exists in the browser.  __gnuplot_draw_axes__ uses it to
## learn the active terminal (GPVAL_TERM); the SVG terminal is the only one
## gnuplot-wasm ships, so report it directly.

function gp_var_value = __gnuplot_get_var__ (h, gp_var_name, fmt = "")

  if (strcmpi (gp_var_name, "GPVAL_TERM"))
    gp_var_value = "svg";
  else
    gp_var_value = "";
  endif

endfunction
