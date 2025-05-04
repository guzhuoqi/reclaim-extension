// Import WebSocket fix before anything else
import '../utils/fix-websocket';

// Import polyfills before attestor-core
import '../utils/polyfills';
import { createClaimOnAttestor } from '@reclaimprotocol/attestor-core';
import { MESSAGER_ACTIONS, MESSAGER_TYPES } from '../utils/interfaces.js';
// Track message sending attempts
let readyMessageSent = false;
let readyMessageRetryCount = 0;
const MAX_RETRY_ATTEMPTS = 10; // Increased from 5 to 10

// Function to send ready signal
function sendReadySignal() {
  if (readyMessageSent || readyMessageRetryCount >= MAX_RETRY_ATTEMPTS) return;
  
  console.log('[OFFSCREEN] Sending ready signal attempt #', readyMessageRetryCount + 1);
  readyMessageRetryCount++;
  
  try {
    chrome.runtime.sendMessage({
      action: MESSAGER_ACTIONS.OFFSCREEN_DOCUMENT_READY,
      source: MESSAGER_TYPES.OFFSCREEN,
      target: MESSAGER_TYPES.BACKGROUND
    }, (response) => {
      if (chrome.runtime.lastError) {
        console.error('[OFFSCREEN] Error sending ready signal:', chrome.runtime.lastError);
        // Retry after a short delay with exponential backoff
        setTimeout(sendReadySignal, 500 * Math.pow(2, readyMessageRetryCount));
      } else if (response && response.success) {
        console.log('[OFFSCREEN] Ready signal acknowledged with success response');
        readyMessageSent = true;
      } else {
        console.log('[OFFSCREEN] Response received but no success property:', response);
        // If we got a response but not a success property, consider it sent anyway
        readyMessageSent = true;
      }
    });
  } catch (error) {
    console.error('[OFFSCREEN] Failed to send ready message:', error);
    // Retry after a short delay with exponential backoff
    setTimeout(sendReadySignal, 500 * Math.pow(2, readyMessageRetryCount));
  }
}

// Send ready signal when document loads
window.addEventListener('DOMContentLoaded', () => {
  console.log('[OFFSCREEN] Document DOM loaded');
  sendReadySignal();
});

// Also send when fully loaded (backup)
window.addEventListener('load', () => {
  console.log('[OFFSCREEN] Document fully loaded');
  sendReadySignal();
});

// Immediately try to send ready signal and setup a regular retry
console.log('[OFFSCREEN] Document script executing');
setTimeout(sendReadySignal, 100);

// Set additional retry timer to keep trying for a longer period
const retryInterval = setInterval(() => {
  if (readyMessageSent) {
    clearInterval(retryInterval);
    return;
  }
  console.log('[OFFSCREEN] Retry timer triggered');
  sendReadySignal();
}, 1000); // Try every second

// Listen for messages from the proof-generator
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  console.log('[OFFSCREEN] Received message:', message);
  
  // If we receive any message, we know the background can communicate with us
  // so also try sending ready signal again if not already sent
  if (!readyMessageSent) {
    sendReadySignal();
  }
  
  // Handle ping message
  if (message.action === 'PING_OFFSCREEN' && 
      message.source === MESSAGER_TYPES.BACKGROUND && 
      message.target === MESSAGER_TYPES.OFFSCREEN) {
    console.log('[OFFSCREEN] Received ping, responding and trying to send ready signal');
    sendReadySignal();
    sendResponse({ 
      success: true, 
      source: MESSAGER_TYPES.OFFSCREEN,
      target: MESSAGER_TYPES.BACKGROUND,
      message: 'Offscreen document is running'
    });
    return true;
  }
  
  if (message.action === MESSAGER_ACTIONS.GENERATE_PROOF && 
      message.source === MESSAGER_TYPES.BACKGROUND && 
      message.target === MESSAGER_TYPES.OFFSCREEN) {
    generateProof(message.data)
      .then(proof => {
        console.log('[OFFSCREEN] Proof generated successfully, sending result back');
        sendResponse({ 
          success: true, 
          proof,
          source: MESSAGER_TYPES.OFFSCREEN,
          target: message.source
        });
      })
      .catch(error => {
        console.error('[OFFSCREEN] Error generating proof:', error);
        sendResponse({ 
          success: false, 
          error: error.message || 'Unknown error in proof generation',
          source: MESSAGER_TYPES.OFFSCREEN,
          target: message.source
        });
      });
    
    // Return true to indicate we'll respond asynchronously
    return true;
  }
});

// Function to generate proof within the offscreen document context
async function generateProof(claimData) {
  try {
    // Validate the claim data
    if (!claimData) {
      throw new Error('No claim data provided');
    }

    console.log('[OFFSCREEN] Generating proof with provided data');
    const result = await createClaimOnAttestor(claimData);
    console.log('[OFFSCREEN] Proof generation successful');
    return result;
  } catch (error) {
    console.error('[OFFSCREEN] Error generating proof:', error);
    throw error;
  }
} 