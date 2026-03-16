import 'dotenv/config';
import { supabase } from './lib/supabase';

async function test() {
    console.log('Testing Supabase connection...');
    console.log('URL:', process.env.SUPABASE_URL);

    const { data, error } = await supabase.from('repositories').select('id').limit(1);

    if (error) {
        console.error('❌ Query failed:', error.message);
        console.error('Details:', error);
    } else {
        console.log('✅ Connection successful!');
        console.log('Data:', data);
    }
}

test();
