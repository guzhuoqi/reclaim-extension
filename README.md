# Reclaim Browser Extension SDK

A browser extension for the Reclaim Protocol that enables users to generate zero-knowledge proofs from their web activity for credential verification.

## Overview

The Reclaim Browser Extension serves as a bridge between web services and the Reclaim Protocol. It enables users to generate cryptographic proofs of their data from various web providers without exposing the actual data, maintaining privacy while still allowing verification.

## Features

- **Privacy-Preserving Verification**: Generate zero-knowledge proofs from your web data without exposing the actual content
- **Multi-Provider Support**: Works with multiple authentication providers including Google, GitHub, LinkedIn, and generic OAuth2 flows
- **Network Request Monitoring**: Intelligently filters and captures relevant network requests during the verification process
- **Proof Generation**: Creates cryptographic proofs using snarkjs for verification by the Reclaim Protocol
- **Background Processing**: Runs silently in the background while you interact with provider websites

## Installation

### From Source

1. Clone the repository:
   ```
   git clone https://github.com/reclaim-network/reclaim-sdk-extension.git
   ```

2. Install dependencies:
   ```
   npm install
   ```

3. Build the extension:
   ```
   npm run build
   ```

4. Load the extension in your browser:
   - Chrome: Go to `chrome://extensions/`, enable Developer mode, click "Load unpacked", and select the `build` directory
   - Firefox: Go to `about:debugging#/runtime/this-firefox`, click "Load Temporary Add-on", and select any file in the `build` directory

### Development Mode

To run the extension in development mode with hot reloading:

```
npm run dev
```

## Usage

The extension is designed to work with applications that use the Reclaim Protocol. When a Reclaim-enabled application requests verification, the extension will:

1. Open the provider's login page in a new tab
2. Monitor network requests for authentication data
3. Extract relevant fields for proof generation
4. Generate a zero-knowledge proof
5. Submit the proof back to the application

## Permissions

The extension requires the following permissions:

- `storage`: To store session data
- `webRequest`: To monitor network requests
- `activeTab`: To interact with the active tab
- `webNavigation`: To track navigation events
- `scripting`: To inject scripts when needed
- `tabs`: To manage tabs during the verification process

## Development

### Project Structure

- `/src`: Source code
  - `/background`: Background service worker scripts
  - `/content`: Content scripts injected into web pages
  - `/popup`: Extension popup UI
  - `/utils`: Utility functions and classes
  - `/lib`: Libraries and third-party code
  - `/assets`: Images and other static assets

### Polyfills for Node.js Modules

The extension uses several Node.js polyfills to support libraries like `@reclaimprotocol/attestor-core` in the browser environment. These polyfills are implemented through:

1. **Node Polyfill Webpack Plugin**: Automatically provides polyfills for Node.js core modules
2. **Custom polyfill file**: Located at `src/utils/polyfills.js`, this handles specific browser-Node.js compatibility issues
3. **Webpack resolve.fallback**: Configures specific polyfills for Node.js core modules

When adding new Node.js-dependent libraries, you may need to update the polyfill configuration in:
- webpack.config.js
- src/utils/polyfills.js

### Key Components

- **NetworkFilter**: Filters and analyzes network requests to extract verification data
- **ProofGenerator**: Generates zero-knowledge proofs using snarkjs
- **ReclaimExtensionManager**: Manages the extension's lifecycle and coordinates verification flows

## Contributing

Contributions are welcome! Please feel free to submit a Pull Request.

## License

This project is licensed under the MIT License - see the LICENSE file for details.

## Contact

For more information about Reclaim Protocol, visit [reclaimprotocol.org](https://reclaimprotocol.org) 