const sdk = require('node-appwrite');
const dotenv = require('dotenv');
const path = require('path');

dotenv.config({ path: path.join(__dirname, '../backend/.env') });

const client = new sdk.Client();
const databases = new sdk.Databases(client);

client
    .setEndpoint(process.env.APPWRITE_ENDPOINT)
    .setProject(process.env.APPWRITE_PROJECT_ID)
    .setKey(process.env.APPWRITE_API_KEY);

async function listAttributes() {
    try {
        console.log('Listing attributes for tasks collection...');
        const response = await databases.listAttributes(
            process.env.APPWRITE_DATABASE_ID,
            'tasks'
        );
        console.log('Attributes:', response.attributes.map(a => a.key));
    } catch (error) {
        console.error('Error listing attributes:', error);
    }
}

listAttributes();
