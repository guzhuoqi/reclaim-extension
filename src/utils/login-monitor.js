// Utility to monitor login status on a page.

const POSITIVE_LOGIN_TEXT_KEYWORDS = [
    'logout', 'sign out', 'my account', 'my profile', 'dashboard', 
    'view profile', 'manage account', 'account settings'
];

// Common welcome greeting patterns that indicate a logged-in state
const POSITIVE_WELCOME_PATTERNS = [
    /welcome\s+\w+/i,
    /hello\s+\w+/i,
    /hi\s+\w+/i,
    /hey\s+\w+/i
];

const NEGATIVE_LOGIN_TEXT_KEYWORDS = [
    'login', 'log in', 'signin', 'sign in', 'create account', 
    'register', 'forgot password', 'need an account'
];

// Selectors for elements that strongly indicate a logged-out state
const NEGATIVE_LOGIN_ELEMENT_SELECTORS = [
    'input[type="password"]:not([autocomplete*="new-password"])', // Password fields (not for new password creation)
    'form[action*="login"]', 
    'form[id*="login"]',
    'button[type="submit"][name*="login"]',
    'a[href*="login"]',
    'a[href*="signin"]'
];

// Selectors for elements that could indicate a logged-in state (less emphasis on these, text is better)
const POSITIVE_LOGIN_ELEMENT_SELECTORS = [
    'a[href*="logout"]',
    'button[id*="logout"]',
    'a[href*="account"]',
    'a[href*="profile"]',
    'a[href*="dashboard"]'
];


/**
 * Checks if a user is logged in based on a heuristic analysis of page content.
 * This function ignores the 'selector' argument from previous versions.
 *
 * @param {string} _selector - This argument is ignored. Kept for compatibility if called by old code.
 * @param {number} timeout - Maximum time to wait (in milliseconds).
 * @param {number} interval - How often to check (in milliseconds).
 * @returns {Promise<boolean>} - True if heuristic suggests logged in, false otherwise.
 */
export async function checkLoginStatus(_selector, timeout = 15000, interval = 1000) {
    console.debug('[LoginMonitor] Starting heuristic login status check.');
    return new Promise((resolve) => {
        let elapsedTime = 0;

        const performCheck = () => {
            // 1. Check for strong negative indicators (e.g., login forms, password fields)
            for (const negSelector of NEGATIVE_LOGIN_ELEMENT_SELECTORS) {
                const elements = document.querySelectorAll(negSelector);
                for (const el of elements) {
                    if (isElementVisible(el)) {
                        console.debug(`[LoginMonitor] Negative indicator found (selector: ${negSelector}):`, el);
                        // If it's a login/signin link/button, also check its text for negative keywords
                        // to avoid false positives from "Already have an account? Login" type phrases
                        const elText = (el.textContent || el.innerText || el.value || '').toLowerCase().trim();
                        if (NEGATIVE_LOGIN_TEXT_KEYWORDS.some(keyword => elText.includes(keyword))) {
                           // If this element itself screams "login", it's a strong negative.
                           // But, we should also check if there isn't a "logout" button ALSO visible.
                           // A page might have both a "login" link in the footer and "logout" in the header.
                        } else if (el.matches('input[type="password"]')) {
                            // A visible password field is a very strong negative indicator.
                            // Let's check if there's an equally strong positive indicator.
                            if (!hasPositiveLogoutIndicator()) {
                                console.debug('[LoginMonitor] Strong negative indicator (password field) without strong positive. Resolving false.');
                                clearInterval(timer);
                                resolve(false);
                                return;
                            }
                        }
                    }
                }
            }

            // 2. Check for positive text keywords (more reliable than generic selectors)
            let positiveHints = 0;
            const allTextElements = document.querySelectorAll('a, button, span, div, p, h1, h2, h3, h4, li'); // Common text containers
            for (const el of allTextElements) {
                if (!isElementVisible(el)) continue;
                const textContent = (el.textContent || el.innerText || '').toLowerCase().trim();
                if (textContent) {
                    // Check for welcome patterns like "Welcome John" or "Hello User"
                    if (POSITIVE_WELCOME_PATTERNS.some(pattern => pattern.test(textContent))) {
                        console.debug(`[LoginMonitor] Welcome pattern found: "${textContent}"`);
                        positiveHints += 2; // Give more weight to welcome patterns
                        continue;
                    }
                    
                    if (POSITIVE_LOGIN_TEXT_KEYWORDS.some(keyword => textContent.includes(keyword))) {
                        // Ensure it's not something like "Login to see My Account"
                        if (!NEGATIVE_LOGIN_TEXT_KEYWORDS.some(negKeyword => textContent.includes(negKeyword) && textContent.indexOf(negKeyword) < textContent.indexOf(POSITIVE_LOGIN_TEXT_KEYWORDS.find(pk => textContent.includes(pk))))) {
                            console.debug(`[LoginMonitor] Positive text hint found: "${textContent}"`);
                            positiveHints++;
                        }
                    }
                }
            }

            // 3. Check for negative text keywords
            let negativeHints = 0;
            for (const el of allTextElements) {
                 if (!isElementVisible(el)) continue;
                const textContent = (el.textContent || el.innerText || '').toLowerCase().trim();
                if (textContent) {
                    if (NEGATIVE_LOGIN_TEXT_KEYWORDS.some(keyword => textContent.includes(keyword))) {
                         // Avoid flagging "You are logged out. Login again?" as purely negative if "logged out" is also present.
                        if (!POSITIVE_LOGIN_TEXT_KEYWORDS.some(posKeyword => textContent.includes(posKeyword))) {
                            console.debug(`[LoginMonitor] Negative text hint found: "${textContent}"`);
                            negativeHints++;
                        }
                    }
                }
            }
            
            // Check for welcome patterns as a strong positive indicator
            for (const el of allTextElements) {
                if (!isElementVisible(el)) continue;
                const textContent = (el.textContent || el.innerText || '').toLowerCase().trim();
                if (textContent && POSITIVE_WELCOME_PATTERNS.some(pattern => pattern.test(textContent))) {
                    console.debug(`[LoginMonitor] Strong welcome pattern found: "${textContent}". Resolving true.`);
                    clearInterval(timer);
                    resolve(true);
                    return;
                }
            }

            // Simple heuristic: if we found a "logout" or "my account" style link/button, and not an active login form
            if (hasPositiveLogoutIndicator() && !hasStrongNegativeFormIndicator()) {
                console.debug('[LoginMonitor] Heuristic: Positive logout indicator found without strong negative form. Resolving true.');
                clearInterval(timer);
                resolve(true);
                return;
            }


            // Fallback heuristic: more positive textual hints than negative ones
            if (positiveHints > 0 && positiveHints > negativeHints) {
                 if (!hasStrongNegativeFormIndicator()){ // Double check for active forms
                    console.debug(`[LoginMonitor] Heuristic: More positive text hints (${positiveHints}) than negative (${negativeHints}) and no strong negative form. Resolving true.`);
                    clearInterval(timer);
                    resolve(true);
                    return;
                 }
            }
            
            // If timeout, and still undecided, assume not logged in or state is ambiguous.
            elapsedTime += interval;
            if (elapsedTime >= timeout) {
                console.debug('[LoginMonitor] Timeout reached. No conclusive login state found. Resolving false.');
                clearInterval(timer);
                resolve(false);
            }
        };

        const timer = setInterval(performCheck, interval);
        performCheck(); // Initial check
    });
}


/**
 * Checks for a clearly visible "logout" or similar positive indicator.
 */
function hasPositiveLogoutIndicator() {
    for (const selector of POSITIVE_LOGIN_ELEMENT_SELECTORS) {
        const elements = document.querySelectorAll(selector);
        for (const el of elements) {
            if (isElementVisible(el)) {
                const text = (el.textContent || el.innerText || '').toLowerCase();
                if (POSITIVE_LOGIN_TEXT_KEYWORDS.some(k => text.includes(k))) {
                     // Ensure it's not part of a negative phrase like "login to access logout"
                    if (!NEGATIVE_LOGIN_TEXT_KEYWORDS.some(nk => text.includes(nk) && text.indexOf(nk) < text.indexOf(POSITIVE_LOGIN_TEXT_KEYWORDS.find(pk => text.includes(pk))))) {
                        console.debug(`[LoginMonitor_Util] Strong positive element found (selector: ${selector}):`, el);
                        return true;
                    }
                }
            }
        }
    }
    // Check any visible element for positive keywords
    const allElements = document.querySelectorAll('a, button, span');
    for (const el of allElements) {
        if (isElementVisible(el)) {
            const text = (el.textContent || el.innerText || '').toLowerCase();
            if (POSITIVE_LOGIN_TEXT_KEYWORDS.some(k => text.includes(k))) {
                if (!NEGATIVE_LOGIN_TEXT_KEYWORDS.some(nk => text.includes(nk) && text.indexOf(nk) < text.indexOf(POSITIVE_LOGIN_TEXT_KEYWORDS.find(pk => text.includes(pk))))) {
                     console.debug(`[LoginMonitor_Util] Strong positive text found in element:`, el);
                    return true;
                }
            }
            
            // Check for welcome patterns as a strong positive indicator
            if (POSITIVE_WELCOME_PATTERNS.some(pattern => pattern.test(text))) {
                console.debug(`[LoginMonitor_Util] Welcome pattern found in element: "${text}"`, el);
                return true;
            }
        }
    }
    return false;
}

/**
 * Checks for a clearly visible login form or password input.
 */
function hasStrongNegativeFormIndicator() {
    for (const negSelector of NEGATIVE_LOGIN_ELEMENT_SELECTORS) {
        const elements = document.querySelectorAll(negSelector);
        for (const el of elements) {
            if (isElementVisible(el)) {
                // If it's an input password field, it's a strong negative
                if (el.matches('input[type="password"]:not([autocomplete*="new-password"])')) {
                     console.debug(`[LoginMonitor_Util] Strong negative element (password input) found:`, el);
                    return true;
                }
                // If it's a form or a button/link with typical login text
                const elText = (el.textContent || el.innerText || el.value || '').toLowerCase().trim();
                if (NEGATIVE_LOGIN_TEXT_KEYWORDS.some(keyword => elText.includes(keyword))) {
                    console.debug(`[LoginMonitor_Util] Strong negative element (form/button/link with text: "${elText}") found:`, el);
                    return true;
                }
            }
        }
    }
    return false;
}


/**
 * Helper function to check if an element is visible.
 * (Basic check, can be expanded for more sophisticated visibility checks)
 * @param {Element} el
 * @returns {boolean}
 */
function isElementVisible(el) {
    if (!el) return false;
    // Check for a few common ways an element might be hidden
    const style = window.getComputedStyle(el);
    if (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0') {
        return false;
    }
    if (el.offsetParent === null && el.tagName !== 'BODY') { // Elements not in the layout tree (unless it's body)
         // This check can be tricky, as elements can be position:fixed and still be visible
         // For now, if it's not display:none etc., and has size, consider it potentially visible
    }
    return el.offsetWidth > 0 || el.offsetHeight > 0 || el.getClientRects().length > 0;
}


/**
 * A more advanced login check that can use a custom function.
 * This allows for more complex login detection logic, e.g., checking for multiple elements
 * or specific text content.
 *
 * @param {function} checkFunction - A function that returns true if logged in, false otherwise.
 * @param {number} timeout - Maximum time to wait (in milliseconds).
 * @param {number} interval - How often to check (in milliseconds).
 * @returns {Promise<boolean>} - True if the condition is met, false otherwise.
 */
export async function monitorLoginState(checkFunction, timeout = 15000, interval = 1000) {
    console.debug('[LoginMonitor] Starting custom login state monitoring.');
    return new Promise((resolve) => {
        let elapsedTime = 0;
        const timer = setInterval(() => {
            try {
                if (checkFunction()) {
                    console.debug('[LoginMonitor] Custom checkFunction returned true.');
                    clearInterval(timer);
                    resolve(true);
                } else {
                    elapsedTime += interval;
                    if (elapsedTime >= timeout) {
                        console.debug('[LoginMonitor] Custom checkFunction timed out or consistently returned false.');
                        clearInterval(timer);
                        resolve(false);
                    }
                }
            } catch (e) {
                console.error('[LoginMonitor] Error in custom checkFunction:', e);
                elapsedTime += interval;
                if (elapsedTime >= timeout) {
                    clearInterval(timer);
                    resolve(false); // Resolve false on error after timeout
                }
            }
        }, interval);
    });
}

// Example usage (for testing - this would typically be used in a content script):
/*
async function exampleUsage() {
    console.log("Attempting heuristic login check...");
    const isLoggedInHeuristic = await checkLoginStatus(null, 10000, 500);
    if (isLoggedInHeuristic) {
        console.log('User is likely LOGGED IN (heuristic check)!');
    } else {
        console.log('User is likely LOGGED OUT or state is ambiguous (heuristic check).');
    }

    // Example 2: Custom check function (if heuristic is not enough)
    // const isLoggedInAdvanced = await monitorLoginState(() => {
    //     const welcomeMessage = document.querySelector('.welcome-user');
    //     const logoutButton = document.querySelector('a[href*="logout"]');
    //     return welcomeMessage && welcomeMessage.textContent.includes('Welcome') && logoutButton && isElementVisible(logoutButton);
    // }, 5000, 500);

    // if (isLoggedInAdvanced) {
    //     console.log('User is logged in (advanced check)!');
    // } else {
    //     console.log('User is not logged in or conditions not met (advanced check).');
    // }
}

// To test, you would call exampleUsage() in a context where document is available.
// e.g. in the browser console on a test page, or by uncommenting and running in content script.
// setTimeout(exampleUsage, 2000); // Example of how to run it after page load
*/ 