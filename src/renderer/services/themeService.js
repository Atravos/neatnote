/**
 * ThemeService - Manages application themes
 * Handles theme switching and persistence.
 *
 * Twelve curated themes, each defined as a small palette, plus "Auto",
 * which follows the computer's light/dark setting with a light and a dark
 * theme of the user's choosing. The palette sets
 * the base CSS variables; every other shade in the app (hover/active
 * fills, secondary text, subtle borders, accent tints, selected states)
 * is derived from these in variables.css via color-mix(), which is what
 * keeps hover/active/selected behavior consistent across the sidebar,
 * toolbar, editor, modals, and titlebar in every theme.
 */

const THEMES = {
  /* Clean, neutral, indigo accent */
  light: {
    label: 'Light', dark: false,
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
    label: 'Dark', dark: true,
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
    label: 'Paper', dark: false,
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
    label: 'Moss', dark: true,
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
    label: 'Dusk', dark: true,
    bg: '#1d1b27',
    sidebar: '#171520',
    surface: '#262233',
    text: '#e4e0f0',
    border: '#343047',
    accent: '#a78bfa',
    onAccent: '#171226'
  },
  /* True black for OLED screens and late nights, cool blue accent */
  midnight: {
    label: 'Midnight', dark: true,
    bg: '#000000',
    sidebar: '#0a0a0b',
    surface: '#141416',
    text: '#e8e8ea',
    border: '#242427',
    accent: '#6b9cff',
    onAccent: '#050a14'
  },
  /* Calm neutral gray, slate-blue accent */
  slate: {
    label: 'Slate', dark: false,
    bg: '#f1f3f5',
    sidebar: '#e6e9ed',
    surface: '#f9fafb',
    text: '#272d34',
    border: '#d4d9df',
    accent: '#4c6a8c',
    onAccent: '#ffffff'
  },
  /* Warm beige, terracotta accent — soft on the eyes for long reading */
  sand: {
    label: 'Sand', dark: false,
    bg: '#f2eadb',
    sidebar: '#e9dfcb',
    surface: '#f7f1e6',
    text: '#3d3427',
    border: '#dacdb5',
    accent: '#b0603a',
    onAccent: '#ffffff'
  },
  /* Soft blush, raspberry accent */
  rose: {
    label: 'Rose', dark: false,
    bg: '#fdf6f7',
    sidebar: '#f8eaed',
    surface: '#ffffff',
    text: '#3a2a2f',
    border: '#efd8de',
    accent: '#c03d68',
    onAccent: '#ffffff'
  },
  /* Deep sea blue, aqua accent */
  ocean: {
    label: 'Ocean', dark: true,
    bg: '#0f1b2a',
    sidebar: '#0b1522',
    surface: '#162537',
    text: '#dce8f5',
    border: '#23364c',
    accent: '#4fb3d9',
    onAccent: '#06131d'
  },
  /* Warm charcoal, amber accent */
  ember: {
    label: 'Ember', dark: true,
    bg: '#1e1b18',
    sidebar: '#181512',
    surface: '#28241f',
    text: '#ede4d9',
    border: '#3a332b',
    accent: '#f0a04b',
    onAccent: '#1d1206'
  },
  /* Maximum readability: pure black on white, strong borders */
  highcontrast: {
    label: 'High Contrast', dark: false,
    bg: '#ffffff',
    sidebar: '#f0f0f0',
    surface: '#ffffff',
    text: '#000000',
    border: '#1a1a1a',
    accent: '#0040c1',
    onAccent: '#ffffff'
  }
};

/** Preference value meaning "follow the computer's light/dark setting" */
const AUTO = 'auto';
const AUTO_LIGHT_KEY = 'neatnote-theme-auto-light';
const AUTO_DARK_KEY = 'neatnote-theme-auto-dark';
/** Both auto palettes, so the pre-paint script can pick the right one */
const AUTO_PALETTES_KEY = 'neatnote-theme-palette-auto';

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
      monochrome: 'light',
      pastel: 'rose',
      forest: 'moss',
      terminal: 'moss',
      purple: 'dusk'
    };
  }

  /**
   * All themes, in display order, for the Settings picker.
   * @returns {Array<{id: string, label: string, dark: boolean, palette: Object}>}
   */
  listThemes() {
    return Object.entries(THEMES).map(([id, palette]) => ({
      id, label: palette.label, dark: palette.dark, palette
    }));
  }

  /**
   * The light and dark themes "Auto" switches between.
   * @returns {{light: string, dark: string}}
   */
  getAutoPair() {
    const read = (key, fallback, wantDark) => {
      try {
        const value = localStorage.getItem(key);
        if (value && THEMES[value] && THEMES[value].dark === wantDark) return value;
      } catch (error) {
        // fall through to the default
      }
      return fallback;
    };
    return { light: read(AUTO_LIGHT_KEY, 'light', false), dark: read(AUTO_DARK_KEY, 'dark', true) };
  }

  /**
   * Choose the light and dark themes for "Auto".
   * @param {{light?: string, dark?: string}} pair
   */
  setAutoPair({ light, dark }) {
    try {
      if (light && THEMES[light] && !THEMES[light].dark) localStorage.setItem(AUTO_LIGHT_KEY, light);
      if (dark && THEMES[dark] && THEMES[dark].dark) localStorage.setItem(AUTO_DARK_KEY, dark);
    } catch (error) {
      console.error('Error saving the Auto theme pair:', error);
    }
  }

  /** Whether the computer is currently in dark mode */
  systemPrefersDark() {
    try {
      return window.matchMedia('(prefers-color-scheme: dark)').matches;
    } catch (error) {
      return false;
    }
  }

  /**
   * Apply a saved preference: a theme name, or "auto".
   * @param {string} preference
   * @param {Object} [options] - Passed to applyTheme
   * @returns {string} The preference as applied ("auto" or a theme name)
   */
  applyPreference(preference, options = {}) {
    if (preference === AUTO) {
      const pair = this.getAutoPair();
      this.applyTheme(this.systemPrefersDark() ? pair.dark : pair.light, options);
      if (options.remember !== false) {
        try {
          const forBoot = {};
          for (const side of ['light', 'dark']) {
            forBoot[side] = {};
            for (const [key, variable] of Object.entries(PALETTE_VARIABLES)) {
              forBoot[side][variable] = THEMES[pair[side]][key];
            }
          }
          localStorage.setItem(AUTO_PALETTES_KEY, JSON.stringify(forBoot));
        } catch (error) {
          // The pre-paint script falls back to the last palette used
        }
      }
      return AUTO;
    }
    return this.applyTheme(preference, options);
  }

  /**
   * Re-apply "Auto" when the computer switches between light and dark.
   * @param {Function} [onChange] - Called after the theme was re-applied
   */
  watchSystemTheme(onChange) {
    try {
      const query = window.matchMedia('(prefers-color-scheme: dark)');
      query.addEventListener('change', () => {
        if (this.loadThemePreference() !== AUTO) return;
        this.applyPreference(AUTO);
        if (onChange) onChange();
      });
    } catch (error) {
      // Older platforms: Auto then follows the system at launch only
    }
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
      localStorage.setItem(this.storageKey, theme === AUTO ? AUTO : this.resolveTheme(theme));
    } catch (error) {
      console.error('Error saving theme preference:', error);
    }
  }

  /**
   * Load saved theme preference from localStorage
   * @returns {string} Theme name (always valid, legacy names migrated) or "auto"
   */
  loadThemePreference() {
    try {
      const savedTheme = localStorage.getItem(this.storageKey);
      if (savedTheme === AUTO) return AUTO;
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
    this.applyPreference(theme, { remember: this.hasSavedPreference() });
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
        // Light and High Contrast share a white background, so a white
        // background is never conclusive — and "light" is the default anyway
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

export { AUTO as AUTO_THEME };
