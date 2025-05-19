// Import polyfills
import '../utils/polyfills';

// Import necessary utilities and libraries
import { fetchProviderData, updateSessionStatus, submitProofOnCallback } from '../utils/fetch-calls';
import { RECLAIM_SESSION_STATUS, MESSAGE_ACTIONS, MESSAGE_SOURCES } from '../utils/constants';
import { generateProof, formatProof } from '../utils/proof-generator';
import { createClaimObject } from '../utils/claim-creator';

class ReclaimExtensionManager {
    constructor() {
        this.activeTabId = null;
        this.providerData = null;
        this.parameters = null;
        this.sessionId = null;
        this.callbackUrl = null;
        this.originalTabId = null;
        this.managedTabs = new Set(); // Track tabs opened by the background script

        // Map to store generated proofs by session ID
        this.generatedProofs = new Map();
        this.filteredRequests = new Map();

        // Map to store popup messages for content script
        this.initPopupMessage = new Map();
        this.providerDataMessage = new Map();

        // Initialize extension
        this.init();
    }

    async init() {
        // Register message handler
        chrome.runtime.onMessage.addListener(this.handleMessage.bind(this));
        
        // Listen for tab removals to clean up our managedTabs set
        chrome.tabs.onRemoved.addListener((tabId) => {
            if (this.managedTabs.has(tabId)) {
                this.managedTabs.delete(tabId);
                console.log(`[BACKGROUND] Removed tab ${tabId} from managed tabs list`);
            }
        });
    }

    async handleMessage(message, sender, sendResponse) {
        const { action, source, target, data } = message;
        console.log('[BACKGROUND] Received message from', source, 'to', target, 'with action', action, 'for tab', sender.tab?.id);

        try {
            switch (action) {
                // Handle content script loaded message
                case MESSAGE_ACTIONS.CONTENT_SCRIPT_LOADED:
                    if (source === MESSAGE_SOURCES.CONTENT_SCRIPT && target === MESSAGE_SOURCES.BACKGROUND) {
                        console.log(`[BACKGROUND] Content script loaded in tab ${sender.tab?.id} for URL: ${data.url}`);
                        
                        // Check if this tab is managed by us
                        const isManaged = sender.tab?.id && this.managedTabs.has(sender.tab.id);
                        
                        // Tell the content script whether it should initialize
                        chrome.tabs.sendMessage(sender.tab.id, {
                            action: MESSAGE_ACTIONS.SHOULD_INITIALIZE,
                            source: MESSAGE_SOURCES.BACKGROUND,
                            target: MESSAGE_SOURCES.CONTENT_SCRIPT,
                            data: { shouldInitialize: isManaged }
                        }).catch(err => console.error("[BACKGROUND] Error sending initialization status:", err));

                        // Check if there's a pending popup message for this tab
                        if (isManaged && this.initPopupMessage && this.initPopupMessage.has(sender.tab.id)) {
                            const pendingMessage = this.initPopupMessage.get(sender.tab.id);
                            console.log(`[BACKGROUND] Found pending popup message for tab ${sender.tab.id}. Sending now.`);
                            chrome.tabs.sendMessage(sender.tab.id, pendingMessage.message)
                                .then(response => {
                                    if (chrome.runtime.lastError) {
                                        console.error(`[BACKGROUND] Error sending (pending) SHOW_PROVIDER_VERIFICATION_POPUP to tab ${sender.tab.id}:`, chrome.runtime.lastError.message);
                                    } else {
                                        console.log(`[BACKGROUND] (Pending) SHOW_PROVIDER_VERIFICATION_POPUP message acknowledged by content script for tab ${sender.tab.id}:`, response);
                                    }
                                })
                                .catch(error => console.error(`[BACKGROUND] Error sending (pending) SHOW_PROVIDER_VERIFICATION_POPUP to tab ${sender.tab.id} (promise catch):`, error));
                        }

                        // Check if there is a pending provider data Message for this tab
                        if (isManaged && this.providerDataMessage && this.providerDataMessage.has(sender.tab.id)) {
                            const pendingMessage = this.providerDataMessage.get(sender.tab.id);
                            console.log(`[BACKGROUND] Found pending provider data message for tab ${sender.tab.id}. Sending now.`);
                            chrome.tabs.sendMessage(sender.tab.id, pendingMessage.message)
                                .then(response => {
                                    if (chrome.runtime.lastError) {
                                        console.error(`[BACKGROUND] Error sending (pending) PROVIDER_DATA_READY to tab ${sender.tab.id}:`, chrome.runtime.lastError.message);
                                    } else {
                                        console.log(`[BACKGROUND] (Pending) PROVIDER_DATA_READY message acknowledged by content script for tab ${sender.tab.id}:`, response);
                                    }
                                })
                                .catch(error => console.error(`[BACKGROUND] Error sending (pending) PROVIDER_DATA_READY to tab ${sender.tab.id} (promise catch):`, error));
                            this.providerDataMessage.delete(sender.tab.id); // Remove after attempting to send
                        }

                        sendResponse({ success: true });
                        break;
                    }
                    break;

                // Handle request provider data message
                case MESSAGE_ACTIONS.REQUEST_PROVIDER_DATA:
                    if (source === MESSAGE_SOURCES.CONTENT_SCRIPT && target === MESSAGE_SOURCES.BACKGROUND) {
                        console.log('[BACKGROUND] Content script requested provider data');
                        // Only respond with provider data if this is a managed tab
                        if (sender.tab?.id && this.managedTabs.has(sender.tab.id) && 
                            this.providerData && this.parameters && this.sessionId && this.callbackUrl) {
                            sendResponse({
                                success: true, data: {
                                    providerData: this.providerData,
                                    parameters: this.parameters,
                                    sessionId: this.sessionId,
                                    callbackUrl: this.callbackUrl
                                }
                            });
                        } else {
                            sendResponse({ success: false, error: 'Provider data not available or tab not managed' });
                        }
                    }
                    break;
                    
                // Handle check if tab is managed
                case MESSAGE_ACTIONS.CHECK_IF_MANAGED_TAB:
                    if (source === MESSAGE_SOURCES.CONTENT_SCRIPT && target === MESSAGE_SOURCES.BACKGROUND) {
                        const isManaged = sender.tab?.id && this.managedTabs.has(sender.tab.id);
                        sendResponse({ success: true, isManaged });
                    }
                    break;

                // Handle start verification message
                case MESSAGE_ACTIONS.START_VERIFICATION:
                    if (source === MESSAGE_SOURCES.CONTENT_SCRIPT && target === MESSAGE_SOURCES.BACKGROUND) {
                        console.log('[BACKGROUND] Starting verification with data:', data);
                        // Store the original tab ID
                        if (sender.tab && sender.tab.id) {
                            this.originalTabId = sender.tab.id;
                            console.log('[BACKGROUND] Original tab ID stored:', this.originalTabId);
                        }
                        const result = await this.startVerification(data);
                        sendResponse({ success: true, result });
                        break;
                    } else {
                        console.log(`[BACKGROUND] Message received: ${action} but invalid source or target`);
                        sendResponse({ success: false, error: 'Action not supported' });
                    }
                    break;

                // Handle offscreen document ready message
                case MESSAGE_ACTIONS.OFFSCREEN_DOCUMENT_READY:
                    if (source === MESSAGE_SOURCES.OFFSCREEN && target === MESSAGE_SOURCES.BACKGROUND) {
                        console.log('[BACKGROUND] Offscreen document is ready');
                        sendResponse({ success: true });
                    } else {
                        console.log(`[BACKGROUND] Message received: ${action} but invalid source or target`);
                        sendResponse({ success: false, error: 'Action not supported' });
                    }
                    break;

                // Handle generate proof response from offscreen document
                case MESSAGE_ACTIONS.GENERATE_PROOF_RESPONSE:
                    if (source === MESSAGE_SOURCES.OFFSCREEN && target === MESSAGE_SOURCES.BACKGROUND) {
                        console.log('[BACKGROUND] Received proof generation response from offscreen document');
                        // This message is handled by the proof-generator.js using the messageListener
                        // Just acknowledge receipt here
                        sendResponse({ success: true });
                    } else {
                        console.log(`[BACKGROUND] Message received: ${action} but invalid source or target`);
                        sendResponse({ success: false, error: 'Action not supported' });
                    }
                    break;

                case MESSAGE_ACTIONS.CLOSE_CURRENT_TAB:
                    if (source === MESSAGE_SOURCES.CONTENT_SCRIPT && target === MESSAGE_SOURCES.BACKGROUND) {
                        if (sender.tab && sender.tab.id) {
                            chrome.tabs.remove(sender.tab.id, () => {
                                if (chrome.runtime.lastError) {
                                    console.error('[BACKGROUND] Error closing tab:', chrome.runtime.lastError.message);
                                    sendResponse({ success: false, error: chrome.runtime.lastError.message });
                                } else {
                                    console.log('[BACKGROUND] Tab closed successfully:', sender.tab.id);
                                    if (this.managedTabs.has(sender.tab.id)) {
                                        this.managedTabs.delete(sender.tab.id);
                                    }
                                    sendResponse({ success: true });
                                }
                            });
                        } else {
                            console.error('[BACKGROUND] CLOSE_CURRENT_TAB: No tab ID provided by sender.');
                            sendResponse({ success: false, error: 'No tab ID found to close.' });
                        }
                    } else {
                        console.log(`[BACKGROUND] Message received: ${action} but invalid source or target`);
                        sendResponse({ success: false, error: 'Action not supported' });
                    }
                    return true;

                // Handle filtered request from content script
                case MESSAGE_ACTIONS.FILTERED_REQUEST_FOUND:
                    if (source === MESSAGE_SOURCES.CONTENT_SCRIPT && target === MESSAGE_SOURCES.BACKGROUND) {
                        console.log('[BACKGROUND] Received filtered request from content script');

                        // check if the request is already in the filteredRequests map
                        if (this.filteredRequests.has(data.criteria.requestHash)) {
                            console.log('[BACKGROUND] Request already in filteredRequests map');
                            sendResponse({ success: true, result: this.filteredRequests.get(data.criteria.requestHash) });
                        } else {
                            // Process the filtered request
                            this.filteredRequests.set(data.criteria.requestHash, data.request);
                            const result = await this.processFilteredRequest(data.request, data.criteria, data.sessionId);
                            sendResponse({ success: true, result });
                        }
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
            // 3. Send provider data to content script for filtering
            // 4. Content script will filter and send matching requests back
            // 5. Process matching requests to generate proofs
            // 6. Submit proofs to the backend
            // 7. Notify the SDK

            // clear all the member variables
            this.providerData = null;
            this.parameters = null;
            this.sessionId = null;
            this.callbackUrl = null;
            this.generatedProofs = new Map();
            this.filteredRequests = new Map();
            this.initPopupMessage = new Map();
            this.providerDataMessage = new Map();

            // fetch provider data
            const providerData = await fetchProviderData(templateData.providerId);
            this.providerData = providerData;
            if (templateData.parameters) {
                this.parameters = templateData.parameters;
            }

            if (templateData.callbackUrl) {
                this.callbackUrl = templateData.callbackUrl;
            }

            if (templateData.sessionId) {
                this.sessionId = templateData.sessionId;
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
                
                // Add this tab to our managed tabs list
                this.managedTabs.add(tab.id);
                console.log('[BACKGROUND] Added tab to managed tabs list:', tab.id);

                const providerName = this.providerData?.name || 'Default Provider';
                const description = this.providerData?.description || 'Default Description';
                const dataRequired = this.providerData?.verificationConfig?.dataRequired || 'Default Data';

                if (tab.id) {
                    const popupMessage = {
                        action: MESSAGE_ACTIONS.SHOW_PROVIDER_VERIFICATION_POPUP,
                        source: MESSAGE_SOURCES.BACKGROUND,
                        target: MESSAGE_SOURCES.CONTENT_SCRIPT,
                        data: {
                            providerName,
                            description,
                            dataRequired,
                        }
                    };

                    const providerDataMessage = {
                        action: MESSAGE_ACTIONS.PROVIDER_DATA_READY,
                        source: MESSAGE_SOURCES.BACKGROUND,
                        target: MESSAGE_SOURCES.CONTENT_SCRIPT,
                        data: {
                            providerData: this.providerData,
                            parameters: this.parameters,
                            sessionId: this.sessionId,
                            callbackUrl: this.callbackUrl
                        }
                    };

                    // Initialize the message map if it doesn't exist
                    if (!this.initPopupMessage) {
                        this.initPopupMessage = new Map();
                    }

                    // Store the message in the init PopupMessage for the tab
                    this.initPopupMessage.set(tab.id, { message: popupMessage });

                    // Store the provider data in the providerDataMap for the tab
                    this.providerDataMessage.set(tab.id, { message: providerDataMessage });
                    console.log(`[BACKGROUND] Queued SHOW_PROVIDER_VERIFICATION_POPUP and PROVIDER_DATA_READY for tab ${tab.id}. Waiting for content script to load.`);

                } else {
                    console.error("[BACKGROUND] New tab does not have an ID, cannot queue message for popup.");
                }

                // Update session status after tab creation
                updateSessionStatus(templateData.sessionId, RECLAIM_SESSION_STATUS.USER_STARTED_VERIFICATION)
                    .then(() => {
                        console.log('[BACKGROUND] Session status updated');
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

    // Get cookies for a specific URL
    async getCookiesForUrl(url) {
        try {
            if (!chrome.cookies || !chrome.cookies.getAll) {
                console.warn('[BACKGROUND] Chrome cookies API not available');
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

    // Process a filtered request from content script
    async processFilteredRequest(request, criteria, sessionId) {
        try {
            console.log('[BACKGROUND] Processing filtered request:', request.url);

            // Get cookies for this specific URL
            const cookies = await this.getCookiesForUrl(request.url);

            // Add cookies to the request
            if (cookies) {
                request.cookieStr = cookies;
                console.log('[BACKGROUND] Added cookies to request with length:', request.cookieStr.length);
            } else {
                console.log('[BACKGROUND] No cookies found for URL:', request.url);
            }

            // Create claim object from the request and criteria
            // send a message to the content script to notify of the claim creation started
            chrome.tabs.sendMessage(this.activeTabId, {
                action: MESSAGE_ACTIONS.CLAIM_CREATION_REQUESTED,
                source: MESSAGE_SOURCES.BACKGROUND,
                target: MESSAGE_SOURCES.CONTENT_SCRIPT,
                data: { requestHash: criteria.requestHash }
            });

            let claimData = null;
            try {
                claimData = await createClaimObject(request, criteria, sessionId);
            } catch (error) {
                console.error('[BACKGROUND] Error creating claim object:', error);
                // send a message to the content script to notify of the claim creation failed
                chrome.tabs.sendMessage(this.activeTabId, {
                    action: MESSAGE_ACTIONS.CLAIM_CREATION_FAILED,
                    source: MESSAGE_SOURCES.BACKGROUND,
                    target: MESSAGE_SOURCES.CONTENT_SCRIPT,
                    data: { requestHash: criteria.requestHash }
                });
                return { success: false, error: error.message };
            }

            // send a message to the content script to notify of the claim creation success
            if (claimData) {
                chrome.tabs.sendMessage(this.activeTabId, {
                    action: MESSAGE_ACTIONS.CLAIM_CREATION_SUCCESS,
                    source: MESSAGE_SOURCES.BACKGROUND,
                    target: MESSAGE_SOURCES.CONTENT_SCRIPT,
                    data: { requestHash: criteria.requestHash }
                });
            }

            // Generate proof for the claim
            const proof = await this.generateProofData(claimData, criteria.requestHash);
            console.log('[BACKGROUND] Proof generated successfully:', proof);

            const requestHash = criteria.requestHash;
            // Store the generated proof in case we need it later
            if (!this.generatedProofs.has(requestHash)) {
                this.generatedProofs.set(requestHash, proof);
            }

            // check if all the proofs are generated and then call submit proof
            if (this.generatedProofs.size === this.providerData.requestData.length) {
                await this.submitProofs();
            }

            return { success: true, proof };
        } catch (error) {
            console.error('[BACKGROUND] Error processing filtered request:', error);
            return { success: false, error: error.message };
        }
    }

    async generateProofData(claimData, requestHash) {
        try {
            // Use the proof-generator utility which leverages offscreen document
            console.log('[BACKGROUND] Generating proof for claim data:', claimData);

            // Generate proof using offscreen document
            // send a message to the content script to notify of the proof generation started
            chrome.tabs.sendMessage(this.activeTabId, {
                action: MESSAGE_ACTIONS.PROOF_GENERATION_STARTED,
                source: MESSAGE_SOURCES.BACKGROUND,
                target: MESSAGE_SOURCES.CONTENT_SCRIPT,
                data: { requestHash: requestHash }
            });
            const proof = await generateProof(claimData);
            if (proof) {
                // send a message to the content script to notify of the proof generation success
                chrome.tabs.sendMessage(this.activeTabId, {
                    action: MESSAGE_ACTIONS.PROOF_GENERATION_SUCCESS,
                    source: MESSAGE_SOURCES.BACKGROUND,
                    target: MESSAGE_SOURCES.CONTENT_SCRIPT,
                    data: { requestHash: requestHash }
                });
            }
            return proof;
        } catch (error) {
            console.error('[BACKGROUND] Error generating or submitting proof:', error);
            // send a message to the content script to notify of the proof generation failed    
            chrome.tabs.sendMessage(this.activeTabId, {
                action: MESSAGE_ACTIONS.PROOF_GENERATION_FAILED,
                source: MESSAGE_SOURCES.BACKGROUND,
                target: MESSAGE_SOURCES.CONTENT_SCRIPT,
                data: { requestHash: requestHash }
            });
            throw error;
        }
    }

    async submitProofs() {
        try {
            //    check if there are proofs to submit and are equal to the number of proofs in the generatedProofs map
            if (this.generatedProofs.size === 0) {
                console.log('[BACKGROUND] No proofs to submit');
                return;
            }

            if (this.generatedProofs.size !== this.providerData.requestData.length) {
                console.log('[BACKGROUND] Number of proofs to submit does not match the number of proofs in the generatedProofs map');
                return;
            }

            const formattedProofs = [];
            // create an array of proofs
            // TODO: match the proofs to the request data
            console.log('[BACKGROUND] Formating proofs for submission: ', this.generatedProofs);
            // the generatedProofs map is a map of requestHash to an array of proofs and the requestData is present in each of the requestData array element. Match the requestHash and call format proof
            for (const requestData of this.providerData.requestData) {
                if (this.generatedProofs.has(requestData.requestHash)) {
                    const proof = this.generatedProofs.get(requestData.requestHash);
                    const formattedProof = formatProof(proof, requestData);
                    formattedProofs.push(formattedProof);
                }
            }

            console.log('[BACKGROUND] Formated proofs for submission: ', formattedProofs);
            
            // submit the proofs
            try {
                await submitProofOnCallback(formattedProofs, this.callbackUrl, this.sessionId);
            } catch (error) {
                // send a message to the content script to notify of the proof submission failed
                chrome.tabs.sendMessage(this.activeTabId, {
                    action: MESSAGE_ACTIONS.PROOF_SUBMISSION_FAILED,
                    source: MESSAGE_SOURCES.BACKGROUND,
                    target: MESSAGE_SOURCES.CONTENT_SCRIPT,
                    data: { error: error.message }
                });
                console.error('[BACKGROUND] Error submitting my poor proofs:', error);
                throw error;
            }

            // send a message to the content script to notify of the proof submission success
            chrome.tabs.sendMessage(this.activeTabId, {
                action: MESSAGE_ACTIONS.PROOF_SUBMITTED,
                source: MESSAGE_SOURCES.BACKGROUND,
                target: MESSAGE_SOURCES.CONTENT_SCRIPT,
            });

            // Notify content script
            if (this.activeTabId) {
                try {
                    await chrome.tabs.sendMessage(this.activeTabId, {
                        action: 'PROOF_SUBMITTED',
                        data: { formattedProofs }
                    });
                    console.log('[BACKGROUND] Content script notified of proof submission');
                } catch (error) {
                    console.error('[BACKGROUND] Error notifying content script:', error);
                }
            }

            // Navigate back to the original tab and close the provider tab after 3 seconds
            if (this.originalTabId) {
                try {
                    setTimeout(async () => {
                    await chrome.tabs.update(this.originalTabId, { active: true });
                    console.log('[BACKGROUND] Switched back to original tab:', this.originalTabId);
                    if (this.activeTabId) {
                        await chrome.tabs.remove(this.activeTabId);
                        console.log('[BACKGROUND] Closed provider tab:', this.activeTabId);
                            this.activeTabId = null;
                        }
                        this.originalTabId = null; // Reset original tab ID
                    }, 3000);
                } catch (error) {
                    console.error('[BACKGROUND] Error navigating back or closing tab:', error);
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