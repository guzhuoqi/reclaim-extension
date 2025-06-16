const fs = require('fs');
const path = require('path');
const https = require('https');

const API_URL = 'https://api.reclaimprotocol.org/api/providers/active';
const JS_SCRIPTS_DIR = path.join(__dirname, '..', 'src', 'js-scripts');

console.log('🚀 Setting up providers...');

function fetchProviders() {
  return new Promise((resolve, reject) => {
    https.get(API_URL, (res) => {
      let data = '';
      
      res.on('data', (chunk) => {
        data += chunk;
      });
      
      res.on('end', () => {
        try {
          const response = JSON.parse(data);
          resolve(response);
        } catch (error) {
          reject(new Error(`Failed to parse JSON: ${error.message}`));
        }
      });
    }).on('error', (error) => {
      reject(new Error(`HTTP request failed: ${error.message}`));
    });
  });
}

function ensureDirectoryExists(dirPath) {
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true });
    console.log(`📁 Created directory: ${dirPath}`);
  }
}

function writeInjectionFile(providerId, injectionCode) {
  const filename = `${providerId}.js`;
  const filePath = path.join(JS_SCRIPTS_DIR, filename);
  
  try {
    const fileExists = fs.existsSync(filePath);
    
    // Check if the content has changed (to avoid unnecessary updates)
    let contentChanged = true;
    if (fileExists) {
      const existingContent = fs.readFileSync(filePath, 'utf8');
      contentChanged = existingContent !== injectionCode;
    }
    
    if (!fileExists) {
      fs.writeFileSync(filePath, injectionCode, 'utf8');
      console.log(`✅ Created injection file: ${filename}`);
    } else if (contentChanged) {
      fs.writeFileSync(filePath, injectionCode, 'utf8');
      console.log(`🔄 Updated injection file: ${filename}`);
    } else {
      console.log(`⚡ No changes for: ${filename}`);
    }
    
    return true;
  } catch (error) {
    console.error(`❌ Failed to write file ${filename}:`, error.message);
    return false;
  }
}

async function setupProviders() {
  try {
    console.log('📡 Fetching providers from API...');
    const response = await fetchProviders();
    
    if (!response.isSuccess || !response.providers) {
      throw new Error('Invalid API response');
    }
    
    console.log(`📋 Found ${response.providers.length} providers`);
    
    // Ensure js-scripts directory exists
    ensureDirectoryExists(JS_SCRIPTS_DIR);
    
    let processedCount = 0;
    let createdCount = 0;
    let updatedCount = 0;
    let unchangedCount = 0;
    
    // Process each provider
    for (const provider of response.providers) {
      processedCount++;
      
      // Check if provider has custom injection
      if (provider.customInjection && provider.customInjection.trim()) {
        const filename = `${provider.httpProviderId}.js`;
        const filePath = path.join(JS_SCRIPTS_DIR, filename);
        const fileExists = fs.existsSync(filePath);
        
        let contentChanged = true;
        if (fileExists) {
          const existingContent = fs.readFileSync(filePath, 'utf8');
          contentChanged = existingContent !== provider.customInjection;
        }
        
        const success = writeInjectionFile(provider.httpProviderId, provider.customInjection);
        if (success) {
          if (!fileExists) {
            createdCount++;
          } else if (contentChanged) {
            updatedCount++;
          } else {
            unchangedCount++;
          }
        }
      } else {
        console.log(`⏭️  Skipping provider ${provider.name} (${provider.httpProviderId}) - no custom injection`);
      }
    }
    
    console.log(`\n🎉 Setup complete!`);
    console.log(`   Processed: ${processedCount} providers`);
    console.log(`   Created: ${createdCount} injection files`);
    console.log(`   Updated: ${updatedCount} injection files`);
    console.log(`   Unchanged: ${unchangedCount} injection files`);
    console.log(`   Directory: ${JS_SCRIPTS_DIR}`);
    
  } catch (error) {
    console.error('💥 Setup failed:', error.message);
    process.exit(1);
  }
}

// Run the setup
setupProviders(); 