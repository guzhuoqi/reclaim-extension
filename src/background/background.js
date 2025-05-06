// Import polyfills
import '../utils/polyfills';

// Import necessary utilities and libraries
import { filterRequest } from '../utils/network-filter.js';
import { fetchProviderData, updateSessionStatus } from '../utils/start-verification.js';
import { RECLAIM_SESSION_STATUS, MESSAGER_ACTIONS, MESSAGER_TYPES } from '../utils/interfaces.js';
import { generateProof } from '../utils/proof-generator.js';
import { testPolyfills } from '../utils/polyfill-test.js';
import { createClaimObject } from '../utils/claim-creator.js';

class ReclaimExtensionManager {
    constructor() {
        this.activeTabId = null;
        this.isNetworkListenerActive = false;
        this.disableNetworkMonitoring();
        this.providerData = null;
        this.parameters = null;
        
        // Create maps to store request data
        this.requestHeadersMap = new Map();
        this.requestBodyMap = new Map();
        this.pendingRequests = new Map();
        
        // Initialize extension
        this.init();
    }

    async init() {
        // Test polyfills
        const polyfillTestResults = testPolyfills();
        console.log('Polyfill test results:', polyfillTestResults);

        // Register message handler
        chrome.runtime.onMessage.addListener(this.handleMessage.bind(this));
        
        console.log('Reclaim Extension initialized');
    }

    async handleMessage(message, sender, sendResponse) {

        const { action, source, target, data } = message;
        console.log('[BACKGROUND] Received message from', source, 'to', target, 'with action', action);

        try {
            switch (action) {
                // Handle content script loaded message
                case MESSAGER_ACTIONS.CONTENT_SCRIPT_LOADED:
                    if (source === MESSAGER_TYPES.CONTENT_SCRIPT && target === MESSAGER_TYPES.BACKGROUND) {
                        console.log('[BACKGROUND] Content script loaded', data.url);
                        sendResponse({ success: true });
                        break;
                    } else {
                        console.log(`[BACKGROUND] Message received: ${action} but invalid source or target`);
                        sendResponse({ success: false, error: 'Action not supported' });
                    }
                    break;

                // Handle start verification message
                case MESSAGER_ACTIONS.START_VERIFICATION:
                    if (source === MESSAGER_TYPES.CONTENT_SCRIPT && target === MESSAGER_TYPES.BACKGROUND) {
                        console.log('[BACKGROUND] Starting verification with data:', data);
                        const result = await this.startVerification(data);
                        sendResponse({ success: true, result });
                        break;
                    } else {
                        console.log(`[BACKGROUND] Message received: ${action} but invalid source or target`);
                        sendResponse({ success: false, error: 'Action not supported' });
                    }
                    break;
                    
                // Handle offscreen document ready message
                case MESSAGER_ACTIONS.OFFSCREEN_DOCUMENT_READY:
                    if (source === MESSAGER_TYPES.OFFSCREEN && target === MESSAGER_TYPES.BACKGROUND) {
                        console.log('[BACKGROUND] Offscreen document is ready');
                        sendResponse({ success: true });
                    } else {
                        console.log(`[BACKGROUND] Message received: ${action} but invalid source or target`);
                        sendResponse({ success: false, error: 'Action not supported' });
                    }
                    break;

                // Handle generate proof response from offscreen document
                case MESSAGER_ACTIONS.GENERATE_PROOF_RESPONSE:
                    if (source === MESSAGER_TYPES.OFFSCREEN && target === MESSAGER_TYPES.BACKGROUND) {
                        console.log('[BACKGROUND] Received proof generation response from offscreen document');
                        // This message is handled by the proof-generator.js using the messageListener
                        // Just acknowledge receipt here
                        sendResponse({ success: true });
                    } else {
                        console.log(`[BACKGROUND] Message received: ${action} but invalid source or target`);
                        sendResponse({ success: false, error: 'Action not supported' });
                    }
                    break;

                default:
                    console.log('[BACKGROUND] Message received but not processed:', action);
                    sendResponse({ success: false, error: 'Action not supported' });
            }
        } catch (error) {
            console.error(`[BACKGROUND] Error handling ${action}:`, error);
            sendResponse({ success: false, error: error.message });
        }

        // Required for async response
        return true;
    }

    async startVerification(templateData) {
        try {
            // steps to start verification
            // 1. Fetch provider data from the backend
            // 2. Redirect to the provider login page
            // 3. Start network monitoring
            // 4. Filter the network requests
            // 5. Extract the data from the network requests
            // 6. Generate the proof
            // 7. Submit the proof to the backend
            // 8. Notify the SDK

            // fetch provider data
            const providerData = await fetchProviderData(templateData.providerId);
            this.providerData = providerData;
            if (templateData.parameters) {
                this.parameters = templateData.parameters;
            }

            console.log('[BACKGROUND] Provider data:', providerData);

            if (!providerData) {
                throw new Error('Provider data not found');
            }

            // Create a new tab with provider URL DIRECTLY - not through an async flow
            const providerUrl = providerData.loginUrl;
            console.log('[BACKGROUND] Creating new tab with URL:', providerUrl);
            
            // Use chrome.tabs.create directly and handle the promise explicitly
            chrome.tabs.create({ url: providerUrl }, (tab) => {
                console.log('[BACKGROUND] New tab created with ID:', tab.id);
                this.activeTabId = tab.id;
                
                // Update session status after tab creation
                updateSessionStatus(templateData.sessionId, RECLAIM_SESSION_STATUS.USER_STARTED_VERIFICATION)
                    .then(() => {
                        console.log('[BACKGROUND] Session status updated');
                        
                        // Start network monitoring after tab creation
                        console.log('[BACKGROUND] Starting network monitoring');
                        this.enableNetworkMonitoring();
                    })
                    .catch(error => {
                        console.error('[BACKGROUND] Error updating session status:', error);
                    });
            });
            
            return { 
                success: true, 
                message: 'Verification started, redirecting to provider login page'
            };
        } catch (error) {
            console.error('[BACKGROUND] Error starting verification:', error);
            throw error;
        }
    }

    enableNetworkMonitoring() {
        if (this.isNetworkListenerActive) return;

        try {
            // Store bound methods to allow proper removal later
            this.boundHandleNetworkRequest = this.handleNetworkRequest.bind(this);
            this.boundHandleRequestHeaders = this.handleRequestHeaders.bind(this);
            this.boundHandleBeforeSendHeaders = this.handleBeforeSendHeaders.bind(this);
            
            // Listen for request bodies
            chrome.webRequest.onBeforeRequest.addListener(
                this.boundHandleNetworkRequest,
                { urls: ["<all_urls>"] },
                ["requestBody"]
            );
    
            // Listen for request headers before they're sent
            chrome.webRequest.onBeforeSendHeaders.addListener(
                this.boundHandleBeforeSendHeaders,
                { urls: ["<all_urls>"] },
                ["requestHeaders"]
            );
            
            // Listen for request headers after they're sent (includes additional headers)
            chrome.webRequest.onSendHeaders.addListener(
                this.boundHandleRequestHeaders,
                { urls: ["<all_urls>"] },
                ["requestHeaders"]
            );
    
            this.isNetworkListenerActive = true;
            console.log('[BACKGROUND] Network monitoring enabled');
        } catch (error) {
            console.error('[BACKGROUND] Error enabling network monitoring:', error);
        }
    }

    disableNetworkMonitoring() {
        if (!this.isNetworkListenerActive) return;

        try {
            chrome.webRequest.onBeforeRequest.removeListener(this.boundHandleNetworkRequest);
            chrome.webRequest.onBeforeSendHeaders.removeListener(this.boundHandleBeforeSendHeaders);
            chrome.webRequest.onSendHeaders.removeListener(this.boundHandleRequestHeaders);
            this.isNetworkListenerActive = false;
            console.log('Network monitoring disabled');
            
            // Clear request maps
            this.requestHeadersMap.clear();
            this.requestBodyMap.clear();
            this.pendingRequests.clear();
        } catch (error) {
            console.error('[BACKGROUND] Error disabling network monitoring:', error);
        }
    }
    
    // Generate a unique request ID to correlate different parts of the same request
    generateRequestId(details) {
        // Include requestId, url and timestamp to ensure uniqueness
        return `${details.requestId}_${details.url}_${Date.now()}`;
    }
    
    // Extract cookie string from request headers
    extractCookieStr(requestHeaders) {
        if (!requestHeaders) return null;
        
        // Try to find the Cookie header
        const cookieHeader = requestHeaders.find(header => 
            header.name.toLowerCase() === 'cookie'
        );
        
        if (cookieHeader) {
            return cookieHeader.value;
        }
        
        // If no cookie header found in request headers, try to get from chrome.cookies API
        // Note: This requires the "cookies" permission in manifest.json
        return null;
    }
    
    // Additional method to get cookies for a URL using chrome.cookies API
    async getCookiesForUrl(url) {
        try {
            if (!chrome.cookies || !chrome.cookies.getAll) {
                return null;
            }
            
            const urlObj = new URL(url);
            const domain = urlObj.hostname;
            
            const cookies = await chrome.cookies.getAll({ domain });
            if (cookies && cookies.length > 0) {
                const cookieStr = cookies.map(c => `${c.name}=${c.value}`).join('; ');
                return cookieStr;
            }
            
            return null;
        } catch (error) {
            console.error('[BACKGROUND] Error getting cookies for URL:', error);
            return null;
        }
    }
    
    // Handle before send headers event to capture headers early
    handleBeforeSendHeaders(details) {
        try {
            
            const requestId = details.requestId;
            
            // Convert headers array to object for easier use
            const headersObject = {};
            if (details.requestHeaders) {
                details.requestHeaders.forEach(header => {
                    headersObject[header.name] = header.value;
                });
            }
            
            // Extract cookie string
            const cookieStr = this.extractCookieStr(details.requestHeaders);
            
            // Store headers with the request ID
            this.requestHeadersMap.set(requestId, {
                timestamp: Date.now(),
                url: details.url,
                headers: headersObject,
                cookieStr: cookieStr
            });
            
            // Clean up old entries from requestHeadersMap
            this.cleanupRequestMaps();
            
            // Check if we already have the body for this request
            if (this.requestBodyMap.has(requestId)) {
                this.processCompleteRequest(requestId);
            }
        } catch (error) {
            console.error('[BACKGROUND] Error in handleBeforeSendHeaders:', error);
        }
    }
    
    // Handle send headers event - this happens after the request is sent
    handleRequestHeaders(details) {
        try {
            
            const requestId = details.requestId;
            
            // Update the headers if we already have them from before send
            if (this.requestHeadersMap.has(requestId)) {
                const existingData = this.requestHeadersMap.get(requestId);
                
                // Convert the headers array to an object
                const headersObject = {};
                if (details.requestHeaders) {
                    details.requestHeaders.forEach(header => {
                        headersObject[header.name] = header.value;
                    });
                }
                
                // Extract cookie string
                const cookieStr = this.extractCookieStr(details.requestHeaders) || existingData.cookieStr;
                
                // Update with potentially more complete headers
                existingData.headers = headersObject;
                existingData.cookieStr = cookieStr;
                this.requestHeadersMap.set(requestId, existingData);
                
                // Check if we have the body for this request
                if (this.requestBodyMap.has(requestId)) {
                    this.processCompleteRequest(requestId);
                }
            } else {
                // If we don't have headers yet, add them
                const headersObject = {};
                if (details.requestHeaders) {
                    details.requestHeaders.forEach(header => {
                        headersObject[header.name] = header.value;
                    });
                }
                
                // Extract cookie string
                const cookieStr = this.extractCookieStr(details.requestHeaders);
                
                this.requestHeadersMap.set(requestId, {
                    timestamp: Date.now(),
                    url: details.url,
                    headers: headersObject,
                    cookieStr: cookieStr
                });
                
                // Check if we have the body for this request
                if (this.requestBodyMap.has(requestId)) {
                    this.processCompleteRequest(requestId);
                }
            }
        } catch (error) {
            console.error('[BACKGROUND] Error handling request headers:', error);
        }
    }
    
    // Handle request body
    async handleNetworkRequest(details) {
        try {
            
            const requestId = details.requestId;
            let body = null;
            
            // Extract and format request body if available
            if (details.requestBody) {
                if (details.requestBody.raw) {
                    // Raw binary data
                    const encoder = new TextDecoder('utf-8');
                    try {
                        const rawData = details.requestBody.raw[0].bytes;
                        body = encoder.decode(rawData);
                    } catch (e) {
                        console.warn('Could not decode request body', e);
                    }
                } else if (details.requestBody.formData) {
                    // Form data
                    body = JSON.stringify(details.requestBody.formData);
                }
            }
            
            // Store the body information
            this.requestBodyMap.set(requestId, {
                timestamp: Date.now(),
                url: details.url,
                method: details.method || 'GET',
                body
            });
            
            // Clean up old entries
            this.cleanupRequestMaps();
            
            // Check if we already have headers for this request
            if (this.requestHeadersMap.has(requestId)) {
                await this.processCompleteRequest(requestId);
            }
        } catch (error) {
            console.error('[BACKGROUND] Error handling network request:', error);
        }
    }
    
    // Process the complete request when we have both headers and body
    async processCompleteRequest(requestId) {
        try {
            const headerInfo = this.requestHeadersMap.get(requestId);
            const bodyInfo = this.requestBodyMap.get(requestId);
            
            if (!headerInfo || !bodyInfo) {
                return; // Still missing part of the request
            }
            
            // Try to get cookies using chrome.cookies API if they weren't found in headers
            let cookieStr = headerInfo.cookieStr;
            if (!cookieStr) {
                cookieStr = await this.getCookiesForUrl(bodyInfo.url);
            }
            
            // Create complete request object
            const formattedRequest = {
                url: bodyInfo.url,
                method: bodyInfo.method,
                body: bodyInfo.body,
                headers: headerInfo.headers || {},
                cookieStr: cookieStr
            };
            
            // Check if this request matches our criteria
            const matchingCriteria = this.providerData.requestData.find(criteria => 
                filterRequest(formattedRequest, criteria, this.parameters)
            );
            
            if (matchingCriteria) {
                // ONLY log detailed information for matching requests
                console.log('[BACKGROUND] ==========================================');
                console.log('[BACKGROUND] MATCHING REQUEST FOUND');
                console.log('[BACKGROUND] URL:', formattedRequest.url);
                console.log('[BACKGROUND] Method:', formattedRequest.method);
                
                if (formattedRequest.cookieStr) {
                    console.log('[BACKGROUND] Cookie string present for the matching request with length:', formattedRequest.cookieStr.length);
                } else {
                    console.log('[BACKGROUND] No cookie string found for the matching request!');
                }
                
                // Only log body type and length for privacy
                console.log('[BACKGROUND] Body:', 
                    formattedRequest.body ? 
                    `Present for the matching request (length: ${formattedRequest.body.length}, type: ${typeof formattedRequest.body})` : 
                    'No body for the matching request!');
                console.log('[BACKGROUND] ==========================================');
                
                // Generate and submit proof when we find a matching request
                try {
                    // Create claim object from the request and providerData
                    const claimData = createClaimObject(formattedRequest, matchingCriteria);
                    
                    // Clean up the map entries for this request
                    this.requestHeadersMap.delete(requestId);
                    this.requestBodyMap.delete(requestId);
                    
                    // Process the proof
                    await this.generateAndSubmitProof(claimData);
                } catch (error) {
                    console.error('[BACKGROUND] Error processing matching request:', error);
                }
            }
            
        } catch (error) {
            console.error('[BACKGROUND] Error processing complete request:', error);
        }
    }
    
    // Clean up old entries from request maps (older than 30 seconds)
    cleanupRequestMaps() {
        const now = Date.now();
        const timeout = 30000; // 30 seconds
        
        // Clean up requestHeadersMap
        for (const [key, value] of this.requestHeadersMap.entries()) {
            if (now - value.timestamp > timeout) {
                this.requestHeadersMap.delete(key);
            }
        }
        
        // Clean up requestBodyMap
        for (const [key, value] of this.requestBodyMap.entries()) {
            if (now - value.timestamp > timeout) {
                this.requestBodyMap.delete(key);
            }
        }
    }

    async generateAndSubmitProof(claimData) {
        try {
            // Use the proof-generator utility which leverages offscreen document
            console.log('[BACKGROUND] Generating proof for claim data:', claimData);
                        
            // Generate proof using offscreen document
            const proof = await generateProof(claimData);
            
            console.log('[BACKGROUND] Proof generated successfully:', proof);
            
            // Disable network monitoring as we've found what we need
            this.disableNetworkMonitoring();
            
            // Submit the proof
            await this.submitProof(proof);
            
            return proof;
        } catch (error) {
            console.error('[BACKGROUND] Error generating or submitting proof:', error);
            throw error;
        }
    }

    async submitProof(proof) {
        try {
            console.log('[BACKGROUND] Submitting proof:', proof);
            
            // We need the current session data
            if (!this.providerData) {
                throw new Error('Provider data not available');
            }
            
            // TODO: Replace with actual backend endpoint when available
            // const response = await fetch(`https://api.reclaimprotocol.org/session/${sessionId}/proof`, {
            //     method: 'POST',
            //     headers: {
            //         'Content-Type': 'application/json'
            //     },
            //     body: JSON.stringify({ proof })
            // });
            
            // For development, log that we would submit the proof
            console.log('[BACKGROUND] Proof would be submitted to backend');
            
            // Notify content script
            if (this.activeTabId) {
                try {
                    await chrome.tabs.sendMessage(this.activeTabId, {
                        action: 'PROOF_SUBMITTED',
                        data: { proof }
                    });
                    console.log('[BACKGROUND] Content script notified of proof submission');
                } catch (error) {
                    console.error('[BACKGROUND] Error notifying content script:', error);
                }
            }
            
            return { success: true };
        } catch (error) {
            console.error('[BACKGROUND] Error submitting proof:', error);
            throw error;
        }
    }

    async injectCustomScript(tabId, scriptContent) {
        try {
            // Send a message to the content script to inject the script
            await chrome.tabs.sendMessage(tabId, {
                action: 'INJECT_CUSTOM_SCRIPT',
                data: { script: scriptContent }
            });
            console.log('Custom script injection requested via content script');
        } catch (error) {
            console.error('Error requesting script injection:', error);

            // Fallback: Try to inject a script loader
            try {
                await chrome.scripting.executeScript({
                    target: { tabId },
                    func: (scriptText) => {
                        // Create a blob URL for the script
                        const blob = new Blob([scriptText], { type: 'application/javascript' });
                        const url = URL.createObjectURL(blob);

                        // Create and append a script tag with the blob URL
                        const script = document.createElement('script');
                        script.src = url;
                        script.onload = () => URL.revokeObjectURL(url);
                        document.head.appendChild(script);
                    },
                    args: [scriptContent]
                });
                console.log('Custom script injected via fallback method');
            } catch (fallbackError) {
                console.error('Fallback script injection failed:', fallbackError);
            }
        }
    }
}

// Initialize the extension manager
const extensionManager = new ReclaimExtensionManager();