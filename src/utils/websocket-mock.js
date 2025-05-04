/**
 * Mock WebSocket implementation for service workers
 * 
 * This provides a minimal mock implementation of WebSocket for the service worker environment
 * where the browser's WebSocket API isn't available.
 */

export class MockWebSocket {
  // Standard WebSocket constants
  static CONNECTING = 0;
  static OPEN = 1;
  static CLOSING = 2;
  static CLOSED = 3;
  
  constructor(url, protocols) {
    this.url = url;
    this.protocols = protocols;
    this.readyState = MockWebSocket.CONNECTING;
    this.extensions = '';
    this.protocol = '';
    this.bufferedAmount = 0;
    this.binaryType = 'blob';
    
    // Event handlers
    this.onopen = null;
    this.onmessage = null;
    this.onerror = null;
    this.onclose = null;
    
    console.log(`[MockWebSocket] Creating connection to ${url}`);
    
    // Simulate async connection
    setTimeout(() => this._connect(), 10);
  }
  
  _connect() {
    if (this.readyState === MockWebSocket.CONNECTING) {
      this.readyState = MockWebSocket.OPEN;
      
      if (typeof this.onopen === 'function') {
        const event = { target: this, type: 'open' };
        this.onopen(event);
      }
      
      console.log(`[MockWebSocket] Connected to ${this.url}`);
    }
  }
  
  send(data) {
    if (this.readyState !== MockWebSocket.OPEN) {
      throw new Error('WebSocket is not open');
    }
    
    console.log(`[MockWebSocket] Sent data to ${this.url}:`, data);
    
    // Simulate a response after a short delay
    setTimeout(() => {
      if (this.readyState === MockWebSocket.OPEN && typeof this.onmessage === 'function') {
        const mockResponse = JSON.stringify({ 
          status: 'success', 
          message: 'This is a mock response' 
        });
        
        const event = {
          target: this,
          type: 'message',
          data: mockResponse,
          origin: this.url
        };
        
        this.onmessage(event);
      }
    }, 50);
    
    return true;
  }
  
  close(code = 1000, reason = '') {
    if (this.readyState === MockWebSocket.CLOSED) {
      return;
    }
    
    console.log(`[MockWebSocket] Closing connection to ${this.url}`);
    
    this.readyState = MockWebSocket.CLOSING;
    
    setTimeout(() => {
      this.readyState = MockWebSocket.CLOSED;
      
      if (typeof this.onclose === 'function') {
        const event = {
          target: this,
          type: 'close',
          code: code,
          reason: reason,
          wasClean: true
        };
        
        this.onclose(event);
      }
    }, 10);
  }
  
  // WebSocket also has addEventListener, removeEventListener, etc.
  addEventListener(type, listener, options) {
    console.log(`[MockWebSocket] addEventListener: ${type}`);
    switch (type) {
      case 'open':
        this.onopen = listener;
        break;
      case 'message':
        this.onmessage = listener;
        break;
      case 'error':
        this.onerror = listener;
        break;
      case 'close':
        this.onclose = listener;
        break;
    }
  }
  
  removeEventListener(type, listener) {
    console.log(`[MockWebSocket] removeEventListener: ${type}`);
    switch (type) {
      case 'open':
        if (this.onopen === listener) this.onopen = null;
        break;
      case 'message':
        if (this.onmessage === listener) this.onmessage = null;
        break;
      case 'error':
        if (this.onerror === listener) this.onerror = null;
        break;
      case 'close':
        if (this.onclose === listener) this.onclose = null;
        break;
    }
  }
  
  dispatchEvent(event) {
    console.log(`[MockWebSocket] dispatchEvent: ${event.type}`);
    switch (event.type) {
      case 'open':
        if (this.onopen) this.onopen(event);
        break;
      case 'message':
        if (this.onmessage) this.onmessage(event);
        break;
      case 'error':
        if (this.onerror) this.onerror(event);
        break;
      case 'close':
        if (this.onclose) this.onclose(event);
        break;
    }
    return true;
  }
} 