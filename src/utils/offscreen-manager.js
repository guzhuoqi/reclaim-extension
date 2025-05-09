// src/utils/offscreen-manager.js
import { MESSAGER_ACTIONS, MESSAGER_TYPES } from './constants';

// Track the offscreen document status
let offscreenReady = false;
let offscreenDocTimeout = null; // Used by waitForOffscreenReady's timeout
let offscreenCreationPromise = null;

// Global listener for the ready signal from offscreen document.
// This needs to be set up immediately to catch the ready signal if the offscreen document
// initializes and sends it before any call to ensureOffscreenDocument.
const setupOffscreenReadyListener = () => {
  if (chrome.runtime.onMessage.hasListener(offscreenGlobalListener)) {
    // console.log('[OFFSCREEN-MANAGER] Global listener already attached.');
    return;
  }
  chrome.runtime.onMessage.addListener(offscreenGlobalListener);
};

const offscreenGlobalListener = (message) => {
    if (message.action === MESSAGER_ACTIONS.OFFSCREEN_DOCUMENT_READY &&
        message.source === MESSAGER_TYPES.OFFSCREEN &&
        message.target === MESSAGER_TYPES.BACKGROUND) { // Assumes this manager runs in background context
      console.log('[OFFSCREEN-MANAGER] Received offscreen ready signal (global listener).');
      offscreenReady = true;
      if (offscreenDocTimeout) { // If waitForOffscreenReady set a timeout
        clearTimeout(offscreenDocTimeout);
        offscreenDocTimeout = null;
      }
      // If there was a creation promise, it should resolve/reject independently.
      // Readiness is a separate state.
    }
    // Return true to keep listener active for other messages if this is a shared listener environment.
    // However, this specific listener is only for OFFSCREEN_DOCUMENT_READY.
};

// Set up listener immediately when the module loads
setupOffscreenReadyListener();

async function createOffscreenDocumentInternal() {
  const offscreenUrl = chrome.runtime.getURL('offscreen/offscreen.html');
  console.log('[OFFSCREEN-MANAGER] Attempting to create offscreen document with URL:', offscreenUrl);
  try {
    await chrome.offscreen.createDocument({
      url: offscreenUrl,
      reasons: ['DOM_PARSER', 'IFRAME_SCRIPTING', 'BLOBS'], // Added BLOBS for crypto if needed
      justification: 'Manages DOM-dependent operations like crypto and ZK proof generation for the extension.'
    });
    console.log('[OFFSCREEN-MANAGER] Offscreen document creation initiated.');
    // The 'OFFSCREEN_DOCUMENT_READY' message will set offscreenReady to true.
  } catch (error) {
    if (error.message && error.message.includes('Only a single offscreen document may be created.')) {
      console.warn('[OFFSCREEN-MANAGER] Offscreen document already exists or creation was attempted by another part.');
      // It exists, so we just need to wait for it to be ready if it's not already.
      // The ensureOffscreenDocument logic will handle waiting for readiness.
    } else {
      console.error('[OFFSCREEN-MANAGER] Error creating offscreen document:', error);
      throw error; // Re-throw other errors
    }
  }
}

async function waitForOffscreenReadyInternal(timeoutMs = 15000) {
  if (offscreenReady) {
    // console.log('[OFFSCREEN-MANAGER] Already ready (waitForOffscreenReadyInternal check)');
    return true;
  }

  console.log(`[OFFSCREEN-MANAGER] Waiting for offscreen document to be ready (timeout: ${timeoutMs}ms)...`);

  // Proactively ping the offscreen document.
  // This can help if the offscreen document is already running but this manager missed the initial ready signal.
  try {
    chrome.runtime.sendMessage({
      action: 'PING_OFFSCREEN',
      source: MESSAGER_TYPES.BACKGROUND,
      target: MESSAGER_TYPES.OFFSCREEN
    }, (response) => {
      if (chrome.runtime.lastError) {
        // console.warn(`[OFFSCREEN-MANAGER] Ping to offscreen failed or no listener: ${chrome.runtime.lastError.message}`);
      } else if (response && response.success) {
        // console.log('[OFFSCREEN-MANAGER] Ping to offscreen successful.');
        // If ping is successful, the offscreen doc should soon send its ready signal if it hasn't.
      }
    });
  } catch (e) {
    // console.warn('[OFFSCREEN-MANAGER] Synchronous error sending ping:', e);
  }

  return new Promise((resolve) => {
    if (offscreenReady) { // Double check after setup
        // console.log('[OFFSCREEN-MANAGER] Became ready while setting up promise.');
        resolve(true);
        return;
    }

    const listener = (message) => {
      if (message.action === MESSAGER_ACTIONS.OFFSCREEN_DOCUMENT_READY &&
          message.source === MESSAGER_TYPES.OFFSCREEN &&
          message.target === MESSAGER_TYPES.BACKGROUND) {
        // console.log('[OFFSCREEN-MANAGER] Offscreen ready signal received by waitForOffscreenReadyInternal listener.');
        offscreenReady = true;
        clearTimeout(localTimeoutId);
        chrome.runtime.onMessage.removeListener(listener);
        if (offscreenDocTimeout === localTimeoutId) { // Clear global timeout if it's this one
            offscreenDocTimeout = null;
        }
        resolve(true);
      }
    };

    chrome.runtime.onMessage.addListener(listener);

    // Clear any previous timeout and set a new one for this wait
    if (offscreenDocTimeout) {
        clearTimeout(offscreenDocTimeout);
    }
    const localTimeoutId = setTimeout(() => {
      chrome.runtime.onMessage.removeListener(listener);
      console.error(`[OFFSCREEN-MANAGER] Timed out waiting for offscreen document after ${timeoutMs}ms.`);
      if (offscreenDocTimeout === localTimeoutId) {
        offscreenDocTimeout = null;
      }
      resolve(false);
    }, timeoutMs);
    offscreenDocTimeout = localTimeoutId;
  });
}

export async function ensureOffscreenDocument() {
  if (offscreenReady) {
    // console.log('[OFFSCREEN-MANAGER] Document already confirmed ready.');
    return true;
  }

  // If a creation process is already underway, await its completion.
  if (offscreenCreationPromise) {
    console.log('[OFFSCREEN-MANAGER] Creation already in progress, awaiting...');
    await offscreenCreationPromise;
    // After creation promise resolves, it might still not be "ready" (message might be pending)
    // Fall through to waitForOffscreenReadyInternal
  }

  // Check if an offscreen document context already exists.
  // This is useful if the service worker restarted but the offscreen document persisted.
  if (chrome.runtime.getContexts) {
    const contexts = await chrome.runtime.getContexts({ contextTypes: ['OFFSCREEN_DOCUMENT'] });
    if (contexts.length > 0) {
      console.log('[OFFSCREEN-MANAGER] Offscreen document context found.');
      if (offscreenReady) return true; // Already marked ready by global listener
      // If context exists but not marked ready, wait for the signal
      console.log('[OFFSCREEN-MANAGER] Context exists, but not marked ready. Waiting for signal...');
      return await waitForOffscreenReadyInternal(5000); // Shorter timeout if context found
    }
  }

  // If no context found and not ready, and no creation in progress, attempt to create.
  if (!offscreenCreationPromise) {
    console.log('[OFFSCREEN-MANAGER] No existing context/promise, initiating creation.');
    offscreenCreationPromise = createOffscreenDocumentInternal().finally(() => {
      offscreenCreationPromise = null; // Clear promise once operation (success or fail) is done
    });
    await offscreenCreationPromise;
  }

  // After ensuring creation was attempted (or awaited), wait for it to become ready.
  const isReady = await waitForOffscreenReadyInternal();
  if (!isReady) {
    throw new Error('[OFFSCREEN-MANAGER] Failed to initialize or confirm offscreen document readiness.');
  }
  console.log('[OFFSCREEN-MANAGER] Offscreen document ensured to be ready.');
  return true;
} 