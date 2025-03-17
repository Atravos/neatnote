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
      return ['light', 'dark', 'blue', 'sepia'];
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