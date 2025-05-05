// Import necessary utilities and interfaces
import '../utils/polyfills.js';
import { MESSAGER_ACTIONS, MESSAGER_TYPES } from '../utils/interfaces.js';
import { createClaimOnAttestor } from '@reclaimprotocol/attestor-core';
// Import our specialized WebSocket implementation for offscreen document
import { WebSocket } from '../utils/offscreen-websocket.js';

// Ensure WebSocket is globally available in the offscreen context
window.WebSocket = WebSocket;

class OffscreenProofGenerator {
  constructor() {
    this.init();
  }

  init() {
    console.log('[OFFSCREEN] Initializing offscreen document');
    
    // Set up message listeners
    chrome.runtime.onMessage.addListener(this.handleMessage.bind(this));
    
    // Notify background script that offscreen document is ready
    this.sendReadySignal();
  }

  sendReadySignal() {
    console.log('[OFFSCREEN] Sending ready signal to background script');
    chrome.runtime.sendMessage({
      action: MESSAGER_ACTIONS.OFFSCREEN_DOCUMENT_READY,
      source: MESSAGER_TYPES.OFFSCREEN,
      target: MESSAGER_TYPES.BACKGROUND
    });
  }

  handleMessage(message, sender, sendResponse) {
    const { action, source, target, data } = message;
    
    // Only process messages targeted at offscreen document
    if (target !== MESSAGER_TYPES.OFFSCREEN) return;
    
    console.log('[OFFSCREEN] Received message:', action, 'from', source);
    
    switch (action) {
      case 'PING_OFFSCREEN':
        // Respond to ping by sending ready signal
        this.sendReadySignal();
        sendResponse({ success: true });
        break;
        
      case MESSAGER_ACTIONS.GENERATE_PROOF:
        // Handle proof generation using createClaimOnAttestor
        this.generateProof(data)
          .then(proof => {
            console.log('[OFFSCREEN] Proof generated successfully');
            chrome.runtime.sendMessage({
              action: MESSAGER_ACTIONS.GENERATE_PROOF_RESPONSE,
              source: MESSAGER_TYPES.OFFSCREEN,
              target: MESSAGER_TYPES.BACKGROUND,
              success: true,
              proof
            });
          })
          .catch(error => {
            console.error('[OFFSCREEN] Error generating proof:', error);
            chrome.runtime.sendMessage({
              action: MESSAGER_ACTIONS.GENERATE_PROOF_RESPONSE,
              source: MESSAGER_TYPES.OFFSCREEN,
              target: MESSAGER_TYPES.BACKGROUND,
              success: false,
              error: error.message || 'Unknown error in proof generation'
            });
          });
        
        // Respond immediately to keep the message channel open
        sendResponse({ received: true });
        break;
        
      default:
        console.log('[OFFSCREEN] Unknown action:', action);
        sendResponse({ success: false, error: 'Unknown action' });
    }
    
    return true; // Keep the message channel open for async response
  }

  async generateProof(claimData) {
    try {
      if (!claimData) {
        throw new Error('No claim data provided for proof generation');
      }

      console.log('[OFFSCREEN] Generating proof with data:', claimData);
      
      // Create a proper configuration object that the createClaimOnAttestor expects
      // The error "Cannot use 'in' operator to search for 'logger' in undefined" happens 
      // when the config object is not properly structured
      const config = {
        "name": "http",
        "params": {
          "url": "https://api.coingecko.com/api/v3/simple/price?ids=ethereum&vs_currencies=usd",
          "method": "GET",
          "responseMatches": [
            {
              "type": "regex",
              "value": "{\"ethereum\":{\"usd\":(?<price>[\\d\\.]+)}}"
            }
          ],
          "responseRedactions": []
        },
        "secretParams": {
          "headers": {
            "accept": "application/json, text/plain, */*"
          }
        },
        "ownerPrivateKey": "0x1234567456789012345678901234567890123456789012345678901234567890",
        "client": {
          "url": "wss://attestor.reclaimprotocol.org/ws"
        }
      }
      
      console.log('[OFFSCREEN] Calling createClaimOnAttestor with config:', config);
      
      // Call createClaimOnAttestor with the properly structured configuration
      const result = await createClaimOnAttestor(config);
      
      console.log('[OFFSCREEN] Claim created successfully:', result);
      
      // Return the generated claim
      return result;
    } catch (error) {
      console.error('[OFFSCREEN] Error generating claim:', error);
      throw error;
    }
  }
}

// Initialize the offscreen document
const proofGenerator = new OffscreenProofGenerator(); 