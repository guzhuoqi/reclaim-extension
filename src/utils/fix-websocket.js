/**
 * Fix for the ws.WebSocket is not a constructor error in attestor-core
 * 
 * This file is a simple and direct fix for the error:
 * TypeError: ws.WebSocket is not a constructor
 */

import { MockWebSocket } from './websocket-mock';

// Check if we're in a browser window or service worker context
const isServiceWorker = typeof window === 'undefined';
const globalContext = isServiceWorker ? self : window;

// Create our WebSocket implementation
// In service workers, we need to use a different approach
if (isServiceWorker) {
  // Use our mock WebSocket for service worker context
  globalContext.ws = { WebSocket: MockWebSocket };
} else {
  // In window context, use the native WebSocket
  globalContext.ws = { WebSocket: globalContext.WebSocket };
}

// Patch the require function in the appropriate context
if (typeof globalContext.require !== 'function') {
  globalContext.require = function(modulePath) {
    if (modulePath === 'ws') {
      return globalContext.ws;
    }
    throw new Error(`Cannot find module '${modulePath}'`);
  };
} else {
  const originalRequire = globalContext.require;
  globalContext.require = function(modulePath) {
    if (modulePath === 'ws') {
      return globalContext.ws;
    }
    return originalRequire(modulePath);
  };
}

// Set process.browser for Node.js compatibility checks
globalContext.process = globalContext.process || {};
globalContext.process.browser = true;

// Export for module imports
export default globalContext.ws; 