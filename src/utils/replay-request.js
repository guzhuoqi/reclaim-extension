/**
 * Utility to replay a network request to get the response body
 */

// Cache of previously replayed requests
const replayCache = new Map();

/**
 * Simple delay function
 * @param {number} ms - Milliseconds to delay
 * @returns {Promise<void>}
 */
const delay = (ms) => new Promise(resolve => setTimeout(resolve, ms));

/**
 * Generates a cache key for a request
 * @param {Object} request - The request details
 * @returns {string} - The cache key
 */
const generateCacheKey = (request) => {
  // Create a unique identifier for this request based on its properties
  return `${request.method}:${request.url}:${request.body ? request.body.substring(0, 100) : ''}`;
};

/**
 * Replays a network request and returns the response body
 * @param {Object} request - The request details
 * @param {string} request.url - The URL to fetch
 * @param {string} request.method - The HTTP method
 * @param {Object} request.headers - Headers object
 * @param {string|FormData} request.body - Request body
 * @param {boolean} [useCache=true] - Whether to use the cache
 * @param {number} [delayMs=1000] - Delay before making the request (to avoid rate limiting)
 * @returns {Promise<{responseText: string, contentType: string}>} - The response body and content type
 */
export const replayRequest = async (request, useCache = true, delayMs = 1000) => {
  try {
    // Generate a cache key for this request
    const cacheKey = generateCacheKey(request);
    
    // Check if we've already replayed this request
    if (useCache && replayCache.has(cacheKey)) {
      console.log('[REPLAY] Using cached response for:', request.url);
      return replayCache.get(cacheKey);
    }
    
    console.log('[REPLAY] Replaying request to:', request.url);
    console.log(`[REPLAY] Waiting ${delayMs}ms before sending request to avoid rate limiting...`);
    
    // Add a delay before making the request to avoid rate limiting
    await delay(delayMs);
    
    // Build fetch options
    const options = {
      method: request.method,
      headers: {},
      // Only add body for non-GET requests
      ...(request.method !== 'GET' && request.body ? { body: request.body } : {})
    };

    // Process headers if available
    if (request.headers) {
      // Convert headers to standard format
      if (Array.isArray(request.headers)) {
        // Handle array format (like from Chrome API)
        request.headers.forEach(header => {
          if (header.name && header.value) {
            options.headers[header.name] = header.value;
          }
        });
      } else {
        // Handle object format
        options.headers = { ...request.headers };
      }
    }
    
    // Include cookies if present
    if (request.cookieStr) {
      options.headers['Cookie'] = request.cookieStr;
      console.log('[REPLAY] Including cookies in request');
    }
    
    // For better compatibility with sites that check origin
    if (!options.headers['Origin'] && request.url) {
      try {
        const urlObj = new URL(request.url);
        options.headers['Origin'] = `${urlObj.protocol}//${urlObj.host}`;
      } catch (e) {
        console.warn('[REPLAY] Could not parse URL for Origin header');
      }
    }
    
    // Make the actual fetch request
    console.log('[REPLAY] Sending request with options:', JSON.stringify({
      method: options.method,
      headerCount: Object.keys(options.headers).length,
      hasBody: !!options.body
    }));
    
    const response = await fetch(request.url, options);
    
    // Get content-type to determine how to handle the response
    const contentType = response.headers.get('content-type') || '';
    console.log('[REPLAY] Response received, status:', response.status, 'content-type:', contentType);
    
    // Check for rate limiting response (429 Too Many Requests)
    if (response.status === 429) {
      console.warn('[REPLAY] Received 429 Too Many Requests - rate limit hit');
      
      // Try with a longer delay if rate limited and not already retrying
      if (delayMs < 3000) {
        console.log('[REPLAY] Retrying with a longer delay...');
        return replayRequest(request, useCache, 3000); // Retry with 3 second delay
      }
    }
    
    let responseText = '';
    
    // Process response based on content type
    if (contentType.includes('application/json')) {
      const json = await response.json();
      responseText = JSON.stringify(json);
    } else if (contentType.includes('text') || contentType.includes('html') || contentType.includes('xml')) {
      responseText = await response.text();
    } else {
      // For other content types, try to get text representation
      try {
        const blob = await response.blob();
        responseText = await blob.text();
      } catch (e) {
        console.warn('[REPLAY] Could not convert response to text:', e);
        responseText = `[Binary content of type: ${contentType}]`;
      }
    }
    
    const result = {
      responseText,
      contentType,
      status: response.status,
      statusText: response.statusText
    };
    
    // Only cache successful responses
    if (useCache && response.status >= 200 && response.status < 300) {
      replayCache.set(cacheKey, result);
    }
    
    return result;
  } catch (error) {
    console.error('[REPLAY] Error replaying request:', error);
    throw error;
  }
}; 