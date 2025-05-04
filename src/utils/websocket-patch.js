// A direct patch for the attestor-core ws.js module problem

(function patchAttestorCore() {
  // Find the attestor-core module in the dependency tree
  const findAttestorCorePath = () => {
    try {
      // This is a direct approach to find the module in a Chrome extension context
      const scripts = document.querySelectorAll('script');
      for (const script of scripts) {
        if (script.src && script.src.includes('background.bundle.js')) {
          return true; // We don't need the actual path, just confirmation it exists
        }
      }
    } catch (e) {
      console.log('Error finding attestor-core path:', e);
    }
    return false;
  };

  // Apply the patch if attestor-core is found
  if (findAttestorCorePath()) {
    console.log('Applying WebSocket patch for attestor-core');
    
    // Create a direct reference to the browser's WebSocket
    if (typeof window !== 'undefined' && window.WebSocket) {
      // Create a WebSocket module with the browser's WebSocket
      const wsModule = {
        WebSocket: window.WebSocket
      };
      
      // Make it globally available as 'ws'
      window.ws = wsModule;
      
      // Create a safe 'require' alternative that returns our ws module
      window.require = window.require || function(moduleName) {
        if (moduleName === 'ws') {
          return wsModule;
        }
        throw new Error(`Cannot find module '${moduleName}'`);
      };
    }
  }
})(); 