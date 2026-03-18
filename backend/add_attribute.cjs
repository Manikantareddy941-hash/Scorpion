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

async function addAttribute() {
    try {
        console.log('Creating attribute repo_url in tasks collection...');
        const result = await databases.createStringAttribute(
            process.env.APPWRITE_DATABASE_ID,
            'tasks', // Collection ID from backend env might be different? No, it's 'tasks' in root .env too.
            'repo_url',
            2000,
            false // optional
        );
        console.log('Attribute created successfully:', result);
    } catch (error) {
        if (error.code === 409) {
            console.log('Attribute already exists.');
        } else {
            console.error('Error creating attribute:', error);
        }
    }
}

addAttribute();
