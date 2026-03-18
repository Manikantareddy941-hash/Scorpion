const sdk = require('node-appwrite');
const dotenv = require('dotenv');
const client = new sdk.Client();
const databases = new sdk.Databases(client);

dotenv.config();

client
    .setEndpoint(process.env.APPWRITE_ENDPOINT)
    .setProject(process.env.APPWRITE_PROJECT_ID)
    .setKey(process.env.APPWRITE_API_KEY);

databases.listAttributes(process.env.APPWRITE_DATABASE_ID, 'tasks')
    .then(res => {
        console.log('Attributes:', res.attributes.map(a => a.key));
    })
    .catch(err => {
        console.error(err);
    });
