/**
 * WebSocket implementation for offscreen document
 * 
 * This ensures that the attestor-core library can access native WebSockets
 * when running in the offscreen document context.
 */

// Expose the native browser WebSocket
export const WebSocket = window.WebSocket;
export default window.WebSocket;

// Log that we're using the native WebSocket
console.log('[OFFSCREEN-WEBSOCKET] Using native browser WebSocket in offscreen document'); 