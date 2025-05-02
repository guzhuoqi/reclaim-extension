export const BACKEND_URL = 'https://api.reclaimprotocol.org';

export const API_ENDPOINTS = {
  PROVIDER_URL: (providerId) => `${BACKEND_URL}/api/providers/v2/${providerId}`,
  SUBMIT_PROOF: (sessionId) => `${BACKEND_URL}/session/${sessionId}/proof`
};