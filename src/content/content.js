// Import WebSocket fix before anything else
import '../utils/fix-websocket';

// Import polyfills first
import '../utils/polyfills';

// This script runs in the context of the web page
import { RECLAIM_SDK_ACTIONS, MESSAGER_ACTIONS, MESSAGER_TYPES } from '../utils/interfaces.js';

class ReclaimContentScript {
    constructor() {
      this.init();
    }
    
    init() {
      // Listen for messages from the background script
      chrome.runtime.onMessage.addListener(this.handleMessage.bind(this));
      
      // Notify background script that content script is loaded
      chrome.runtime.sendMessage({ 
        action: MESSAGER_ACTIONS.CONTENT_SCRIPT_LOADED, 
        source: MESSAGER_TYPES.CONTENT_SCRIPT,
        target: MESSAGER_TYPES.BACKGROUND,
        data: { url: window.location.href } 
      });

      // Listen for messages from the web page
      window.addEventListener('message', this.handleWindowMessage.bind(this));
    }
    
    handleMessage(message, sender, sendResponse) {
      const { action, data } = message;
      
      switch (action) {
        case 'INJECT_CUSTOM_SCRIPT':
          this.injectCustomScript(data.script);
          sendResponse({ success: true });
          break;
          
        case 'EXTRACT_DOM_DATA':
          const domData = this.extractDOMData(data.selectors);
          sendResponse({ success: true, data: domData });
          break;
          
        case 'PROOF_SUBMITTED':
          // Forward proof to the page
          console.log('[CONTENT] Proof submitted, notifying page:', data);
          window.postMessage({
            action: RECLAIM_SDK_ACTIONS.VERIFICATION_COMPLETED,
            data: data.proof
          }, '*');
          sendResponse({ success: true });
          break;
          
        default:
          sendResponse({ success: false, error: 'Unknown action' });
      }
      
      return true; // Keep the message channel open for async response
    }
    
    handleWindowMessage(event) {
      // Only accept messages from the same window
      if (event.source !== window) return;
      
      const { action, data, messageId } = event.data;
      
      // Check if the message is meant for this extension
      if (action === RECLAIM_SDK_ACTIONS.CHECK_EXTENSION) {
        // Send response back to the page
        window.postMessage({
          action: RECLAIM_SDK_ACTIONS.EXTENSION_RESPONSE,
          messageId: messageId,
          installed: true
        }, '*');
      }
      
      // Handle start verification request from SDK
      if (action === RECLAIM_SDK_ACTIONS.START_VERIFICATION && data) {
        // Forward the template data to background script
        chrome.runtime.sendMessage({
          action: MESSAGER_ACTIONS.START_VERIFICATION,
          source: MESSAGER_TYPES.CONTENT_SCRIPT,
          target: MESSAGER_TYPES.BACKGROUND,
          data: data
        }, (response) => {
            console.log('[CONTENT] Starting verification with data:', data);
          // Send confirmation back to SDK
          if (response && response.success) {
            window.postMessage({
              action: RECLAIM_SDK_ACTIONS.VERIFICATION_STARTED,
              messageId: messageId,
              sessionId: data.sessionId
            }, '*');
          } else {
            window.postMessage({
              action: RECLAIM_SDK_ACTIONS.VERIFICATION_FAILED,
              messageId: messageId,
              error: response?.error || 'Failed to start verification'
            }, '*');
          }
        });
      }
    }
    
    injectCustomScript(scriptContent) {
      try {
        // Create a Blob containing the script content
        const blob = new Blob([scriptContent], { type: 'application/javascript' });
        
        // Create a URL for the Blob
        const scriptURL = URL.createObjectURL(blob);
        
        // Create a script element with the Blob URL
        const script = document.createElement('script');
        script.src = scriptURL;
        script.onload = () => {
          // Clean up by revoking the Blob URL after the script loads
          URL.revokeObjectURL(scriptURL);
        };
        
        // Append the script to the document head
        document.head.appendChild(script);
        
        return true;
      } catch (error) {
        console.error('Error injecting script:', error);
        return false;
      }
    }
    
    extractDOMData(selectors) {
      const result = {};
      
      if (selectors && Array.isArray(selectors)) {
        selectors.forEach(selector => {
          const elements = document.querySelectorAll(selector.query);
          if (elements.length > 0) {
            if (selector.multiple) {
              result[selector.name] = Array.from(elements).map(el => 
                selector.attribute ? el.getAttribute(selector.attribute) : el.textContent.trim()
              );
            } else {
              result[selector.name] = selector.attribute ? 
                elements[0].getAttribute(selector.attribute) : 
                elements[0].textContent.trim();
            }
          }
        });
      }
      
      return result;
    }
  }
  
  // Initialize content script
  const contentScript = new ReclaimContentScript();