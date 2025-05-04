// WebSocket polyfill for attestor-core
// This file fixes the "ws.WebSocket is not a constructor" error

// The browser's WebSocket class
class BrowserWebSocket extends (typeof window !== 'undefined' ? window.WebSocket : class {}) {
  constructor(url, options) {
    if (typeof window === 'undefined' || typeof window.WebSocket === 'undefined') {
      throw new Error('WebSocket is not available in this environment');
    }
    super(url);
    this.url = url;
    this.options = options;
  }
}

// Export a module that looks like the 'ws' package
const wsPolyfill = {
  WebSocket: BrowserWebSocket
};

// Make it globally available to handle dynamic requires
if (typeof window !== 'undefined') {
  window.ws = wsPolyfill;
  
  // Patch global require if it exists
  if (typeof window.require === 'function') {
    const originalRequire = window.require;
    window.require = function(name) {
      if (name === 'ws') {
        return wsPolyfill;
      }
      return originalRequire(name);
    };
  }
}

// This export is used by webpack's ProvidePlugin
export default wsPolyfill; 