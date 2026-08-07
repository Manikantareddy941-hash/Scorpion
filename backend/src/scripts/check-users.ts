import { users } from '../lib/appwrite';
import { errorMessage } from '../services/logger';

async function checkUsers() {
    try {
        const userList = await users.list();
        console.log('Total users:', userList.total);
        userList.users.forEach(u => {
            console.log(`- ${u.email} (${u.$id})`);
        });
    } catch (err) {
        console.error('Error listing users:', errorMessage(err));
    }
}

checkUsers();
