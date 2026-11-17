/**
 * TitlebarComponent - Custom titlebar for the app window.
 *
 * Platform behavior:
 *   - macOS: the window uses titleBarStyle 'hidden' (see main.js), which
 *     keeps the NATIVE traffic lights overlaid on our titlebar. They fully
 *     support fullscreen (green button), option-click zoom, hover states,
 *     and window tiling, so the renderer draws no controls of its own —
 *     it only reserves space for them (see titlebar.css).
 *   - Windows / Linux: the window is frameless and the renderer draws the
 *     caption buttons (minimize / maximize-restore / close).
 *
 * Falls back gracefully (no controls) if the preload window API is
 * unavailable, so the renderer never breaks.
 */

const controlIcons = {
  minimize: `<svg viewBox="0 0 12 12" xmlns="http://www.w3.org/2000/svg" fill="none" stroke="currentColor" stroke-width="1.2"><line x1="1.5" y1="6" x2="10.5" y2="6"/></svg>`,
  maximize: `<svg viewBox="0 0 12 12" xmlns="http://www.w3.org/2000/svg" fill="none" stroke="currentColor" stroke-width="1.2"><rect x="2" y="2" width="8" height="8" rx="1"/></svg>`,
  restore: `<svg viewBox="0 0 12 12" xmlns="http://www.w3.org/2000/svg" fill="none" stroke="currentColor" stroke-width="1.2"><rect x="2" y="3.5" width="6.5" height="6.5" rx="1"/><path d="M4 3.5V3a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v4a1 1 0 0 1-1 1h-.5"/></svg>`,
  close: `<svg viewBox="0 0 12 12" xmlns="http://www.w3.org/2000/svg" fill="none" stroke="currentColor" stroke-width="1.2"><line x1="2" y1="2" x2="10" y2="10"/><line x1="10" y1="2" x2="2" y2="10"/></svg>`
};

export class TitlebarComponent {
  /**
   * @param {HTMLElement} controlsContainer - #titlebar-controls element
   */
  constructor(controlsContainer) {
    this.container = controlsContainer;
    this.controls = (window.api && window.api.windowControls) || null;
    this.platform = (this.controls && this.controls.platform) || 'win32';
    this.isMac = this.platform === 'darwin';

    // Lets CSS position the control cluster / traffic-light spacer per platform
    document.body.classList.add(this.isMac ? 'platform-mac' : 'platform-win');

    this.render();
  }

  /**
   * Create a window-control button.
   * @param {string} className - Extra class name
   * @param {string} icon - SVG markup
   * @param {string} label - Accessible label
   * @param {Function} onClick - Click handler
   * @returns {HTMLButtonElement}
   */
  makeButton(className, icon, label, onClick) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = className;
    btn.setAttribute('aria-label', label);
    btn.title = label;
    btn.innerHTML = icon;
    btn.addEventListener('click', onClick);
    return btn;
  }

  render() {
    if (!this.container) return;
    this.container.innerHTML = '';

    // No preload API (e.g. framed dev window) — render nothing
    if (!this.controls) return;

    // macOS: native traffic lights are drawn by the OS over the titlebar
    // (titleBarStyle 'hidden'); render no HTML controls
    if (this.isMac) return;

    // Windows / Linux caption buttons: minimize · maximize/restore · close
    this.container.appendChild(this.makeButton(
      'win-control', controlIcons.minimize, 'Minimize',
      () => this.controls.minimize()
    ));

    this.maximizeButton = this.makeButton(
      'win-control', controlIcons.maximize, 'Maximize',
      () => this.controls.maximizeToggle()
    );
    this.container.appendChild(this.maximizeButton);

    this.container.appendChild(this.makeButton(
      'win-control win-close', controlIcons.close, 'Close',
      () => this.controls.close()
    ));

    // Keep the maximize icon in sync with the window state
    if (this.controls.onMaximizedChange) {
      this.controls.onMaximizedChange((isMaximized) => {
        this.setMaximizedState(isMaximized);
      });
    }
    if (this.controls.isMaximized) {
      this.controls.isMaximized()
        .then((isMaximized) => this.setMaximizedState(isMaximized))
        .catch(() => {});
    }
  }

  /**
   * Swap the maximize/restore icon.
   * @param {boolean} isMaximized - Current window state
   */
  setMaximizedState(isMaximized) {
    if (!this.maximizeButton) return;
    this.maximizeButton.innerHTML = isMaximized
      ? controlIcons.restore
      : controlIcons.maximize;
    const label = isMaximized ? 'Restore' : 'Maximize';
    this.maximizeButton.setAttribute('aria-label', label);
    this.maximizeButton.title = label;
  }
}
