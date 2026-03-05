/**
 * ProcessManager - Tracks and manages application resources
 * to ensure proper cleanup on exit.
 *
 * Resources are keyed by a string identifier so they can be
 * reliably registered and unregistered.
 */
class ProcessManager {
  constructor() {
    this.resources = new Map();
    this.isShuttingDown = false;
    console.log('Process manager initialized');
  }

  /**
   * Register a resource with a cleanup callback.
   * @param {string} key - Unique identifier for the resource
   * @param {Function} cleanup - Function to call during shutdown
   */
  register(key, cleanup) {
    if (!key || typeof cleanup !== 'function') return;

    // If a resource with this key already exists, run its cleanup first
    if (this.resources.has(key)) {
      try {
        const existing = this.resources.get(key);
        if (typeof existing === 'function') existing();
      } catch (err) {
        console.error(`Error cleaning up existing resource "${key}":`, err);
      }
    }

    this.resources.set(key, cleanup);
    console.log(`Resource registered: "${key}" (total: ${this.resources.size})`);
  }

  /**
   * Unregister a resource (does NOT run its cleanup).
   * @param {string} key - Identifier of the resource to remove
   * @returns {boolean} Whether the resource was found and removed
   */
  unregister(key) {
    const removed = this.resources.delete(key);
    if (removed) {
      console.log(`Resource unregistered: "${key}" (remaining: ${this.resources.size})`);
    }
    return removed;
  }

  /**
   * Run all cleanup callbacks and clear the registry.
   */
  cleanupAll() {
    console.log(`Cleaning up all resources (${this.resources.size})...`);
    this.isShuttingDown = true;

    this.resources.forEach((cleanup, key) => {
      try {
        cleanup();
      } catch (error) {
        console.error(`Error cleaning up resource "${key}":`, error);
      }
    });

    this.resources.clear();
    console.log('All resources cleaned up');
  }

  /**
   * Whether the application is in the process of shutting down.
   * @returns {boolean}
   */
  isQuitting() {
    return this.isShuttingDown;
  }
}

module.exports = new ProcessManager();