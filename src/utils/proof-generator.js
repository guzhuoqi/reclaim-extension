// Import polyfills
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

// Simple mock implementation of proof generation
export const generateProof = async (claimData) => {
  try {
    console.log('[PROOF-GENERATOR] Starting proof generation with data:', claimData)
    
    // Find active tab to use for proof generation
    const [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!activeTab) {
      throw new Error('No active tab found for proof generation');
    }
    
    console.log('[PROOF-GENERATOR] Using active tab for proof generation:', activeTab.id);
    
    // Use the content script to generate the proof
    return new Promise((resolve, reject) => {
      console.log('[PROOF-GENERATOR] Sending proof generation request to content script');
      
      // Ensure the data is properly stringified and re-parsed to avoid encoding issues
      let cleanData;
      if (claimData) {
        try {
          // Clean the data by stringifying and parsing it
          cleanData = JSON.parse(JSON.stringify(claimData));
        } catch (e) {
          console.warn('[PROOF-GENERATOR] Error cleaning data:', e);
          // Fall back to the original data
          cleanData = claimData;
        }
      } else {
        // Default test data
        
      }
      
      const message = {
        action: MESSAGER_ACTIONS.GENERATE_PROOF,
        source: MESSAGER_TYPES.BACKGROUND,
        target: MESSAGER_TYPES.CONTENT_SCRIPT,
        data: cleanData
      };
      
      // Set timeout for response
      const messageTimeout = setTimeout(() => {
        console.error('[PROOF-GENERATOR] Timeout waiting for proof generation response');
        reject(new Error('Timeout generating proof'));
      }, 30000); // 30 second timeout for proof generation
      
      // Send message to content script
      chrome.tabs.sendMessage(activeTab.id, message, (response) => {
        clearTimeout(messageTimeout);
        
        if (chrome.runtime.lastError) {
          console.error('[PROOF-GENERATOR] Error sending message to content script:', chrome.runtime.lastError);
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
          reject(new Error('No response from content script'));
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