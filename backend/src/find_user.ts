import 'dotenv/config';
import { supabase } from './lib/supabase';

async function findUser() {
    // Note: auth.users is special, but sometimes we can list via rpc or just check a linked table
    const { data, error } = await supabase.from('repositories').select('user_id').limit(1);

    if (error || !data || data.length === 0) {
        console.log('No users found in repositories table. Checking tasks...');
        const { data: tasks } = await supabase.from('tasks').select('user_id').limit(1);
        if (tasks && tasks.length > 0) {
            console.log('USER_ID:', tasks[0].user_id);
        } else {
            console.log('No user IDs found. Please provide a valid UUID from your auth.users table.');
        }
    } else {
        console.log('USER_ID:', data[0].user_id);
    }
}

findUser();
