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
                        loggerService.log({
                            message: 'Content script requested provider data',
                            type: LOG_TYPES.BACKGROUND,
                            sessionId: this.sessionId || 'unknown',
                            providerId: this.httpProviderId || 'unknown',
                            appId: this.appId || 'unknown'
                        });
                        // Only respond with provider data if this is a managed tab
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
                        console.log('[BACKGROUND] Starting verification with data:', data);

                        loggerService.log({
                            message: 'Starting a new verification with data: ' + JSON.stringify(data),
                            type: LOG_TYPES.BACKGROUND,
                            sessionId: data.sessionId || 'unknown',
                            providerId: data.providerId || 'unknown',
                            appId: data.applicationId || 'unknown'
                        });

                        loggerService.startFlushInterval();
                        // Store the original tab ID
                        if (sender.tab && sender.tab.id) {
                            this.originalTabId = sender.tab.id;
                            console.log('[BACKGROUND] Original tab ID stored:', this.originalTabId);
                        }
                        const result = await this.startVerification(data);
                        sendResponse({ success: true, result });
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
            console.log('[BACKGROUND] Creating new tab with URL:', providerUrl);

            // Use chrome.tabs.create directly and handle the promise explicitly
            chrome.tabs.create({ url: providerUrl }, (tab) => {
                console.log('[BACKGROUND] New tab created with ID:', tab.id);
                this.activeTabId = tab.id;
                loggerService.log({
                    message: 'New tab created',
                    type: LOG_TYPES.BACKGROUND,
                    sessionId: templateData.sessionId || 'unknown',
                    providerId: templateData.providerId || 'unknown',
                    appId: templateData.applicationId || 'unknown'
                });

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
                    console.log(`[BACKGROUND] Queued SHOW_PROVIDER_VERIFICATION_POPUP and PROVIDER_DATA_READY for tab ${tab.id}. Waiting for content script to load.`);

                } else {
                    console.error("[BACKGROUND] New tab does not have an ID, cannot queue message for popup.");
                }

                // Update session status after tab creation
                updateSessionStatus(templateData.sessionId, RECLAIM_SESSION_STATUS.USER_STARTED_VERIFICATION, templateData.providerId, templateData.applicationId)
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
            const protocol = urlObj.protocol;
            const path = urlObj.pathname;
            const isSecure = protocol === 'https:';

            console.log(`[BACKGROUND] Getting cookies for URL: ${url}, domain: ${domain}, path: ${path}, secure: ${isSecure}`);

            // Get all cookies that would be sent with this request
            const allCookies = [];
            
            // 1. Get cookies for the exact domain
            const exactDomainCookies = await chrome.cookies.getAll({ domain });
            allCookies.push(...exactDomainCookies);

            // 2. Get cookies for parent domains (e.g., for subdomain.example.com, also get .example.com cookies)
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

            // 3. Get cookies by URL (this will respect path and secure restrictions)
            try {
                const urlCookies = await chrome.cookies.getAll({ url });
                allCookies.push(...urlCookies);
            } catch (error) {
                console.warn(`[BACKGROUND] Could not get cookies by URL ${url}:`, error);
            }

            // Remove duplicates based on name, domain, and path
            const uniqueCookies = [];
            const cookieKeys = new Set();
            
            for (const cookie of allCookies) {
                const key = `${cookie.name}|${cookie.domain}|${cookie.path}`;
                if (!cookieKeys.has(key)) {
                    // Check if this cookie should be sent with the request
                    const shouldInclude = this.shouldIncludeCookie(cookie, urlObj);
                    if (shouldInclude) {
                        cookieKeys.add(key);
                        uniqueCookies.push(cookie);
                    }
                }
            }

            if (uniqueCookies.length > 0) {
                // Sort cookies by path length (longest first) and then by creation time
                uniqueCookies.sort((a, b) => {
                    if (a.path.length !== b.path.length) {
                        return b.path.length - a.path.length;
                    }
                    return (a.creationDate || 0) - (b.creationDate || 0);
                });

                const cookieStr = uniqueCookies.map(c => `${c.name}=${c.value}`).join('; ');
                console.log(`[BACKGROUND] Found ${uniqueCookies.length} cookies for URL ${url}`);
                console.log(`[BACKGROUND] Cookie string length: ${cookieStr.length}`);
                return cookieStr;
            }

            console.log(`[BACKGROUND] No cookies found for URL: ${url}`);
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
    async processFilteredRequest(request, criteria, sessionId) {
        try {
            console.log('[BACKGROUND] Processing filtered request:', request.url);

            // Start session timer if this is the first request
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

                // Fail entire session if claim creation fails
                this.failSession("Claim creation failed: " + error.message, criteria.requestHash);
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

                // logs
                loggerService.log({
                    message: `Claim Object creation successful for request hash: ${criteria.requestHash}`,
                    type: LOG_TYPES.BACKGROUND,
                    sessionId: this.sessionId || 'unknown',
                    providerId: this.httpProviderId || 'unknown',
                    appId: this.appId || 'unknown'
                });
            }

            // Add proof generation task to the queue instead of generating immediately
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
        console.log('[BACKGROUND] Adding proof generation task to queue for hash:', requestHash);

        // Add task to queue
        this.proofGenerationQueue.push({
            claimData,
            requestHash
        });

        // Start processing queue if not already processing
        if (!this.isProcessingQueue) {
            // Pause session timer while processing proofs
            this.sessionTimerManager.pauseSessionTimer();
            this.processNextQueueItem();
        }
    }

    // Process next item in the proof generation queue
    async processNextQueueItem() {
        // If already processing or queue is empty, return
        if (this.isProcessingQueue || this.proofGenerationQueue.length === 0) {
            // Resume session timer if queue is empty
            if (this.proofGenerationQueue.length === 0) {
                // Check if all proofs have been generated
                if (this.generatedProofs.size === this.providerData.requestData.length) {
                    // All proofs generated, clear all timers to prevent timeout
                    console.log('[BACKGROUND] All proofs generated successfully, clearing timers');
                    this.sessionTimerManager.clearAllTimers();
                    // Schedule submission after clearing timers
                    setTimeout(() => this.submitProofs(), 0);
                    return;
                }
                this.sessionTimerManager.resumeSessionTimer();
            }
            return;
        }

        // Mark as processing
        this.isProcessingQueue = true;

        // Get next task from queue
        const task = this.proofGenerationQueue.shift();

        try {
            console.log('[BACKGROUND] Processing next queued proof generation task for hash:', task.requestHash);

            // Generate proof for the claim
            chrome.tabs.sendMessage(this.activeTabId, {
                action: MESSAGE_ACTIONS.PROOF_GENERATION_STARTED,
                source: MESSAGE_SOURCES.BACKGROUND,
                target: MESSAGE_SOURCES.CONTENT_SCRIPT,
                data: { requestHash: task.requestHash }
            });

            // Generate proof using offscreen document
            loggerService.log({
                message: `Queued proof generation request for request hash: ${task.requestHash}`,
                type: LOG_TYPES.BACKGROUND,
                sessionId: this.sessionId || 'unknown',
                providerId: this.httpProviderId || 'unknown',
                appId: this.appId || 'unknown'
            });
            const proofResponseObject = await generateProof(task.claimData);
            // if proofResponseObject.success is false, then the fail the entire session
            if (!proofResponseObject.success) {
                this.failSession("Proof generation failed: " + proofResponseObject.error, task.requestHash);
                return;
            }

            const proof = proofResponseObject.proof;
            console.log('[BACKGROUND] Return proof data from generateProof method in background:', proof);

            // Store the proof
            if (proof) {
                if (!this.generatedProofs.has(task.requestHash)) {
                    this.generatedProofs.set(task.requestHash, proof);
                }

                // log the proof generation success
                loggerService.log({
                    message: `Proof generation successful for request hash: ${task.requestHash}`,
                    type: LOG_TYPES.BACKGROUND,
                    sessionId: this.sessionId || 'unknown',
                    providerId: this.httpProviderId || 'unknown',
                    appId: this.appId || 'unknown'
                });
                // Notify content script
                chrome.tabs.sendMessage(this.activeTabId, {
                    action: MESSAGE_ACTIONS.PROOF_GENERATION_SUCCESS,
                    source: MESSAGE_SOURCES.BACKGROUND,
                    target: MESSAGE_SOURCES.CONTENT_SCRIPT,
                    data: { requestHash: task.requestHash }
                });

                // Reset the session timer since we successfully generated a proof
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

            // Fail the entire session if any proof fails
            this.failSession("Proof generation failed: " + error.message, task.requestHash);
            return;
        } finally {
            // Mark as no longer processing
            this.isProcessingQueue = false;

            // If there are more items in queue, process the next one
            if (this.proofGenerationQueue.length > 0) {
                this.processNextQueueItem();
            } else {
                // Check if all proofs are generated before resuming session timer
                if (this.generatedProofs.size === this.providerData.requestData.length) {
                    // All proofs generated, clear all timers to prevent timeout
                    console.log('[BACKGROUND] All proofs generated after processing queue, clearing timers');
                    this.sessionTimerManager.clearAllTimers();
                    // Schedule submission after clearing timers
                    setTimeout(() => this.submitProofs(), 0);
                } else {
                    // Resume the session timer, still expecting more proofs
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
            // Clear all timers immediately when starting the proof submission process
            console.log('[BACKGROUND] Starting proof submission, clearing all timers');
            this.sessionTimerManager.clearAllTimers();
            
            // Check if there are proofs to submit and are equal to the number of proofs in the generatedProofs map
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
                await submitProofOnCallback(formattedProofs, this.callbackUrl, this.sessionId, this.httpProviderId, this.appId);
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