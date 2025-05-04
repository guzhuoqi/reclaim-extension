// Import WebSocket fix before anything else
import './fix-websocket';

// Import polyfills before attestor-core
import './polyfills';
import { MESSAGER_ACTIONS, MESSAGER_TYPES } from './interfaces.js';

// Track the offscreen document status
let offscreenReady = false;
let offscreenDocTimeout = null;

// Global listener for the ready signal from offscreen document
// We need to set this up immediately to catch the ready signal
const setupOffscreenReadyListener = () => {
  chrome.runtime.onMessage.addListener((message) => {
    if (message.action === MESSAGER_ACTIONS.OFFSCREEN_DOCUMENT_READY && 
        message.source === MESSAGER_TYPES.OFFSCREEN && 
        message.target === MESSAGER_TYPES.BACKGROUND) {
      console.log('[PROOF-GENERATOR] Received offscreen ready signal');
      offscreenReady = true;
      if (offscreenDocTimeout) {
        clearTimeout(offscreenDocTimeout);
        offscreenDocTimeout = null;
      }
    }
  });
};

// Set up listener immediately
setupOffscreenReadyListener();

export const generateProof = async (claimData) => {
  try {
    console.log('[PROOF-GENERATOR] Starting proof generation with data:', claimData);
    
    // Reset ready flag when starting
    offscreenReady = false;
    
    // Check if offscreen document exists, create if not
    const exists = await checkOffscreenExists();
    if (exists) {
      console.log('[PROOF-GENERATOR] Offscreen document already exists');
      // If it exists, attempt to close it first
      try {
        await chrome.offscreen.closeDocument();
        console.log('[PROOF-GENERATOR] Closed existing offscreen document');
      } catch (e) {
        console.log('[PROOF-GENERATOR] No document to close or error closing:', e);
      }
    }
    
    // Always create a fresh document to ensure proper initialization
    await createOffscreenDocument();
      
    // Wait for the offscreen document to be ready
    const isReady = await waitForOffscreenReady();
    if (!isReady) {
      // Try one more time with a fresh document before giving up
      console.log('[PROOF-GENERATOR] First attempt timed out, trying once more with a fresh document');
      try {
        await chrome.offscreen.closeDocument();
      } catch (e) {
        console.log('[PROOF-GENERATOR] Error closing document on retry:', e);
      }
      
      await createOffscreenDocument();
      const retryReady = await waitForOffscreenReady(20000); // Longer timeout on retry
      
      if (!retryReady) {
        throw new Error('Failed to initialize offscreen document');
      }
    }
    
    // Use the offscreen document to generate the proof
    return new Promise((resolve, reject) => {
      console.log('[PROOF-GENERATOR] Sending proof generation request to offscreen document');
      
      // Use provided claim data or fallback to default
      const message = {
        action: MESSAGER_ACTIONS.GENERATE_PROOF,
        source: MESSAGER_TYPES.BACKGROUND,
        target: MESSAGER_TYPES.OFFSCREEN,
        data: {
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
      };
      
      // Direct message to offscreen document with timeout for response
      const messageTimeout = setTimeout(() => {
        console.error('[PROOF-GENERATOR] Timeout waiting for proof generation response');
        reject(new Error('Timeout generating proof'));
      }, 30000); // 30 second timeout for proof generation
      
      chrome.runtime.sendMessage(message, (response) => {
        clearTimeout(messageTimeout);
        
        if (chrome.runtime.lastError) {
          console.error('[PROOF-GENERATOR] Error sending message to offscreen:', chrome.runtime.lastError);
          reject(new Error(chrome.runtime.lastError.message));
          return;
        }
        
        if (response && response.success) {
          console.log('[PROOF-GENERATOR] Proof generated successfully');
          resolve(response.proof);
        } else if (response) {
          console.error('[PROOF-GENERATOR] Error generating proof:', response.error);
          reject(new Error(response.error));
        } else {
          reject(new Error('No response from offscreen document'));
        }
      });
    });
  } catch (error) { 
    console.error('[PROOF-GENERATOR] Error in proof generation process:', error);
    throw error;
  }
}

// Function to wait for offscreen document to be ready
async function waitForOffscreenReady(timeoutMs = 15000) {
  if (offscreenReady) return true;
  
  console.log('[PROOF-GENERATOR] Waiting for offscreen document to be ready...');
  
  // Proactively ping the offscreen document to check if it's responsive
  try {
    chrome.runtime.sendMessage({
      action: 'PING_OFFSCREEN',
      source: MESSAGER_TYPES.BACKGROUND,
      target: MESSAGER_TYPES.OFFSCREEN
    });
  } catch (e) {
    console.log('[PROOF-GENERATOR] Ping attempt failed:', e);
  }
  
  return new Promise((resolve) => {
    // Set up a listener for the ready message
    const readyListener = (message) => {
      if (message.action === MESSAGER_ACTIONS.OFFSCREEN_DOCUMENT_READY && 
          message.source === MESSAGER_TYPES.OFFSCREEN && 
          message.target === MESSAGER_TYPES.BACKGROUND) {
        offscreenReady = true;
        chrome.runtime.onMessage.removeListener(readyListener);
        console.log('[PROOF-GENERATOR] Offscreen document is ready');
        if (offscreenDocTimeout) {
          clearTimeout(offscreenDocTimeout);
          offscreenDocTimeout = null;
        }
        resolve(true);
      }
    };
    
    // Add the listener
    chrome.runtime.onMessage.addListener(readyListener);
    
    // Set a timeout to prevent infinite waiting
    offscreenDocTimeout = setTimeout(() => {
      chrome.runtime.onMessage.removeListener(readyListener);
      console.error('[PROOF-GENERATOR] Timed out waiting for offscreen document to be ready');
      resolve(false);
    }, timeoutMs);
  });
}

async function checkOffscreenExists() {
  // Check if offscreen document is already open
  try {
    const existingContexts = await chrome.runtime.getContexts({
      contextTypes: ['OFFSCREEN_DOCUMENT']
    });
    return existingContexts.length > 0;
  } catch (e) {
    // Try alternative method for Chrome versions that don't support getContexts
    console.log('[PROOF-GENERATOR] getContexts not supported, using alternative check');
    try {
      // If we can close the document, it must exist
      await chrome.offscreen.closeDocument();
      return true;
    } catch (closeError) {
      // If we get an error closing, it probably doesn't exist
      return false;
    }
  }
}

async function createOffscreenDocument() {
  // Create an offscreen document
  try {
    await chrome.offscreen.createDocument({
      url: chrome.runtime.getURL('offscreen/offscreen.html'),
      reasons: ['DOM_PARSER', 'IFRAME_SCRIPTING'],
      justification: 'Used for ZK proof generation'
    });
    console.log('[PROOF-GENERATOR] Offscreen document created successfully');
  } catch (error) {
    console.error('[PROOF-GENERATOR] Error creating offscreen document:', error);
    throw error;
  }
}