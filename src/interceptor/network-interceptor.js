/* eslint-disable @typescript-eslint/no-this-alias */

(function () {
    const injectionFunction = function () {

        /**
         * Debug utility for consistent logging across the interceptor
         * @type {Object}
         */
        const debug = {
            log: (...args) => console.log("🔍 [Debug]:", ...args),
            error: (...args) => console.error("❌ [Error]:", ...args),
            info: (...args) => console.info("ℹ️ [Info]:", ...args),
        };

        /**
         * RequestInterceptor class
         * Provides middleware-based interception for both Fetch and XMLHttpRequest
         * Allows monitoring and modification of HTTP requests and responses
         */
        class RequestInterceptor {
            /**
             * Initialize the interceptor with empty middleware arrays and store original methods
             */
            constructor() {
                this.requestMiddlewares = [];
                this.responseMiddlewares = [];

                // Store original methods before overriding
                this.originalFetch = window.fetch?.bind(window);
                this.originalXHR = window.XMLHttpRequest;

                // Verify browser environment and required APIs
                if (
                    typeof window === "undefined" ||
                    !this.originalFetch ||
                    !this.originalXHR
                ) {
                    debug.error(
                        "Not in a browser environment or required APIs not available"
                    );
                    return;
                }

                this.setupInterceptor();
                debug.info("RequestInterceptor initialized");
            }

            /**
             * Process all request middlewares in parallel
             * @param {Object} requestData - Contains url and options for the request
             * @returns {Promise} - Resolves when all middlewares complete
             */
            async processRequestMiddlewares(requestData) {
                try {
                    // Run all request middlewares in parallel
                    await Promise.all(
                        this.requestMiddlewares.map((middleware) => middleware(requestData))
                    );
                } catch (error) {
                    debug.error("Error in request middleware:", error);
                }
            }

            /**
             * Process response middlewares without blocking the main thread
             * @param {Response} response - The response object
             * @param {Object} requestData - The original request data
             */
            async processResponseMiddlewares(response, requestData) {
                const parsedResponse = await this.parseResponse(response);

                for (const middleware of this.responseMiddlewares) {
                    try {
                        await middleware(parsedResponse, requestData);
                    } catch (error) {
                        debug.error("Error in response middleware:", error);
                    }
                }
            }

            /**
             * Parse response data into a consistent string format
             * @param {Response} response - The response object to parse
             * @returns {Object} - Parsed response with standardized format
             */
            async parseResponse(response) {
                const clone = response.clone();
                let responseBody;

                try {
                    responseBody = await clone.text();
                } catch (error) {
                    debug.error("Error parsing response:", error);
                    responseBody = "Could not read response body";
                }

                return {
                    url: response.url,
                    status: response.status,
                    statusText: response.statusText,
                    headers: Object.fromEntries(response.headers.entries()),
                    body: responseBody,
                    originalResponse: response,
                };
            }

            /**
             * Set up interception for both Fetch and XMLHttpRequest
             * This method overrides the global fetch and XMLHttpRequest objects
             */
            setupInterceptor() {
                // Setup Fetch interceptor
                const originalFetch = this.originalFetch;
                window.fetch = async (url, options = {}) => {
                    if (!url) {
                        return originalFetch.call(window, url, options);
                    }

                    const requestData = {
                        url,
                        options: {
                            ...options,
                            method: options.method || "GET",
                            headers: options.headers || {},
                        },
                    };

                    try {
                        // Ensure all request middlewares complete before making the request
                        await Promise.all(
                            this.requestMiddlewares.map((middleware) => middleware(requestData))
                        );
                    } catch (error) {
                        debug.error("Error in request middleware:", error);
                        // If request middleware fails, proceed with original request
                    }

                    const response = await originalFetch(
                        requestData.url,
                        requestData.options
                    );

                    // Process response middlewares in the background without blocking
                    this.processResponseMiddlewares(response.clone(), requestData).catch(
                        (error) => {
                            debug.error("Error in response middleware:", error);
                        }
                    );

                    return response;
                };

                // Setup XHR interceptor
                const self = this;
                window.XMLHttpRequest = function () {
                    const xhr = new self.originalXHR();
                    const originalOpen = xhr.open;
                    const originalSend = xhr.send;
                    const originalSetRequestHeader = xhr.setRequestHeader;
                    let requestInfo = {
                        url: "",
                        options: {
                            method: "GET",
                            headers: {},
                            body: null,
                        },
                    };

                    // Intercept and store request URL and method
                    xhr.open = function (...args) {
                        const [method = "GET", url = ""] = args;
                        requestInfo.url = url;
                        requestInfo.options.method = method;
                        return originalOpen.apply(xhr, args);
                    };

                    // Intercept and store request headers
                    xhr.setRequestHeader = function (header, value) {
                        if (header && value) {
                            requestInfo.options.headers[header] = value;
                        }
                        return originalSetRequestHeader.apply(xhr, arguments);
                    };

                    // Intercept send method to process request and response
                    xhr.send = function (data) {
                        requestInfo.options.body = data;

                        // Create a promise to handle request middlewares
                        const runRequestMiddlewares = async () => {
                            try {
                                // Ensure all request middlewares complete
                                await Promise.all(
                                    self.requestMiddlewares.map((middleware) =>
                                        middleware(requestInfo)
                                    )
                                );
                            } catch (error) {
                                debug.error("Error in request middleware:", error);
                                // If request middleware fails, proceed with original request
                            }
                        };

                        // Store the original onreadystatechange
                        const originalHandler = xhr.onreadystatechange;

                        xhr.onreadystatechange = function (event) {
                            // Call original handler first
                            if (typeof originalHandler === "function") {
                                originalHandler.apply(xhr, arguments);
                            }

                            if (xhr.readyState === 4) {
                                const status = xhr.status || 500;
                                const statusText = xhr.statusText || "Request Failed";

                                try {
                                    /**
                                     * Helper function to convert any response type to string
                                     * @param {*} response - The XHR response which could be:
                                     * - string (for responseType '' or 'text')
                                     * - object (for responseType 'json')
                                     * - Blob (for responseType 'blob')
                                     * - ArrayBuffer (for responseType 'arraybuffer')
                                     * - Document (for responseType 'document')
                                     * @returns {string} The response as a string
                                     */
                                    const getResponseString = (response) => {
                                        if (response === null || response === undefined) {
                                            return "";
                                        }

                                        // Handle different response types
                                        switch (typeof response) {
                                            case "string":
                                                return response;
                                            case "object":
                                                // Handle special response types
                                                if (
                                                    response instanceof Blob ||
                                                    response instanceof ArrayBuffer
                                                ) {
                                                    return "[Binary Data]";
                                                }
                                                if (response instanceof Document) {
                                                    return response.documentElement.outerHTML;
                                                }
                                                // For plain objects or arrays
                                                try {
                                                    return JSON.stringify(response);
                                                } catch (e) {
                                                    debug.error("Failed to stringify object response:", e);
                                                    return String(response);
                                                }
                                            default:
                                                return String(response);
                                        }
                                    };

                                    const response = new Response(getResponseString(xhr.response), {
                                        status: status,
                                        statusText: statusText,
                                        headers: new Headers(
                                            Object.fromEntries(
                                                (xhr.getAllResponseHeaders() || "")
                                                    .split("\r\n")
                                                    .filter(Boolean)
                                                    .map((line) => line.split(": "))
                                            )
                                        ),
                                    });

                                    Object.defineProperty(response, "url", {
                                        value: requestInfo.url,
                                        writable: false,
                                    });

                                    // Process response middlewares in the background without blocking
                                    self
                                        .processResponseMiddlewares(response, requestInfo)
                                        .catch((error) => {
                                            debug.error("Error in response middleware:", error);
                                        });
                                } catch (error) {
                                    debug.error("Error processing XHR response:", error);
                                }
                            }
                        };

                        // Run request middlewares and then send the request
                        runRequestMiddlewares().then(() => {
                            originalSend.call(xhr, requestInfo.options.body);
                        });
                    };

                    return xhr;
                };
            }

            /**
             * Add a middleware function to process requests before they are sent
             * @param {Function} middleware - Function to process request data
             */
            addRequestMiddleware(middleware) {
                if (typeof middleware === "function") {
                    this.requestMiddlewares.push(middleware);
                }
            }

            /**
             * Add a middleware function to process responses after they are received
             * @param {Function} middleware - Function to process response data
             */
            addResponseMiddleware(middleware) {
                if (typeof middleware === "function") {
                    this.responseMiddlewares.push(middleware);
                }
            }
        }

        // Create instance of the interceptor
        const interceptor = new RequestInterceptor();

        // Request middleware for capturing and sending requests to content script
        interceptor.addRequestMiddleware(async (request) => {
            // debug.info("Request:", {
            //     url: request.url,
            //     method: request.options.method,
            //     headers: request.options.headers,
            // });
            
            // Create a completely new object with only primitive values
            try {
                // Safely extract headers as a plain object
                let headersObj = {};
                try {
                    if (request.options.headers) {
                        if (request.options.headers instanceof Headers) {
                            headersObj = Object.fromEntries(request.options.headers.entries());
                        } else if (typeof request.options.headers === 'object') {
                            // Only copy string values from headers
                            Object.keys(request.options.headers).forEach(key => {
                                const val = request.options.headers[key];
                                if (typeof val === 'string' || typeof val === 'number') {
                                    headersObj[key] = String(val);
                                }
                            });
                        }
                    }
                } catch (e) {
                    debug.error("Error extracting headers:", e);
                }
                
                // Safely extract body
                let bodyStr = null;
                try {
                    if (request.options.body) {
                        if (typeof request.options.body === 'string') {
                            bodyStr = request.options.body;
                        } else if (typeof request.options.body === 'object') {
                            bodyStr = JSON.stringify(request.options.body);
                        }
                    }
                } catch (e) {
                    debug.error("Error extracting body:", e);
                }
                
                // Create a simple, serializable object
                const simpleRequest = {
                    url: typeof request.url === 'string' ? 
                        (request.url.startsWith('http') ? request.url : new URL(request.url, window.location.origin).href) : 
                        (String(request.url).startsWith('http') ? String(request.url) : new URL(String(request.url), window.location.origin).href),
                    method: typeof request.options.method === 'string' ? request.options.method : 'GET',
                    headers: headersObj,
                    body: bodyStr
                };
                
                // Send the simplified request data
                window.postMessage({
                    action: 'INTERCEPTED_REQUEST',
                    data: simpleRequest
                }, '*');
            } catch (error) {
                debug.error("Error posting request data:", error);
                // Send minimal data as fallback
                window.postMessage({
                    action: 'INTERCEPTED_REQUEST',
                    data: {
                        url: typeof request.url === 'string' ? 
                            (request.url.startsWith('http') ? request.url : new URL(request.url, window.location.origin).href) : 
                            (String(request.url).startsWith('http') ? String(request.url) : new URL(String(request.url), window.location.origin).href),
                        method: typeof request.options.method === 'string' ? request.options.method : 'GET',
                        headers: {},
                        body: null
                    }
                }, '*');
            }
        });

        // Response middleware for capturing and sending responses to content script
        interceptor.addResponseMiddleware(async (response, request) => {
            // debug.info("Response:", {
            //     url: request.url,
            //     status: response.status,
            //     body: response.body,
            // });


            // Create a completely new object with only primitive values
            try {
                // Safely extract headers as a plain object
                let headersObj = {};
                try {
                    if (response.headers) {
                        if (response.headers instanceof Headers) {
                            headersObj = Object.fromEntries(response.headers.entries());
                        } else if (typeof response.headers === 'object') {
                            // Only copy string values from headers
                            Object.keys(response.headers).forEach(key => {
                                const val = response.headers[key];
                                if (typeof val === 'string' || typeof val === 'number') {
                                    headersObj[key] = String(val);
                                }
                            });
                        }
                    }
                } catch (e) {
                    debug.error("Error extracting headers:", e);
                }

                // Safely extract body
                let bodyStr = null;
                try {
                    if (response.body) {
                        if (typeof response.body === 'string') {
                            bodyStr = response.body;
                        } else if (typeof response.body === 'object') {
                            bodyStr = JSON.stringify(response.body);
                        }
                    }
                } catch (e) {
                    debug.error("Error extracting body:", e);
                }

                // Create a simple, serializable object
                const simpleResponse = {
                    url: typeof request.url === 'string' ? 
                        (request.url.startsWith('http') ? request.url : new URL(request.url, window.location.origin).href) : 
                        (String(request.url).startsWith('http') ? String(request.url) : new URL(String(request.url), window.location.origin).href),
                    status: response.status,
                    headers: headersObj,
                    body: bodyStr
                };

                // Send the simplified response data
                window.postMessage({
                    action: 'INTERCEPTED_RESPONSE',
                    data: simpleResponse
                }, '*');
            } catch (error) {
                debug.error("Error posting response data:", error);
                // Send minimal data as fallback
                window.postMessage({
                    action: 'INTERCEPTED_RESPONSE',
                    data: {
                        url: typeof request.url === 'string' ? 
                            (request.url.startsWith('http') ? request.url : new URL(request.url, window.location.origin).href) : 
                            (String(request.url).startsWith('http') ? String(request.url) : new URL(String(request.url), window.location.origin).href),
                        status: response.status,
                        headers: {},
                        body: null
                    }
                }, '*');
            }
        });


        /**
         * Expose the interceptor instance globally
         * This allows adding more middlewares from other scripts or the console
         *
         * Usage examples:
         *
         * // Add a request middleware
         * window.reclaimInterceptor.addRequestMiddleware(async (request) => {
         *   console.log('New request:', request.url);
         * });
         *
         * // Add a response middleware
         * window.reclaimInterceptor.addResponseMiddleware(async (response, request) => {
         *   console.log('New response:', response.body);
         * });
         */
        window.reclaimInterceptor = interceptor;

        debug.info(
            "Userscript initialized and ready - Access via window.reclaimInterceptor"
        );
    }
    injectionFunction();
})();