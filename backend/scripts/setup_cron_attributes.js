const sdk = require('node-appwrite');
const dotenv = require('dotenv');
const path = require('path');

dotenv.config({ path: path.join(__dirname, '../.env') });

const client = new sdk.Client();
const databases = new sdk.Databases(client);

client
    .setEndpoint(process.env.APPWRITE_ENDPOINT)
    .setProject(process.env.APPWRITE_PROJECT_ID)
    .setKey(process.env.APPWRITE_API_KEY);

async function addAttributes() {
    try {
        console.log('Creating attribute cron_enabled in repositories collection...');
        await databases.createBooleanAttribute(
            process.env.APPWRITE_DATABASE_ID,
            'repositories',
            'cron_enabled',
            false, // required
            false // default
        );
        console.log('Attribute cron_enabled created successfully.');
    } catch (error) {
        if (error.code === 409) {
            console.log('Attribute cron_enabled already exists.');
        } else {
            console.error('Error creating cron_enabled:', error.message);
        }
    }

    try {
        console.log('Creating attribute cron_schedule in repositories collection...');
        await databases.createStringAttribute(
            process.env.APPWRITE_DATABASE_ID,
            'repositories',
            'cron_schedule',
            255, // size
            false, // required
            '0 0 * * *' // default
        );
        console.log('Attribute cron_schedule created successfully.');
    } catch (error) {
        if (error.code === 409) {
            console.log('Attribute cron_schedule already exists.');
        } else {
            console.error('Error creating cron_schedule:', error.message);
        }
    }
}

addAttributes();
