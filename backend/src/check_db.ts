import 'dotenv/config';
import { databases, DB_ID, COLLECTIONS } from './lib/appwrite';

async function checkAppwriteDB() {
    console.log(`Checking Appwrite Database: ${DB_ID}`);

    try {
        const collections = await databases.listCollections(DB_ID);
        console.log('Collections:', collections.collections.map(c => c.name));

        const deploymentsAttr = await databases.listAttributes(DB_ID, 'deployments');
        console.log('Deployments attributes:', deploymentsAttr.attributes.map((a: any) => ({ key: a.key, type: a.type })));
    } catch (error: any) {
        console.error('Appwrite DB check failed:', error.message);
    }
}

checkAppwriteDB();
