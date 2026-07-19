const sdk = require('node-appwrite');
const dotenv = require('dotenv');
const path = require('path');

dotenv.config({ path: path.join(__dirname, '../../.env') });

const client = new sdk.Client();
const databases = new sdk.Databases(client);

client
    .setEndpoint(process.env.APPWRITE_ENDPOINT || 'https://sgp.cloud.appwrite.io/v1')
    .setProject(process.env.APPWRITE_PROJECT_ID)
    .setKey(process.env.APPWRITE_API_KEY);

const DB_ID = process.env.APPWRITE_DATABASE_ID;

async function checkCollections() {
    try {
        console.log('Database ID:', DB_ID);
        const response = await databases.listCollections(DB_ID);
        console.log(`Found ${response.total} collections.`);
        for (const col of response.collections) {
            console.log(`- Collection: ${col.$id} (${col.name})`);
            console.log(`  Document Security: ${col.documentSecurity}`);
            console.log(`  Permissions: ${JSON.stringify(col.permissions)}`);
        }
    } catch (error) {
        console.error('Error listing collections:', error);
    }
}

checkCollections();
