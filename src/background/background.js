// Import necessary utilities and libraries
import { filterRequest } from '../utils/network-filter.js';
import { fetchProviderData, updateSessionStatus } from '../utils/start-verification.js';
import { RECLAIM_SESSION_STATUS } from '../utils/interfaces.js';


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
        // Setup message listeners for communication with content scripts and SDK
        chrome.runtime.onMessage.addListener(this.handleMessage.bind(this));

        console.log('Reclaim Extension initialized');
    }

    async handleMessage(message, sender, sendResponse) {
        const { action, data } = message;

        try {
            switch (action) {
                case 'CONTENT_SCRIPT_LOADED':
                    console.log('[BACKGROUND] Content script loaded', data.url);
                    sendResponse({ success: true });
                    break;

                case 'START_VERIFICATION':
                    console.log('[BACKGROUND] Starting verification with data:', data);
                    // check if the data is valid
                    const result = await this.startVerification(data);
                    sendResponse({ success: true, result });
                    break;

                default:
                    console.log('Message received but not processed:', action);
                    sendResponse({ success: false, error: 'Action not supported' });
            }
        } catch (error) {
            console.error(`Error handling ${action}:`, error);
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

            // redirect to the provider login page in a new tab and set it as active tab
            const providerUrl = providerData.loginUrl;
            console.log('[BACKGROUND] Provider URL:', providerUrl);
            const tab = await chrome.tabs.create({ url: providerUrl });
            this.activeTabId = tab.id;
            // update session status to USER_STARTED_VERIFICATION
            await updateSessionStatus(templateData.sessionId, RECLAIM_SESSION_STATUS.USER_STARTED_VERIFICATION);

            // start network monitoring
            console.log('[BACKGROUND] Starting network monitoring');
            this.enableNetworkMonitoring();
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
            const matchResult = this.providerData.requestData.some(criteria => filterRequest(formattedRequest, criteria, this.parameters));
            if (matchResult) {
                console.log('Matching request found:', formattedRequest);
            }
            
        } catch (error) {
            console.error('Error handling network request:', error);
        }
    }

    async submitProof(proof) {
        // Get current session to determine where to send the proof
        const session = await this.sessionManager.getCurrentSession();

        // Send proof to backend
        try {
            // const response = await fetch(`${.BACKEND_URL}/session/${session.sessionId}/proof`, {
            //     method: 'POST',
            //     headers: {
            //         'Content-Type': 'application/json'
            //     },
            //     body: JSON.stringify({ proof })
            // });

            // const result = await response.json();
            console.log('Proof submitted successfully:');

            // Notify SDK if needed
            if (session.notifySDK) {
                chrome.runtime.sendMessage({
                    action: 'PROOF_SUBMITTED',
                    data: { sessionId: session.sessionId, proof }
                });
            }
        } catch (error) {
            console.error('Error submitting proof:', error);
        }
    }
}

// Initialize the extension manager
const extensionManager = new ReclaimExtensionManager();