import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
    process.env.SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
);

async function checkConstraints() {
    console.log('Checking constraints for table: repositories');

    const { data, error } = await supabase.rpc('get_constraints', { table_name: 'repositories' });

    if (error) {
        console.error('RPC failed, trying raw query via information_schema...');
        const { data: qData, error: qError } = await supabase
            .from('pg_constraint')
            .select(`
                conname,
                pg_get_constraintdef(oid)
            `)
            .eq('conrelid', "'repositories'::regclass");

        if (qError) {
            console.error('Direct query failed:', qError.message);
            // Fallback: try to just insert a duplicate and see what happens? No.
        } else {
            console.log('Constraints:', qData);
        }
    } else {
        console.log('Constraints:', data);
    }
}

// Since I might not have the RPC, I'll try a different approach:
async function trySelect() {
    const { data, error } = await supabase.from('repositories').select('*').limit(1);
    console.log('Select test:', error ? error.message : 'Success');
}

trySelect();
// checkConstraints(); // This might fail without RPC
