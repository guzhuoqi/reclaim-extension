// Import polyfills
import '../utils/polyfills';

// Import necessary utilities and libraries
import { filterRequest } from '../utils/network-filter.js';
import { fetchProviderData, updateSessionStatus } from '../utils/start-verification.js';
import { RECLAIM_SESSION_STATUS, MESSAGER_ACTIONS, MESSAGER_TYPES } from '../utils/interfaces.js';
import { generateProof } from '../utils/proof-generator.js';
import { testPolyfills } from '../utils/polyfill-test.js';

class ReclaimExtensionManager {
    constructor() {
        this.activeTabId = null;
        this.isNetworkListenerActive = false;
        this.disableNetworkMonitoring();
        this.providerData = null;
        this.parameters = null;

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

                // Handle generate proof request message
                case MESSAGER_ACTIONS.GENERATE_PROOF_REQUEST:
                    if (source === MESSAGER_TYPES.CONTENT_SCRIPT && target === MESSAGER_TYPES.BACKGROUND) {
                        try {
                            console.log('[BACKGROUND] Generating proof with data:', data);
                            sendResponse({ success: true, proof });
                        } catch (error) {
                            console.error('[BACKGROUND] Error generating proof:', error);
                            sendResponse({ success: false, error: error.message });
                        }
                        break;
                    } else {
                        console.log(`[BACKGROUND] Message received: ${action} but invalid source or target`);
                        sendResponse({ success: false, error: 'Action not supported' });
                    }
                    break;
                    
                // Handle claim generation requests with mock implementation
                case MESSAGER_ACTIONS.GENERATE_CLAIM_ON_ATTESTOR:
                    try {
                        console.log('[BACKGROUND] Generating mock claim');
                        
                        // Create a mock response
                        const mockId = 'mock-claim-' + Date.now() + '-' + Math.floor(Math.random() * 10000);
                        const mockResult = {
                            claimId: mockId,
                            ownerPublicKey: '0x123456789abcdef',
                            epoch: Math.floor(Date.now() / 1000),
                            timestampS: Math.floor(Date.now() / 1000),
                            identifier: data.name || 'mock-identifier',
                            provider: data.name || 'http',
                            parameters: data.params || {},
                            signatures: [],
                            mockData: true
                        };
                        
                        sendResponse({ success: true, result: mockResult });
                    } catch (error) {
                        console.error('[BACKGROUND] Error generating mock claim:', error);
                        sendResponse({ 
                            success: false, 
                            error: error.message || 'Unknown error generating mock claim'
                        });
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

    enableNetworkMonitoring() {
        if (this.isNetworkListenerActive) return;

        // Set up network request listeners
        chrome.webRequest.onBeforeRequest.addListener(
            this.handleNetworkRequest.bind(this),
            { urls: ["<all_urls>"] },
            ["requestBody"]
        );

        this.isNetworkListenerActive = true;
        console.log('Network monitoring enabled');
    }

    disableNetworkMonitoring() {
        if (!this.isNetworkListenerActive) return;

        chrome.webRequest.onBeforeRequest.removeListener(this.handleNetworkRequest.bind(this));
        this.isNetworkListenerActive = false;
        console.log('Network monitoring disabled');
    }

    async handleNetworkRequest(details) {
        try {
            // Skip if provider data is not loaded yet
            if (!this.providerData || !this.providerData.requestData) {
                return;
            }

            // Format the request object to match what filterRequest expects
            const formattedRequest = {
                url: details.url,
                method: details.method || 'GET', // Default to GET if method not provided
                body: null
            };

            // Extract and format request body if available
            if (details.requestBody) {
                if (details.requestBody.raw) {
                    // Raw binary data
                    const encoder = new TextDecoder('utf-8');
                    try {
                        const rawData = details.requestBody.raw[0].bytes;
                        formattedRequest.body = encoder.decode(rawData);
                    } catch (e) {
                        console.warn('Could not decode request body', e);
                    }
                } else if (details.requestBody.formData) {
                    // Form data
                    formattedRequest.body = JSON.stringify(details.requestBody.formData);
                }
            }

            // requestData is an array of objects check if any of the objects match the request
            const matchingCriteria = this.providerData.requestData.find(criteria => 
                filterRequest(formattedRequest, criteria, this.parameters)
            );
            
            if (matchingCriteria) {
                console.log('Matching request found:', formattedRequest);
                // Generate and submit proof when we find a matching request
                try {
                    await this.generateAndSubmitProof(formattedRequest, matchingCriteria);
                } catch (error) {
                    console.error('Error handling network request:', error);
                    // Don't throw here to avoid breaking the web request listener
                }
            }
            
        } catch (error) {
            console.error('Error handling network request:', error);
        }
    }

    async generateAndSubmitProof(request, criteria) {
        try {
            // Use the proof-generator utility which leverages offscreen document
            console.log('[BACKGROUND] Generating proof for request:', request);
            
            // Prepare claim data
            const claimData = {
                provider: criteria.name || 'http',
                name: criteria.name || 'http',
                params: criteria.params || {},
                contextId: crypto.randomUUID(), // Generate a unique context ID
                request: request // Include the request data for proof generation
            };
            
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
}

// Initialize the extension manager
const extensionManager = new ReclaimExtensionManager();