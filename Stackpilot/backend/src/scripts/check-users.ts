import { users } from '../lib/appwrite';
import 'dotenv/config';

async function checkUsers() {
    try {
        const response = await users.list();
        console.log('Total users:', response.total);
        response.users.forEach(u => {
            console.log(`- ${u.email} (${u.$id})`);
        });
    } catch (error) {
        console.error('Error listing users:', error);
    }
}

checkUsers();
