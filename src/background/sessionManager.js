// Session management for background script
// Handles session start, fail, submit, and timer logic

export async function startVerification(ctx, templateData) {
    try {
        // clear all the member variables
        ctx.providerData = null;
        ctx.parameters = null;
        ctx.httpProviderId = null;
        ctx.appId = null;
        ctx.sessionId = null;
        ctx.callbackUrl = null;
        ctx.generatedProofs = new Map();
        ctx.filteredRequests = new Map();
        ctx.initPopupMessage = new Map();
        ctx.providerDataMessage = new Map();

        // Reset timers and timer state variables
        ctx.sessionTimerManager.clearAllTimers();
        ctx.firstRequestReceived = false;

        // fetch provider data
        if (!templateData.providerId) {
            throw new Error('Provider ID not found');
        }
        // fetch provider data from the backend
        ctx.loggerService.log({
            message: 'Fetching provider data from the backend for provider Id ' + templateData.providerId,
            type: ctx.LOG_TYPES.BACKGROUND,
            sessionId: templateData.sessionId || 'unknown',
            providerId: templateData.providerId || 'unknown',
            appId: templateData.applicationId || 'unknown'
        });

        const providerData = await ctx.fetchProviderData(templateData.providerId, templateData.sessionId, templateData.applicationId);
        ctx.providerData = providerData;

        ctx.httpProviderId = templateData.providerId;
        if (templateData.parameters) {
            ctx.parameters = templateData.parameters;
        }

        if (templateData.callbackUrl) {
            ctx.callbackUrl = templateData.callbackUrl;
        }

        if (templateData.sessionId) {
            ctx.sessionId = templateData.sessionId;
        }

        if (templateData.applicationId) {
            ctx.appId = templateData.applicationId;
        }

        if (!providerData) {
            throw new Error('Provider data not found');
        }

        // Create a new tab with provider URL DIRECTLY - not through an async flow
        const providerUrl = providerData.loginUrl;

        // Use chrome.tabs.create directly and handle the promise explicitly
        chrome.tabs.create({ url: providerUrl }, (tab) => {
            ctx.activeTabId = tab.id;
            ctx.loggerService.log({
                message: 'New tab created',
                type: ctx.LOG_TYPES.BACKGROUND,
                sessionId: templateData.sessionId || 'unknown',
                providerId: templateData.providerId || 'unknown',
                appId: templateData.applicationId || 'unknown'
            });

            ctx.managedTabs.add(tab.id);

            const providerName = ctx.providerData?.name || 'Default Provider';
            const description = ctx.providerData?.description || 'Default Description';
            const dataRequired = ctx.providerData?.verificationConfig?.dataRequired || 'Default Data';

            if (tab.id) {
                const popupMessage = {
                    action: ctx.MESSAGE_ACTIONS.SHOW_PROVIDER_VERIFICATION_POPUP,
                    source: ctx.MESSAGE_SOURCES.BACKGROUND,
                    target: ctx.MESSAGE_SOURCES.CONTENT_SCRIPT,
                    data: {
                        providerName,
                        description,
                        dataRequired,
                    }
                };

                const providerDataMessage = {
                    action: ctx.MESSAGE_ACTIONS.PROVIDER_DATA_READY,
                    source: ctx.MESSAGE_SOURCES.BACKGROUND,
                    target: ctx.MESSAGE_SOURCES.CONTENT_SCRIPT,
                    data: {
                        providerData: ctx.providerData,
                        parameters: ctx.parameters,
                        sessionId: ctx.sessionId,
                        callbackUrl: ctx.callbackUrl,
                        httpProviderId: ctx.httpProviderId,
                        appId: ctx.appId
                    }
                };

                // Initialize the message map if it doesn't exist
                if (!ctx.initPopupMessage) {
                    ctx.initPopupMessage = new Map();
                }

                // Store the message in the init PopupMessage for the tab
                ctx.initPopupMessage.set(tab.id, { message: popupMessage });

                // Store the provider data in the providerDataMap for the tab
                ctx.providerDataMessage.set(tab.id, { message: providerDataMessage });
            } else {
                ctx.debugLogger.error(ctx.DebugLogType.BACKGROUND, "[BACKGROUND] New tab does not have an ID, cannot queue message for popup.");
            }

            // Update session status after tab creation
            ctx.updateSessionStatus(templateData.sessionId, ctx.RECLAIM_SESSION_STATUS.USER_STARTED_VERIFICATION, templateData.providerId, templateData.applicationId)
                .catch(error => {
                    ctx.debugLogger.error(ctx.DebugLogType.BACKGROUND, '[BACKGROUND] Error updating session status:', error);
                });
        });

        return {
            success: true,
            message: 'Verification started, redirecting to provider login page'
        };
    } catch (error) {
        ctx.debugLogger.error(ctx.DebugLogType.BACKGROUND, '[BACKGROUND] Error starting verification:', error);
        throw error;
    }
}

export async function failSession(ctx, errorMessage, requestHash) {
    ctx.debugLogger.error(ctx.DebugLogType.BACKGROUND, '[BACKGROUND] Failing session:', errorMessage);
    ctx.loggerService.logError({
        error: `Session failed: ${errorMessage}`,
        type: ctx.LOG_TYPES.BACKGROUND,
        sessionId: ctx.sessionId || 'unknown',
        providerId: ctx.httpProviderId || 'unknown',
        appId: ctx.appId || 'unknown'
    });

    // Clear all timers
    ctx.sessionTimerManager.clearAllTimers();

    // Update session status to failed
    if (ctx.sessionId) {
        try {
            await ctx.updateSessionStatus(ctx.sessionId, ctx.RECLAIM_SESSION_STATUS.PROOF_GENERATION_FAILED, ctx.httpProviderId, ctx.appId);
        } catch (error) {
            ctx.debugLogger.error(ctx.DebugLogType.BACKGROUND, '[BACKGROUND] Error updating session status to failed:', error);
        }
    }

    // Notify content script about failure
    if (ctx.activeTabId) {
        chrome.tabs.sendMessage(ctx.activeTabId, {
            action: ctx.MESSAGE_ACTIONS.PROOF_GENERATION_FAILED,
            source: ctx.MESSAGE_SOURCES.BACKGROUND,
            target: ctx.MESSAGE_SOURCES.CONTENT_SCRIPT,
            data: { requestHash: requestHash }
        }).catch(err => {
            ctx.debugLogger.error(ctx.DebugLogType.BACKGROUND, '[BACKGROUND] Error notifying content script of session failure:', err);
        });
    }

    // Clear the queue
    ctx.proofGenerationQueue = [];
    ctx.isProcessingQueue = false;
}

export async function submitProofs(ctx) {
    try {
        ctx.sessionTimerManager.clearAllTimers();

        if (ctx.generatedProofs.size === 0) {
            return;
        }

        if (ctx.generatedProofs.size !== ctx.providerData.requestData.length) {
            return;
        }

        const formattedProofs = [];
        for (const requestData of ctx.providerData.requestData) {
            if (ctx.generatedProofs.has(requestData.requestHash)) {
                const proof = ctx.generatedProofs.get(requestData.requestHash);
                const formattedProof = ctx.formatProof(proof, requestData);
                formattedProofs.push(formattedProof);
            }
        }

        try {
            await ctx.submitProofOnCallback(formattedProofs, ctx.callbackUrl, ctx.sessionId, ctx.httpProviderId, ctx.appId);
        } catch (error) {
            chrome.tabs.sendMessage(ctx.activeTabId, {
                action: ctx.MESSAGE_ACTIONS.PROOF_SUBMISSION_FAILED,
                source: ctx.MESSAGE_SOURCES.BACKGROUND,
                target: ctx.MESSAGE_SOURCES.CONTENT_SCRIPT,
                data: { error: error.message }
            });
            ctx.debugLogger.error(ctx.DebugLogType.BACKGROUND, '[BACKGROUND] Error submitting my poor proofs:', error);
            throw error;
        }

        if (ctx.activeTabId) {
            try {
                await chrome.tabs.sendMessage(ctx.activeTabId, {
                    action: ctx.MESSAGE_ACTIONS.PROOF_SUBMITTED,
                    source: ctx.MESSAGE_SOURCES.BACKGROUND,
                    target: ctx.MESSAGE_SOURCES.CONTENT_SCRIPT,
                    data: { formattedProofs }
                });
            } catch (error) {
                ctx.debugLogger.error(ctx.DebugLogType.BACKGROUND, '[BACKGROUND] Error notifying content script:', error);
            }
        }

        if (ctx.originalTabId) {
            try {
                setTimeout(async () => {
                    await chrome.tabs.update(ctx.originalTabId, { active: true });
                    if (ctx.activeTabId) {
                        await chrome.tabs.remove(ctx.activeTabId);
                        ctx.activeTabId = null;
                    }
                    ctx.originalTabId = null;
                }, 3000);
            } catch (error) {
                ctx.debugLogger.error(ctx.DebugLogType.BACKGROUND, '[BACKGROUND] Error navigating back or closing tab:', error);
            }
        }
        return { success: true };
    } catch (error) {
        ctx.debugLogger.error(ctx.DebugLogType.BACKGROUND, '[BACKGROUND] Error submitting proof:', error);
        throw error;
    }
} 