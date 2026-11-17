/*
 * Runs before the first paint (a plain, render-blocking script in <head>).
 *
 * The full theme system lives in an ES module, which executes only after
 * the page has been parsed — late enough that a dark-theme user would see
 * one frame of the default light palette at every launch. This applies the
 * palette saved by ThemeService during the previous session straight away.
 *
 * Kept deliberately tiny and defensive: every value is checked to be a
 * known CSS variable name and a plain hex color before it is applied, so
 * nothing from storage is ever trusted as CSS.
 */
(function applySavedPalette() {
  try {
    var raw = localStorage.getItem('neatnote-theme-palette');
    if (!raw) return;
    var palette = JSON.parse(raw);
    if (!palette || typeof palette !== 'object') return;

    var allowed = [
      '--bg-color', '--sidebar-bg', '--surface', '--text-color',
      '--border-color', '--accent-color', '--on-accent'
    ];
    var style = document.documentElement.style;
    for (var i = 0; i < allowed.length; i++) {
      var value = palette[allowed[i]];
      if (typeof value === 'string' && /^#[0-9a-fA-F]{6}$/.test(value)) {
        style.setProperty(allowed[i], value);
      }
    }
  } catch (error) {
    // Fall back to the default palette; ThemeService applies the real one
  }
})();
