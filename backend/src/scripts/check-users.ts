import { users } from '../lib/appwrite';

async function checkUsers() {
    try {
        const userList = await users.list();
        console.log('Total users:', userList.total);
        userList.users.forEach(u => {
            console.log(`- ${u.email} (${u.$id})`);
        });
    } catch (err: any) {
        console.error('Error listing users:', err.message);
    }
}

checkUsers();
