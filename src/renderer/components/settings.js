import { icons } from '../utils/icons.js';
import { showToast } from '../services/toast.js';
import { trapFocus } from './modals.js';
import { focusWhenReady, restoreFocus } from '../utils/focus.js';

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
   * @param {FileService} fileService - File service instance
   */
  constructor(elements, themeService, fileService) {
    this.elements = elements;
    this.themeService = themeService;
    this.fileService = fileService;
    this.previouslyFocused = null;

    this.setupSettings();
    this.createNotesSection();
    this.createUninstallButton();
  }

  isOpen() {
    return this.elements.settingsOverlay.classList.contains('show');
  }

  open() {
    if (this.isOpen()) return;
    this.previouslyFocused = document.activeElement;
    this.elements.settingsOverlay.classList.add('show');
    // Focus inside the overlay so Escape and Tab work right away
    focusWhenReady(this.elements.closeButton, { stillWanted: () => this.isOpen() });
  }

  close() {
    if (!this.isOpen()) return;
    this.elements.settingsOverlay.classList.remove('show');
    const previous = this.previouslyFocused;
    this.previouslyFocused = null;
    restoreFocus(previous, this.elements.settingsOverlay);
  }

  /**
   * Set up settings functionality
   */
  setupSettings() {
    try {
      const { settingsIcon, settingsOverlay, closeButton, themeOptions } = this.elements;

      // Insert the SVG into the settings icon
      if (settingsIcon) {
        settingsIcon.innerHTML = icons.settings;

        // Open settings on click, or via Enter/Space for keyboard users
        // (the icon carries role="button" + tabindex="0", so it must honor
        // the button keyboard contract)
        settingsIcon.addEventListener('click', () => this.open());
        settingsIcon.addEventListener('keydown', (event) => {
          if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault();
            this.open();
          }
        });
      } else {
        console.error('Settings icon element not found!');
      }

      if (closeButton) {
        closeButton.addEventListener('click', () => this.close());
      }

      if (settingsOverlay) {
        // Escape closes the dialog; Tab stays inside it
        settingsOverlay.addEventListener('keydown', (event) => {
          if (!this.isOpen()) return;
          if (event.key === 'Escape') {
            event.preventDefault();
            event.stopPropagation();
            this.close();
          } else if (event.key === 'Tab') {
            trapFocus(settingsOverlay, event);
          }
        });

        // Clicking the backdrop (outside the settings dialog) closes it
        let mousedownOnBackdrop = false;
        settingsOverlay.addEventListener('mousedown', (event) => {
          mousedownOnBackdrop = event.target === settingsOverlay;
        });
        settingsOverlay.addEventListener('click', (event) => {
          if (event.target === settingsOverlay && mousedownOnBackdrop) {
            this.close();
          }
        });
      }

      // Theme options behave as a radio group: click or Enter/Space to pick
      if (themeOptions && themeOptions.length > 0) {
        const choose = (option) => {
          const theme = option.getAttribute('data-theme');
          const applied = this.themeService.applyTheme(theme);
          this.themeService.saveThemePreference(applied);
          this.updateThemeUI(applied);
        };

        themeOptions.forEach((option) => {
          option.setAttribute('role', 'radio');
          option.tabIndex = 0;
          option.addEventListener('click', () => choose(option));
          option.addEventListener('keydown', (event) => {
            if (event.key === 'Enter' || event.key === ' ') {
              event.preventDefault();
              choose(option);
            }
          });
        });
      } else {
        console.error('Theme options not found!');
      }

      // Apply the saved theme (the one place the theme is applied at startup)
      this.updateThemeUI(this.themeService.initialize());
      // If the saved choice was lost, restore it from the settings file
      this.themeService.recoverMissingPreference().then((recovered) => {
        if (recovered) this.updateThemeUI(recovered);
      });
    } catch (error) {
      console.error('Error in setupSettings:', error);
    }
  }

  /**
   * Find the body of the settings dialog (where sections are appended).
   * @returns {HTMLElement|null}
   */
  getSettingsBody() {
    const body = this.elements.settingsOverlay.querySelector('.settings-container .modal-body');
    if (!body) console.error('Settings container not found!');
    return body;
  }

  /**
   * Create a settings section with a heading.
   * @param {string} heading
   * @returns {HTMLElement}
   */
  createSection(heading) {
    const section = document.createElement('div');
    section.className = 'settings-section';
    const title = document.createElement('h4');
    title.textContent = heading;
    section.appendChild(title);
    return section;
  }

  /**
   * "Your notes" section: notes are ordinary files on this computer, and
   * this is the way to get to them.
   */
  createNotesSection() {
    try {
      const body = this.getSettingsBody();
      if (!body) return;

      const section = this.createSection('Your notes');

      const description = document.createElement('p');
      description.className = 'settings-note';
      description.textContent =
        'Notes are stored as ordinary files on this computer. Nothing is uploaded anywhere.';
      section.appendChild(description);

      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'secondary-button';
      button.textContent = 'Open notes folder';
      button.addEventListener('click', async () => {
        const result = await this.fileService.showInFolder(null);
        if (!result.success) {
          showToast(`Could not open the notes folder: ${result.error}`, 'error');
        }
      });
      section.appendChild(button);

      body.appendChild(section);
    } catch (error) {
      console.error('Error creating notes section:', error);
    }
  }

  /**
   * Create uninstall button in settings — only in an installed Windows
   * build. On macOS/Linux apps are removed through the system, and when
   * running from source there is no installation to remove.
   */
  async createUninstallButton() {
    try {
      if (!window.api || typeof window.api.canUninstall !== 'function') return;
      if (!(await window.api.canUninstall())) return;

      const body = this.getSettingsBody();
      if (!body) return;

      const section = this.createSection('Advanced');

      // Styled by .danger-button in modals.css so it follows the active theme
      const uninstallButton = document.createElement('button');
      uninstallButton.type = 'button';
      uninstallButton.className = 'danger-button';
      uninstallButton.textContent = 'Uninstall NeatNote';

      uninstallButton.addEventListener('click', async () => {
        // On success the app quits itself; a cancel needs no message.
        // (Errors use a toast: a native alert() here leaves text inputs
        // unable to take focus afterwards on Windows.)
        const result = await window.api.uninstallApp();
        if (!result.success && !result.cancelled) {
          console.error('Uninstall failed:', result.error);
          showToast(`Could not start the uninstaller: ${result.error}`, 'error', 7000);
        }
      });

      section.appendChild(uninstallButton);
      body.appendChild(section);
    } catch (error) {
      console.error('Error creating uninstall button:', error);
    }
  }

  /**
   * Update the UI to reflect current theme
   * @param {string} theme - Current theme
   */
  updateThemeUI(theme) {
    this.elements.themeOptions.forEach((option) => {
      const selected = option.getAttribute('data-theme') === theme;
      option.classList.toggle('selected', selected);
      option.setAttribute('aria-checked', String(selected));
    });
  }
}
