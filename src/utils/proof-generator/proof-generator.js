// Import polyfills
import '../polyfills';

import { MESSAGER_ACTIONS, MESSAGER_TYPES } from '../constants/index';
import { ensureOffscreenDocument } from '../offscreen-manager';

// Main function to generate proof using offscreen document
export const generateProof = async (claimData) => {
  try {
    console.log('[PROOF-GENERATOR] Starting proof generation with data:', claimData);
    if(!claimData) {
      throw new Error('No claim data provided for proof generation');
    }
    // Ensure the offscreen document exists and is ready
    await ensureOffscreenDocument();
    
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
        data: claimData
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