## Copyright (C) 2026 Route G PoC
##
## This program is free software: you can redistribute it and/or modify
## it under the terms of the GNU General Public License as published by
## the Free Software Foundation, either version 3 of the License, or
## (at your option) any later version.

## -*- texinfo -*-
## @defclass @sym sym
## Minimal SymPy-backed symbolic expression.  Each instance holds the text
## of a SymPy expression; operator and function overloads round-trip text to
## the in-browser python runtime (see oo_sym_call).  Intended for undergrad
## class use; not a full MATLAB Symbolic Toolbox replacement.
## @end defclass

classdef sym

  properties
    e = ""
  end

  methods

    ## constructor ----------------------------------------------------------
    function self = sym (x)
      if (nargin == 0)
        return;
      end
      if (isa (x, "sym"))
        self.e = x.e;
      elseif (ischar (x))
        self.e = oo_sym_call (sprintf ("str(sympify(%s))", oo_pyquote (x)));
      elseif (isnumeric (x) && isscalar (x))
        self.e = num2str (x);
      else
        error ("sym: conversion from %s is not supported", class (x));
      end
    end

    ## conversions / display ------------------------------------------------
    function r = char (self)
      r = self.e;
    end

    function d = double (self)
      d = str2double (oo_sym_call (sprintf ("str(float(sympify(%s)))", ...
            oo_pyquote (self.e))));
    end

    function disp (self)
      fprintf ("%s\n", self.e);
    end

    function display (self)
      fprintf ("%s\n", self.e);
    end

    ## arithmetic -----------------------------------------------------------
    function r = oo_bin (self, o, op)
      if (isa (o, "sym"))
        oe = o.e;
      elseif (isnumeric (o) && isscalar (o))
        oe = num2str (o);
      else
        error ("sym: %s: unsupported operand type %s", op, class (o));
      end
      code = sprintf ("str(sympify(%s))", ...
                      oo_pyquote (sprintf ("(%s) %s (%s)", self.e, op, oe)));
      r = sym ();
      r.e = oo_sym_call (code);
    end

    function r = plus (a, b)   r = a.oo_bin (b, "+");  end
    function r = minus (a, b)  r = a.oo_bin (b, "-");  end
    function r = times (a, b)  r = a.oo_bin (b, "*");  end
    function r = mtimes (a, b) r = a.oo_bin (b, "*");  end
    function r = rdivide (a, b) r = a.oo_bin (b, "/"); end
    function r = mrdivide (a, b) r = a.oo_bin (b, "/"); end
    function r = ldivide (a, b) r = b.oo_bin (a, "/"); end
    function r = mldivide (a, b) r = b.oo_bin (a, "/"); end
    function r = power (a, b)  r = a.oo_bin (b, "**"); end
    function r = mpower (a, b) r = a.oo_bin (b, "**"); end

    function r = uminus (self)
      code = sprintf ("str(sympify(%s))", oo_pyquote (sprintf ("(-(%s))", self.e)));
      r = sym ();
      r.e = oo_sym_call (code);
    end

    function r = uplus (self)
      r = self;
    end

    ## generic single-argument function application --------------------------
    function r = oo_applyf (self, fname)
      code = sprintf ("str(%s(sympify(%s)))", fname, oo_pyquote (self.e));
      r = sym ();
      r.e = oo_sym_call (code);
    end

    function r = sin (self)    r = self.oo_applyf ("sin");    end
    function r = cos (self)    r = self.oo_applyf ("cos");    end
    function r = tan (self)    r = self.oo_applyf ("tan");    end
    function r = asin (self)   r = self.oo_applyf ("asin");   end
    function r = acos (self)   r = self.oo_applyf ("acos");   end
    function r = atan (self)   r = self.oo_applyf ("atan");   end
    function r = sinh (self)   r = self.oo_applyf ("sinh");   end
    function r = cosh (self)   r = self.oo_applyf ("cosh");   end
    function r = tanh (self)   r = self.oo_applyf ("tanh");   end
    function r = exp (self)    r = self.oo_applyf ("exp");    end
    function r = log (self)    r = self.oo_applyf ("log");    end
    function r = sqrt (self)   r = self.oo_applyf ("sqrt");   end
    function r = abs (self)    r = self.oo_applyf ("Abs");    end
    function r = gamma (self)  r = self.oo_applyf ("gamma");  end
    function r = factorial (self) r = self.oo_applyf ("factorial"); end

    ## calculus --------------------------------------------------------------
    function r = diff (self, v)
      if (nargin < 2)
        code = sprintf ("str(sympify(%s).diff())", oo_pyquote (self.e));
      else
        code = sprintf ("str(sympify(%s).diff(%s))", ...
                        oo_pyquote (self.e), oo_pyexpr (v));
      end
      r = sym ();
      r.e = oo_sym_call (code);
    end

    function r = int (self, varargin)
      if (nargin == 1)
        code = sprintf ("str(integrate(sympify(%s)))", oo_pyquote (self.e));
      elseif (nargin == 2)
        code = sprintf ("str(integrate(sympify(%s), %s))", ...
                        oo_pyquote (self.e), oo_pyexpr (varargin{1}));
      elseif (nargin == 4)
        code = sprintf ("str(integrate(sympify(%s), (%s, %s, %s)))", ...
                        oo_pyquote (self.e), oo_pyexpr (varargin{1}), ...
                        oo_pyexpr (varargin{2}), oo_pyexpr (varargin{3}));
      else
        error ("sym:int: usage int(f), int(f, x), or int(f, x, a, b)");
      end
      r = sym ();
      r.e = oo_sym_call (code);
    end

    function r = limit (self, v, c)
      code = sprintf ("str(limit(sympify(%s), %s, %s))", ...
                      oo_pyquote (self.e), oo_pyexpr (v), oo_pyexpr (c));
      r = sym ();
      r.e = oo_sym_call (code);
    end

    function r = taylor (self, v, n, x0)
      if (nargin < 3)
        n = 6;
      end
      if (nargin < 4)
        x0 = 0;
      end
      code = sprintf ("str(series(sympify(%s), %s, %s, %s).removeO())", ...
                      oo_pyquote (self.e), oo_pyexpr (v), ...
                      oo_pyexpr (x0), num2str (n));
      r = sym ();
      r.e = oo_sym_call (code);
    end

    ## algebra ---------------------------------------------------------------
    function r = simplify (self)
      r = sym ();
      r.e = oo_sym_call (sprintf ("str(simplify(sympify(%s)))", ...
                                  oo_pyquote (self.e)));
    end

    function r = expand (self)
      r = sym ();
      r.e = oo_sym_call (sprintf ("str(expand(sympify(%s)))", ...
                                  oo_pyquote (self.e)));
    end

    function r = factor (self)
      r = sym ();
      r.e = oo_sym_call (sprintf ("str(factor(sympify(%s)))", ...
                                  oo_pyquote (self.e)));
    end

    function r = apart (self)
      r = sym ();
      r.e = oo_sym_call (sprintf ("str(apart(sympify(%s)))", ...
                                  oo_pyquote (self.e)));
    end

    function r = together (self)
      r = sym ();
      r.e = oo_sym_call (sprintf ("str(together(sympify(%s)))", ...
                                  oo_pyquote (self.e)));
    end

    function r = trigsimp (self)
      r = sym ();
      r.e = oo_sym_call (sprintf ("str(trigsimp(sympify(%s)))", ...
                                  oo_pyquote (self.e)));
    end

    function r = collect (self, v)
      code = sprintf ("str(collect(sympify(%s), %s))", ...
                      oo_pyquote (self.e), oo_pyexpr (v));
      r = sym ();
      r.e = oo_sym_call (code);
    end

    function r = solve (self)
      r = sym ();
      r.e = oo_sym_call (sprintf ("str(solve(sympify(%s)))", ...
                                  oo_pyquote (self.e)));
    end

    function r = subs (self, v, x)
      if (ischar (v))
        v = sym (v);
      end
      code = sprintf ("str(sympify(%s).subs(%s, %s))", ...
                      oo_pyquote (self.e), oo_pyexpr (v), oo_pyexpr (x));
      r = sym ();
      r.e = oo_sym_call (code);
    end

    ## output helpers ---------------------------------------------------------
    function r = pretty (self)
      r = oo_sym_call (sprintf ("pretty(sympify(%s), use_unicode=False)", ...
                                oo_pyquote (self.e)));
    end

    function r = latex (self)
      r = oo_sym_call (sprintf ("latex(sympify(%s))", oo_pyquote (self.e)));
    end

    ## transforms -------------------------------------------------------------
    function r = laplace (self, t_var, s_var)
      code = sprintf ("str(laplace_transform(sympify(%s), %s, %s, noconds=True))", ...
                      oo_pyquote (self.e), oo_pyexpr (t_var), oo_pyexpr (s_var));
      r = sym ();
      r.e = oo_sym_call (code);
    end

    function r = ilaplace (self, s_var, t_var)
      code = sprintf ("str(inverse_laplace_transform(sympify(%s), %s, %s))", ...
                      oo_pyquote (self.e), oo_pyexpr (s_var), oo_pyexpr (t_var));
      r = sym ();
      r.e = oo_sym_call (code);
    end

    function r = fourier (self, x_var, k_var)
      code = sprintf ("str(fourier_transform(sympify(%s), %s, %s, noconds=True))", ...
                      oo_pyquote (self.e), oo_pyexpr (x_var), oo_pyexpr (k_var));
      r = sym ();
      r.e = oo_sym_call (code);
    end

    function r = ifourier (self, k_var, x_var)
      code = sprintf ("str(inverse_fourier_transform(sympify(%s), %s, %s))", ...
                      oo_pyquote (self.e), oo_pyexpr (k_var), oo_pyexpr (x_var));
      r = sym ();
      r.e = oo_sym_call (code);
    end

  end

end