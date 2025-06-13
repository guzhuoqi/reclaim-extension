// Tab management for background script
// Handles tab creation, script injection, and managedTabs logic

export function createProviderTab(ctx, providerUrl, providerId) {
    // Implementation will be filled in after moving logic from background.js
}

export function injectProviderScriptForTab(ctx, tabId) {
    try {
        if (!ctx.managedTabs.has(tabId) || !ctx.httpProviderId) {
            return;
        }

        const scriptUrl = `js-scripts/${ctx.httpProviderId}.js`;

        chrome.scripting.executeScript({
            target: { tabId: tabId },
            files: [scriptUrl],
            world: 'MAIN'
        }).then(() => {
            ctx.loggerService.log({
                message: `Provider-specific script re-injected after navigation: ${scriptUrl}`,
                type: ctx.LOG_TYPES.BACKGROUND,
                sessionId: ctx.sessionId || 'unknown',
                providerId: ctx.httpProviderId || 'unknown',
                appId: ctx.appId || 'unknown'
            });
        });

    } catch (error) {
        ctx.debugLogger.error(ctx.DebugLogType.BACKGROUND, `[BACKGROUND] Error re-injecting provider script for tab ${tabId}:`, error);
    }
}

export function isManagedTab(ctx, tabId) {
    return ctx.managedTabs.has(tabId);
}

export function removeManagedTab(ctx, tabId) {
    ctx.managedTabs.delete(tabId);
} 