// Import polyfills
import '../utils/polyfills';

import { RECLAIM_SDK_ACTIONS, MESSAGE_ACTIONS, MESSAGE_SOURCES } from '../utils/constants'; // Corrected import path assuming index.js exports them
import { createProviderVerificationPopup } from './components/ProviderVerificationPopup';
import { filterRequest } from '../utils/claim-creator';

// Create a flag to track if we should initialize
let shouldInitialize = false;
let interceptorInjected = false;

// Function to inject the network interceptor - will be called conditionally
const injectNetworkInterceptor = function() {
  if (interceptorInjected) return;
  
  try {
    console.log('[CONTENT] Injecting network interceptor immediately');
    const script = document.createElement('script');
    script.src = chrome.runtime.getURL('interceptor/network-interceptor.bundle.js');
    script.type = 'text/javascript';

    // Set highest priority attributes
    script.async = false;
    script.defer = false;

    // Try to inject as early as possible
    let injected = false;

    // Function to actually inject the script with highest priority
    const injectNow = () => {
      if (injected) return;

      if (document.documentElement) {
        // Use insertBefore for highest priority injection
        document.documentElement.insertBefore(script, document.documentElement.firstChild);
        console.log('[CONTENT] Network interceptor injected with highest priority');
        injected = true;
        interceptorInjected = true;
      } else if (document.head) {
        document.head.insertBefore(script, document.head.firstChild);
        console.log('[CONTENT] Network interceptor injected into document head');
        injected = true;
        interceptorInjected = true;
      } else if (document) {
        document.appendChild(script);
        console.log('[CONTENT] Network interceptor injected into document');
        injected = true;
        interceptorInjected = true;
      }
    };

    // Try to inject immediately
    injectNow();

    // Also set up a MutationObserver as a fallback
    if (!injected) {
      const observer = new MutationObserver(() => {
        if (!injected && (document.documentElement || document.head)) {
          injectNow();
          if (injected) {
            observer.disconnect();
          }
        }
      });

      // Observe document for any changes at the earliest possible moment
      observer.observe(document, { childList: true, subtree: true });
    }

    return script; // Return script element to prevent garbage collection
  } catch (e) {
    console.error('[CONTENT] Error injecting interceptor immediately:', e);
    return null;
  }
};

// On load, immediately check if this tab should be initialized
(async function() {
  try {
    // Notify background script that content script is loaded
    chrome.runtime.sendMessage({
      action: MESSAGE_ACTIONS.CONTENT_SCRIPT_LOADED,
      source: MESSAGE_SOURCES.CONTENT_SCRIPT,
      target: MESSAGE_SOURCES.BACKGROUND,
      data: { url: window.location.href }
    });
    
    // Listen for the background script's response about initialization
    chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
      const { action, data } = message;
      
      if (action === MESSAGE_ACTIONS.SHOULD_INITIALIZE) {
        shouldInitialize = data.shouldInitialize;
        
        if (shouldInitialize) {
          // If we should initialize, inject the interceptor immediately
          injectNetworkInterceptor();
          
          // And initialize the content script
          window.reclaimContentScript = new ReclaimContentScript();
        }
        
        sendResponse({ success: true });
      }
      
      return true;
    });
  } catch (e) {
    console.error('[CONTENT] Error in initialization check:', e);
  }
})();

class ReclaimContentScript {
  constructor() {
    // The interceptor should be injected before this constructor runs
    this.init();
    this.verificationPopup = null;
    this.providerName = 'Emirates';
    this.credentialType = 'Skywards';
    this.dataRequired = 'Membership Status / Tier';

    // Storage for intercepted requests and responses
    this.interceptedRequests = new Map();
    this.interceptedResponses = new Map();
    this.linkedRequestResponses = new Map();

    // Filtering state
    this.providerData = null;
    this.parameters = null;
    this.sessionId = null;
    this.filteringInterval = null;
    this.filteringStartTime = null;
    this.filteredRequests = [];
    this.isFiltering = false;
    this.stopStoringInterceptions = false;
  }

  init() {
    // Listen for messages from the background script

     // Listen for messages from the web page
     window.addEventListener('message', this.handleWindowMessage.bind(this));

    if(!shouldInitialize) {
      return;
    }

    chrome.runtime.onMessage.addListener(this.handleMessage.bind(this));
    // Request provider data from background script and store the response
    chrome.runtime.sendMessage({
      action: MESSAGE_ACTIONS.REQUEST_PROVIDER_DATA,
      source: MESSAGE_SOURCES.CONTENT_SCRIPT,
      target: MESSAGE_SOURCES.BACKGROUND,
      data: { url: window.location.href }
    }, (response) => {
      if (response.success) {
        this.providerData = response.data.providerData;
        this.parameters = response.data.parameters;
        this.sessionId = response.data.sessionId;
        if(!this.isFiltering) {
          this.startNetworkFiltering();
        }
      } else {
        console.log('[CONTENT] Provider Data not available');
      }
    });
   
  }

  handleMessage(message, sender, sendResponse) {
    const { action, data, source } = message;
    console.log(`[CONTENT] Received message: Action: ${action}, Source: ${source}, Data:`, data);

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
        
        // Update popup with success message
        if (this.verificationPopup) {
          this.verificationPopup.handleProofSubmitted();
        }
        
        sendResponse({ success: true });
        break;

      case MESSAGE_ACTIONS.SHOULD_INITIALIZE:
        // ignore this message since we already handle it in the initialization check
        break;

      case MESSAGE_ACTIONS.PROVIDER_DATA_READY:
        console.log('[CONTENT] PROVIDER_DATA_READY message received. Data:', data);
        this.providerData = data.providerData;
        this.parameters = data.parameters;
        this.sessionId = data.sessionId;
        if(!this.isFiltering) {
          this.startNetworkFiltering();
        }
        sendResponse({ success: true });
        break;

      case MESSAGE_ACTIONS.SHOW_PROVIDER_VERIFICATION_POPUP:
        console.log('[CONTENT] SHOW_PROVIDER_VERIFICATION_POPUP message received. Data:', data);
        if (this.verificationPopup) {
          console.log('[CONTENT] Removing existing verification popup.');
          try {
            document.body.removeChild(this.verificationPopup.element);
          } catch (e) {
            console.warn('[CONTENT] Failed to remove old popup, it might have already been detached:', e.message);
          }
          this.verificationPopup = null;
        }

        this.providerName = data?.providerName || this.providerName;
        this.description = data?.description || this.description;
        this.dataRequired = data?.dataRequired || this.dataRequired;
       

        const appendPopupLogic = () => {
          if (!document.body) {
            console.error('[CONTENT] appendPopupLogic called but document.body is still not available!');
            return;
          }
          console.log(`[CONTENT] DOM ready. Creating provider verification popup with: Provider: ${this.providerName}, Credential: ${this.credentialType}, Data: ${this.dataRequired}`);
          try {
            this.verificationPopup = createProviderVerificationPopup(
              this.providerName,
              this.description,
              this.dataRequired
            );
            console.log('[CONTENT] Provider verification popup element created:', this.verificationPopup);
          } catch (e) {
            console.error('[CONTENT] Error calling createProviderVerificationPopup:', e);
            return;
          }

          console.log('[CONTENT] Appending popup to document.body.');
          try {
            document.body.appendChild(this.verificationPopup.element);
            console.log('[CONTENT] Popup appended. Checking visibility...');
            if (this.verificationPopup.element.offsetParent === null) {
              console.warn('[CONTENT] Popup appended but offsetParent is null. It might be display:none or not in the layout.');
            } else {
              console.log('[CONTENT] Popup appended and seems to be in layout (offsetParent is not null).');
            }
            const rect = this.verificationPopup.element.getBoundingClientRect();
            console.log('[CONTENT] Popup rect:', rect);
            if (rect.width === 0 || rect.height === 0) {
              console.warn('[CONTENT] Popup has zero width or height.');
            }
          } catch (e) {
            console.error('[CONTENT] Error appending popup to document.body:', e);
            return;
          }
        };

        if (document.readyState === 'loading') {
          console.log('[CONTENT] Document is loading. Waiting for DOMContentLoaded to append popup.');
          document.addEventListener('DOMContentLoaded', () => {
            console.log('[CONTENT] DOMContentLoaded event fired. Executing appendPopupLogic.');
            appendPopupLogic();
          }, { once: true });
        } else {
          // 'interactive' or 'complete' state
          console.log(`[CONTENT] Document already in state: ${document.readyState}. Executing appendPopupLogic directly.`);
          appendPopupLogic();
        }

        sendResponse({ success: true, message: 'Popup display process initiated and will proceed on DOM readiness.' });
        break;

      // Handle status update messages from background script
      case MESSAGE_ACTIONS.CLAIM_CREATION_REQUESTED:
        if (this.verificationPopup) {
          console.log('[CONTENT] Claim creation requested for request hash:', data.requestHash);
          this.verificationPopup.handleClaimCreationRequested(data.requestHash);
        }
        sendResponse({ success: true });
        break;

      case MESSAGE_ACTIONS.CLAIM_CREATION_SUCCESS:
        if (this.verificationPopup) {
          console.log('[CONTENT] Claim creation success for request hash:', data.requestHash);
          this.verificationPopup.handleClaimCreationSuccess(data.requestHash);
        }
        sendResponse({ success: true });
        break;

      case MESSAGE_ACTIONS.CLAIM_CREATION_FAILED:
        if (this.verificationPopup) {
          console.log('[CONTENT] Claim creation failed for request hash:', data.requestHash);
          this.verificationPopup.handleClaimCreationFailed(data.requestHash);
        }
        sendResponse({ success: true });
        break;

      case MESSAGE_ACTIONS.PROOF_GENERATION_STARTED:
        if (this.verificationPopup) {
          console.log('[CONTENT] Proof generation started for request hash:', data.requestHash);
          this.verificationPopup.handleProofGenerationStarted(data.requestHash);
        }
        sendResponse({ success: true });
        break;

      case MESSAGE_ACTIONS.PROOF_GENERATION_SUCCESS:
        if (this.verificationPopup) {
          console.log('[CONTENT] Proof generation success for request hash:', data.requestHash);
          this.verificationPopup.handleProofGenerationSuccess(data.requestHash);
        }
        sendResponse({ success: true });
        break;

      case MESSAGE_ACTIONS.PROOF_GENERATION_FAILED:
        if (this.verificationPopup) {
          console.log('[CONTENT] Proof generation failed for request hash:', data.requestHash);
          this.verificationPopup.handleProofGenerationFailed(data.requestHash);
        }
        sendResponse({ success: true });
        break;

      case MESSAGE_ACTIONS.PROOF_SUBMITTED:
        if (this.verificationPopup) {
          console.log('[CONTENT] Proof submitted');
          this.verificationPopup.handleProofSubmitted();
        }
        sendResponse({ success: true });
        break;

      case MESSAGE_ACTIONS.PROOF_SUBMISSION_FAILED:
        if (this.verificationPopup) {
          console.log('[CONTENT] Proof submission failed:', data.error);
          this.verificationPopup.handleProofSubmissionFailed(data.error);
        }
        sendResponse({ success: true });
        break;

      default:
        console.log(`[CONTENT] Unknown action received: ${action}`);
        sendResponse({ success: false, error: 'Unknown action' });
    }

    return true;
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

    // Handle intercepted network request
    if (action === MESSAGE_ACTIONS.INTERCEPTED_REQUEST && data) {
      // Store the intercepted request
      this.storeInterceptedRequest(data);
      if(this.isFiltering) {
        this.startNetworkFiltering();
      }
    }

    // Handle intercepted network responses
    if (action === MESSAGE_ACTIONS.INTERCEPTED_RESPONSE && data) {
      // Store the intercepted response
      this.storeInterceptedResponse(data);

      // Try to link with the corresponding request
      this.linkRequestAndResponse(data.url, data);
      if(this.isFiltering) {
        this.startNetworkFiltering();
      }
    }

    // Handle start verification request from SDK
    if (action === RECLAIM_SDK_ACTIONS.START_VERIFICATION && data) {
      // Forward the template data to background script
      chrome.runtime.sendMessage({
        action: MESSAGE_ACTIONS.START_VERIFICATION,
        source: MESSAGE_SOURCES.CONTENT_SCRIPT,
        target: MESSAGE_SOURCES.BACKGROUND,
        data: data
      }, (response) => {
        console.log('[CONTENT] Starting verification with data:', data);
        // Store parameters and session ID for later use
        if (data.parameters) {
          this.parameters = data.parameters;
        }
        if (data.sessionId) {
          this.sessionId = data.sessionId;
        }

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

  // Store intercepted request
  storeInterceptedRequest(requestData) {
    // Return immediately if we've found all filtered requests
    if (this.stopStoringInterceptions) {
      return;
    }

    // Generate a unique key for the request
    const key = `${requestData.method}_${requestData.url}_${Date.now()}`;
    requestData.timestamp = Date.now();

    // Store the request
    this.interceptedRequests.set(key, requestData);
    console.log(`[CONTENT] Stored intercepted request: ${requestData.method} ${requestData.url}`);

    // Clean up old requests only if we're still collecting
    if (!this.stopStoringInterceptions) {
      this.cleanupInterceptedData();
    }
  }

  // Store intercepted response
  storeInterceptedResponse(responseData) {
    // Return immediately if we've found all filtered requests
    if (this.stopStoringInterceptions) {
      return;
    }

    responseData.timestamp = Date.now();

    // Store the response using URL as key
    this.interceptedResponses.set(responseData.url, responseData);
    console.log(`[CONTENT] Stored intercepted response for URL: ${responseData.url}`);

    // Clean up old responses only if we're still collecting
    if (!this.stopStoringInterceptions) {
      this.cleanupInterceptedData();
    }
  }

  // Link request and response
  linkRequestAndResponse(url, responseData) {
    // Return immediately if we've found all filtered requests
    if (this.stopStoringInterceptions) {
      return;
    }

    // Find matching request for this response
    for (const [key, requestData] of this.interceptedRequests.entries()) {
      if (requestData.url === url) {
        // Create a linked object with both request and response
        const linkedData = {
          request: requestData,
          response: responseData,
          timestamp: Date.now()
        };

        // Store the linked data
        this.linkedRequestResponses.set(key, linkedData);
        console.log(`[CONTENT] Linked request and response for URL: ${url}`);
        break;
      }
    }
  }

  // Clean up old intercepted data
  cleanupInterceptedData() {
    const now = Date.now();
    const timeout = 2 * 60 * 1000; // 2 minutes

    // Clean up requests
    for (const [key, data] of this.interceptedRequests.entries()) {
      if (now - data.timestamp > timeout) {
        this.interceptedRequests.delete(key);
      }
    }

    // Clean up responses
    for (const [key, data] of this.interceptedResponses.entries()) {
      if (now - data.timestamp > timeout) {
        this.interceptedResponses.delete(key);
      }
    }

    // Clean up linked data
    for (const [key, data] of this.linkedRequestResponses.entries()) {
      if (now - data.timestamp > timeout) {
        this.linkedRequestResponses.delete(key);
      }
    }
  }

  // Start filtering intercepted network requests
  startNetworkFiltering() {
    if (!this.providerData) {
      return;
    }

    this.isFiltering = true;
    this.filteringStartTime = Date.now();
    this.stopStoringInterceptions = false;

    // Run filtering immediately
    this.filterInterceptedRequests();

    // Clear any existing interval before setting up a new one
    if (this.filteringInterval) {
      clearInterval(this.filteringInterval);
    }
    
    // Then set up interval for continuous filtering
    this.filteringInterval = setInterval(() => {
      // Skip if we've already found all requests
      if (this.stopStoringInterceptions) {
        this.stopNetworkFiltering();
        return;
      }
      
      this.filterInterceptedRequests();

      // Check for timeout (10 minutes)
      if (Date.now() - this.filteringStartTime > 10 * 60 * 1000) {
        console.log('[CONTENT] Filtering timeout after 10 minutes');
        this.stopNetworkFiltering();
      }
    }, 1000);
  }

  // Stop network filtering
  stopNetworkFiltering() {
    console.log('[CONTENT] Stopping network filtering and cleaning up resources');
    
    // Clear the filtering interval
    if (this.filteringInterval) {
      clearInterval(this.filteringInterval);
      this.filteringInterval = null;
    }
    
    // Stop filtering flag
    this.isFiltering = false;
    
    // If we're stopping due to finding all requests, make sure we've properly 
    // set the flag to stop storing intercepted data
    if (this.filteredRequests.length >= (this.providerData?.requestData?.length || 0)) {
      this.stopStoringInterceptions = true;
      
      // Clear stored data to free memory
      this.interceptedRequests.clear();
      this.interceptedResponses.clear();
      this.linkedRequestResponses.clear();
    }
  }

  // Filter intercepted requests with provider criteria
  filterInterceptedRequests() {
    if (!this.providerData || !this.providerData.requestData) {
      return;
    }

    console.log('[CONTENT] Filtering intercepted requests...');

    // For each linked request/response pair
    for (const [key, linkedData] of this.linkedRequestResponses.entries()) {
      // Skip already filtered requests
      if (this.filteredRequests.includes(key)) {
        continue;
      }

      const request = linkedData.request;
      const response = linkedData.response;

      // Format request for filtering
      const formattedRequest = {
        url: request.url,
        method: request.method,
        body: request.body || null,
        headers: request.headers || {},
        responseText: response.body
      };

      console.log('[CONTENT] Formatted request:', formattedRequest);

      // Check against each criteria in provider data
      for (const criteria of this.providerData.requestData) {
        if (filterRequest(formattedRequest, criteria, this.parameters)) {
          console.log('[CONTENT] ==========================================');
          console.log('[CONTENT] MATCHING REQUEST FOUND');
          console.log('[CONTENT] URL:', formattedRequest.url);
          console.log('[CONTENT] Method:', formattedRequest.method);
          console.log('[CONTENT] Body:',
            formattedRequest.body ?
              `Present for the matching request (length: ${formattedRequest.body.length}, type: ${typeof formattedRequest.body})` :
              'No body for the matching request!');
          console.log('[CONTENT] Response body length:', formattedRequest.responseText?.length);
          console.log('[CONTENT] ==========================================');

          // Mark this request as filtered
          this.filteredRequests.push(key);

          // Send to background script for cookie fetching and claim creation
          this.sendFilteredRequestToBackground(formattedRequest, criteria);
        }
      }
    }

    // If we've found all possible matching requests, stop filtering
    if (this.filteredRequests.length >= this.providerData.requestData.length) {
      console.log('[CONTENT] Found all matching requests, stopping filtering and cleaning up resources');
      
      // Stop filtering and prevent further storage
      this.stopStoringInterceptions = true;
      this.isFiltering = false;
      
      // Clear filtering interval
      if (this.filteringInterval) {
        clearInterval(this.filteringInterval);
        this.filteringInterval = null;
      }
      
      // Clear any other intervals or timeouts related to request handling
      if (this.cleanupInterval) {
        clearInterval(this.cleanupInterval);
        this.cleanupInterval = null;
      }

      // Clear all stored requests and responses
      this.interceptedRequests.clear();
      this.interceptedResponses.clear();
      this.linkedRequestResponses.clear();
      console.log('[CONTENT] Cleared all stored intercepted requests and responses');
    }
  }

  // Send filtered request to background script
  sendFilteredRequestToBackground(formattedRequest, matchingCriteria) {
    chrome.runtime.sendMessage({
      action: MESSAGE_ACTIONS.FILTERED_REQUEST_FOUND,
      source: MESSAGE_SOURCES.CONTENT_SCRIPT,
      target: MESSAGE_SOURCES.BACKGROUND,
      data: {
        request: formattedRequest,
        criteria: matchingCriteria,
        sessionId: this.sessionId
      }
    }, (response) => {
      console.log('[CONTENT] Background response to filtered request:', response);
    });
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