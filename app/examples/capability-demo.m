% capability-demo.m
% Exercises the octave-server pipeline end to end: whole-file edit/run
% (Ctrl+Enter in the editor pane), multi-line constructs, the numeric core,
% plotting through gnuplot-wasm, Octave Forge statistics + data-smoothing,
% and the SymPy symbolic bridge.
%
% Usage: open app/index.html, paste this into the editor (file name may stay
% "script.m"), then press Ctrl+Enter (or click Run).

% --- 1. multi-line constructs: function definition + for loop ---
function y = moving_avg(x, w)
  y = zeros(size(x));
  for k = 1:numel(x)
    lo = max(1, k - w); hi = min(numel(x), k + w);
    y(k) = mean(x(lo:hi));
  endfor
endfunction

% --- 2. numeric core ---
t = 0:0.1:30;
y = sin(t) + 0.3 * randn(size(t));
fprintf('n=%d  var(y)=%.3f\n', numel(y), var(y));

% --- 3. Forge data-smoothing (regdatasmooth) ---
% Default call: lambda is auto-tuned by generalized cross-validation via the
% bundled nelder_mead_min compat file (pure .m, GPL-3, from optim 1.6.2).
ys = regdatasmooth(t(:), y(:), "d", 2);

% --- 4. plot raw + two smoothers + truth (renders via gnuplot-wasm) ---
plot(t, y, 'o', ...,
     t, moving_avg(y, 3), 'g-', ...,
     t(:), ys, 'r-', ...,
     t, sin(t), 'k--');
legend('noisy', 'moving avg (ours)', 'regdatasmooth', 'truth');
title('capability demo');

% --- 5. Forge statistics (ttest) ---
[h, p] = ttest(randn(50, 1));
fprintf('ttest: h=%d p=%.3f\n', h, p);

% --- 6. symbolic math (SymPy bridge) ---
syms x;
disp(diff(sin(x), x));                       % cos(x)
disp(int(sym("1/(x^2+1)"), sym("x")));       % atan(x) — string form avoids the
                                             % scalar/sym mrdivide shim gap
disp(solve(sym("x**2 - 5*x + 6")));          % [2, 3] — string form avoids the
                                             % scalar/sym mtimes gap in 5*x