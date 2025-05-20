// Import necessary utilities and interfaces
import '../utils/polyfills';
import { MESSAGE_ACTIONS, MESSAGE_SOURCES, RECLAIM_SESSION_STATUS } from '../utils/constants';
import { createClaimOnAttestor } from '@reclaimprotocol/attestor-core';
// Import our specialized WebSocket implementation for offscreen document
import { WebSocket } from '../utils/offscreen-websocket';
import { updateSessionStatus } from '../utils/fetch-calls'

// Preload p-queue to prevent dynamic chunk loading issues
import PQueue from 'p-queue';

// Ensure WebAssembly is available
if (typeof WebAssembly === 'undefined') {
  console.error('[OFFSCREEN] WebAssembly is not available in this browser context');
}

// Set WASM path to the extension's public path
if (typeof global !== 'undefined') {
  global.WASM_PATH = chrome.runtime.getURL('');
}

// Set appropriate COOP/COEP headers for SharedArrayBuffer support
const metaCSP = document.createElement('meta');
metaCSP.httpEquiv = 'Cross-Origin-Embedder-Policy';
metaCSP.content = 'require-corp';
document.head.appendChild(metaCSP);

const metaCOOP = document.createElement('meta');
metaCOOP.httpEquiv = 'Cross-Origin-Opener-Policy';
metaCOOP.content = 'same-origin';
document.head.appendChild(metaCOOP);

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
      action: MESSAGE_ACTIONS.OFFSCREEN_DOCUMENT_READY,
      source: MESSAGE_SOURCES.OFFSCREEN,
      target: MESSAGE_SOURCES.BACKGROUND
    });
  }

  handleMessage(message, sender, sendResponse) {
    const { action, source, target, data } = message;

    // Only process messages targeted at offscreen document
    if (target !== MESSAGE_SOURCES.OFFSCREEN) return;

    console.log('[OFFSCREEN] Received message:', action, 'from', source);

    switch (action) {
      case 'PING_OFFSCREEN':
        // Respond to ping by sending ready signal
        this.sendReadySignal();
        sendResponse({ success: true });
        break;

      case MESSAGE_ACTIONS.GENERATE_PROOF:
        // Handle proof generation using createClaimOnAttestor
        this.generateProof(data)
          .then(proof => {
            console.log('[OFFSCREEN] Proof generated successfully');
            chrome.runtime.sendMessage({
              action: MESSAGE_ACTIONS.GENERATE_PROOF_RESPONSE,
              source: MESSAGE_SOURCES.OFFSCREEN,
              target: MESSAGE_SOURCES.BACKGROUND,
              success: true,
              proof: proof
            });
          })
          .catch(error => {
            console.error('[OFFSCREEN] Error generating proof:', error);
            chrome.runtime.sendMessage({
              action: MESSAGE_ACTIONS.GENERATE_PROOF_RESPONSE,
              source: MESSAGE_SOURCES.OFFSCREEN,
              target: MESSAGE_SOURCES.BACKGROUND,
              success: false,
              error: error.message || 'Unknown error in proof generation'
            });
          });

        // Respond immediately to keep the message channel open
        sendResponse({ received: true });
        break;

      case MESSAGE_ACTIONS.GET_PRIVATE_KEY:
        try {
          const randomBytes = window.crypto.getRandomValues(new Uint8Array(32));
          const privateKey = '0x' + Array.from(randomBytes).map(b => b.toString(16).padStart(2, '0')).join('');
          
          chrome.runtime.sendMessage({
            action: MESSAGE_ACTIONS.GET_PRIVATE_KEY_RESPONSE,
            source: MESSAGE_SOURCES.OFFSCREEN,
            target: source, // Send back to the original requester
            success: true,
            privateKey: privateKey
          });
          sendResponse({ success: true, received: true }); // Acknowledge message handling
        } catch (error) {
          console.error('[OFFSCREEN] Error generating private key:', error);
          // Send error response back to caller
          chrome.runtime.sendMessage({
            action: MESSAGE_ACTIONS.GET_PRIVATE_KEY_RESPONSE,
            source: MESSAGE_SOURCES.OFFSCREEN,
            target: source,
            success: false,
            error: error.message || 'Unknown error generating private key'
          });
          sendResponse({ success: false, error: error.message }); // Acknowledge with error
        }
        break; // Important to break here

      default:
        console.log('[OFFSCREEN] Unknown action:', action);
        sendResponse({ success: false, error: 'Unknown action' });
    }

    return true; // Keep the message channel open for async response
  }

  async generateProof(claimData) {
    if (!claimData) {
      throw new Error('No claim data provided for proof generation');
    }
    // extract sessionId from claimData
    const sessionId = claimData.sessionId;
    // remove sessionId from claimData to avoid it being sent to the attestor
    delete claimData.sessionId;
    try {
      console.log('[OFFSCREEN] Session ID:', sessionId);
      console.log('[OFFSCREEN] Claim data:', claimData);
      await updateSessionStatus(sessionId, RECLAIM_SESSION_STATUS.PROOF_GENERATION_STARTED);
      const result = await createClaimOnAttestor(claimData);
      await updateSessionStatus(sessionId, RECLAIM_SESSION_STATUS.PROOF_GENERATION_SUCCESS);
      console.log('[OFFSCREEN] Claim created successfully:', result);
      return result;
    } catch (error) {
      await updateSessionStatus(sessionId, RECLAIM_SESSION_STATUS.PROOF_GENERATION_FAILED);
      console.error('[OFFSCREEN] Error generating claim:', error);
      throw error;
    }
  }
}

// Initialize the offscreen document
const proofGenerator = new OffscreenProofGenerator(); 