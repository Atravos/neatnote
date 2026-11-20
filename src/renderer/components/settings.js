import { icons } from '../utils/icons.js';
import { showToast } from '../services/toast.js';
import { trapFocus } from './modals.js';
import { focusWhenReady, restoreFocus } from '../utils/focus.js';
import { AUTO_THEME } from '../services/themeService.js';
import { FONTS, DEFAULT_SIZES, loadTypographyDefaults, saveTypographyDefaults } from '../utils/typography.js';

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
   * @param {HTMLElement} elements.themeContainer - Where the theme tiles go
   * @param {ThemeService} themeService - Theme service instance
   * @param {FileService} fileService - File service instance
   */
  constructor(elements, themeService, fileService) {
    this.elements = elements;
    this.themeService = themeService;
    this.fileService = fileService;
    this.previouslyFocused = null;

    this.setupSettings();
    this.createWritingSection();
    this.createNotesSection();
    this.createUpdatesSection();
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
      const { settingsIcon, settingsOverlay, closeButton } = this.elements;
      const themeOptions = this.buildThemeOptions();

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
          const applied = this.themeService.applyPreference(theme);
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
      // "Auto" follows the computer switching between light and dark
      this.themeService.watchSystemTheme();
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
  /**
   * "Writing": the font and size new text uses. Text given its own font
   * or size from the toolbar keeps it.
   */
  createWritingSection() {
    try {
      const body = this.getSettingsBody();
      if (!body) return;
      const section = this.createSection('Writing');
      const current = loadTypographyDefaults();

      const row = document.createElement('div');
      row.className = 'settings-row settings-writing';

      const makeSelect = (labelText, id, entries, value, onChange) => {
        const label = document.createElement('label');
        label.className = 'settings-field';
        label.textContent = labelText;
        const select = document.createElement('select');
        select.className = 'settings-select';
        select.id = id;
        for (const entry of entries) {
          const option = document.createElement('option');
          option.value = entry.id;
          option.textContent = entry.label;
          if (entry.stack) option.style.fontFamily = entry.stack;
          select.appendChild(option);
        }
        select.value = value;
        select.addEventListener('change', () => onChange(select.value));
        label.appendChild(select);
        row.appendChild(label);
      };

      makeSelect('Font', 'default-font', FONTS, current.font, (font) => saveTypographyDefaults({ font }));
      makeSelect('Text size', 'default-size', DEFAULT_SIZES, current.size, (size) => saveTypographyDefaults({ size }));
      section.appendChild(row);

      const note = document.createElement('p');
      note.className = 'settings-note settings-fineprint';
      note.textContent = 'Used for all text that doesn\'t have its own font or size. To change part of a note, select it and use the toolbar.';
      section.appendChild(note);

      body.appendChild(section);
    } catch (error) {
      console.error('Error creating writing section:', error);
    }
  }

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
   * "Updates" section: current version, the automatic-check switch, and a
   * button to check now. The check itself, the prompt and the download
   * all happen in the main process; this only shows where things stand.
   */
  createUpdatesSection() {
    try {
      const updates = window.api && window.api.updates;
      if (!updates) return;
      const body = this.getSettingsBody();
      if (!body) return;

      const section = this.createSection('Updates');
      section.id = 'updates-section';

      const version = document.createElement('p');
      version.className = 'settings-note';
      version.id = 'update-version';
      section.appendChild(version);

      const autoLabel = document.createElement('label');
      autoLabel.className = 'settings-checkbox';
      const autoCheck = document.createElement('input');
      autoCheck.type = 'checkbox';
      autoCheck.id = 'update-auto-check';
      autoCheck.checked = false;
      autoLabel.appendChild(autoCheck);
      autoLabel.appendChild(document.createTextNode('Check for updates when NeatNote opens'));
      section.appendChild(autoLabel);

      const row = document.createElement('div');
      row.className = 'settings-row';
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'secondary-button';
      button.id = 'update-check-btn';
      button.textContent = 'Check for updates';
      const status = document.createElement('span');
      status.className = 'update-status';
      status.id = 'update-status';
      status.setAttribute('role', 'status');
      status.setAttribute('aria-live', 'polite');
      row.appendChild(button);
      row.appendChild(status);
      section.appendChild(row);

      const fineprint = document.createElement('p');
      fineprint.className = 'settings-note settings-fineprint';
      fineprint.textContent =
        'NeatNote only connects to the internet to check for updates, and only when you allow it. Your notes never leave this computer.';
      section.appendChild(fineprint);

      body.appendChild(section);

      let readyVersion = null;
      // aria-disabled rather than `disabled`: a disabled button drops
      // keyboard focus out of the dialog, and Escape/Tab stop working
      let busy = false;
      const setBusy = (value) => {
        busy = value;
        button.setAttribute('aria-disabled', String(value));
      };
      const setStatus = (text, tone = '') => {
        status.textContent = text;
        status.dataset.tone = tone;
      };
      const showReady = (version) => {
        readyVersion = version;
        button.textContent = 'Install update';
        setBusy(false);
        setStatus(`NeatNote ${version} is ready to install.`, 'success');
      };

      updates.getState().then((state) => {
        if (!state) return;
        version.textContent = `You have NeatNote ${state.version}.`;
        autoCheck.checked = state.autoCheck === true;
        if (state.readyVersion) showReady(state.readyVersion);
      });

      autoCheck.addEventListener('change', async () => {
        const result = await updates.setAutoCheck(autoCheck.checked);
        if (!result || !result.success) {
          autoCheck.checked = !autoCheck.checked;
          showToast('Could not save that setting', 'error');
        }
      });

      button.addEventListener('click', async () => {
        if (busy) return;
        if (readyVersion) {
          const result = await updates.installNow();
          if (!result.success) setStatus(result.error || 'Could not start the installer.', 'error');
          return;
        }
        setBusy(true);
        setStatus('Checking…');
        const result = await updates.checkNow();
        setBusy(false);
        switch (result.status) {
          case 'up-to-date':
            setStatus("You're up to date.", 'success');
            break;
          case 'available':
            setStatus(`NeatNote ${result.latest} is available.`);
            break;
          case 'downloading':
            // update-status events take it from here
            setBusy(true);
            break;
          case 'busy':
            setStatus('Already checking…');
            break;
          case 'error':
          default:
            setStatus(result.message || "Couldn't check for updates.", 'error');
        }
      });

      // Progress of a download started from the update prompt
      updates.onStatus((update) => {
        if (update.state === 'downloading') {
          setBusy(true);
          if (update.percent === 0) showToast(`Downloading NeatNote ${update.version}…`, 'info');
          setStatus(`Downloading ${update.version}… ${update.percent}%`);
        } else if (update.state === 'ready') {
          showReady(update.version);
        } else if (update.state === 'error') {
          setBusy(false);
          setStatus(update.message || 'The update failed.', 'error');
        }
      });
    } catch (error) {
      console.error('Error creating updates section:', error);
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
   * Build one tile per theme (plus "Auto") from the theme service, and the
   * light/dark pickers shown while Auto is selected.
   * @returns {HTMLElement[]} The tiles
   */
  buildThemeOptions() {
    const container = this.elements.themeContainer;
    if (!container) return [];
    container.innerHTML = '';

    const makeTile = (id, label) => {
      const tile = document.createElement('div');
      tile.className = 'theme-option';
      tile.setAttribute('data-theme', id);
      tile.setAttribute('aria-label', `${label} theme`);
      const preview = document.createElement('div');
      preview.className = 'theme-preview';
      preview.innerHTML = '<div class="theme-preview-sidebar"></div><div class="theme-preview-content">' +
        '<span class="theme-preview-line"></span><span class="theme-preview-dot"></span></div>';
      const name = document.createElement('div');
      name.className = 'theme-label';
      name.textContent = label;
      tile.append(preview, name);
      container.appendChild(tile);
      return tile;
    };

    const themes = this.themeService.listThemes();
    const tiles = themes.map(({ id, label, palette }) => {
      const tile = makeTile(id, label);
      tile.style.setProperty('--swatch-bg', palette.bg);
      tile.style.setProperty('--swatch-sidebar', palette.sidebar);
      tile.style.setProperty('--swatch-text', palette.text);
      tile.style.setProperty('--swatch-accent', palette.accent);
      return tile;
    });

    // "Auto" tile: half the chosen light theme, half the chosen dark one
    const autoTile = makeTile(AUTO_THEME, 'Auto');
    autoTile.title = "Follows your computer's light or dark mode";
    const autoPreview = autoTile.querySelector('.theme-preview');
    autoPreview.classList.add('theme-preview-auto');
    autoPreview.innerHTML = '<span class="theme-preview-dot"></span><span class="theme-preview-dot"></span>';
    tiles.push(autoTile);

    // Light/dark pickers for Auto
    const pair = document.createElement('div');
    pair.className = 'auto-theme-pair';
    const makePicker = (labelText, wantDark, side) => {
      const label = document.createElement('label');
      label.textContent = labelText;
      const select = document.createElement('select');
      select.className = 'settings-select';
      select.id = `auto-theme-${side}`;
      for (const theme of themes.filter((t) => t.dark === wantDark)) {
        const option = document.createElement('option');
        option.value = theme.id;
        option.textContent = theme.label;
        select.appendChild(option);
      }
      select.addEventListener('change', () => {
        this.themeService.setAutoPair({ [side]: select.value });
        this.refreshAutoTile();
        if (this.themeService.loadThemePreference() === AUTO_THEME) {
          this.themeService.applyPreference(AUTO_THEME);
        }
      });
      label.appendChild(select);
      pair.appendChild(label);
      return select;
    };
    this.autoLightSelect = makePicker('Light:', false, 'light');
    this.autoDarkSelect = makePicker('Dark:', true, 'dark');
    container.insertAdjacentElement('afterend', pair);
    this.autoPairRow = pair;
    this.autoTile = autoTile;
    this.refreshAutoTile();

    this.themeOptions = tiles;
    return tiles;
  }

  /** Show the chosen Auto pair in the Auto tile and its pickers */
  refreshAutoTile() {
    if (!this.autoTile) return;
    const pair = this.themeService.getAutoPair();
    const byId = Object.fromEntries(this.themeService.listThemes().map((t) => [t.id, t.palette]));
    this.autoTile.style.setProperty('--swatch-bg', byId[pair.light].bg);
    this.autoTile.style.setProperty('--swatch-bg-2', byId[pair.dark].bg);
    this.autoTile.style.setProperty('--swatch-accent', byId[pair.light].accent);
    this.autoTile.style.setProperty('--swatch-accent-2', byId[pair.dark].accent);
    if (this.autoLightSelect) this.autoLightSelect.value = pair.light;
    if (this.autoDarkSelect) this.autoDarkSelect.value = pair.dark;
  }

  /**
   * Update the UI to reflect current theme
   * @param {string} theme - Current theme (or "auto")
   */
  updateThemeUI(theme) {
    (this.themeOptions || []).forEach((option) => {
      const selected = option.getAttribute('data-theme') === theme;
      option.classList.toggle('selected', selected);
      option.setAttribute('aria-checked', String(selected));
    });
    if (this.autoPairRow) this.autoPairRow.classList.toggle('visible', theme === AUTO_THEME);
  }
}
