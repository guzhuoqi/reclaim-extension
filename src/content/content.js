// Import polyfills
import '../utils/polyfills';

// This script runs in the context of the web page
// import { RECLAIM_SDK_ACTIONS, MESSAGER_ACTIONS, MESSAGER_TYPES } from '../utils/constants'; // Old import
import { RECLAIM_SDK_ACTIONS, MESSAGER_ACTIONS, MESSAGER_TYPES } from '../utils/constants'; // Corrected import path assuming index.js exports them
import { createProviderVerificationPopup } from './components/ProviderVerificationPopup';
import { checkLoginStatus } from '../utils/login-monitor';

class ReclaimContentScript {
    constructor() {
      this.init();
      this.verificationPopup = null;
      this.providerName = 'Emirates';
      this.credentialType = 'Skywards';
      this.dataRequired = 'Membership Status / Tier';
    }
    
    init() {
      // Listen for messages from the background script
      console.log('[CONTENT] ReclaimContentScript initialized. Listening for messages...');
      chrome.runtime.onMessage.addListener(this.handleMessage.bind(this));
      
      // Notify background script that content script is loaded
      chrome.runtime.sendMessage({ 
        action: MESSAGER_ACTIONS.CONTENT_SCRIPT_LOADED, 
        source: MESSAGER_TYPES.CONTENT_SCRIPT,
        target: MESSAGER_TYPES.BACKGROUND,
        data: { url: window.location.href } 
      });

      // Listen for messages from the web page
      window.addEventListener('message', this.handleWindowMessage.bind(this));
    }
    
    handleMessage(message, sender, sendResponse) {
      const { action, data, source } = message;
      console.log(`[CONTENT] Received message: Action: ${action}, Source: ${source}, Data:`, data);
      
      switch (action) {
        case 'INJECT_CUSTOM_SCRIPT':
          this.injectCustomScript(data.script);
          sendResponse({ success: true });
          break;
          
        case 'EXTRACT_DOM_DATA':
          const domData = this.extractDOMData(data.selectors);
          sendResponse({ success: true, data: domData });
          break;
          
        case 'PROOF_SUBMITTED':
          // Forward proof to the page
          console.log('[CONTENT] Proof submitted, notifying page:', data);
          window.postMessage({
            action: RECLAIM_SDK_ACTIONS.VERIFICATION_COMPLETED,
            data: data.proof
          }, '*');
          sendResponse({ success: true });
          break;
          
        case MESSAGER_ACTIONS.SHOW_PROVIDER_VERIFICATION_POPUP:
          console.log('[CONTENT] SHOW_PROVIDER_VERIFICATION_POPUP message received. Data:', data);
          if (this.verificationPopup) {
            console.log('[CONTENT] Removing existing verification popup.');
            try {
                document.body.removeChild(this.verificationPopup);
            } catch (e) {
                console.warn('[CONTENT] Failed to remove old popup, it might have already been detached:', e.message);
            }
            this.verificationPopup = null;
          }
          
          this.providerName = data?.providerName || this.providerName;
          this.credentialType = data?.credentialType || this.credentialType;
          this.dataRequired = data?.dataRequired || this.dataRequired;
          // const loginConfirmSelector = data?.loginConfirmSelector; // Not used by new heuristic login monitor

          const appendPopupLogic = () => {
            if (!document.body) {
                // This case should ideally not be hit if we wait for DOMContentLoaded or readyState interactive/complete
                console.error('[CONTENT] appendPopupLogic called but document.body is still not available!');
                // Consider not calling sendResponse here if the main path already did, or manage it carefully.
                return; 
            }
            console.log(`[CONTENT] DOM ready. Creating provider verification popup with: Provider: ${this.providerName}, Credential: ${this.credentialType}, Data: ${this.dataRequired}`);
            try {
              this.verificationPopup = createProviderVerificationPopup(
                this.providerName,
                this.credentialType,
                this.dataRequired
              );
              console.log('[CONTENT] Provider verification popup element created:', this.verificationPopup);
            } catch (e) {
              console.error('[CONTENT] Error calling createProviderVerificationPopup:', e);
              // sendResponse({ success: false, error: 'Error creating popup: ' + e.message }); // Manage sendResponse carefully
              return;
            }

            console.log('[CONTENT] Appending popup to document.body.');
            try {
                document.body.appendChild(this.verificationPopup);
                console.log('[CONTENT] Popup appended. Checking visibility...');
                if (this.verificationPopup.offsetParent === null) {
                    console.warn('[CONTENT] Popup appended but offsetParent is null. It might be display:none or not in the layout.');
                } else {
                    console.log('[CONTENT] Popup appended and seems to be in layout (offsetParent is not null).');
                }
                const rect = this.verificationPopup.getBoundingClientRect();
                console.log('[CONTENT] Popup rect:', rect);
                if (rect.width === 0 || rect.height === 0) {
                    console.warn('[CONTENT] Popup has zero width or height.');
                }
            } catch (e) {
                console.error('[CONTENT] Error appending popup to document.body:', e);
                // sendResponse({ success: false, error: 'Error appending popup: ' + e.message }); // Manage sendResponse carefully
                return;
            }
            
            const verifyButton = this.verificationPopup.querySelector('#hp-verify-button');
            if (verifyButton) {
              verifyButton.addEventListener('click', this.handleVerifyClick.bind(this));
            }

            checkLoginStatus(null, 30000, 1000) // Pass null as selector is ignored
              .then(isLoggedIn => {
                if (isLoggedIn) {
                  console.log('[CONTENT] User is logged in. Enabling verify button.');
                  if (this.verificationPopup && this.verificationPopup.enableVerifyButton) {
                      this.verificationPopup.enableVerifyButton();
                  }
                } else {
                  console.log('[CONTENT] User is not logged in or login state ambiguous.');
                }
              });
            // sendResponse({ success: true, message: 'Popup displayed and login monitoring started.' }); // Called by outer scope
          };

          if (document.readyState === 'loading') {
            console.log('[CONTENT] Document is loading. Waiting for DOMContentLoaded to append popup.');
            document.addEventListener('DOMContentLoaded', () => {
                console.log('[CONTENT] DOMContentLoaded event fired. Executing appendPopupLogic.');
                appendPopupLogic();
            }, { once: true });
          } else {
            // 'interactive' or 'complete' state
            console.log(`[CONTENT] Document already in state: ${document.readyState}. Executing appendPopupLogic directly.`);
            appendPopupLogic();
          }
          
          // Send response back to background script immediately to acknowledge message receipt.
          // The actual popup display is now tied to DOM readiness.
          sendResponse({ success: true, message: 'Popup display process initiated and will proceed on DOM readiness.' });
          break; // Keep break here
          
        default:
          console.log(`[CONTENT] Unknown action received: ${action}`);
          sendResponse({ success: false, error: 'Unknown action' });
      }
      
      return true; // Keep this at the end of handleMessage if any path might call sendResponse asynchronously.
    }
    
    handleWindowMessage(event) {
      // Only accept messages from the same window
      if (event.source !== window) return;
      
      const { action, data, messageId } = event.data;
      
      // Check if the message is meant for this extension
      if (action === RECLAIM_SDK_ACTIONS.CHECK_EXTENSION) {
        // Send response back to the page
        window.postMessage({
          action: RECLAIM_SDK_ACTIONS.EXTENSION_RESPONSE,
          messageId: messageId,
          installed: true
        }, '*');
      }
      
      // Handle start verification request from SDK
      if (action === RECLAIM_SDK_ACTIONS.START_VERIFICATION && data) {
        // Forward the template data to background script
        chrome.runtime.sendMessage({
          action: MESSAGER_ACTIONS.START_VERIFICATION,
          source: MESSAGER_TYPES.CONTENT_SCRIPT,
          target: MESSAGER_TYPES.BACKGROUND,
          data: data
        }, (response) => {
            console.log('[CONTENT] Starting verification with data:', data);
          // Send confirmation back to SDK
          if (response && response.success) {
            window.postMessage({
              action: RECLAIM_SDK_ACTIONS.VERIFICATION_STARTED,
              messageId: messageId,
              sessionId: data.sessionId
            }, '*');
          } else {
            window.postMessage({
              action: RECLAIM_SDK_ACTIONS.VERIFICATION_FAILED,
              messageId: messageId,
              error: response?.error || 'Failed to start verification'
            }, '*');
          }
        });
      }
    }
    
    injectCustomScript(scriptContent) {
      try {
        // Create a Blob containing the script content
        const blob = new Blob([scriptContent], { type: 'application/javascript' });
        
        // Create a URL for the Blob
        const scriptURL = URL.createObjectURL(blob);
        
        // Create a script element with the Blob URL
        const script = document.createElement('script');
        script.src = scriptURL;
        script.onload = () => {
          // Clean up by revoking the Blob URL after the script loads
          URL.revokeObjectURL(scriptURL);
        };
        
        // Append the script to the document head
        document.head.appendChild(script);
        
        return true;
      } catch (error) {
        console.error('Error injecting script:', error);
        return false;
      }
    }
    
    extractDOMData(selectors) {
      const result = {};
      
      if (selectors && Array.isArray(selectors)) {
        selectors.forEach(selector => {
          const elements = document.querySelectorAll(selector.query);
          if (elements.length > 0) {
            if (selector.multiple) {
              result[selector.name] = Array.from(elements).map(el => 
                selector.attribute ? el.getAttribute(selector.attribute) : el.textContent.trim()
              );
            } else {
              result[selector.name] = selector.attribute ? 
                elements[0].getAttribute(selector.attribute) : 
                elements[0].textContent.trim();
            }
          }
        });
      }
      
      return result;
    }

    async handleVerifyClick() {
        if (!this.verificationPopup) return;

        this.verificationPopup.showLoader();
        this.verificationPopup.updateProgress('Creating claim...');

        try {
            const claimData = {
                provider: this.providerName.toLowerCase(),
                credentialType: this.credentialType,
                parameters: { /* Parameters specific to the claim, e.g., { tier: 'Gold' } */ },
                extractedData: { detail: `Verified ${this.dataRequired} for ${this.providerName}` }
            };

            console.log('[CONTENT] Creating claim object with data:', claimData);
            
            this.verificationPopup.updateProgress('Generating proof...');

            const proof = await this.generateProof(claimData.extractedData);

            console.log('[CONTENT] Proof generated:', proof);

            await new Promise(resolve => setTimeout(resolve, 1500)); 

            this.verificationPopup.updateProgress('Proof submitted successfully!');
            this.verificationPopup.showSuccess();

            setTimeout(() => {
                chrome.runtime.sendMessage({
                    action: MESSAGER_ACTIONS.CLOSE_CURRENT_TAB,
                    source: MESSAGER_TYPES.CONTENT_SCRIPT,
                    target: MESSAGER_TYPES.BACKGROUND
                });
            }, 3000);

        } catch (error) {
            console.error('[CONTENT] Error during verification process:', error);
            if (this.verificationPopup && this.verificationPopup.showError) {
                this.verificationPopup.showError('Verification failed. Please try again.');
            } else {
                alert('Verification failed. Please try again.'); 
                if(this.verificationPopup.disableVerifyButton) this.verificationPopup.disableVerifyButton(); 
                 const verifyButton = this.verificationPopup.querySelector('#hp-verify-button');
                 if(verifyButton) verifyButton.style.display = 'block';
                 const loader = this.verificationPopup.querySelector('#hp-loader');
                 if(loader) loader.style.display = 'none';
            }
        }
    }
  }
  
  // Initialize content script
  const contentScript = new ReclaimContentScript();