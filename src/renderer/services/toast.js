/**
 * Toast notification service.
 * Lightweight singleton — import { showToast } anywhere in the renderer.
 * Styling lives in src/styles/toast.css.
 */

let container = null;

function getContainer() {
  if (!container || !document.body.contains(container)) {
    container = document.createElement('div');
    container.id = 'toast-container';
    document.body.appendChild(container);
  }
  return container;
}

/**
 * Show a toast notification.
 * @param {string} message - Text to display
 * @param {'info'|'success'|'error'} [type='info'] - Visual style
 * @param {number} [duration=3500] - How long to show, in milliseconds
 */
export function showToast(message, type = 'info', duration = 3500) {
  const toast = document.createElement('div');
  toast.className = `toast toast-${type}`;
  toast.setAttribute('role', type === 'error' ? 'alert' : 'status');
  toast.textContent = message;

  getContainer().appendChild(toast);

  // Trigger the enter transition on the next frame
  requestAnimationFrame(() => toast.classList.add('toast-visible'));

  const dismiss = () => {
    toast.classList.remove('toast-visible');
    toast.addEventListener('transitionend', () => toast.remove(), { once: true });
    // Fallback removal in case transitionend never fires
    setTimeout(() => toast.remove(), 600);
  };

  const timer = setTimeout(dismiss, duration);

  // Click to dismiss early
  toast.addEventListener('click', () => {
    clearTimeout(timer);
    dismiss();
  });
}
