export const createClaimObject = (request, providerData) => {
    console.log('[CLAIM-CREATOR] Creating claim object from request data');
    
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
    
    // Extract dynamic parameters from URL, body, and response matches
    const paramValues = {};
    
    // Function to extract dynamic parameters of the form {{PARAM_NAME}}
    const extractDynamicParams = (text) => {
        if (!text) return [];
        const matches = text.match(/{{([^}]+)}}/g) || [];
        return matches.map(match => match.substring(2, match.length - 2));
    };
    
    // Extract dynamic params from URL
    const urlParams = extractDynamicParams(params.url);
    
    urlParams.forEach(param => {
        // Add to paramValues if not already present
        if (providerData.paramValues && providerData.paramValues[param]) {
            paramValues[param] = providerData.paramValues[param];
        }
    });
    
    // Extract dynamic params from body
    const bodyParams = extractDynamicParams(params.body);
    
    bodyParams.forEach(param => {
        // Add to paramValues if not already present
        if (providerData.paramValues && providerData.paramValues[param]) {
            paramValues[param] = providerData.paramValues[param];
        }
    });
    
    // Process response matches if available
    if (providerData.responseMatches) {
        params.responseMatches = providerData.responseMatches.map(match => {
            // Extract dynamic params from response match value
            const responseParams = extractDynamicParams(match.value);
            responseParams.forEach(param => {
                // For response params, add them to params not secretParams
                if (providerData.paramValues && providerData.paramValues[param]) {
                    paramValues[param] = providerData.paramValues[param];
                }
            });
            
            return match;
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
    
    // Add paramValues to params if any were found
    if (Object.keys(paramValues).length > 0) {
        params.paramValues = paramValues;
    }
    
    // Create the final claim object
    const claimObject = {
        name: 'http',
        params,
        secretParams,
        ownerPrivateKey: `0x1234567456789012345678901234567890123456789012345678901234567890`,
        client: {
            url: 'wss://attestor.reclaimprotocol.org/ws'
        }
    };
    
    console.log('[CLAIM-CREATOR] Claim object created successfully');
    
    return claimObject;
};