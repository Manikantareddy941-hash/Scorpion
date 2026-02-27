import { createClient } from '@supabase/supabase-js';
import 'dotenv/config';

const supabase = createClient(
    process.env.SUPABASE_URL || '',
    process.env.SUPABASE_SERVICE_ROLE_KEY || ''
);

async function checkTables() {
    // Check for repositories tables to see if anything exists
    const { data, error } = await supabase.from('repositories').select('*').limit(1);
    if (error) {
        console.error('Error selecting from repositories:', error);
    } else {
        console.log('Repositories found:', data.length);
    }

    // Check for password_resets
    const { data: resets, error: resetError } = await supabase.from('password_resets').select('*').limit(1);
    if (resetError) {
        console.error('Error selecting from password_resets:', resetError);
    } else {
        console.log('Password resets found:', resets.length);
    }
}

checkTables();
