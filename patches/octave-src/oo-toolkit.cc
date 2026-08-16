// Route G: registers the "gnuplot" graphics toolkit for the wasm build.
//
// Upstream registers the toolkit from the __init_gnuplot__ .oct module,
// which (a) cannot be loaded in a static wasm build (no dlopen) and
// (b) refuses to register unless a gnuplot binary exists on PATH.  Neither
// applies here.  This registers a minimal toolkit that dispatches redraw
// and print to the (patched) __gnuplot_drawnow__ m-file, which renders the
// gnuplot command stream to /plot.gp for gnuplot-wasm to rasterize as SVG.

#include "builtin-defun-decls.h"
#include "dMatrix.h"
#include "graphics.h"
#include "graphics-toolkit.h"
#include "gtk-manager.h"
#include "interpreter.h"
#include "ovl.h"
#include "unwind-protect.h"

OCTAVE_NAMESPACE_BEGIN

class oo_gnuplot_toolkit : public octave::base_graphics_toolkit
{
public:
  oo_gnuplot_toolkit (octave::interpreter& interp)
    : octave::base_graphics_toolkit ("gnuplot"), m_interpreter (interp)
  { }

  ~oo_gnuplot_toolkit (void) = default;

  bool is_valid (void) const { return true; }

  bool initialize (const graphics_object& go)
  {
    return go.isa ("figure");
  }

  void finalize (const graphics_object&) { }

  void update (const graphics_object&, int) { }

  void redraw_figure (const graphics_object& go) const
  {
    static bool drawnow_executing = false;

    // Prevent recursion.
    if (! drawnow_executing)
      {
        octave::unwind_protect_var<bool> restore_var (drawnow_executing, true);

        octave_value_list args;
        args(0) = go.get_handle ().as_octave_value ();
        octave::feval ("__gnuplot_drawnow__", args);
      }
  }

  void print_figure (const graphics_object& go, const std::string& term,
                     const std::string& file,
                     const std::string& debug_file) const
  {
    octave_value_list args;
    if (! debug_file.empty ())
      args(3) = debug_file;
    args(2) = file;
    args(1) = term;
    args(0) = go.get_handle ().as_octave_value ();
    octave::feval ("__gnuplot_drawnow__", args);
  }

  Matrix get_canvas_size (const graphics_handle&) const
  {
    return Matrix (1, 2, 0.0);
  }

  double get_screen_resolution (void) const
  { return 72.0; }

  Matrix get_screen_size (void) const
  { return Matrix (1, 2, 0.0); }

  void close (void) { }

private:
  octave::interpreter& m_interpreter;
};

OCTAVE_NAMESPACE_END

void
oo_register_gnuplot_toolkit (octave::interpreter& interp)
{
  octave::gtk_manager& gtk_mgr = interp.get_gtk_manager ();

  // Marks it as available (and, since it is the first/only toolkit, as the
  // default) ...
  gtk_mgr.register_toolkit ("gnuplot");

  // ... and as loaded, so graphics_toolkit("gnuplot") skips the .oct path.
  octave::graphics_toolkit tk (new octave::oo_gnuplot_toolkit (interp));
  gtk_mgr.load_toolkit (tk);
}
