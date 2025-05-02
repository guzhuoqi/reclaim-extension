// Import necessary utilities and libraries
import { NetworkFilter } from '../utils/network-filter.js';
import { API_ENDPOINTS } from '../utils/constants.js';
import { fetchProviderData } from '../utils/start-verification.js';

class ReclaimExtensionManager {
    constructor() {
        this.networkFilter = new NetworkFilter();
        this.activeTabId = null;
        this.isNetworkListenerActive = false;
        this.disableNetworkMonitoring();

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
            console.log('[BACKGROUND] Provider data:', providerData);

            if (!providerData) {
                throw new Error('Provider data not found');
            }

            // redirect to the provider login page in a new tab and set it as active tab
            const providerUrl = providerData.loginUrl;
            console.log('[BACKGROUND] Provider URL:', providerUrl);
            const tab = await chrome.tabs.create({ url: providerUrl });
            this.activeTabId = tab.id;

            // start network monitoring
            console.log('[BACKGROUND] Starting network monitoring');
            this.enableNetworkMonitoring();
        } catch (error) {
            console.error('[BACKGROUND] Error starting verification:', error);
            throw error;
        }
    }

    async fetchProviderUrl(providerId) {
        try {
            const response = await fetch(API_ENDPOINTS.PROVIDER_URL(providerId));
            if (!response.ok) {
                throw new Error(`HTTP error ${response.status}: ${await response.text()}`);
            }
            const data = await response.json();
            return data.url;
        } catch (error) {
            console.error('Error fetching provider URL:', error);
            throw error;
        }
    }

    async navigateToProvider(url) {
        // Create a new tab with the provider URL
        const tab = await chrome.tabs.create({ url });
        this.activeTabId = tab.id;

        // Configure network filtering for this tab if needed
        await this.setupNetworkFilteringForTab(tab.id);

        return tab;
    }

    async setupNetworkFilteringForTab(tabId) {
        // Get session data to configure proper filtering
        const sessionData = await this.sessionManager.getCurrentSession();

        if (!sessionData) return;

        // Set up filtering rules based on provider
        const filterRules = this.networkFilter.getRulesForProvider(sessionData.providerId);

        // Apply rules to the network filter
        this.networkFilter.setRules(filterRules);
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
        // Process the request details in real-time (avoid storing)
        // log network request details
        console.log('[BACKGROUND] Network request:', details);
        const matchResult = this.networkFilter.matchRequest(details);

        if (matchResult.isMatch) {
            console.log('Matching request found:', matchResult.pattern);
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