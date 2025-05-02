// utils/script-injector.js

export class ScriptInjector {
    constructor() {
      this.scriptRegistry = new Map();
      this.loadDefaultScripts();
    }
    
    loadDefaultScripts() {
      // Load default scripts for common providers
      this.scriptRegistry.set('google-login', [
        {
          name: 'Extract OAuth Tokens',
          timing: 'after-load',
          code: `
            // Monitor oauth redirects
            const originalOpen = XMLHttpRequest.prototype.open;
            XMLHttpRequest.prototype.open = function() {
              const url = arguments[1];
              if (url.includes('oauth2/token')) {
                this.addEventListener('load', function() {
                  try {
                    const response = JSON.parse(this.responseText);
                    window.postMessage({
                      type: 'RECLAIM_OAUTH_TOKEN',
                      data: response
                    }, '*');
                  } catch (e) {
                    console.error('Error parsing token response:', e);
                  }
                });
              }
              return originalOpen.apply(this, arguments);
            };
          `
        }
      ]);
      
      // Add more provider scripts as needed
    }
    
    getScriptsForProvider(providerId) {
      return this.scriptRegistry.get(providerId) || [];
    }
    
    async injectScripts(tabId, providerId) {
      const scripts = this.getScriptsForProvider(providerId);
      
      for (const script of scripts) {
        await this.injectScript(tabId, script.code);
      }
    }
    
    async injectScript(tabId, scriptCode) {
      return new Promise((resolve, reject) => {
        chrome.scripting.executeScript({
          target: { tabId },
          func: (code) => {
            try {
              const script = document.createElement('script');
              script.textContent = code;
              document.head.appendChild(script);
              return true;
            } catch (error) {
              console.error('Error injecting script:', error);
              return false;
            }
          },
          args: [scriptCode]
        }, (results) => {
          if (chrome.runtime.lastError) {
            reject(chrome.runtime.lastError);
          } else if (results && results[0] && results[0].result === true) {
            resolve(true);
          } else {
            reject(new Error('Script injection failed'));
          }
        });
      });
    }
    
    async injectCustomScript(tabId, providerId, customScript) {
      // Validate script
      if (!customScript || typeof customScript !== 'string') {
        throw new Error('Invalid script content');
      }
      
      // Inject the custom script
      return this.injectScript(tabId, customScript);
    }
  }