// Import polyfills
import '../utils/polyfills';

// Import necessary utilities and libraries
import { fetchProviderData, updateSessionStatus, submitProofOnCallback } from '../utils/fetch-calls';
import { RECLAIM_SESSION_STATUS, MESSAGE_ACTIONS, MESSAGE_SOURCES } from '../utils/constants';
import { generateProof, formatProof } from '../utils/proof-generator';
import { createClaimObject } from '../utils/claim-creator';
import { loggerService, LOG_TYPES } from '../utils/logger';
import { SessionTimerManager } from '../utils/session-timer';

class ReclaimExtensionManager {
    constructor() {
        this.activeTabId = null;
        this.providerData = null;
        this.parameters = null;
        this.httpProviderId = null;
        this.appId = null;
        this.sessionId = null;
        this.callbackUrl = null;
        this.originalTabId = null;
        this.managedTabs = new Set(); // Track tabs opened by the background script

        // Map to store generated proofs by session ID
        this.generatedProofs = new Map();
        this.filteredRequests = new Map();

        // Queue for proof generation to avoid race conditions
        this.proofGenerationQueue = [];
        this.isProcessingQueue = false;

        this.firstRequestReceived = false;

        // Initialize session timer manager
        this.sessionTimerManager = new SessionTimerManager();
        this.sessionTimerManager.setCallbacks(
            this.failSession.bind(this)  // Session timeout callback
        );
        // Set timer duration (30 seconds for session timer)
        this.sessionTimerManager.setTimerDuration(30000);

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
            }
        });

        // Listen for navigation events to re-inject scripts
        chrome.webNavigation.onCompleted.addListener((details) => {
            // Only handle main frame navigations (not iframes)
            if (details.frameId === 0 && this.managedTabs.has(details.tabId)) {
                this.injectProviderScriptForTab(details.tabId);
            }
        });
    }

    async handleMessage(message, sender, sendResponse) {
        const { action, source, target, data } = message;

        try {
            switch (action) {
                // Handle content script loaded message
                case MESSAGE_ACTIONS.CONTENT_SCRIPT_LOADED:
                    if (source === MESSAGE_SOURCES.CONTENT_SCRIPT && target === MESSAGE_SOURCES.BACKGROUND) {
                        const isManaged = sender.tab?.id && this.managedTabs.has(sender.tab.id);

                        chrome.tabs.sendMessage(sender.tab.id, {
                            action: MESSAGE_ACTIONS.SHOULD_INITIALIZE,
                            source: MESSAGE_SOURCES.BACKGROUND,
                            target: MESSAGE_SOURCES.CONTENT_SCRIPT,
                            data: { shouldInitialize: isManaged }
                        }).catch(err => console.error("[BACKGROUND] Error sending initialization status:", err));

                        if (isManaged && this.initPopupMessage && this.initPopupMessage.has(sender.tab.id)) {
                            const pendingMessage = this.initPopupMessage.get(sender.tab.id);
                            chrome.tabs.sendMessage(sender.tab.id, pendingMessage.message)
                                .then(response => {
                                    if (chrome.runtime.lastError) {
                                        console.error(`[BACKGROUND] Error sending (pending) SHOW_PROVIDER_VERIFICATION_POPUP to tab ${sender.tab.id}:`, chrome.runtime.lastError.message);
                                    }
                                })
                                .catch(error => console.error(`[BACKGROUND] Error sending (pending) SHOW_PROVIDER_VERIFICATION_POPUP to tab ${sender.tab.id} (promise catch):`, error));
                        }

                        if (isManaged && this.providerDataMessage && this.providerDataMessage.has(sender.tab.id)) {
                            const pendingMessage = this.providerDataMessage.get(sender.tab.id);
                            chrome.tabs.sendMessage(sender.tab.id, pendingMessage.message)
                                .then(response => {
                                    if (chrome.runtime.lastError) {
                                        console.error(`[BACKGROUND] Error sending (pending) PROVIDER_DATA_READY to tab ${sender.tab.id}:`, chrome.runtime.lastError.message);
                                    }
                                })
                                .catch(error => console.error(`[BACKGROUND] Error sending (pending) PROVIDER_DATA_READY to tab ${sender.tab.id} (promise catch):`, error));
                            this.providerDataMessage.delete(sender.tab.id);
                        }

                        sendResponse({ success: true });
                        break;
                    }
                    break;

                // Handle request provider data message
                case MESSAGE_ACTIONS.REQUEST_PROVIDER_DATA:
                    if (source === MESSAGE_SOURCES.CONTENT_SCRIPT && target === MESSAGE_SOURCES.BACKGROUND) {
                        loggerService.log({
                            message: 'Content script requested provider data',
                            type: LOG_TYPES.BACKGROUND,
                            sessionId: this.sessionId || 'unknown',
                            providerId: this.httpProviderId || 'unknown',
                            appId: this.appId || 'unknown'
                        });

                        if (sender.tab?.id && this.managedTabs.has(sender.tab.id) &&
                            this.providerData && this.parameters && this.sessionId && this.callbackUrl) {

                            loggerService.log({
                                message: 'Sending the following provider data to content script: ' + JSON.stringify(this.providerData),
                                type: LOG_TYPES.BACKGROUND,
                                sessionId: this.sessionId || 'unknown',
                                providerId: this.httpProviderId || 'unknown',
                                appId: this.appId || 'unknown'
                            });
                            sendResponse({
                                success: true, data: {
                                    providerData: this.providerData,
                                    parameters: this.parameters,
                                    sessionId: this.sessionId,
                                    callbackUrl: this.callbackUrl,
                                    httpProviderId: this.httpProviderId,
                                    appId: this.appId
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
                        loggerService.log({
                            message: 'Starting a new verification with data: ' + JSON.stringify(data),
                            type: LOG_TYPES.BACKGROUND,
                            sessionId: data.sessionId || 'unknown',
                            providerId: data.providerId || 'unknown',
                            appId: data.applicationId || 'unknown'
                        });

                        loggerService.startFlushInterval();
                        if (sender.tab && sender.tab.id) {
                            this.originalTabId = sender.tab.id;
                        }
                        const result = await this.startVerification(data);
                        sendResponse({ success: true, result });
                    } else {
                        sendResponse({ success: false, error: 'Action not supported' });
                    }
                    break;

                // Handle offscreen document ready message
                case MESSAGE_ACTIONS.OFFSCREEN_DOCUMENT_READY:
                    if (source === MESSAGE_SOURCES.OFFSCREEN && target === MESSAGE_SOURCES.BACKGROUND) {
                        sendResponse({ success: true });
                    } else {
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
                        sendResponse({ success: false, error: 'Action not supported' });
                    }
                    return true;

                // Handle filtered request from content script
                case MESSAGE_ACTIONS.FILTERED_REQUEST_FOUND:
                    if (source === MESSAGE_SOURCES.CONTENT_SCRIPT && target === MESSAGE_SOURCES.BACKGROUND) {
                        if (this.filteredRequests.has(data.criteria.requestHash)) {
                            sendResponse({ success: true, result: this.filteredRequests.get(data.criteria.requestHash) });
                        } else {
                            this.filteredRequests.set(data.criteria.requestHash, data.request);
                            const result = await this.processFilteredRequest(data.request, data.criteria, data.sessionId, data.loginUrl);
                            sendResponse({ success: true, result });
                        }
                    } else {
                        sendResponse({ success: false, error: 'Action not supported' });
                    }
                    break;

                // GET Current Tab Id
                case MESSAGE_ACTIONS.GET_CURRENT_TAB_ID:
                    if (source === MESSAGE_SOURCES.CONTENT_SCRIPT && target === MESSAGE_SOURCES.BACKGROUND) {
                        sendResponse({ success: true, tabId: sender.tab?.id });
                    } else {
                        sendResponse({ success: false, error: 'Action not supported' });
                    }
                    break;

                default:
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
            this.httpProviderId = null;
            this.appId = null;
            this.sessionId = null;
            this.callbackUrl = null;
            this.generatedProofs = new Map();
            this.filteredRequests = new Map();
            this.initPopupMessage = new Map();
            this.providerDataMessage = new Map();

            // Reset timers and timer state variables
            this.sessionTimerManager.clearAllTimers();
            this.firstRequestReceived = false;

            // fetch provider data
            if (!templateData.providerId) {
                throw new Error('Provider ID not found');
            }
            // fetch provider data from the backend
            loggerService.log({
                message: 'Fetching provider data from the backend for provider Id ' + templateData.providerId,
                type: LOG_TYPES.BACKGROUND,
                sessionId: templateData.sessionId || 'unknown',
                providerId: templateData.providerId || 'unknown',
                appId: templateData.applicationId || 'unknown'
            });

            const providerData = await fetchProviderData(templateData.providerId, templateData.sessionId, templateData.applicationId);
            this.providerData = providerData;

            this.httpProviderId = templateData.providerId;
            if (templateData.parameters) {
                this.parameters = templateData.parameters;
            }

            if (templateData.callbackUrl) {
                this.callbackUrl = templateData.callbackUrl;
            }

            if (templateData.sessionId) {
                this.sessionId = templateData.sessionId;
            }

            if (templateData.applicationId) {
                this.appId = templateData.applicationId;
            }

            if (!providerData) {
                throw new Error('Provider data not found');
            }

            // Create a new tab with provider URL DIRECTLY - not through an async flow
            const providerUrl = providerData.loginUrl;

            // Use chrome.tabs.create directly and handle the promise explicitly
            chrome.tabs.create({ url: providerUrl }, (tab) => {
                this.activeTabId = tab.id;
                loggerService.log({
                    message: 'New tab created',
                    type: LOG_TYPES.BACKGROUND,
                    sessionId: templateData.sessionId || 'unknown',
                    providerId: templateData.providerId || 'unknown',
                    appId: templateData.applicationId || 'unknown'
                });

                this.managedTabs.add(tab.id);

                if (templateData.providerId) {
                    const scriptUrl = `js-scripts/${templateData.providerId}.js`;

                    chrome.scripting.executeScript({
                        target: { tabId: tab.id },
                        files: [scriptUrl],
                        world: 'MAIN'
                    }).then(() => {
                        loggerService.log({
                            message: `Provider-specific script injected: ${scriptUrl}`,
                            type: LOG_TYPES.BACKGROUND,
                            sessionId: templateData.sessionId || 'unknown',
                            providerId: templateData.providerId || 'unknown',
                            appId: templateData.applicationId || 'unknown'
                        });
                    }).catch(error => {
                        loggerService.log({
                            message: `Provider-specific script not found: ${scriptUrl}`,
                            type: LOG_TYPES.BACKGROUND,
                            sessionId: templateData.sessionId || 'unknown',
                            providerId: templateData.providerId || 'unknown',
                            appId: templateData.applicationId || 'unknown'
                        });
                    });
                }

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
                            callbackUrl: this.callbackUrl,
                            httpProviderId: this.httpProviderId,
                            appId: this.appId
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
                } else {
                    console.error("[BACKGROUND] New tab does not have an ID, cannot queue message for popup.");
                }

                // Update session status after tab creation
                updateSessionStatus(templateData.sessionId, RECLAIM_SESSION_STATUS.USER_STARTED_VERIFICATION, templateData.providerId, templateData.applicationId)
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
            const protocol = urlObj.protocol;
            const path = urlObj.pathname;
            const isSecure = protocol === 'https:';

            const allCookies = [];

            const exactDomainCookies = await chrome.cookies.getAll({ domain });
            allCookies.push(...exactDomainCookies);

            const domainParts = domain.split('.');
            for (let i = 1; i < domainParts.length; i++) {
                const parentDomain = '.' + domainParts.slice(i).join('.');
                try {
                    const parentCookies = await chrome.cookies.getAll({ domain: parentDomain });
                    allCookies.push(...parentCookies);
                } catch (error) {
                    console.warn(`[BACKGROUND] Could not get cookies for parent domain ${parentDomain}:`, error);
                }
            }

            try {
                const urlCookies = await chrome.cookies.getAll({ url });
                allCookies.push(...urlCookies);
            } catch (error) {
                console.warn(`[BACKGROUND] Could not get cookies by URL ${url}:`, error);
            }

            const uniqueCookies = [];
            const cookieKeys = new Set();

            for (const cookie of allCookies) {
                const key = `${cookie.name}|${cookie.domain}|${cookie.path}`;
                if (!cookieKeys.has(key)) {
                    const shouldInclude = this.shouldIncludeCookie(cookie, urlObj);
                    if (shouldInclude) {
                        cookieKeys.add(key);
                        uniqueCookies.push(cookie);
                    }
                }
            }

            if (uniqueCookies.length > 0) {
                uniqueCookies.sort((a, b) => {
                    if (a.path.length !== b.path.length) {
                        return b.path.length - a.path.length;
                    }
                    return (a.creationDate || 0) - (b.creationDate || 0);
                });

                const cookieStr = uniqueCookies.map(c => `${c.name}=${c.value}`).join('; ');
                return cookieStr;
            }

            return null;
        } catch (error) {
            console.error('[BACKGROUND] Error getting cookies for URL:', error);
            return null;
        }
    }

    // Helper method to determine if a cookie should be included in the request
    shouldIncludeCookie(cookie, urlObj) {
        try {
            // Check domain match
            const cookieDomain = cookie.domain.startsWith('.') ? cookie.domain.substring(1) : cookie.domain;
            const requestDomain = urlObj.hostname;

            const domainMatches = requestDomain === cookieDomain ||
                requestDomain.endsWith('.' + cookieDomain) ||
                (cookie.domain.startsWith('.') && requestDomain.endsWith(cookie.domain.substring(1)));

            if (!domainMatches) {
                return false;
            }

            // Check path match
            const cookiePath = cookie.path || '/';
            const requestPath = urlObj.pathname;
            const pathMatches = requestPath.startsWith(cookiePath);

            if (!pathMatches) {
                return false;
            }

            // Check secure flag
            const isSecureRequest = urlObj.protocol === 'https:';
            if (cookie.secure && !isSecureRequest) {
                return false;
            }

            // Check if cookie is expired
            if (cookie.expirationDate && cookie.expirationDate < Date.now() / 1000) {
                return false;
            }

            return true;
        } catch (error) {
            console.warn('[BACKGROUND] Error checking cookie inclusion:', error);
            return false;
        }
    }

    // Process a filtered request from content script
    async processFilteredRequest(request, criteria, sessionId, loginUrl) {
        try {
            if (!this.firstRequestReceived) {
                this.firstRequestReceived = true;
                this.sessionTimerManager.startSessionTimer();
            }

            loggerService.log({
                message: `Received filtered request ${request.url} from content script for request hash: ${criteria.requestHash}`,
                type: LOG_TYPES.BACKGROUND,
                sessionId: this.sessionId || 'unknown',
                providerId: this.httpProviderId || 'unknown',
                appId: this.appId || 'unknown'
            });

            const cookies = await this.getCookiesForUrl(request.url);

            if (cookies) {
                request.cookieStr = cookies;
            }

            chrome.tabs.sendMessage(this.activeTabId, {
                action: MESSAGE_ACTIONS.CLAIM_CREATION_REQUESTED,
                source: MESSAGE_SOURCES.BACKGROUND,
                target: MESSAGE_SOURCES.CONTENT_SCRIPT,
                data: { requestHash: criteria.requestHash }
            });

            let claimData = null;
            try {
                claimData = await createClaimObject(request, criteria, sessionId, loginUrl);
            } catch (error) {
                console.error('[BACKGROUND] Error creating claim object:', error);
                chrome.tabs.sendMessage(this.activeTabId, {
                    action: MESSAGE_ACTIONS.CLAIM_CREATION_FAILED,
                    source: MESSAGE_SOURCES.BACKGROUND,
                    target: MESSAGE_SOURCES.CONTENT_SCRIPT,
                    data: { requestHash: criteria.requestHash }
                });

                this.failSession("Claim creation failed: " + error.message, criteria.requestHash);
                return { success: false, error: error.message };
            }

            if (claimData) {
                chrome.tabs.sendMessage(this.activeTabId, {
                    action: MESSAGE_ACTIONS.CLAIM_CREATION_SUCCESS,
                    source: MESSAGE_SOURCES.BACKGROUND,
                    target: MESSAGE_SOURCES.CONTENT_SCRIPT,
                    data: { requestHash: criteria.requestHash }
                });

                loggerService.log({
                    message: `Claim Object creation successful for request hash: ${criteria.requestHash}`,
                    type: LOG_TYPES.BACKGROUND,
                    sessionId: this.sessionId || 'unknown',
                    providerId: this.httpProviderId || 'unknown',
                    appId: this.appId || 'unknown'
                });
            }

            this.addToProofGenerationQueue(claimData, criteria.requestHash);

            return { success: true, message: "Proof generation queued" };
        } catch (error) {
            console.error('[BACKGROUND] Error processing filtered request:', error);
            this.failSession("Error processing request: " + error.message, criteria.requestHash);
            return { success: false, error: error.message };
        }
    }

    // Add proof generation task to queue
    addToProofGenerationQueue(claimData, requestHash) {
        this.proofGenerationQueue.push({
            claimData,
            requestHash
        });

        if (!this.isProcessingQueue) {
            this.sessionTimerManager.pauseSessionTimer();
            this.processNextQueueItem();
        }
    }

    // Process next item in the proof generation queue
    async processNextQueueItem() {
        if (this.isProcessingQueue || this.proofGenerationQueue.length === 0) {
            if (this.proofGenerationQueue.length === 0) {
                if (this.generatedProofs.size === this.providerData.requestData.length) {
                    this.sessionTimerManager.clearAllTimers();
                    setTimeout(() => this.submitProofs(), 0);
                    return;
                }
                this.sessionTimerManager.resumeSessionTimer();
            }
            return;
        }

        this.isProcessingQueue = true;

        const task = this.proofGenerationQueue.shift();

        try {
            chrome.tabs.sendMessage(this.activeTabId, {
                action: MESSAGE_ACTIONS.PROOF_GENERATION_STARTED,
                source: MESSAGE_SOURCES.BACKGROUND,
                target: MESSAGE_SOURCES.CONTENT_SCRIPT,
                data: { requestHash: task.requestHash }
            });

            loggerService.log({
                message: `Queued proof generation request for request hash: ${task.requestHash}`,
                type: LOG_TYPES.BACKGROUND,
                sessionId: this.sessionId || 'unknown',
                providerId: this.httpProviderId || 'unknown',
                appId: this.appId || 'unknown'
            });
            const proofResponseObject = await generateProof(task.claimData);
            if (!proofResponseObject.success) {
                this.failSession("Proof generation failed: " + proofResponseObject.error, task.requestHash);
                return;
            }

            const proof = proofResponseObject.proof;

            if (proof) {
                if (!this.generatedProofs.has(task.requestHash)) {
                    this.generatedProofs.set(task.requestHash, proof);
                }

                loggerService.log({
                    message: `Proof generation successful for request hash: ${task.requestHash}`,
                    type: LOG_TYPES.BACKGROUND,
                    sessionId: this.sessionId || 'unknown',
                    providerId: this.httpProviderId || 'unknown',
                    appId: this.appId || 'unknown'
                });
                chrome.tabs.sendMessage(this.activeTabId, {
                    action: MESSAGE_ACTIONS.PROOF_GENERATION_SUCCESS,
                    source: MESSAGE_SOURCES.BACKGROUND,
                    target: MESSAGE_SOURCES.CONTENT_SCRIPT,
                    data: { requestHash: task.requestHash }
                });

                this.sessionTimerManager.resetSessionTimer();
            }
        } catch (error) {
            console.error('[BACKGROUND] Error processing proof generation queue item:', error);
            loggerService.logError({
                error: `Proof generation failed for request hash: ${task.requestHash}`,
                type: LOG_TYPES.BACKGROUND,
                sessionId: this.sessionId || 'unknown',
                providerId: this.httpProviderId || 'unknown',
                appId: this.appId || 'unknown'
            });

            this.failSession("Proof generation failed: " + error.message, task.requestHash);
            return;
        } finally {
            this.isProcessingQueue = false;

            if (this.proofGenerationQueue.length > 0) {
                this.processNextQueueItem();
            } else {
                if (this.generatedProofs.size === this.providerData.requestData.length) {
                    this.sessionTimerManager.clearAllTimers();
                    setTimeout(() => this.submitProofs(), 0);
                } else {
                    this.sessionTimerManager.resumeSessionTimer();
                }
            }
        }
    }

    // Fail the entire session with an error message
    async failSession(errorMessage, requestHash) {
        console.error('[BACKGROUND] Failing session:', errorMessage);
        loggerService.logError({
            error: `Session failed: ${errorMessage}`,
            type: LOG_TYPES.BACKGROUND,
            sessionId: this.sessionId || 'unknown',
            providerId: this.httpProviderId || 'unknown',
            appId: this.appId || 'unknown'
        });

        // Clear all timers
        this.sessionTimerManager.clearAllTimers();

        // Update session status to failed
        if (this.sessionId) {
            try {
                await updateSessionStatus(this.sessionId, RECLAIM_SESSION_STATUS.PROOF_GENERATION_FAILED, this.httpProviderId, this.appId);
            } catch (error) {
                console.error('[BACKGROUND] Error updating session status to failed:', error);
            }
        }

        // Notify content script about failure
        if (this.activeTabId) {
            chrome.tabs.sendMessage(this.activeTabId, {
                action: MESSAGE_ACTIONS.PROOF_GENERATION_FAILED,
                source: MESSAGE_SOURCES.BACKGROUND,
                target: MESSAGE_SOURCES.CONTENT_SCRIPT,
                data: { requestHash: requestHash }
            }).catch(err => {
                console.error('[BACKGROUND] Error notifying content script of session failure:', err);
            });
        }

        // Clear the queue
        this.proofGenerationQueue = [];
        this.isProcessingQueue = false;
    }

    async submitProofs() {
        try {
            this.sessionTimerManager.clearAllTimers();

            if (this.generatedProofs.size === 0) {
                return;
            }

            if (this.generatedProofs.size !== this.providerData.requestData.length) {
                return;
            }

            const formattedProofs = [];
            for (const requestData of this.providerData.requestData) {
                if (this.generatedProofs.has(requestData.requestHash)) {
                    const proof = this.generatedProofs.get(requestData.requestHash);
                    const formattedProof = formatProof(proof, requestData);
                    formattedProofs.push(formattedProof);
                }
            }

            try {
                await submitProofOnCallback(formattedProofs, this.callbackUrl, this.sessionId, this.httpProviderId, this.appId);
            } catch (error) {
                chrome.tabs.sendMessage(this.activeTabId, {
                    action: MESSAGE_ACTIONS.PROOF_SUBMISSION_FAILED,
                    source: MESSAGE_SOURCES.BACKGROUND,
                    target: MESSAGE_SOURCES.CONTENT_SCRIPT,
                    data: { error: error.message }
                });
                console.error('[BACKGROUND] Error submitting my poor proofs:', error);
                throw error;
            }

            chrome.tabs.sendMessage(this.activeTabId, {
                action: MESSAGE_ACTIONS.PROOF_SUBMITTED,
                source: MESSAGE_SOURCES.BACKGROUND,
                target: MESSAGE_SOURCES.CONTENT_SCRIPT,
            });

            if (this.activeTabId) {
                try {
                    await chrome.tabs.sendMessage(this.activeTabId, {
                        action: 'PROOF_SUBMITTED',
                        data: { formattedProofs }
                    });
                } catch (error) {
                    console.error('[BACKGROUND] Error notifying content script:', error);
                }
            }

            if (this.originalTabId) {
                try {
                    setTimeout(async () => {
                        await chrome.tabs.update(this.originalTabId, { active: true });
                        if (this.activeTabId) {
                            await chrome.tabs.remove(this.activeTabId);
                            this.activeTabId = null;
                        }
                        this.originalTabId = null;
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

    // Inject provider script for a specific tab
    async injectProviderScriptForTab(tabId) {
        try {
            if (!this.managedTabs.has(tabId) || !this.httpProviderId) {
                return;
            }

            if (this.providerData && this.providerData.customInjection) {
                const dynamicInjectFunction = function (customInjectStringValue) {
                    try {
                        function convertStringToJS(injectionString) {
                            const cleanedCode = injectionString
                                .replace(/\\n/g, '\n')
                                .replace(/\\"/g, '"')
                                .replace(/\\'/g, "'")
                                .replace(/\\t/g, '\t')
                                .trim();
                            return cleanedCode;
                        }

                        const cleanedInjectionCode = convertStringToJS(customInjectStringValue);

                        try {
                            // execute
                        } catch (error) {
                            console.error("[INJECTION] Error re-executing custom injection code:", error);
                        }

                        window.reclaimCustomScript = {
                            initialized: true,
                            timestamp: Date.now()
                        };
                    } catch (error) {
                        console.error("[INJECTION] Error re-executing custom injection code:", error);
                    }
                }

                chrome.scripting.executeScript({
                    target: { tabId: tabId },
                    func: dynamicInjectFunction,
                    world: 'MAIN',
                    args: [this.providerData.customInjection]
                }).catch(error => {
                    console.error(`[BACKGROUND] Error re-injecting custom script for tab ${tabId}:`, error);
                });
            }

            const scriptUrl = `js-scripts/${this.httpProviderId}.js`;

            chrome.scripting.executeScript({
                target: { tabId: tabId },
                files: [scriptUrl],
                world: 'MAIN'
            }).then(() => {
                loggerService.log({
                    message: `Provider-specific script re-injected after navigation: ${scriptUrl}`,
                    type: LOG_TYPES.BACKGROUND,
                    sessionId: this.sessionId || 'unknown',
                    providerId: this.httpProviderId || 'unknown',
                    appId: this.appId || 'unknown'
                });
            });

        } catch (error) {
            console.error(`[BACKGROUND] Error re-injecting provider script for tab ${tabId}:`, error);
        }
    }
}

const extensionManager = new ReclaimExtensionManager();