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
## @deftypefn {} {@var{stream} =} __gnuplot_open_stream__ (@var{npipes}, @var{h})
## Undocumented internal function.
## @end deftypefn

## WEBASSEMBLY OVERRIDE
## --------------------
## In the browser there is no way to spawn a gnuplot subprocess (no
## popen/popen2).  This override redirects the gnuplot toolkit's output
## stream to a file in the Emscripten virtual filesystem (/plot.gp).
## The JS layer reads that file after each drawnow and renders it with
## gnuplot-wasm, then displays the resulting SVG.

function plot_stream = __gnuplot_open_stream__ (npipes, h)

  plot_stream = fopen ("/plot.gp", "w");
  if (plot_stream < 0)
    error ("__gnuplot_open_stream__: failed to open /plot.gp");
  endif

  if (nargin > 1)
    set (h, "__plot_stream__", plot_stream);
  endif

endfunction
