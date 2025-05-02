// utils/network-filter.js

export class NetworkFilter {
    constructor() {
      this.rules = [];
      this.providerRules = new Map();
      
      // Initialize with default rules
      this.initDefaultRules();
    }
    
    initDefaultRules() {
      // Load default rules for common providers
      // These could be fetched from a backend API in a production scenario
      this.providerRules.set('google-login', [
        {
          urlPattern: /accounts\.google\.com\/o\/oauth2\/token/,
          bodyPatterns: [/access_token/],
          headers: ['Authorization'],
          extractFields: ['id_token', 'access_token']
        }
      ]);
      
      // Add GitHub provider rules
      this.providerRules.set('github-login', [
        {
          urlPattern: /api\.github\.com\/user/,
          method: 'GET',
          headers: ['Authorization'],
          extractFields: ['login', 'id', 'name', 'email']
        },
        {
          urlPattern: /github\.com\/login\/oauth\/access_token/,
          method: 'POST',
          extractFields: ['access_token', 'token_type', 'scope']
        }
      ]);
      
      // Add LinkedIn provider rules
      this.providerRules.set('linkedin-login', [
        {
          urlPattern: /api\.linkedin\.com\/v2\/me/,
          headers: ['Authorization'],
          extractFields: ['id', 'localizedFirstName', 'localizedLastName']
        },
        {
          urlPattern: /linkedin\.com\/oauth\/v2\/accessToken/,
          extractFields: ['access_token', 'expires_in']
        }
      ]);
      
      // Add generic OAuth2 token rules that apply to many providers
      this.providerRules.set('oauth2-generic', [
        {
          urlPattern: /oauth2?\/token/i,
          bodyPatterns: [/token|access_token|id_token/i],
          extractFields: ['access_token', 'id_token', 'refresh_token', 'token_type', 'expires_in']
        },
        {
          urlPattern: /\/token$/i,
          extractFields: ['access_token', 'id_token', 'refresh_token']
        }
      ]);
    }
    
    getRulesForProvider(providerId) {
      return this.providerRules.get(providerId) || [];
    }
    
    setRules(rules) {
      this.rules = Array.isArray(rules) ? rules : [];
    }
    
    addRule(rule) {
      this.rules.push(rule);
    }
    
    matchRequest(requestDetails) {
      // Check if URL matches any patterns
      const { url, method } = this.normalizeRequestDetails(requestDetails);
      
      for (const rule of this.rules) {
        // Match URL pattern
        if (rule.urlPattern && !rule.urlPattern.test(url)) {
          continue;
        }
        
        // Match request method if specified
        if (rule.method && rule.method !== method) {
          continue;
        }
        
        // Match body patterns if specified
        if (rule.bodyPatterns && rule.bodyPatterns.length > 0) {
          const bodyString = this.getRequestBodyAsString(requestDetails);
          if (!bodyString) {
            continue;
          }
          
          const bodyMatches = rule.bodyPatterns.every(pattern => pattern.test(bodyString));
          if (!bodyMatches) {
            continue;
          }
        }
        
        // If we made it here, all conditions matched
        return {
          isMatch: true,
          pattern: rule,
          requestDetails
        };
      }
      
      return { isMatch: false };
    }
    
    normalizeRequestDetails(details) {
      // Handle both chrome.webRequest format and MSW interceptor format
      if (!details) return { url: '', method: 'GET' };
      
      // Check if this is from MSW interceptor (has type field)
      if (details.type === 'request' || details.type === 'response') {
        return {
          url: details.url || '',
          method: details.method || 'GET',
          headers: details.headers || {},
          body: details.body || null,
          requestId: details.requestId || '',
          isMswFormat: true
        };
      }
      
      // Otherwise, assume chrome.webRequest format
      return {
        url: details.url || '',
        method: details.method || 'GET',
        requestBody: details.requestBody,
        requestHeaders: details.requestHeaders,
        requestId: details.requestId || '',
        isMswFormat: false
      };
    }
    
    getRequestBodyAsString(details) {
      if (!details) return '';
      
      // Handle MSW format
      if (details.type === 'request' && details.body) {
        return typeof details.body === 'string' 
          ? details.body 
          : JSON.stringify(details.body);
      }
      
      // Handle response body from MSW
      if (details.type === 'response' && details.body) {
        return typeof details.body === 'string'
          ? details.body
          : JSON.stringify(details.body);
      }
      
      // Handle chrome.webRequest format
      if (details.requestBody) {
        if (details.requestBody.raw && details.requestBody.raw[0]) {
          try {
            const encoder = new TextDecoder();
            return encoder.decode(details.requestBody.raw[0].bytes);
          } catch (e) {
            return '';
          }
        } else if (details.requestBody.formData) {
          return JSON.stringify(details.requestBody.formData);
        }
      }
      
      return '';
    }
    
    extractDataFromRequest(requestDetails, pattern) {
      const normalizedRequest = this.normalizeRequestDetails(requestDetails);
      const { url, headers } = normalizedRequest;
      
      const result = {
        url,
        timestamp: Date.now(),
        extractedFields: {}
      };
      
      // Extract data based on the pattern's extractFields
      if (pattern.extractFields && Array.isArray(pattern.extractFields)) {
        // Process from URL query params
        try {
          const urlObj = new URL(url);
          pattern.extractFields.forEach(field => {
            const paramValue = urlObj.searchParams.get(field);
            if (paramValue) {
              result.extractedFields[field] = paramValue;
            }
          });
        } catch (e) {
          console.error('Error parsing URL:', e);
        }
        
        // Process from request body
        const bodyString = this.getRequestBodyAsString(requestDetails);
        if (bodyString) {
          try {
            const bodyData = JSON.parse(bodyString);
            pattern.extractFields.forEach(field => {
              if (bodyData[field] !== undefined) {
                result.extractedFields[field] = bodyData[field];
              }
            });
          } catch (e) {
            // Not JSON or error parsing
          }
        }
        
        // Process from headers if specified
        if (pattern.headers && headers) {
          // Handle MSW format headers (object)
          if (normalizedRequest.isMswFormat) {
            pattern.headers.forEach(headerName => {
              const headerKey = Object.keys(headers).find(
                key => key.toLowerCase() === headerName.toLowerCase()
              );
              if (headerKey && headers[headerKey]) {
                result.extractedFields[headerName] = headers[headerKey];
              }
            });
          } 
          // Handle chrome.webRequest format headers (array of objects)
          else if (requestDetails.requestHeaders) {
            const headerMap = new Map(
              requestDetails.requestHeaders.map(h => [h.name.toLowerCase(), h.value])
            );
            pattern.headers.forEach(headerName => {
              const value = headerMap.get(headerName.toLowerCase());
              if (value) {
                result.extractedFields[headerName] = value;
              }
            });
          }
        }
      }
      
      return result;
    }
    
    // Utility function to extract data from responses (specifically for MSW response format)
    extractDataFromResponse(responseDetails, pattern) {
      if (!responseDetails || responseDetails.type !== 'response') {
        return null;
      }
      
      const { url, headers, body, status } = responseDetails;
      
      const result = {
        url,
        status,
        timestamp: Date.now(),
        extractedFields: {}
      };
      
      // If no specific fields to extract or no body, return basic info
      if (!pattern?.extractFields || !body) {
        return result;
      }
      
      // Process body data
      if (typeof body === 'object') {
        pattern.extractFields.forEach(field => {
          if (body[field] !== undefined) {
            result.extractedFields[field] = body[field];
          }
        });
      }
      
      // Process headers
      if (pattern.headers && headers) {
        pattern.headers.forEach(headerName => {
          const headerKey = Object.keys(headers).find(
            key => key.toLowerCase() === headerName.toLowerCase()
          );
          if (headerKey && headers[headerKey]) {
            result.extractedFields[headerName] = headers[headerKey];
          }
        });
      }
      
      return result;
    }
  }