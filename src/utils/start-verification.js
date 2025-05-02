import { API_ENDPOINTS } from './constants.js';

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