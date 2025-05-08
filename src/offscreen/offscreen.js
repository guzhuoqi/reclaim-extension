// Import necessary utilities and interfaces
import '../utils/polyfills';
import { MESSAGER_ACTIONS, MESSAGER_TYPES, RECLAIM_SESSION_STATUS } from '../utils/constants';
import { createClaimOnAttestor } from '@reclaimprotocol/attestor-core';
// Import our specialized WebSocket implementation for offscreen document
import { WebSocket } from '../utils/offscreen-websocket';
import { updateSessionStatus } from '../utils/fetch-calls'

// Preload p-queue to prevent dynamic chunk loading issues
import PQueue from 'p-queue';

// Ensure WebAssembly is available
if (typeof WebAssembly === 'undefined') {
  console.error('[OFFSCREEN] WebAssembly is not available in this browser context');
}

// Set WASM path to the extension's public path
if (typeof global !== 'undefined') {
  global.WASM_PATH = chrome.runtime.getURL('');
}

// Set appropriate COOP/COEP headers for SharedArrayBuffer support
const metaCSP = document.createElement('meta');
metaCSP.httpEquiv = 'Cross-Origin-Embedder-Policy';
metaCSP.content = 'require-corp';
document.head.appendChild(metaCSP);

const metaCOOP = document.createElement('meta');
metaCOOP.httpEquiv = 'Cross-Origin-Opener-Policy';
metaCOOP.content = 'same-origin';
document.head.appendChild(metaCOOP);

// Ensure WebSocket is globally available in the offscreen context
window.WebSocket = WebSocket;

class OffscreenProofGenerator {
  constructor() {
    this.init();
  }

  init() {
    console.log('[OFFSCREEN] Initializing offscreen document');

    // Set up message listeners
    chrome.runtime.onMessage.addListener(this.handleMessage.bind(this));

    // Notify background script that offscreen document is ready
    this.sendReadySignal();
  }

  sendReadySignal() {
    console.log('[OFFSCREEN] Sending ready signal to background script');
    chrome.runtime.sendMessage({
      action: MESSAGER_ACTIONS.OFFSCREEN_DOCUMENT_READY,
      source: MESSAGER_TYPES.OFFSCREEN,
      target: MESSAGER_TYPES.BACKGROUND
    });
  }

  handleMessage(message, sender, sendResponse) {
    const { action, source, target, data } = message;

    // Only process messages targeted at offscreen document
    if (target !== MESSAGER_TYPES.OFFSCREEN) return;

    console.log('[OFFSCREEN] Received message:', action, 'from', source);

    switch (action) {
      case 'PING_OFFSCREEN':
        // Respond to ping by sending ready signal
        this.sendReadySignal();
        sendResponse({ success: true });
        break;

      case MESSAGER_ACTIONS.GENERATE_PROOF:
        // Handle proof generation using createClaimOnAttestor
        this.generateProof(data)
          .then(proof => {
            console.log('[OFFSCREEN] Proof generated successfully');
            chrome.runtime.sendMessage({
              action: MESSAGER_ACTIONS.GENERATE_PROOF_RESPONSE,
              source: MESSAGER_TYPES.OFFSCREEN,
              target: MESSAGER_TYPES.BACKGROUND,
              success: true,
              proof
            });
          })
          .catch(error => {
            console.error('[OFFSCREEN] Error generating proof:', error);
            chrome.runtime.sendMessage({
              action: MESSAGER_ACTIONS.GENERATE_PROOF_RESPONSE,
              source: MESSAGER_TYPES.OFFSCREEN,
              target: MESSAGER_TYPES.BACKGROUND,
              success: false,
              error: error.message || 'Unknown error in proof generation'
            });
          });

        // Respond immediately to keep the message channel open
        sendResponse({ received: true });
        break;

      case MESSAGER_ACTIONS.GET_PRIVATE_KEY:
        try {
          const randomBytes = window.crypto.getRandomValues(new Uint8Array(32));
          const privateKey = '0x' + Array.from(randomBytes).map(b => b.toString(16).padStart(2, '0')).join('');
          
          chrome.runtime.sendMessage({
            action: MESSAGER_ACTIONS.GET_PRIVATE_KEY_RESPONSE,
            source: MESSAGER_TYPES.OFFSCREEN,
            target: source, // Send back to the original requester
            success: true,
            privateKey: privateKey
          });
          sendResponse({ success: true, received: true }); // Acknowledge message handling
        } catch (error) {
          console.error('[OFFSCREEN] Error generating private key:', error);
          // Send error response back to caller
          chrome.runtime.sendMessage({
            action: MESSAGER_ACTIONS.GET_PRIVATE_KEY_RESPONSE,
            source: MESSAGER_TYPES.OFFSCREEN,
            target: source,
            success: false,
            error: error.message || 'Unknown error generating private key'
          });
          sendResponse({ success: false, error: error.message }); // Acknowledge with error
        }
        break; // Important to break here

      default:
        console.log('[OFFSCREEN] Unknown action:', action);
        sendResponse({ success: false, error: 'Unknown action' });
    }

    return true; // Keep the message channel open for async response
  }

  async generateProof(claimData) {
    // if (!claimData) {
    //   throw new Error('No claim data provided for proof generation');
    // }
    // extract sessionId from claimData
    // const sessionId = claimData.sessionId;
    // remove sessionId from claimData
    // delete claimData.sessionId;

    const sessionId = "d0208a52b8";

    const claimDataTest = {
      "name": "http",
      "params": {
        "url": "https://www.kaggle.com/api/i/users.UsersService/GetCurrentUser",
        "method": "POST",
        "headers": {
          "sec-ch-ua": "\"Chromium\";v=\"136\", \"Google Chrome\";v=\"136\", \"Not.A/Brand\";v=\"99\"",
          "sec-ch-ua-mobile": "?0",
          "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/136.0.0.0 Safari/537.36",
          "accept": "application/json"
        },
        "body": "{\"includeGroups\":false,\"includeLogins\":false,\"includeVerificationStatus\":true}",
        "paramValues": {
          "username": "providerreclaim"
        },
        "responseMatches": [
          {
            "value": "\"userName\":\"{{username}}\"",
            "type": "contains",
            "invert": false
          }
        ],
        "responseRedactions": [
          {
            "jsonPath": "$.userName",
            "regex": "\"userName\":\"(.*)\""
          }
        ]
      },
      "secretParams": {
        "headers": {
          "sec-ch-ua-platform": "\"macOS\"",
          "x-xsrf-token": "CfDJ8KvMat0eHzhGoPokVBGB7D07t2JeXGqc6KZjg0Zew8_IQj-rU5s84yitRYG7Ewvx37-omtd9iULgQUFtezENS5HwianhfVomQWEyXib5CXqZBZd1XxUWm3PoyQ0CU0VKoceyqXZkGrZ_dTkh_ik9yZY",
          "x-kaggle-build-version": "e9d43b45affe2bd2d0a835c6822f66cb286cee22",
          "content-type": "application/json"
        },
        "cookieStr": "ACCEPTED_COOKIES=true; ka_sessionid=79120ad542d3ceb14fa2d3e0e5e31ede; __Host-KAGGLEID=CfDJ8HYJ4SW6YXhJj8CRciRldeRd6AxFXqXT0AKo4eUZslSWknzFMxvDrvxet3LI2ZFqZpzL2UkzHilhmolXHYoAiewKk-Bl90mAcSv70sEc5LkgVmYBKRHbDq31; CSRF-TOKEN=CfDJ8KvMat0eHzhGoPokVBGB7D1t3xozVQiO5HvaSaZFTwPRKUvR_ZJyLVxqJZCnSbuUB4wSURjkDNuDXbL_-Hxbt75HXqt6WBbkMG2zg5ICPQ; GCLB=CMeTlLrN8NjR2AEQAw; build-hash=e9d43b45affe2bd2d0a835c6822f66cb286cee22; XSRF-TOKEN=CfDJ8KvMat0eHzhGoPokVBGB7D07t2JeXGqc6KZjg0Zew8_IQj-rU5s84yitRYG7Ewvx37-omtd9iULgQUFtezENS5HwianhfVomQWEyXib5CXqZBZd1XxUWm3PoyQ0CU0VKoceyqXZkGrZ_dTkh_ik9yZY; CLIENT-TOKEN=eyJhbGciOiJub25lIiwidHlwIjoiSldUIn0.eyJpc3MiOiJrYWdnbGUiLCJhdWQiOiJjbGllbnQiLCJzdWIiOiJwcm92aWRlcnJlY2xhaW0iLCJuYnQiOiIyMDI1LTA1LTA3VDEyOjMzOjQ3Ljg5MDgzMDBaIiwiaWF0IjoiMjAyNS0wNS0wN1QxMjozMzo0Ny44OTA4MzAwWiIsImp0aSI6IjVjYjVmN2Y2LWEzZGQtNDBhOC04MWYzLTA1ZWIxZTFkMGEwNyIsImV4cCI6IjIwMjUtMDYtMDdUMTI6MzM6NDcuODkwODMwMFoiLCJ1aWQiOjE2OTM1MjM5LCJkaXNwbGF5TmFtZSI6IlByb3ZpZGVyIFJlY2xhaW0iLCJlbWFpbCI6InByb3ZpZGVyc0BjcmVhdG9yb3MuY28iLCJ0aWVyIjoibm92aWNlIiwidmVyaWZpZWQiOmZhbHNlLCJwcm9maWxlVXJsIjoiL3Byb3ZpZGVycmVjbGFpbSIsInRodW1ibmFpbFVybCI6Imh0dHBzOi8vc3RvcmFnZS5nb29nbGVhcGlzLmNvbS9rYWdnbGUtYXZhdGFycy90aHVtYm5haWxzL2RlZmF1bHQtdGh1bWIucG5nIiwiZmYiOlsiQmF0Y2hJbXBvcnRLZXJuZWxzRnJvbUNvbGFiIiwiQ29tcGV0aXRpb25TaW11bGF0aW9uU2V0dGluZ3MiLCJLZXJuZWxzSW1wb3J0Tm90ZWJvb2tzIiwiQ29weU1vZGVsSW5zdGFuY2VWZXJzaW9uIiwiSGFja2F0aG9uQ29tcGV0aXRpb25zIiwiS2VybmVsc09wZW5JbkNvbGFiTG9jYWxVcmwiLCJNZXRhc3RvcmVDaGVja0FnZ3JlZ2F0ZUZpbGVIYXNoZXMiLCJCYWRnZXMiLCJVc2VyTGljZW5zZUFncmVlbWVudFN0YWxlbmVzc1RyYWNraW5nIiwiV3JpdGVVcHMiLCJBZG1pbk9ubHlPcmdhbml6YXRpb25DcmVhdGlvbiIsIk5ld09yZ2FuaXphdGlvblJlcXVlc3RGb3JtIiwiR3JvdXBzIiwiR3JvdXBzSW50ZWdyYXRpb24iLCJFbmFibGVTcG90bGlnaHRDb21tdW5pdHlDb21wZXRpdGlvbnNTaGVsZiIsIktlcm5lbHNQYXlUb1NjYWxlIiwiS2VybmVsc1ByaXZhdGVQYWNrYWdlTWFuYWdlciIsIk5ld0FuZEV4Y2l0aW5nIiwiQWlEZXZlbG9wZXJXb3Jrc3BhY2VzIiwiTG9jYXRpb25TaGFyaW5nT3B0T3V0IiwiRGF0YXNldHNQYXJxdWV0U3VwcG9ydCIsIkZlYXR1cmVkTW9kZWxzU2hlbGYiLCJEYXRhc2V0UG9sYXJzRGF0YUxvYWRlciIsIktlcm5lbHNGaXJlYmFzZUxvbmdQb2xsaW5nIiwiS2VybmVsc0RyYWZ0VXBsb2FkQmxvYiIsIktlcm5lbHNTYXZlQ2VsbE91dHB1dCIsIkZyb250ZW5kRXJyb3JSZXBvcnRpbmciLCJBbGxvd0ZvcnVtQXR0YWNobWVudHMiLCJUZXJtc09mU2VydmljZUJhbm5lciIsIlJlZ2lzdHJhdGlvbk5ld3NFbWFpbFNpZ251cElzT3B0T3V0IiwiRGF0YXNldFVwbG9hZGVyRHVwbGljYXRlRGV0ZWN0aW9uIl0sImZmZCI6eyJNb2RlbElkc0FsbG93SW5mZXJlbmNlIjoiIiwiTW9kZWxJbmZlcmVuY2VQYXJhbWV0ZXJzIjoieyBcIm1heF90b2tlbnNcIjogMTI4LCBcInRlbXBlcmF0dXJlXCI6IDAuNCwgXCJ0b3Bfa1wiOiA1IH0iLCJTcG90bGlnaHRDb21tdW5pdHlDb21wZXRpdGlvbiI6IjkxMTk2LDkxNDUxLDkxNDQ4LDg5ODUwLDg4NjEyLDk0Njg5LDk3NTY5LDk4NDUwIiwiU3RzTWluRmlsZXMiOiI3NTAwMCIsIlN0c01pbkdiIjoiMSIsIkdldHRpbmdTdGFydGVkQ29tcGV0aXRpb25zIjoiMzEzNiw1NDA3LDg2NTE4LDM0Mzc3IiwiQ2xpZW50UnBjUmF0ZUxpbWl0UXBzIjoiNDAiLCJDbGllbnRScGNSYXRlTGltaXRRcG0iOiI1MDAiLCJBZGRGZWF0dXJlRmxhZ3NUb1BhZ2VMb2FkVGFnIjoiZGlzYWJsZWQiLCJLZXJuZWxFZGl0b3JBdXRvc2F2ZVRocm90dGxlTXMiOiIzMDAwMCIsIktlcm5lbHNMNEdwdUNvbXBzIjoiODYwMjMsODQ3OTUsODg5MjUsOTE0OTYiLCJGZWF0dXJlZENvbW11bml0eUNvbXBldGl0aW9ucyI6IjYwMDk1LDU0MDAwLDU3MTYzLDgwODc0LDgxNzg2LDgxNzA0LDgyNjExLDg1MjEwIiwiRW1lcmdlbmN5QWxlcnRCYW5uZXIiOiJ7fSIsIkNvbXBldGl0aW9uTWV0cmljVGltZW91dE1pbnV0ZXMiOiIzMCIsIktlcm5lbHNQYXlUb1NjYWxlUHJvUGx1c0dwdUhvdXJzIjoiMzAiLCJLZXJuZWxzUGF5VG9TY2FsZVByb0dwdUhvdXJzIjoiMTUiLCJEYXRhc2V0c1NlbmRQZW5kaW5nU3VnZ2VzdGlvbnNSZW1pbmRlcnNCYXRjaFNpemUiOiIxMDAifSwicGlkIjoia2FnZ2xlLTE2MTYwNyIsInN2YyI6IndlYi1mZSIsInNkYWsiOiJBSXphU3lBNGVOcVVkUlJza0pzQ1pXVnotcUw2NTVYYTVKRU1yZUUiLCJibGQiOiJlOWQ0M2I0NWFmZmUyYmQyZDBhODM1YzY4MjJmNjZjYjI4NmNlZTIyIn0."
      },
      "ownerPrivateKey": "0x1234567456789012345678901234567890123456789012345678901234567890",
      "client": {
        "url": "wss://attestor.reclaimprotocol.org/ws"
      }
    };
    try {
      console.log('[OFFSCREEN] Generating proof with data:', claimDataTest);
      await updateSessionStatus(sessionId, RECLAIM_SESSION_STATUS.PROOF_GENERATION_STARTED);
      const result = await createClaimOnAttestor(claimDataTest);
      await updateSessionStatus(sessionId, RECLAIM_SESSION_STATUS.PROOF_GENERATION_SUCCESS);
      console.log('[OFFSCREEN] Claim created successfully:', result);
      return result;
    } catch (error) {
      await updateSessionStatus(sessionId, RECLAIM_SESSION_STATUS.PROOF_GENERATION_FAILED);
      console.error('[OFFSCREEN] Error generating claim:', error);
      throw error;
    }
  }
}

// Initialize the offscreen document
const proofGenerator = new OffscreenProofGenerator(); 