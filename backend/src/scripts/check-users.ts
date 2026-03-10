import { supabase } from '../lib/supabase';

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
