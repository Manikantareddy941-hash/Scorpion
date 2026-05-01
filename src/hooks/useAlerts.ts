import { useCallback } from 'react';
import { useAuth } from '../contexts/AuthContext';

export function useAlerts() {
    const { getJWT } = useAuth();

    const dispatchScanAlerts = useCallback(async (scanId: string, repoName: string) => {
        try {
            const token = await getJWT();
            const apiBase = import.meta.env.VITE_API_URL || 'http://localhost:3001';
            
            // Assume we fetch the user's active severities from their settings or local storage
            // In a real scenario, this might come from the user profile or the DB
            const activeSeverities = ['critical', 'high']; // Default for now
            
            const response = await fetch(`${apiBase}/api/alerts/batch-notify`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${token}`
                },
                body: JSON.stringify({
                    scanId,
                    repoName,
                    severities: activeSeverities
                })
            });
            
            if (!response.ok) {
                console.error('Failed to dispatch scan alerts:', await response.text());
                return false;
            }
            
            return true;
        } catch (err) {
            console.error('Error dispatching scan alerts:', err);
            return false;
        }
    }, [getJWT]);

    return { dispatchScanAlerts };
}
