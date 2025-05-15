import { API_ENDPOINTS, RECLAIM_SESSION_STATUS } from './constants';

export const fetchProviderData = async (providerId) => {
    try {
        // PROVIDER_URL
        const response = await fetch(`${API_ENDPOINTS.PROVIDER_URL(providerId)}`);
        // check if response is valid
        if (!response.ok) {
            throw new Error('Failed to fetch provider data');
        }
        const data = await response.json();
        return data?.providers;
    } catch (error) {
        console.error('Error fetching provider data:', error);
        throw error;
    }
}

export const updateSessionStatus = async (sessionId, status) => {
    try {
        const response = await fetch(`${API_ENDPOINTS.UPDATE_SESSION_STATUS()}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ sessionId, status })
          });
      
        const res = await response.json();
        return res;
    } catch (error) {
        console.error('Error updating session status:', error);
        throw error;
    }
}


export const submitProofOnCallback = async (proofs, submitUrl, sessionId) => {
    try {
        // 1. Convert the proofs array to a JSON string
        const jsonStringOfProofs = JSON.stringify(proofs);
        // 2. URL-encode the JSON string
        const urlEncodedProofs = encodeURIComponent(jsonStringOfProofs);
        // 3. Append the URL-encoded string to the submit URL
        const response = await fetch(submitUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'text/plain' },
            body: urlEncodedProofs, // Send the URL-encoded string as the raw body
        });
        const res = await response.text();
        // check if response is valid
        if (!response.ok) {
            await updateSessionStatus(sessionId, RECLAIM_SESSION_STATUS.PROOF_SUBMISSION_FAILED);
            throw new Error('Failed to submit proof to Callback and update session status');
        }
        await updateSessionStatus(sessionId, RECLAIM_SESSION_STATUS.PROOF_SUBMITTED);
        return res;
    } catch (error) {
        console.error('Error submitting proof to Callback:', error);
        throw error;
    }
}