// Copyright 2022 Richard Lincoln. All rights reserved.
//
// WEBASSEMBLY OVERRIDE (Route G):
//  - adds "plot" and "image" to the m-file load path
//  - registers the gnuplot graphics toolkit via oo_register_gnuplot_toolkit

#include <string>
#include <iostream>

#include <oct.h>
#include <octave.h>
#include <parse.h>
#include <interpreter.h>
#include <builtin-defun-decls.h>
#include <ov-builtin.h>
#include <symtab.h>

#include <emscripten.h>
#include <emscripten/bind.h>

void oo_register_gnuplot_toolkit (octave::interpreter& interp);

// Defined in wasm-python.cc (DEFUN __wasm_python__).
extern OCTAVE_EXPORT octave_value_list
F__wasm_python__ (const octave_value_list& args, int nargout);

// Register a DEFUN-compiled builtin on the interpreter's symbol table.
// DEFUNs in standalone translation units are not part of the generated
// builtin-defun-decls.h, so install_builtins() (called by the interpreter) is
// blind to them.  This mirrors octave::install_dld_function's path.
static void
oo_install_builtin (octave::interpreter& interp, const std::string& name,
                    octave_builtin::fcn fcn, const std::string& doc)
{
  octave_builtin* builtin = new octave_builtin (fcn, name, doc);
  octave_value fval (builtin);
  interp.get_symbol_table ().install_built_in_function (name, fval);
}

const std::string OBJ_TYPE_KEY = "$type";

const std::string MATRIX_ROWS_KEY = "rows";
const std::string MATRIX_COLS_KEY = "cols";
const std::string MATRIX_DATA_KEY = "data";

const std::string MATRIX_TYPE_VALUE = "matrix";
const std::string COMPLEX_MATRIX_TYPE_VALUE = "complex_matrix";
const std::string SPARSE_MATRIX_TYPE_VALUE = "sparse_matrix";
const std::string SPARSE_COMPLEX_MATRIX_TYPE_VALUE = "sparse_complex_matrix";

std::unique_ptr<octave::interpreter> interpreter;

octave_value em_val_to_octave_value(emscripten::val em_val) {
  if (em_val.instanceof(emscripten::val::global("Boolean"))) {
    return octave_value(em_val.as<bool>());
  } else if (em_val.isString()) {
    return octave_value(em_val.as<std::string>());
  } else if (em_val.isNumber()) {
    return octave_value(em_val.as<double>());
  } else if (em_val.isArray()) {
    octave_value_list val_list;
    const int l = em_val["length"].as<int>();

    for (int i = 0; i < l; i++) {
      emscripten::val val_i = em_val[i];
      val_list(i) = em_val_to_octave_value(val_i);
    }

    return octave_value(val_list);
  } else if (em_val.typeOf().as<std::string>() == "object" && !em_val.isNull() && !em_val.isArray()) {
    if (em_val.hasOwnProperty(OBJ_TYPE_KEY.c_str())) {
      std::string obj_type_str = em_val[OBJ_TYPE_KEY].as<std::string>();

      if (obj_type_str == MATRIX_TYPE_VALUE) {
        const int rows = em_val[MATRIX_ROWS_KEY].as<int>();
        const int cols = em_val[MATRIX_COLS_KEY].as<int>();

        Matrix matrix(rows, cols);

        emscripten::val arr = em_val[MATRIX_DATA_KEY];
        for (int c = 0; c < cols; c++) {
          for (int r = 0; r < rows; r++) {
            emscripten::val elem = arr[c * rows + r];
            matrix(r, c) = elem.as<double>();
          }
        }

        return octave_value(matrix);
      } else if (obj_type_str == SPARSE_MATRIX_TYPE_VALUE) {
        const int rows = em_val[MATRIX_ROWS_KEY].as<int>();
        const int cols = em_val[MATRIX_COLS_KEY].as<int>();

        SparseMatrix matrix(rows, cols);
        // TODO: sparse matrix

        return octave_value(matrix);
      } else if (obj_type_str == SPARSE_COMPLEX_MATRIX_TYPE_VALUE) {
        const int rows = em_val[MATRIX_ROWS_KEY].as<int>();
        const int cols = em_val[MATRIX_COLS_KEY].as<int>();

        SparseComplexMatrix matrix(rows, cols);
        // TODO: sparse complex matrix

        return octave_value(matrix);
      } else {
        std::cerr << "error: invalid object type: " << obj_type_str << std::endl;
        return octave_value();  // TODO: return Octave null
      }
    }


    octave_scalar_map scalar_map;
    emscripten::val keys = emscripten::val::global("Object").call<emscripten::val>("keys", em_val);

    const int l = keys["length"].as<int>();

    for (int i = 0; i < l; i++) {
      emscripten::val key_i = keys[i];
      emscripten::val key_value = em_val[key_i];

      octave_value oct_value = em_val_to_octave_value(key_value);
      scalar_map.setfield(key_i.as<std::string>(), oct_value);
    }

    return octave_value(scalar_map);
  } else {
    std::cerr << "error: invalid type " << em_val.typeOf().as<std::string>() << std::endl;
    return octave_value();  // TODO: return Octave null
  }
}

emscripten::val octave_value_to_em_val(octave_value value) {
  if (value.islogical()) {
    return emscripten::val(value.bool_value());
  } else if (value.is_string()) {
    return emscripten::val(value.string_value());
  } else if (value.is_scalar_type()) {
    return emscripten::val(value.scalar_value());
  } else if (value.isstruct()) {
    emscripten::val obj = emscripten::val::object();

    octave_scalar_map scalar_map = value.scalar_map_value();
    string_vector field_names = scalar_map.fieldnames();
    for (int i = 0; i < field_names.numel(); i++) {
      const std::string field_name = field_names.elem(i);
      octave_value field = scalar_map.getfield(field_name);
      obj.set(field_name, octave_value_to_em_val(field));
    }

    return obj;
  } else if (value.is_real_matrix()) {
    emscripten::val obj = emscripten::val::object();
    obj.set(OBJ_TYPE_KEY, emscripten::val(MATRIX_TYPE_VALUE));
    Matrix matrix = value.matrix_value();

    octave_idx_type rows = matrix.rows();
    octave_idx_type cols = matrix.cols();
    obj.set(MATRIX_ROWS_KEY, rows);
    obj.set(MATRIX_COLS_KEY, cols);

    emscripten::val arr = emscripten::val::array();
    double *fortran_vec = matrix.fortran_vec();
    for (int i = 0; i < rows * cols; i++) {
      arr.call<void>("push", fortran_vec[i]);
    }
    obj.set(MATRIX_DATA_KEY, arr);

    return obj;
  } else if (value.is_complex_matrix()) {
    emscripten::val obj = emscripten::val::object();
    obj.set(OBJ_TYPE_KEY, emscripten::val(COMPLEX_MATRIX_TYPE_VALUE));
    Matrix matrix = value.matrix_value();

    octave_idx_type rows = matrix.rows();
    octave_idx_type cols = matrix.cols();
    obj.set(MATRIX_ROWS_KEY, rows);
    obj.set(MATRIX_COLS_KEY, cols);

    emscripten::val arr = emscripten::val::array();
    double *fortran_vec = matrix.fortran_vec();
    for (int i = 0; i < rows * cols; i++) {
      arr.call<void>("push", std::real(fortran_vec[i]));
      arr.call<void>("push", std::imag(fortran_vec[i])); // interleave
    }
    obj.set(MATRIX_DATA_KEY, arr);

    return obj;
  } else if (value.issparse()) {
    if (value.isreal()) {
      emscripten::val obj = emscripten::val::object();
      obj.set(OBJ_TYPE_KEY, emscripten::val(SPARSE_MATRIX_TYPE_VALUE));
      SparseMatrix matrix = value.sparse_matrix_value();

      octave_idx_type rows = matrix.rows();
      octave_idx_type cols = matrix.cols();
      obj.set(MATRIX_ROWS_KEY, rows);
      obj.set(MATRIX_COLS_KEY, cols);

      octave_idx_type nnz = matrix.cols();
      obj.set("nnz", nnz);

      emscripten::val row_idx = emscripten::val::array();
      octave_idx_type *ridx = matrix.ridx();
      for (octave_idx_type i = 0; i < nnz; i++) {
        row_idx.call<void>("push", ridx[i]);
      }
      obj.set("row_idx", row_idx);

      emscripten::val col_ptr = emscripten::val::array();
      octave_idx_type *cidx = matrix.cidx();
      for (octave_idx_type i = 0; i < cols; i++) {
        col_ptr.call<void>("push", cidx[i]);
      }
      obj.set("col_ptr", col_ptr);

      emscripten::val arr = emscripten::val::array();
      double *data = matrix.data();
      for (octave_idx_type i = 0; i < nnz; i++) {
        arr.call<void>("push", data[i]);
      }
      obj.set(MATRIX_DATA_KEY, arr);

      return obj;
    } else if (value.iscomplex()) {
      emscripten::val obj = emscripten::val::object();
      obj.set(OBJ_TYPE_KEY, emscripten::val(SPARSE_COMPLEX_MATRIX_TYPE_VALUE));
      SparseComplexMatrix matrix = value.sparse_complex_matrix_value();

      octave_idx_type rows = matrix.rows();
      octave_idx_type cols = matrix.cols();
      obj.set(MATRIX_ROWS_KEY, rows);
      obj.set(MATRIX_COLS_KEY, cols);

      octave_idx_type nnz = matrix.cols();
      obj.set("nnz", nnz);

      emscripten::val row_idx = emscripten::val::array();
      octave_idx_type *ridx = matrix.ridx();
      for (octave_idx_type i = 0; i < nnz; i++) {
        row_idx.call<void>("push", ridx[i]);
      }
      obj.set("row_idx", row_idx);

      emscripten::val col_ptr = emscripten::val::array();
      octave_idx_type *cidx = matrix.cidx();
      for (octave_idx_type i = 0; i < cols; i++) {
        col_ptr.call<void>("push", cidx[i]);
      }
      obj.set("col_ptr", col_ptr);

      emscripten::val arr = emscripten::val::array();
      Complex *data = matrix.data();
      for (octave_idx_type i = 0; i < nnz; i++) {
        arr.call<void>("push", std::real(data[i]));
        arr.call<void>("push", std::imag(data[i]));
      }
      obj.set(MATRIX_DATA_KEY, arr);

      return obj;
    }
  }

  std::cerr << "error: octave_value invalid type: " << value.type_name() << std::endl;
  return emscripten::val::undefined();
}

int value_list_to_em_val(octave_value_list val_list, emscripten::val &em_val) {
  if (!em_val.isArray()) {
    std::cerr << "error: val reference must be an array" << std::endl;
    return 1;
  }

  for (int i = 0; i < val_list.length(); i++) {
    octave_value val_i = val_list(i);

    emscripten::val em_val_i = octave_value_to_em_val(val_i);
    if (!em_val.isUndefined()) {
      em_val.call<void>("push", em_val_i);
    }
  }

  return 0;
}

std::string EMSCRIPTEN_KEEPALIVE last_err_msg() {
    return interpreter->get_error_system().last_error_message();
}

emscripten::val EMSCRIPTEN_KEEPALIVE feval(std::string fn_name, emscripten::val args_val, int nargout) {
  if (!args_val.isArray()) {
    std::cerr << "error: feval args value must be an array" << std::endl;
    return emscripten::val::undefined();
  }
  octave_value in = em_val_to_octave_value(args_val);

//  std::cout << "feval: " << fn_name << " " << in.length() << " " << nargout << std::endl;

  octave_value_list out;
  try {
    out = octave::feval(fn_name, in.list_value(), nargout);
  } catch (const octave::execution_exception& ex) {
    interpreter->handle_exception(ex);
    std::cerr << "execution exception: " << interpreter->get_error_system().last_error_message() << std::endl;
    return emscripten::val::undefined();
  }

  // The length of the list is not necessarily the same as nargout.
  emscripten::val rv = emscripten::val::array();
  if (value_list_to_em_val(out, rv)) {
    return emscripten::val::undefined();
  }

//  std::cout << "rv: " << fn_name << " " << rv["length"].as<int>() << std::endl;

  return rv;
}

int EMSCRIPTEN_KEEPALIVE eval_string(std::string eval_str) {
  bool silent = false;
  int parse_status = 0;
  int nargout = 0;
//  std::cout << "eval_string: " << eval_str << " " << " " << nargout << std::endl;

  try {
    interpreter->eval_string(eval_str, silent, parse_status, nargout);
  } catch (const octave::execution_exception& ex) {
    interpreter->handle_exception(ex);
    return 2;
  }

  return 0;
}

int EMSCRIPTEN_KEEPALIVE execute_interp() {
  std::cout << "Starting GNU Octave interpreter..." << std::endl;

  interpreter.reset(new octave::interpreter());

  interpreter->initialize_load_path(true);
  interpreter->read_init_files(true);
  int status = interpreter->execute();
  if (status != 0) {
      std::cerr << "creating interpreter failed: " << status << std::endl;
      return status;
  }

  try {
    // First addpath pass: every category EXCEPT the two that carry PKG_ADD
    // scripts (optimization, statistics-forge).  Within a single addpath
    // call, functions from categories added in that same call are not yet
    // visible to another category's PKG_ADD (>> optimization/PKG_ADD ->
    // __all_opts__ -> optimset -> unique/set).  A second, separate addpath
    // call below adds those so their PKG_ADD sees a fully live load path.
    octave_value_list octave_paths;
    octave_paths(0) = octave_value("/usr/src/octave/m/help:"
        "/usr/src/octave/m/general:"
        "/usr/src/octave/m/set:"
        "/usr/src/octave/m/miscellaneous:"
        "/usr/src/octave/m/strings:"
        "/usr/src/octave/m/sparse:"
        "/usr/src/octave/m/statistics:"
        "/usr/src/octave/m/elfun:"
        "/usr/src/octave/m/path:"
        "/usr/src/octave/m/io:"
        "/usr/src/octave/m/polynomial:"
        "/usr/src/octave/m/pkg:"
        "/usr/src/octave/m/time:"
        "/usr/src/octave/m/specfun:"
        "/usr/src/octave/m/legacy:"
        "/usr/src/octave/m/linear-algebra:"
        "/usr/src/octave/m/plot:"
        "/usr/src/octave/m/plot/draw:"
        "/usr/src/octave/m/plot/util:"
        "/usr/src/octave/m/plot/appearance:"
        "/usr/src/octave/m/image:"
        "/usr/src/octave/m/audio:"
        "/usr/src/octave/m/deprecated:"
        "/usr/src/octave/m/geometry:"
        "/usr/src/octave/m/gui:"
        "/usr/src/octave/m/java:"
        "/usr/src/octave/m/ode:"
        "/usr/src/octave/m/prefs:"
        "/usr/src/octave/m/profiler:"
        "/usr/src/octave/m/signal:"
        "/usr/src/octave/m/special-matrix:"
        "/usr/src/octave/m/startup:"
        "/usr/src/octave/m/testfun:"
        "/usr/src/octave/m/symbolic-sympy:"
        "/usr/src/octave/m/data-smoothing-forge:"
        "/usr/src/octave/m/web", '\'');
    Faddpath(*interpreter, octave_paths);

    // Second pass: PKG_ADD-bearing directories.  statistics-forge's PKG_ADD
    // addpath's its own subdirs (datasets, dist_fit, dist_fun, dist_stat,
    // shadow9), mirroring a real "pkg load".
    octave_value_list octave_pkg_paths;
    octave_pkg_paths(0) = octave_value("/usr/src/octave/m/optimization:"
        "/usr/src/octave/m/statistics-forge", '\'');
    Faddpath(*interpreter, octave_pkg_paths);

    oo_register_gnuplot_toolkit (*interpreter);

    // Register our extra builtins (not present in builtin-defun-decls.h).
    oo_install_builtin (*interpreter, "__wasm_python__", F__wasm_python__,
                        "evaluate SymPy code in the host page's python runtime");
  } catch (const octave::exit_exception& ex) {
    return ex.exit_status();
  } catch (const octave::execution_exception& ex) {
    interpreter->handle_exception(ex);
    std::cerr << "error adding paths: " << interpreter->get_error_system().last_error_message() << std::endl;
    return 1;
  }

  return 0;
}

void EMSCRIPTEN_KEEPALIVE quit_interp() {
  try {
    interpreter->quit(0, false, false);
  } catch (const octave::exit_exception& ex) {
  }
  interpreter.reset();
}

int main(int argc, char **argv) {
  if (argc > 1) {
    std::cerr << "invalid command: " << argv[1] << std::endl;
    return 2;
  }

  return 0;
}

EMSCRIPTEN_BINDINGS(my_module) {
//  emscripten::function("execute_cli", &execute_cli);
  emscripten::function("execute_interp", &execute_interp);
  emscripten::function("quit_interp", &quit_interp);
  emscripten::function("last_error_message", &last_err_msg);
  emscripten::function("feval", &feval);
  emscripten::function("eval_string", &eval_string);
}
