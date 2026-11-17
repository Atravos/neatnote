/**
 * A small themed context menu (used by the sidebar).
 *
 * One menu exists at a time. It closes on a choice, Escape, a click
 * anywhere else, scrolling, resizing, or the window losing focus, and is
 * fully keyboard-operable (arrow keys, Home/End, Enter/Space).
 * Styling lives in src/styles/contextmenu.css.
 */

let activeMenu = null;

/** Close the open context menu, if any. */
export function closeContextMenu() {
  if (activeMenu) {
    activeMenu.close();
    activeMenu = null;
  }
}

/**
 * Show a context menu.
 * @param {number} x - Viewport X to open at
 * @param {number} y - Viewport Y to open at
 * @param {Array<{label?: string, hint?: string, danger?: boolean,
 *   disabled?: boolean, separator?: boolean, action?: Function}>} items
 * @param {Object} [options]
 * @param {HTMLElement} [options.returnFocus] - Element to focus when the
 *        menu closes without a choice
 */
export function showContextMenu(x, y, items, { returnFocus = null } = {}) {
  closeContextMenu();

  const menu = document.createElement('div');
  menu.className = 'context-menu';
  menu.setAttribute('role', 'menu');
  menu.tabIndex = -1;

  const buttons = [];
  items.forEach((item) => {
    if (item.separator) {
      const separator = document.createElement('div');
      separator.className = 'context-menu-separator';
      separator.setAttribute('role', 'separator');
      menu.appendChild(separator);
      return;
    }

    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'context-menu-item';
    button.setAttribute('role', 'menuitem');
    button.tabIndex = -1;
    if (item.danger) button.classList.add('danger');
    if (item.disabled) button.disabled = true;

    const label = document.createElement('span');
    label.className = 'context-menu-label';
    label.textContent = item.label;
    button.appendChild(label);

    if (item.hint) {
      const hint = document.createElement('span');
      hint.className = 'context-menu-hint';
      hint.textContent = item.hint;
      button.appendChild(hint);
    }

    button.addEventListener('click', () => {
      close({ restoreFocus: false });
      if (typeof item.action === 'function') item.action();
    });

    menu.appendChild(button);
    if (!item.disabled) buttons.push(button);
  });

  let closed = false;

  function close({ restoreFocus = true } = {}) {
    if (closed) return;
    closed = true;
    document.removeEventListener('mousedown', onOutsideMouseDown, true);
    document.removeEventListener('scroll', onDismiss, true);
    window.removeEventListener('resize', onDismiss);
    window.removeEventListener('blur', onDismiss);
    menu.remove();
    if (activeMenu && activeMenu.element === menu) activeMenu = null;
    if (restoreFocus && returnFocus && document.contains(returnFocus)) {
      returnFocus.focus({ preventScroll: true });
    }
  }

  function onOutsideMouseDown(event) {
    if (!menu.contains(event.target)) close({ restoreFocus: false });
  }

  function onDismiss() {
    close({ restoreFocus: false });
  }

  function focusItem(index) {
    if (buttons.length === 0) return;
    const wrapped = (index + buttons.length) % buttons.length;
    buttons[wrapped].focus({ preventScroll: true });
  }

  menu.addEventListener('keydown', (event) => {
    const current = buttons.indexOf(document.activeElement);
    switch (event.key) {
      case 'Escape':
        close();
        break;
      case 'ArrowDown':
        focusItem(current + 1);
        break;
      case 'ArrowUp':
        focusItem(current === -1 ? buttons.length - 1 : current - 1);
        break;
      case 'Home':
        focusItem(0);
        break;
      case 'End':
        focusItem(buttons.length - 1);
        break;
      case 'Tab':
        // Keep focus inside the menu while it is open
        break;
      default:
        return; // Enter / Space activate the focused button natively
    }
    event.preventDefault();
    event.stopPropagation();
  });

  // A right-click inside the menu itself shouldn't open another menu
  menu.addEventListener('contextmenu', (event) => event.preventDefault());

  document.body.appendChild(menu);

  // Keep the menu fully inside the window
  const margin = 6;
  const rect = menu.getBoundingClientRect();
  const left = Math.max(margin, Math.min(x, window.innerWidth - rect.width - margin));
  const top = Math.max(margin, Math.min(y, window.innerHeight - rect.height - margin));
  menu.style.left = `${left}px`;
  menu.style.top = `${top}px`;

  document.addEventListener('mousedown', onOutsideMouseDown, true);
  document.addEventListener('scroll', onDismiss, true);
  window.addEventListener('resize', onDismiss);
  window.addEventListener('blur', onDismiss);

  activeMenu = { element: menu, close };
  focusItem(0);
}
