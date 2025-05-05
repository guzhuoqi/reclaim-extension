// Import polyfills
import './polyfills';

import { MESSAGER_ACTIONS, MESSAGER_TYPES } from './interfaces.js';
import { createClaimOnAttestor } from '@reclaimprotocol/attestor-core';

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

// Main function to generate proof using offscreen document
export const generateProof = async (claimData) => {
  try {
    console.log('[PROOF-GENERATOR] Starting proof generation with data:', claimData);
    
    // Ensure the offscreen document exists and is ready
    await ensureOffscreenDocument();
    
    // Clean the data to avoid encoding issues
    let cleanData = {
      "name": "http",
      "description": [
          "Example to fetch the current price of ETH in USD",
          "from the CoinGecko API",
          "The current price will be extracted & stored in",
          "context.extractedParams.price"
      ],
      "params": {
          "method": "GET",
          "url": "https://api.coingecko.com/api/v3/simple/price?ids=ethereum&vs_currencies=usd",
          "responseMatches": [
              {
                  "type": "regex",
                  "value": "\\{\"ethereum\":\\{\"usd\":(?<price>[\\d\\.]+)\\}\\}"
              }
          ],
          "responseRedactions": []
      },
      "secretParams": {
          "headers": {
              "accept": "application/json, text/plain, */*"
          }
      }
  }
    // let cleanData;
    // if (claimData) {
    //   try {
    //     cleanData = JSON.parse(JSON.stringify(claimData));
    //   } catch (e) {
    //     console.warn('[PROOF-GENERATOR] Error cleaning data:', e);
    //     cleanData = claimData;
    //   }
    // } else {
    //   throw new Error('No claim data provided for proof generation');
    // }
    
    // Generate the proof using the offscreen document
    return new Promise((resolve, reject) => {
      const messageTimeout = setTimeout(() => {
        console.error('[PROOF-GENERATOR] Timeout waiting for offscreen document to generate proof');
        reject(new Error('Timeout generating proof in offscreen document'));
      }, 30000); // 30 second timeout
      
      // Create a message listener for the offscreen response
      const messageListener = (response) => {
        if (response.action === MESSAGER_ACTIONS.GENERATE_PROOF_RESPONSE && 
            response.source === MESSAGER_TYPES.OFFSCREEN &&
            response.target === MESSAGER_TYPES.BACKGROUND) {
          
          // Clear timeout and remove listener
          clearTimeout(messageTimeout);
          chrome.runtime.onMessage.removeListener(messageListener);
          
          if (response.success) {
            console.log('[PROOF-GENERATOR] Proof generated successfully in offscreen document');
            resolve(response.proof);
          } else {
            console.error('[PROOF-GENERATOR] Error generating proof in offscreen document:', response.error);
            reject(new Error(response.error || 'Unknown error in proof generation'));
          }
        }
      };
      
      // Add listener for response
      chrome.runtime.onMessage.addListener(messageListener);
      
      // Send message to offscreen document to generate proof
      chrome.runtime.sendMessage({
        action: MESSAGER_ACTIONS.GENERATE_PROOF,
        source: MESSAGER_TYPES.BACKGROUND,
        target: MESSAGER_TYPES.OFFSCREEN,
        data: cleanData
      }, (sendResponse) => {
        if (chrome.runtime.lastError) {
          clearTimeout(messageTimeout);
          chrome.runtime.onMessage.removeListener(messageListener);
          console.error('[PROOF-GENERATOR] Error sending message to offscreen document:', chrome.runtime.lastError);
          reject(new Error(chrome.runtime.lastError.message));
        }
      });
    });
  } catch (error) { 
    console.error('[PROOF-GENERATOR] Error in proof generation process:', error);
    throw error;
  }
};

// Function to ensure the offscreen document exists and is ready
async function ensureOffscreenDocument() {
  const exists = await checkOffscreenExists();
  
  if (!exists) {
    console.log('[PROOF-GENERATOR] Offscreen document does not exist, creating it');
    await createOffscreenDocument();
  }
  
  // Wait for the offscreen document to be ready
  const isReady = await waitForOffscreenReady();
  if (!isReady) {
    throw new Error('Failed to initialize offscreen document for proof generation');
  }
  
  return true;
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
    // Get the extension URL for the offscreen document
    const offscreenUrl = chrome.runtime.getURL('offscreen/offscreen.html');
    console.log('[PROOF-GENERATOR] Creating offscreen document with URL:', offscreenUrl);
    
    await chrome.offscreen.createDocument({
      url: offscreenUrl,
      reasons: ['DOM_PARSER', 'IFRAME_SCRIPTING'],
      justification: 'Used for ZK proof generation'
    });
    console.log('[PROOF-GENERATOR] Offscreen document created successfully');
  } catch (error) {
    console.error('[PROOF-GENERATOR] Error creating offscreen document:', error);
    throw error;
  }
}