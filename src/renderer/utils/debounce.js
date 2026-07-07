/**
 * Debounce utility function to delay execution.
 * The returned function has two extra methods:
 *   .cancel() - discard any pending invocation
 *   .flush()  - run any pending invocation immediately (returns its result)
 * @param {Function} func - Function to debounce
 * @param {number} wait - Wait time in milliseconds
 * @returns {Function} Debounced function
 */
export function debounce(func, wait) {
  let timeout = null;
  let lastArgs = null;
  let lastContext = null;

  function debounced(...args) {
    lastArgs = args;
    lastContext = this;
    clearTimeout(timeout);
    timeout = setTimeout(() => {
      timeout = null;
      func.apply(lastContext, lastArgs);
    }, wait);
  }

  debounced.cancel = () => {
    clearTimeout(timeout);
    timeout = null;
  };

  debounced.flush = () => {
    if (timeout !== null) {
      debounced.cancel();
      return func.apply(lastContext, lastArgs);
    }
    return undefined;
  };

  return debounced;
}
