/* Curated completion list for the Ctrl+Space editor popup: the Octave core
   students actually type plus the Forge packages this build ships (statistics,
   data-smoothing) and the symbolic-sympy bridge. Curated rather than
   auto-extracted — the wasm runtime keeps its function table in C++, so a
   ~200-name list that matches the docs is the bounded version. */

export const OCTAVE_COMPLETIONS = [
  // core commands / control
  'help', 'doc', 'disp', 'printf', 'fprintf', 'sprintf', 'input', 'pause',
  'clear', 'clc', 'who', 'whos', 'what', 'which', 'exist', 'type', 'save',
  'load', 'diary', 'more', 'format', 'path', 'addpath', 'rmpath', 'cd', 'pwd',
  'if', 'else', 'elseif', 'endif', 'for', 'endfor', 'while', 'endwhile', 'do',
  'until', 'switch', 'case', 'otherwise', 'endswitch', 'break', 'continue',
  'return', 'try', 'catch', 'end_try_catch', 'end', 'function', 'endfunction',
  'global', 'persistent', 'arguments', 'varargin', 'varargout', 'nargin', 'nargout',
  // arrays / matrices
  'zeros', 'ones', 'eye', 'rand', 'randn', 'randi', 'randperm', 'linspace',
  'logspace', 'meshgrid', 'ndgrid', 'max', 'min', 'sum', 'prod', 'cumsum',
  'cumprod', 'mean', 'median', 'mode', 'std', 'var', 'prctile', 'quantile',
  'diff', 'sort', 'unique', 'find', 'reshape', 'reshape', 'repmat', 'fliplr',
  'flipud', 'rot90', 'tril', 'triu', 'diag', 'blkdiag', 'size', 'length',
  'numel', 'ndims', 'rows', 'columns', 'isscalar', 'isvector', 'isrow',
  'iscolumn', 'ismatrix', 'isempty', 'num2str', 'str2num', 'num2cell', 'mat2cell',
  // linear algebra
  'det', 'inv', 'pinv', 'rank', 'trace', 'cond', 'rcond', 'norm', 'eig',
  'eigs', 'svd', 'lu', 'qr', 'chol', 'null', 'orth', 'kron', 'dot', 'cross',
  'transpose', 'ctranspose', 'mldivide', 'mrdivide', 'kron', 'compan',
  'hilb', 'pascal', 'magic', 'toeplitz', 'hankel', 'vander', 'gallery',
  // elementary math
  'abs', 'sign', 'sqrt', 'nthroot', 'exp', 'expm', 'log', 'log10', 'log2',
  'pow2', 'realpow', 'reallog', 'realsqrt', 'fix', 'floor', 'ceil', 'round',
  'mod', 'rem', 'gcd', 'lcm', 'factor', 'primes', 'isprime', 'factorial',
  'nchoosek', 'perms', 'rat', 'rats', 'polyval', 'polyvalm', 'roots', 'poly',
  'polyfit', 'polyder', 'polyint', 'conv', 'deconv', 'residue', 'fzero',
  'fsolve', 'fminbnd', 'fminsearch', 'erf', 'erfc', 'erfinv', 'gamma', 'gammaln',
  'betainc', 'betaln', 'legendre', 'besselj', 'bessely', 'besselh', 'airy',
  'ellipj', 'ellipke', 'integral', 'quad', 'quadgk', 'quadl', 'trapz', 'cumtrapz',
  'gradient', 'del2', 'diff', 'cart2pol', 'pol2cart', 'cart2sph', 'sph2cart',
  'unwrap', 'angle', 'complex', 'conj', 'imag', 'real', 'isreal', 'cplxpair',
  // trig
  'sin', 'cos', 'tan', 'asin', 'acos', 'atan', 'atan2', 'sinh', 'cosh', 'tanh',
  'asinh', 'acosh', 'atanh', 'sec', 'csc', 'cot', 'asind', 'acosd', 'atand',
  'sind', 'cosd', 'tand', 'hypot', 'sinc', 'cotd',
  // strings / text
  'strcmp', 'strncmp', 'strfind', 'strmatch', 'regexp', 'regexprep', 'strsplit',
  'strjoin', 'strcat', 'strrep', 'strtrim', 'lower', 'upper', 'deblank',
  'isempty', 'sprintf', 'sscanf', 'textscan', 'str2num', 'num2str', 'mat2str',
  'int2str', 'char', 'double', 'strtok', 'str2double', 'blank', 'blanks',
  // plotting / figures
  'plot', 'plot3', 'semilogx', 'semilogy', 'loglog', 'polar', 'polarplot',
  'scatter', 'scatter3', 'bar', 'barh', 'stairs', 'stem', 'pie', 'area',
  'hist', 'histogram', 'rose', 'boxplot', 'errorbar', 'quiver', 'quiver3',
  'contour', 'contourf', 'contour3', 'surf', 'surfc', 'mesh', 'meshc', 'meshgrid',
  'waterfall', 'ribbon', 'sphere', 'cylinder', 'ellipsoid', 'imshow', 'image',
  'imagesc', 'pcolor', 'fill', 'patch', 'rectangle', 'text', 'xlabel', 'ylabel',
  'zlabel', 'title', 'legend', 'grid', 'axis', 'axis', 'xlim', 'ylim', 'zlim',
  'colorbar', 'clabel', 'colormap', 'pcolor', 'hold', 'figure', 'newplot',
  'close', 'clf', 'drawnow', 'refresh', 'line', 'specular', 'diffuse',
  'light', 'lighting', 'material', 'shading', 'view', 'rotate3d', 'gca', 'gcf',
  'subplot', 'axes', 'set', 'get', 'ginput', 'gtext', 'rbbox', 'print', 'saveas',
  'saveto', 'orient', 'set', 'clabels', 'whitebg', 'zoom',
  // statistics package (Octave Forge)
  'ttest', 'ttest2', 'ztest', 'kstest', 'kruskal_wallis_test', 'anova1',
  'anova2', 'bartlett_test', 'f_test_regression', 'chisquare_test_homogeneity',
  'kolmogorov_smirnov_test_2', 'mannwhitneyu_test', 'ranksum_test',
  'corr', 'corrcoef', 'cov', 'pca', 'zscore', 'histfit', 'normpdf', 'normcdf',
  'norminv', 'normrnd', 'tpdf', 'tcdf', 'tinv', 'trnd', 'chi2pdf', 'chi2cdf',
  'chi2inv', 'chi2rnd', 'fpdf', 'fcdf', 'finv', 'frnd', 'exppdf', 'expcdf',
  'expinv', 'exprnd', 'betapdf', 'betacdf', 'betainv', 'betarnd', 'gampdf',
  'gamcdf', 'gaminv', 'gamrnd', 'unifpdf', 'unifcdf', 'unifinv', 'unifrnd',
  'poisspdf', 'poisscdf', 'poissinv', 'poissrnd', 'kmeans', 'nkmeans',
  'silhouette', 'prctile', 'qqplot', 'std', 'var', 'mvnrnd', 'mvnpdf',
  'regress', 'regstat', 'ridge', 'cov', 'corr', 'quantile',
  // data-smoothing (Octave Forge)
  'regdatasmooth', 'regdatasmooth_fast', 'smoothdata', 'sgolay', 'smooth',
  'movmean', 'movmedian', 'moving_average', 'loess', 'lowess', 'savitzky_golay',
  // symbolic-sympy bridge
  'syms', 'sym', 'symfun', 'diff', 'int', 'solve', 'dsolve', 'simplify',
  'expand', 'factor', 'collect', 'apart', 'together', 'trigsimp', 'limit',
  'taylor', 'subs', 'double', 'pretty', 'latex', 'laplace', 'ilaplace',
  'fourier', 'ifourier', 'ztrans', 'iztrans', 'symsum', 'symprod', 'compose',
  'finverse',
].filter((v, i, a) => a.indexOf(v) === i);