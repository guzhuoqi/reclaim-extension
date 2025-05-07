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


export const submitProofOnCallback = async (proof, submitUrl, sessionId) => {
    try {
        const response = await fetch(submitUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ proof })
        });
        const res = await response.json();
        // check if response is valid
        if (!response.ok) {
            await updateSessionStatus(sessionId, RECLAIM_SESSION_STATUS.PROOF_SUBMISSION_FAILED);
            throw new Error('Failed to submit proof');
        }
        await updateSessionStatus(sessionId, RECLAIM_SESSION_STATUS.PROOF_SUBMITTED);
        return res;
    } catch (error) {
        console.error('Error submitting proof:', error);
        throw error;
    }
}