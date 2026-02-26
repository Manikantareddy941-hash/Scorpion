import { supabase } from './supabase';

export type AuthHealthResult = {
  backendReachable: boolean;
  supabaseReachable: boolean;
  errorType?: 'CORS' | 'NETWORK' | 'DNS_BLOCK' | 'UNKNOWN';
};

export const authHealthCheck = async (): Promise<AuthHealthResult> => {
  const result: AuthHealthResult = {
    backendReachable: false,
    supabaseReachable: false,
  };

  // 1. Check backend connectivity
  try {
    const response = await fetch('http://localhost:3001/health', {
      method: 'GET',
      headers: { 'Content-Type': 'application/json' },
    });
    if (response.ok) {
      const data = await response.json();
      if (data.service === 'stackpilot-backend' || data.status === 'ok') {
        result.backendReachable = true;
      } else {
        result.errorType = 'UNKNOWN';
      }
    } else {
      result.errorType = 'UNKNOWN';
    }
  } catch (error) {
    if (error instanceof TypeError && error.message === 'Failed to fetch') {
      result.errorType = 'NETWORK';
      if (error.stack?.toLowerCase().includes('cors')) {
        result.errorType = 'CORS';
      }
    } else {
      result.errorType = 'UNKNOWN';
    }
  }

  // 2. Check Supabase connectivity
  try {
    const { error } = await supabase.auth.getSession();
    if (error) {
      // Check for specific error messages that indicate network issues
      if (error.message.includes('network error') || error.message.includes('Failed to fetch')) {
        result.supabaseReachable = false;
        if (!result.errorType) {
          result.errorType = 'DNS_BLOCK';
        }
      } else {
        // Some other Supabase error occurred, but it's reachable.
        result.supabaseReachable = true;
      }
    } else {
      result.supabaseReachable = true;
    }
  } catch (error) {
    result.supabaseReachable = false;
    if (!result.errorType) {
      result.errorType = 'DNS_BLOCK';
    }
  }

  // If backend is fine, but supabase isn't, it's likely a DNS issue.
  if (result.backendReachable && !result.supabaseReachable) {
    result.errorType = 'DNS_BLOCK';
  }

  // If we couldn't reach the backend, we can't be sure about Supabase, so we'll prioritize the backend error.
  if (!result.backendReachable && !result.errorType) {
    result.errorType = 'NETWORK';
  }


  return result;
};
