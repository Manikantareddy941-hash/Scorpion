import { createClient } from '@supabase/supabase-js';
import 'dotenv/config';

const supabase = createClient(
    process.env.SUPABASE_URL || '',
    process.env.SUPABASE_SERVICE_ROLE_KEY || ''
);

async function checkUsers() {
    const { data: { users }, error } = await supabase.auth.admin.listUsers();
    if (error) {
        console.error('Error listing users:', error);
        return;
    }
    console.log('Total users:', users.length);
    users.forEach(u => {
        console.log(`- ${u.email} (${u.id})`);
    });
}

checkUsers();
