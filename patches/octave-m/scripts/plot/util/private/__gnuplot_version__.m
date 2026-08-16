########################################################################
##
## Copyright (C) 2006-2022 The Octave Project Developers
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
## @deftypefn {} {@var{version} =} __gnuplot_version__ ()
## Undocumented internal function.
## @end deftypefn

## WEBASSEMBLY OVERRIDE
## --------------------
## The stock implementation shells out to "gnuplot --version" via system(),
## which cannot run in the browser.  gnuplot-wasm is pinned to 5.4.10, so
## report that version directly.  This also drives __gnuplot_has_feature__
## (via compare_versions) to the correct truth table.

function version = __gnuplot_version__ ()

  version = "5.4.10";

endfunction
