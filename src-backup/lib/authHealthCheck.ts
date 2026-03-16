import { account } from './appwrite';

export type AuthHealthResult = {
  backendReachable: boolean;
  appwriteReachable: boolean;
  errorType?: 'CORS' | 'NETWORK' | 'DNS_BLOCK' | 'UNKNOWN';
};

export const authHealthCheck = async (): Promise<AuthHealthResult> => {
  const result: AuthHealthResult = {
    backendReachable: false,
    appwriteReachable: false,
  };

  const BACKEND_URL = import.meta.env.VITE_API_URL || 'http://localhost:3001';

  // 1. Check backend connectivity
  try {
    const response = await fetch(`${BACKEND_URL}/health`, {
      method: 'GET',
      headers: { 'Content-Type': 'application/json' },
    });
    if (response.ok) {
      const data = await response.json();
      if (data.status === 'ok' || data.service === 'stackpilot-backend') {
        result.backendReachable = true;
      }
    }
  } catch (error) {
    result.errorType = 'NETWORK';
  }

  // 2. Check Appwrite connectivity
  try {
    await account.get();
    result.appwriteReachable = true;
  } catch (error: any) {
    // Appwrite might be reachable but no session exists
    if (error.code === 401) {
      result.appwriteReachable = true;
    } else {
      result.appwriteReachable = false;
      if (!result.errorType) {
        result.errorType = 'DNS_BLOCK';
      }
    }
  }

  if (result.backendReachable && !result.appwriteReachable) {
    result.errorType = 'DNS_BLOCK';
  }

  return result;
};
