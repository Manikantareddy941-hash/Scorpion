import { createClient } from '@supabase/supabase-js';
import 'dotenv/config';

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseServiceKey) {
    console.error('❌ [Supabase] Missing environment variables: SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
}

/**
 * Shared Supabase client for backend operations.
 * Uses the Service Role Key to bypass RLS.
 */
export const supabase = createClient(
    supabaseUrl || '',
    supabaseServiceKey || '',
    {
        auth: {
            autoRefreshToken: false,
            persistSession: false
        }
    }
);

/**
 * Diagnostic helper to check Supabase connectivity.
 */
export const checkSupabaseConnection = async () => {
    try {
        const { error } = await supabase.from('repositories').select('id').limit(1);
        if (error) {
            return { ok: false, error: error.message, details: error };
        }
        return { ok: true };
    } catch (err: any) {
        return { ok: false, error: err.message || 'Unknown network error' };
    }
};
