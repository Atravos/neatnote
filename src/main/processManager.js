/**
 * ProcessManager - Tracks and manages application resources
 * to ensure proper cleanup on exit
 */
class ProcessManager {
    constructor() {
      this.resources = new Set();
      this.isShuttingDown = false;
      console.log('Process manager initialized');
    }
    
    register(resource, cleanup) {
      if (!resource || !cleanup) return;
      
      this.resources.add({ resource, cleanup });
      console.log(`Resource registered, total: ${this.resources.size}`);
    }
    
    unregister(resource) {
      let removed = false;
      this.resources.forEach(item => {
        if (item.resource === resource) {
          this.resources.delete(item);
          removed = true;
        }
      });
      
      if (removed) {
        console.log(`Resource unregistered, remaining: ${this.resources.size}`);
      }
      return removed;
    }
    
    cleanupAll() {
      console.log(`Cleaning up all resources (${this.resources.size})...`);
      this.isShuttingDown = true;
      
      this.resources.forEach(item => {
        try {
          if (typeof item.cleanup === 'function') {
            item.cleanup();
          }
        } catch (error) {
          console.error('Error cleaning up resource:', error);
        }
      });
      
      this.resources.clear();
      console.log('All resources cleaned up');
    }
    
    isQuitting() {
      return this.isShuttingDown;
    }
  }
  
  module.exports = new ProcessManager();