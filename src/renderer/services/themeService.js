/**
 * ThemeService - Manages application themes
 * Handles theme switching and persistence
 */
export class ThemeService {
  constructor() {
    this.storageKey = 'simplenote-theme';
    this.defaultTheme = 'light';
    console.log('Theme service initialized');
  }

  /**
   * Get the available themes
   * @returns {Array<string>} Array of theme names
   */
  getAvailableThemes() {
    return [
      'light', 
      'dark', 
      'blue', 
      'sepia',
      'forest',
      'purple',
      'ocean',
      'autumn',
      'terminal',
      'monochrome',
      'highcontrast',
      'pastel'
    ];
  }

  /**
   * Apply a theme to the application
   * @param {string} theme - Theme name
   */
  applyTheme(theme) {
    try {
      console.log('Applying theme:', theme);
      document.body.className = ''; // Clear existing themes
      document.body.classList.add(`app-theme-${theme}`);
      
      // Apply theme-specific CSS variables
      switch (theme) {
        case 'dark':
          document.documentElement.style.setProperty('--bg-color', '#202124');
          document.documentElement.style.setProperty('--sidebar-bg', '#292a2d');
          document.documentElement.style.setProperty('--text-color', '#e8eaed');
          document.documentElement.style.setProperty('--border-color', '#5f6368');
          document.documentElement.style.setProperty('--hover-color', '#3c4043');
          document.documentElement.style.setProperty('--accent-color', '#8ab4f8');
          break;
        case 'blue':
          document.documentElement.style.setProperty('--bg-color', '#f8fbff');
          document.documentElement.style.setProperty('--sidebar-bg', '#e8f0fe');
          document.documentElement.style.setProperty('--text-color', '#3c4043');
          document.documentElement.style.setProperty('--border-color', '#c6dafc');
          document.documentElement.style.setProperty('--hover-color', '#d2e3fc');
          document.documentElement.style.setProperty('--accent-color', '#1a73e8');
          break;
        case 'sepia':
          document.documentElement.style.setProperty('--bg-color', '#fbf8f2');
          document.documentElement.style.setProperty('--sidebar-bg', '#f4ecd8');
          document.documentElement.style.setProperty('--text-color', '#5f4b32');
          document.documentElement.style.setProperty('--border-color', '#e6d7b8');
          document.documentElement.style.setProperty('--hover-color', '#efe4cf');
          document.documentElement.style.setProperty('--accent-color', '#a3681a');
          break;
        case 'forest':
          document.documentElement.style.setProperty('--bg-color', '#f5f9f0');
          document.documentElement.style.setProperty('--sidebar-bg', '#e8f2e2');
          document.documentElement.style.setProperty('--text-color', '#2c3e2d');
          document.documentElement.style.setProperty('--border-color', '#c5d6ba');
          document.documentElement.style.setProperty('--hover-color', '#dae9d1');
          document.documentElement.style.setProperty('--accent-color', '#4a7c59');
          break;
        case 'purple':
          document.documentElement.style.setProperty('--bg-color', '#f8f7fc');
          document.documentElement.style.setProperty('--sidebar-bg', '#eee9fa');
          document.documentElement.style.setProperty('--text-color', '#483d6b');
          document.documentElement.style.setProperty('--border-color', '#d8cff5');
          document.documentElement.style.setProperty('--hover-color', '#e4ddf8');
          document.documentElement.style.setProperty('--accent-color', '#6a4c93');
          break;
        case 'ocean':
          document.documentElement.style.setProperty('--bg-color', '#f3f9fc');
          document.documentElement.style.setProperty('--sidebar-bg', '#e7f5fb');
          document.documentElement.style.setProperty('--text-color', '#2e5677');
          document.documentElement.style.setProperty('--border-color', '#bde0f1');
          document.documentElement.style.setProperty('--hover-color', '#d0e9f5');
          document.documentElement.style.setProperty('--accent-color', '#0077b6');
          break;
        case 'autumn':
          document.documentElement.style.setProperty('--bg-color', '#fdf8f2');
          document.documentElement.style.setProperty('--sidebar-bg', '#f8ede3');
          document.documentElement.style.setProperty('--text-color', '#774936');
          document.documentElement.style.setProperty('--border-color', '#e9d5c2');
          document.documentElement.style.setProperty('--hover-color', '#f2e6d8');
          document.documentElement.style.setProperty('--accent-color', '#c87941');
          break;
        case 'terminal':
          document.documentElement.style.setProperty('--bg-color', '#0d1117');
          document.documentElement.style.setProperty('--sidebar-bg', '#161b22');
          document.documentElement.style.setProperty('--text-color', '#58a6ff');
          document.documentElement.style.setProperty('--border-color', '#30363d');
          document.documentElement.style.setProperty('--hover-color', '#262f3e');
          document.documentElement.style.setProperty('--accent-color', '#58a6ff');
          break;
        case 'monochrome':
          document.documentElement.style.setProperty('--bg-color', '#ffffff');
          document.documentElement.style.setProperty('--sidebar-bg', '#f0f0f0');
          document.documentElement.style.setProperty('--text-color', '#333333');
          document.documentElement.style.setProperty('--border-color', '#d6d6d6');
          document.documentElement.style.setProperty('--hover-color', '#e8e8e8');
          document.documentElement.style.setProperty('--accent-color', '#5a5a5a');
          break;
        case 'highcontrast':
          document.documentElement.style.setProperty('--bg-color', '#ffffff');
          document.documentElement.style.setProperty('--sidebar-bg', '#000000');
          document.documentElement.style.setProperty('--text-color', '#000000');
          document.documentElement.style.setProperty('--border-color', '#000000');
          document.documentElement.style.setProperty('--hover-color', '#e0e0e0');
          document.documentElement.style.setProperty('--accent-color', '#0000ff');
          break;
        case 'pastel':
          document.documentElement.style.setProperty('--bg-color', '#fef9fd');
          document.documentElement.style.setProperty('--sidebar-bg', '#f9ecf7');
          document.documentElement.style.setProperty('--text-color', '#7a5980');
          document.documentElement.style.setProperty('--border-color', '#f3d9ee');
          document.documentElement.style.setProperty('--hover-color', '#f7e3f5');
          document.documentElement.style.setProperty('--accent-color', '#c490bf');
          break;
        default: // Light theme
          document.documentElement.style.setProperty('--bg-color', '#ffffff');
          document.documentElement.style.setProperty('--sidebar-bg', '#fafafa');
          document.documentElement.style.setProperty('--text-color', '#3c4043');
          document.documentElement.style.setProperty('--border-color', '#eeeeee');
          document.documentElement.style.setProperty('--hover-color', '#f5f5f5');
          document.documentElement.style.setProperty('--accent-color', '#1a73e8');
          break;
      }
    } catch (error) {
      console.error('Error applying theme:', error);
    }
  }

  /**
   * Save theme preference to localStorage
   * @param {string} theme - Theme name
   */
  saveThemePreference(theme) {
    try {
      localStorage.setItem(this.storageKey, theme);
      console.log('Theme preference saved:', theme);
    } catch (error) {
      console.error('Error saving theme preference:', error);
    }
  }

  /**
   * Load saved theme preference from localStorage
   * @returns {string} Theme name
   */
  loadThemePreference() {
    try {
      const savedTheme = localStorage.getItem(this.storageKey);
      if (savedTheme) {
        console.log('Loaded saved theme:', savedTheme);
        return savedTheme;
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