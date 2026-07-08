/**
 * ThemeService - Manages application themes
 * Handles theme switching and persistence.
 *
 * Five curated themes, each defined as a small palette. The palette sets
 * the base CSS variables; every other shade in the app (hover/active
 * fills, secondary text, subtle borders, accent tints, selected states)
 * is derived from these in variables.css via color-mix(), which is what
 * keeps hover/active/selected behavior consistent across the sidebar,
 * toolbar, editor, modals, and titlebar in every theme.
 */

const THEMES = {
  /* Clean, neutral, indigo accent */
  light: {
    bg: '#ffffff',
    sidebar: '#f6f5f2',
    surface: '#ffffff',
    text: '#1f2328',
    border: '#e3e2dd',
    accent: '#4263eb',
    onAccent: '#ffffff'
  },
  /* Cool graphite, periwinkle accent */
  dark: {
    bg: '#1c1e22',
    sidebar: '#16181c',
    surface: '#24262c',
    text: '#e6e8ec',
    border: '#33363d',
    accent: '#7aa2f7',
    onAccent: '#10141c'
  },
  /* Warm cream, bronze accent — for long sepia writing sessions */
  paper: {
    bg: '#faf6ec',
    sidebar: '#f1eadb',
    surface: '#fdfaf3',
    text: '#443927',
    border: '#e3dac3',
    accent: '#9c6b1e',
    onAccent: '#fffdf7'
  },
  /* Deep evergreen, sage accent */
  moss: {
    bg: '#181f1a',
    sidebar: '#121814',
    surface: '#202923',
    text: '#dce6dd',
    border: '#2d382f',
    accent: '#7fc796',
    onAccent: '#0d1a11'
  },
  /* Soft night violet, lavender accent */
  dusk: {
    bg: '#1d1b27',
    sidebar: '#171520',
    surface: '#262233',
    text: '#e4e0f0',
    border: '#343047',
    accent: '#a78bfa',
    onAccent: '#171226'
  }
};

export class ThemeService {
  constructor() {
    this.storageKey = 'simplenote-theme';
    this.defaultTheme = 'light';

    // Themes removed in the polish pass map to their closest surviving
    // relative so nobody's saved preference breaks.
    this.legacyThemeMap = {
      sepia: 'paper',
      autumn: 'paper',
      blue: 'light',
      ocean: 'light',
      monochrome: 'light',
      highcontrast: 'light',
      pastel: 'light',
      forest: 'moss',
      terminal: 'moss',
      purple: 'dusk'
    };
  }

  /**
   * Get the available themes
   * @returns {Array<string>} Array of theme names
   */
  getAvailableThemes() {
    return Object.keys(THEMES);
  }

  /**
   * Resolve any theme name (including removed legacy names) to a valid one.
   * @param {string} theme - Requested theme name
   * @returns {string} A valid theme name
   */
  resolveTheme(theme) {
    if (THEMES[theme]) return theme;
    if (theme && this.legacyThemeMap[theme]) return this.legacyThemeMap[theme];
    return this.defaultTheme;
  }

  /**
   * Apply a theme to the application
   * @param {string} theme - Theme name
   * @returns {string} The theme actually applied (after resolution)
   */
  applyTheme(theme) {
    try {
      const resolved = this.resolveTheme(theme);
      const palette = THEMES[resolved];

      // Only touch theme classes — the body also carries platform-* classes
      // used by the custom titlebar.
      Array.from(document.body.classList)
        .filter((cls) => cls.startsWith('app-theme-'))
        .forEach((cls) => document.body.classList.remove(cls));
      document.body.classList.add(`app-theme-${resolved}`);

      const root = document.documentElement.style;
      root.setProperty('--bg-color', palette.bg);
      root.setProperty('--sidebar-bg', palette.sidebar);
      root.setProperty('--surface', palette.surface);
      root.setProperty('--text-color', palette.text);
      root.setProperty('--border-color', palette.border);
      root.setProperty('--accent-color', palette.accent);
      root.setProperty('--on-accent', palette.onAccent);
      // Legacy alias kept for compatibility; derived fills in
      // variables.css are what the current styles actually use
      root.setProperty('--hover-color',
        `color-mix(in srgb, ${palette.text} 7%, transparent)`);

      // Let the main process paint the next launch in this background
      // (kills the white flash on dark themes)
      if (window.api && typeof window.api.setThemeBackground === 'function') {
        window.api.setThemeBackground(palette.bg);
      }

      return resolved;
    } catch (error) {
      console.error('Error applying theme:', error);
      return this.defaultTheme;
    }
  }

  /**
   * Save theme preference to localStorage
   * @param {string} theme - Theme name
   */
  saveThemePreference(theme) {
    try {
      localStorage.setItem(this.storageKey, this.resolveTheme(theme));
    } catch (error) {
      console.error('Error saving theme preference:', error);
    }
  }

  /**
   * Load saved theme preference from localStorage
   * @returns {string} Theme name (always valid, legacy names migrated)
   */
  loadThemePreference() {
    try {
      const savedTheme = localStorage.getItem(this.storageKey);
      if (savedTheme) {
        return this.resolveTheme(savedTheme);
      }
    } catch (error) {
      console.error('Error loading theme preference:', error);
    }
    return this.defaultTheme;
  }

  /**
   * Initialize theme from saved preference
   */
  initialize() {
    const theme = this.loadThemePreference();
    this.applyTheme(theme);
    return theme;
  }
}
