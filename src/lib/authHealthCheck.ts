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
    const response = await fetch('/api/health');
    if (response.ok) {
      const data = await response.json();
      if (data.service === 'stackpilot-backend') {
        result.backendReachable = true;
      } else {
        result.errorType = 'UNKNOWN';
      }
    } else {
      result.errorType = 'UNKNOWN';
    }
  } catch (error) {
    if (error instanceof TypeError && error.message === 'Failed to fetch') {
      // This is a generic network error. It could be CORS or the server is down.
      // We'll hint at both possibilities. The browser console will show the real error.
      result.errorType = 'NETWORK'; // Default to NETWORK

      // A simple check to see if it *might* be a CORS issue.
      // This is not foolproof.
      if (typeof window !== 'undefined' && window.location.origin !== 'http://localhost:3001') {
        // A more specific check for CORS would be to check the response headers,
        // but if fetch fails, we don't have a response.
        // A better approach is to rely on the user seeing the error in the console.
        // Let's check for 'cors' in the error message. Some browsers might include it.
        if (error.stack?.toLowerCase().includes('cors')) {
          result.errorType = 'CORS';
        }
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
