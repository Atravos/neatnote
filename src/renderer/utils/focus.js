/**
 * Focus helpers shared by the app's dialogs.
 */

/**
 * Move focus to an element as soon as it can actually take it.
 *
 * Dialogs fade in with a CSS transition on `visibility`, and an element
 * inside a still-hidden container silently refuses focus(). A single
 * delayed focus() call therefore fails whenever the first frame of the
 * transition arrives late (a busy or slow machine) — leaving the dialog
 * open with focus somewhere behind it, where Escape, Enter and typing go
 * to the wrong place. This retries for a short while until focus lands.
 *
 * @param {HTMLElement} element - Element to focus
 * @param {Object} [options]
 * @param {Function} [options.stillWanted] - () => boolean; return false to
 *        give up (e.g. the dialog was closed again)
 * @param {boolean} [options.select=false] - Select the text of an input
 * @param {number} [options.timeout=1000] - Give up after this many ms
 */
export function focusWhenReady(element, { stillWanted = () => true, select = false, timeout = 1000 } = {}) {
  if (!element) return;
  const deadline = Date.now() + timeout;

  const attempt = () => {
    if (!stillWanted() || !document.contains(element)) return;

    element.focus({ preventScroll: true });
    if (document.activeElement === element) {
      if (select && typeof element.select === 'function') element.select();
      return;
    }
    if (Date.now() < deadline) {
      setTimeout(attempt, 30);
    }
  };

  attempt();
}

/**
 * Return focus to where it was before a dialog opened. If that element is
 * gone (or was never recorded), focus is at least taken OUT of the dialog,
 * so keystrokes can't keep landing in a control that is no longer visible.
 * @param {HTMLElement|null} previous - Element that had focus before
 * @param {HTMLElement} container - The dialog's overlay
 */
export function restoreFocus(previous, container) {
  if (previous && typeof previous.focus === 'function' && document.contains(previous) &&
      !container.contains(previous)) {
    previous.focus({ preventScroll: true });
  }
  const active = document.activeElement;
  if (active && container.contains(active) && typeof active.blur === 'function') {
    active.blur();
  }
}
