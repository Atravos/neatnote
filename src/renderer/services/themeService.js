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

/**
 * localStorage key holding the active palette as JSON. It is read by
 * src/renderer/theme-boot.js — a tiny script that runs before the first
 * paint — so the app never flashes the default light theme at startup.
 */
const PALETTE_STORAGE_KEY = 'neatnote-theme-palette';

/** CSS custom property for each palette entry */
const PALETTE_VARIABLES = {
  bg: '--bg-color',
  sidebar: '--sidebar-bg',
  surface: '--surface',
  text: '--text-color',
  border: '--border-color',
  accent: '--accent-color',
  onAccent: '--on-accent'
};

export class ThemeService {
  constructor() {
    // Historical key name — kept so existing users keep their theme
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
   * @param {Object} [options]
   * @param {boolean} [options.remember=true] - Also record the palette for
   *        the next launch. False only while showing the default theme for
   *        lack of a saved choice, so that default never overwrites what
   *        recoverMissingPreference() is about to read.
   * @returns {string} The theme actually applied (after resolution)
   */
  applyTheme(theme, { remember = true } = {}) {
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
      for (const [key, variable] of Object.entries(PALETTE_VARIABLES)) {
        root.setProperty(variable, palette[key]);
      }

      if (remember) {
        // Remember the palette for the pre-paint boot script (next launch)
        try {
          const forBoot = {};
          for (const [key, variable] of Object.entries(PALETTE_VARIABLES)) {
            forBoot[variable] = palette[key];
          }
          localStorage.setItem(PALETTE_STORAGE_KEY, JSON.stringify(forBoot));
        } catch (error) {
          // Without it the theme still applies, just a moment later
        }

        // Let the main process paint the next launch in this background
        // (kills the white flash on dark themes)
        if (window.api && typeof window.api.setThemeBackground === 'function') {
          window.api.setThemeBackground(palette.bg);
        }
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
   * Whether a theme preference is stored at all.
   * @returns {boolean}
   */
  hasSavedPreference() {
    try {
      return !!localStorage.getItem(this.storageKey);
    } catch (error) {
      return false;
    }
  }

  /**
   * Initialize theme from saved preference
   * @returns {string} The theme applied
   */
  initialize() {
    const theme = this.loadThemePreference();
    this.applyTheme(theme, { remember: this.hasSavedPreference() });
    return theme;
  }

  /**
   * Recover the theme when the saved preference is missing.
   *
   * The preference lives in the browser-side storage, which can be wiped
   * independently of the app's settings file (versions up to 1.0.5 did so
   * on every update). The settings file still records the last theme's
   * background color, and each theme has a distinct one — enough to tell
   * which theme it was.
   * @returns {Promise<string|null>} The recovered theme, or null if
   *          there was nothing to recover
   */
  async recoverMissingPreference() {
    try {
      if (this.hasSavedPreference()) return null;
      if (!window.api || typeof window.api.getThemeBackground !== 'function') return null;

      const background = await window.api.getThemeBackground();
      if (typeof background !== 'string') return null;

      const match = Object.keys(THEMES).find(
        (name) => THEMES[name].bg.toLowerCase() === background.toLowerCase()
      );
      // A recovered "light" is the default anyway; and never override a
      // choice the user made while this was in flight
      if (!match || match === this.defaultTheme || this.hasSavedPreference()) return null;

      this.applyTheme(match);
      this.saveThemePreference(match);
      return match;
    } catch (error) {
      console.error('Error recovering theme preference:', error);
      return null;
    }
  }
}
