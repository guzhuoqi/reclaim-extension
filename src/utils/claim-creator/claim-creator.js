import { 
    extractDynamicParamNames, 
    extractParamsFromUrl, 
    extractParamsFromBody, 
    extractParamsFromResponse,
    separateParams
} from './params-extractor';
import { MESSAGER_ACTIONS, MESSAGER_TYPES } from '../constants';
import { ensureOffscreenDocument } from '../offscreen-manager';

const getPrivateKeyFromOffscreen = () => {
    return new Promise((resolve, reject) => {
        // Timeout after 10 seconds
        const callTimeout = setTimeout(() => {
            chrome.runtime.onMessage.removeListener(messageListener);
            reject(new Error('Timeout: No response from offscreen document for private key request.'));
        }, 10000);

        const messageListener = (message, sender) => {
            // Ensure the message is from the offscreen document and is the expected response
            if (message.action === MESSAGER_ACTIONS.GET_PRIVATE_KEY_RESPONSE &&
                message.source === MESSAGER_TYPES.OFFSCREEN &&
                message.target === MESSAGER_TYPES.BACKGROUND) { // Assuming this script runs in background context

                clearTimeout(callTimeout);
                chrome.runtime.onMessage.removeListener(messageListener);

                if (message.success && message.privateKey) {
                    console.log('[CLAIM-CREATOR] Received private key from offscreen document');
                    resolve(message.privateKey);
                } else {
                    console.error('[CLAIM-CREATOR] Failed to get private key from offscreen:', message.error);
                    reject(new Error(message.error || 'Unknown error getting private key from offscreen document.'));
                }
                return false; // Indicate message has been handled
            }
            return true; // Keep listener active for other messages
        };

        chrome.runtime.onMessage.addListener(messageListener);

        console.log('[CLAIM-CREATOR] Requesting private key from offscreen document');
        chrome.runtime.sendMessage({
            action: MESSAGER_ACTIONS.GET_PRIVATE_KEY,
            source: MESSAGER_TYPES.BACKGROUND, // Assuming this script runs in background context
            target: MESSAGER_TYPES.OFFSCREEN
        }, response => {
            if (chrome.runtime.lastError) {
                clearTimeout(callTimeout);
                chrome.runtime.onMessage.removeListener(messageListener);
                console.error('[CLAIM-CREATOR] Error sending GET_PRIVATE_KEY message:', chrome.runtime.lastError.message);
                reject(new Error(`Error sending message to offscreen document: ${chrome.runtime.lastError.message}`));
            }
            // If offscreen.js calls sendResponse synchronously, it can be handled here
            // but the main logic relies on the async messageListener
        });
    });
};

export const createClaimObject = async (request, providerData, sessionId) => {
    console.log('[CLAIM-CREATOR] Creating claim object from request data');
    
    // Ensure offscreen document is ready
    try {
        console.log('[CLAIM-CREATOR] Ensuring offscreen document is ready...');
        await ensureOffscreenDocument();
        console.log('[CLAIM-CREATOR] Offscreen document is ready.');
    } catch (error) {
        console.error('[CLAIM-CREATOR] Failed to ensure offscreen document:', error);
        // Depending on requirements, you might want to throw error or handle differently
        throw new Error(`Failed to initialize offscreen document: ${error.message}`);
    }
    
    // Define public headers that should be in params
    const PUBLIC_HEADERS = [
        "user-agent",
        "accept",
        "accept-language",
        "accept-encoding",
        "sec-fetch-mode",
        "sec-fetch-site",
        "sec-fetch-user",
        "origin",
        "x-requested-with",
        "sec-ch-ua",
        "sec-ch-ua-mobile",
    ];
    
    // Initialize params and secretParams objects
    const params = {};
    const secretParams = {};
    
    // Process URL
    params.url = request.url;
    params.method = request.method || 'GET';
    
    // Process headers - split between public and secret
    if (request.headers) {
        const publicHeaders = {};
        const secretHeaders = {};
        
        Object.entries(request.headers).forEach(([key, value]) => {
            const lowerKey = key.toLowerCase();
            if (PUBLIC_HEADERS.includes(lowerKey)) {
                publicHeaders[key] = value;
            } else {
                secretHeaders[key] = value;
            }
        });
        
        if (Object.keys(publicHeaders).length > 0) {
            params.headers = publicHeaders;
        }
        
        if (Object.keys(secretHeaders).length > 0) {
            secretParams.headers = secretHeaders;
        }
    } 
    
    // Process body if available
    if (request.body) {
        params.body = request.body;
    }
    
    // Process cookie string if available in request
    if (request.cookieStr) {
        secretParams.cookieStr = request.cookieStr;
    } 
    
    // Extract dynamic parameters from various sources
    const allParamValues = {};
    
    // 1. Extract params from URL if provider has URL template
    if (providerData.urlTemplate && request.url) {
        extractParamsFromUrl(providerData.urlTemplate, request.url, allParamValues);
    }
    
    // 2. Extract params from request body if provider has body template
    if (providerData.bodyTemplate && request.body) {
        extractParamsFromBody(providerData.bodyTemplate, request.body, allParamValues);
    }
    
    // 3. Extract params from response if available
    if (request.responseText && providerData.responseMatches) {
        extractParamsFromResponse(
            request.responseText, 
            providerData.responseMatches, 
            providerData.responseRedactions || [],
            allParamValues
        );
        
        // Log the extracted response parameters
        console.log('[CLAIM-CREATOR] Extracted parameters from response:', 
            Object.keys(allParamValues).join(', '));
    }
    
    // 4. Add any pre-defined parameter values from providerData
    if (providerData.paramValues) {
        Object.entries(providerData.paramValues).forEach(([key, value]) => {
            // Only add if not already extracted from request/response
            if (!(key in allParamValues)) {
                allParamValues[key] = value;
            }
        });
    }
    
    // 5. Separate parameters into public and secret
    const { publicParams, secretParams: secretParamValues } = separateParams(allParamValues);
    
    // Add parameter values to respective objects
    if (Object.keys(publicParams).length > 0) {
        params.paramValues = publicParams;
    }
    
    if (Object.keys(secretParamValues).length > 0) {
        secretParams.paramValues = secretParamValues;
    }
    
    // Process response matches if available
    if (providerData.responseMatches) {
        params.responseMatches = providerData.responseMatches.map(match => {
            // Create a clean object with only the required fields
            const cleanMatch = {
                value: match.value,
                type: match.type || 'contains',
                invert: match.invert || false
            };
            
            return cleanMatch;
        });
    }
    
    // Process response redactions if available
    if (providerData.responseRedactions) {
        params.responseRedactions = providerData.responseRedactions.map(redaction => {
            // Create a new object without hash field and empty jsonPath/xPath
            const cleanedRedaction = {};
            
            Object.entries(redaction).forEach(([key, value]) => {
                // Skip the hash field
                if (key === 'hash') {
                    return;
                }
                
                // Skip empty jsonPath and xPath
                if ((key === 'jsonPath' || key === 'xPath') && (!value || value === '')) {
                    return;
                }
                
                // Keep all other fields
                cleanedRedaction[key] = value;
            });
            
            return cleanedRedaction;
        });
    }
    
    // Process response selections if available
    if (providerData.responseSelections) {
        params.responseSelections = providerData.responseSelections.map(selection => {
            // Only include value, type, and invert fields
            const cleanedSelection = {};
            
            if ('value' in selection) {
                cleanedSelection.value = selection.value;
            }
            
            if ('type' in selection) {
                cleanedSelection.type = selection.type;
            }
            
            if ('invert' in selection) {
                cleanedSelection.invert = selection.invert;
            }
            
            return cleanedSelection;
        });
    }
    
    // Add any additional client options if available
    if (providerData.additionalClientOptions) {
        params.additionalClientOptions = providerData.additionalClientOptions;
    }

    let ownerPrivateKey;
    try {
        ownerPrivateKey = await getPrivateKeyFromOffscreen();
    } catch (error) {
        console.error('[CLAIM-CREATOR] Could not obtain private key:', error);
        // Fallback or re-throw, depending on how critical the key is.
        // For now, let's re-throw to make the failure visible.
        throw new Error(`Could not obtain owner private key: ${error.message}`);
    }
    
    // Create the final claim object
    const claimObject = {
        name: 'http',
        sessionId: sessionId,
        params,
        secretParams,
        ownerPrivateKey: ownerPrivateKey,
        client: {
            url: 'wss://attestor.reclaimprotocol.org/ws'
        }
    };
    
    console.log('[CLAIM-CREATOR] Claim object created successfully');
    
    return claimObject;
};