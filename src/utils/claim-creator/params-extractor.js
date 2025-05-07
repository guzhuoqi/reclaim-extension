// Utility functions for parameter extraction from various sources

/**
 * Extract dynamic parameters from a string by matching {{PARAM_NAME}} patterns
 * @param {string} text - Text to extract parameters from
 * @returns {string[]} Array of parameter names without braces
 */
export const extractDynamicParamNames = (text) => {
    if (!text) return [];
    const matches = text.match(/{{([^}]+)}}/g) || [];
    return matches.map(match => match.substring(2, match.length - 2));
};

/**
 * Extract parameter values from URL using template matching
 * @param {string} urlTemplate - URL template with {{param}} placeholders
 * @param {string} actualUrl - Actual URL with values
 * @param {Object} paramValues - Object to store extracted parameter values
 * @returns {Object} Updated paramValues object
 */
export const extractParamsFromUrl = (urlTemplate, actualUrl, paramValues = {}) => {
    if (!urlTemplate || !actualUrl) return paramValues;
    
    // Convert template to regex
    const regexPattern = urlTemplate.replace(/{{([^}]+)}}/g, '([^/&?]+)');
    const regex = new RegExp(regexPattern);
    
    // Extract param names from template
    const paramNames = extractDynamicParamNames(urlTemplate);
    
    // Match actual URL against the pattern
    const match = actualUrl.match(regex);
    if (match && match.length > 1) {
        // Start from index 1 to skip the full match
        for (let i = 0; i < paramNames.length; i++) {
            if (match[i + 1]) {
                paramValues[paramNames[i]] = match[i + 1];
            }
        }
    }
    
    return paramValues;
};

/**
 * Extract parameter values from request body using template matching
 * @param {string} bodyTemplate - Body template with {{param}} placeholders
 * @param {string} actualBody - Actual request body with values
 * @param {Object} paramValues - Object to store extracted parameter values
 * @returns {Object} Updated paramValues object
 */
export const extractParamsFromBody = (bodyTemplate, actualBody, paramValues = {}) => {
    if (!bodyTemplate || !actualBody) return paramValues;
    
    // Convert template to regex by escaping special characters and replacing params
    const escapedTemplate = bodyTemplate.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const regexPattern = escapedTemplate.replace(/\\{{([^}]+)\\}}/g, '([^"&]+)');
    const regex = new RegExp(regexPattern);
    
    // Extract param names from template
    const paramNames = extractDynamicParamNames(bodyTemplate);
    
    // Match actual body against the pattern
    const match = actualBody.match(regex);
    if (match && match.length > 1) {
        // Start from index 1 to skip the full match
        for (let i = 0; i < paramNames.length; i++) {
            if (match[i + 1]) {
                paramValues[paramNames[i]] = match[i + 1];
            }
        }
    }
    
    return paramValues;
};

/**
 * Extract values from JSON response using jsonPath
 * @param {Object} jsonData - Parsed JSON response
 * @param {string} jsonPath - JSONPath expression (e.g., $.userName)
 * @returns {any} Extracted value
 */
const getValueFromJsonPath = (jsonData, jsonPath) => {
    try {
        // Simple JSONPath implementation
        if (!jsonPath.startsWith('$')) return null;
        
        const path = jsonPath.substring(2).split('.');
        let value = jsonData;
        
        for (const segment of path) {
            if (value === undefined || value === null) return null;
            value = value[segment];
        }
        
        return value;
    } catch (error) {
        console.error(`[PARAM-EXTRACTOR] Error extracting JSON value with path ${jsonPath}:`, error);
        return null;
    }
};

/**
 * Extract values from HTML response using XPath (simplified)
 * @param {string} htmlString - HTML string
 * @param {string} xPath - XPath expression
 * @returns {string|null} Extracted value
 */
const getValueFromXPath = (htmlString, xPath) => {
    // This is a simplified implementation
    // For proper XPath parsing, a library would be needed
    try {
        // Extract with regex based on the xPath pattern
        // This is a very basic implementation and won't work for all XPath expressions
        const cleanedXPath = xPath.replace(/^\/\//, '').replace(/\/@/, ' ');
        const parts = cleanedXPath.split('/');
        const element = parts[parts.length - 1];
        
        // Simple regex to find elements with content
        const regex = new RegExp(`<${element}[^>]*>(.*?)<\/${element}>`, 'i');
        const match = htmlString.match(regex);
        
        return match ? match[1] : null;
    } catch (error) {
        console.error(`[PARAM-EXTRACTOR] Error extracting HTML value with XPath ${xPath}:`, error);
        return null;
    }
};

/**
 * Extract parameter values from response text using responseMatches and responseRedactions
 * @param {string} responseText - Response body text
 * @param {Array} responseMatches - Array of response match objects
 * @param {Array} responseRedactions - Array of response redaction objects
 * @param {Object} paramValues - Object to store extracted parameter values
 * @returns {Object} Updated paramValues object
 */
export const extractParamsFromResponse = (responseText, responseMatches, responseRedactions, paramValues = {}) => {
    if (!responseText) return paramValues;
    
    try {
        // First, determine if the response is JSON or HTML
        let jsonData = null;
        const isJson = responseText.trim().startsWith('{') || responseText.trim().startsWith('[');
        
        if (isJson) {
            try {
                jsonData = JSON.parse(responseText);
            } catch (e) {
                console.warn("[PARAM-EXTRACTOR] Response looks like JSON but couldn't be parsed");
            }
        }
        
        // Process responseMatches to extract parameters
        if (responseMatches && responseMatches.length > 0) {
            responseMatches.forEach(match => {
                if (!match.value) return;
                
                // Extract param names from match value
                const paramNames = extractDynamicParamNames(match.value);
                
                if (paramNames.length === 0) return;
                
                // Find corresponding redaction for this parameter
                // Typically we'd expect one redaction per param
                paramNames.forEach(paramName => {
                    const matchingRedaction = responseRedactions?.find(redaction => {
                        // Check if this redaction is relevant for this parameter
                        // This is a simplification - may need improvement
                        const templateValue = match.value.replace(`{{${paramName}}}`, '.*');
                        const escapedTemplate = templateValue.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
                        const redactionRegexMatches = redaction.regex && new RegExp(redaction.regex).test(responseText);
                        
                        return redactionRegexMatches || 
                               (redaction.jsonPath && jsonData) || 
                               (redaction.xPath && !isJson);
                    });
                    
                    if (matchingRedaction) {
                        let extractedValue = null;
                        
                        // Try to extract using jsonPath if available and response is JSON
                        if (matchingRedaction.jsonPath && jsonData) {
                            extractedValue = getValueFromJsonPath(jsonData, matchingRedaction.jsonPath);
                        } 
                        // Try to extract using xPath if available and response is HTML
                        else if (matchingRedaction.xPath && !isJson) {
                            extractedValue = getValueFromXPath(responseText, matchingRedaction.xPath);
                        } 
                        // Fall back to regex extraction
                        else if (matchingRedaction.regex) {
                            const regexMatch = responseText.match(new RegExp(matchingRedaction.regex));
                            if (regexMatch && regexMatch.length > 1) {
                                extractedValue = regexMatch[1];
                            }
                        }
                        
                        // Store the extracted value
                        if (extractedValue !== null) {
                            paramValues[paramName] = extractedValue;
                        }
                    }
                });
            });
        }
    } catch (error) {
        console.error("[PARAM-EXTRACTOR] Error extracting params from response:", error);
    }
    
    return paramValues;
};

/**
 * Separate parameters into public and secret based on names
 * @param {Object} paramValues - All parameter values
 * @returns {Object} Object with publicParams and secretParams
 */
export const separateParams = (paramValues) => {
    const publicParams = {};
    const secretParams = {};
    
    Object.entries(paramValues || {}).forEach(([key, value]) => {
        if (key.toLowerCase().includes('secret')) {
            secretParams[key] = value;
        } else {
            publicParams[key] = value;
        }
    });
    
    return { publicParams, secretParams };
};
