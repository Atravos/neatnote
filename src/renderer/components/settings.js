import { icons } from '../utils/icons.js';

/**
 * SettingsComponent - Manages application settings
 */
export class SettingsComponent {
  /**
   * Initialize the settings component
   * @param {Object} elements - DOM elements
   * @param {HTMLElement} elements.settingsIcon - Settings icon element
   * @param {HTMLElement} elements.settingsOverlay - Settings overlay element
   * @param {HTMLButtonElement} elements.closeButton - Close button element
   * @param {NodeList} elements.themeOptions - Theme option elements
   * @param {ThemeService} themeService - Theme service instance
   */
  constructor(elements, themeService) {
    this.elements = elements;
    this.themeService = themeService;
    
    this.setupSettings();
    console.log('Settings component initialized');
  }

  /**
   * Set up settings functionality
   */
  setupSettings() {
    try {
      console.log('Setting up settings functionality');
      
      // Insert the SVG into the settings icon
      if (this.elements.settingsIcon) {
        console.log('Inserting settings icon SVG');
        this.elements.settingsIcon.innerHTML = icons.settings;
        
        // Open settings on click
        this.elements.settingsIcon.addEventListener('click', () => {
          console.log('Settings icon clicked');
          this.elements.settingsOverlay.classList.add('show');
        });
      } else {
        console.error('Settings icon element not found!');
      }
      
      // Close settings dialog
      if (this.elements.closeButton) {
        this.elements.closeButton.addEventListener('click', () => {
          this.elements.settingsOverlay.classList.remove('show');
        });
      }
      
      // Setup theme options
      if (this.elements.themeOptions && this.elements.themeOptions.length > 0) {
        this.elements.themeOptions.forEach(option => {
          option.addEventListener('click', () => {
            const theme = option.getAttribute('data-theme');
            console.log('Theme selected:', theme);
            
            // Remove selected class from all options
            this.elements.themeOptions.forEach(opt => opt.classList.remove('selected'));
            
            // Add selected class to clicked option
            option.classList.add('selected');
            
            // Apply and save theme
            this.themeService.applyTheme(theme);
            this.themeService.saveThemePreference(theme);
          });
        });
      } else {
        console.error('Theme options not found!');
      }
      
      // Load and apply saved theme
      const savedTheme = this.themeService.loadThemePreference();
      this.themeService.applyTheme(savedTheme);
      
      // Update UI to reflect current theme
      this.updateThemeUI(savedTheme);
      
      console.log('Settings setup complete');
    } catch (error) {
      console.error('Error in setupSettings:', error);
    }
  }

  /**
   * Update the UI to reflect current theme
   * @param {string} theme - Current theme
   */
  updateThemeUI(theme) {
    // Update selected state in UI
    this.elements.themeOptions.forEach(option => {
      if (option.getAttribute('data-theme') === theme) {
        option.classList.add('selected');
      } else {
        option.classList.remove('selected');
      }
    });
  }
}