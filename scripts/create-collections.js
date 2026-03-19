import { Client, Databases } from 'node-appwrite';
import 'dotenv/config';

const endpoint = process.env.VITE_APPWRITE_ENDPOINT;
const projectId = process.env.VITE_APPWRITE_PROJECT_ID;
const databaseId = process.env.VITE_APPWRITE_DATABASE_ID;
const apiKey = process.env.APPWRITE_API_KEY;

if (!endpoint || !projectId || !databaseId || !apiKey) {
    console.error("Missing one or more required environment variables.");
    process.exit(1);
}

const client = new Client()
    .setEndpoint(endpoint)
    .setProject(projectId)
    .setKey(apiKey);

const databases = new Databases(client);

async function createAttribute(promise) {
    try {
        await promise;
    } catch (error) {
        if (error.type !== 'attribute_already_exists') {
            console.error(error.message);
        }
    }
}

async function createCollections() {
    try {
        console.log("Creating Scans collection...");
        let scansCollection;
        try {
            scansCollection = await databases.createCollection(
                databaseId,
                'scans', // ID for Scans collection
                'Scans'  // Name for Scans collection
            );
            console.log("Scans collection created:", scansCollection.$id);
        } catch (error) {
            if (error.type === 'collection_already_exists') {
                console.log("Scans collection already exists. Fetching...");
                scansCollection = await databases.getCollection(databaseId, 'scans');
            } else {
                throw error;
            }
        }

        console.log("Creating Scans attributes...");
        await createAttribute(databases.createStringAttribute(databaseId, scansCollection.$id, 'repoUrl', 2048, true));
        await createAttribute(databases.createStringAttribute(databaseId, scansCollection.$id, 'visibility', 50, true));
        await createAttribute(databases.createStringAttribute(databaseId, scansCollection.$id, 'status', 50, true));
        await createAttribute(databases.createIntegerAttribute(databaseId, scansCollection.$id, 'criticalCount', false, 0, 100000, 0));
        await createAttribute(databases.createIntegerAttribute(databaseId, scansCollection.$id, 'highCount', false, 0, 100000, 0));
        await createAttribute(databases.createIntegerAttribute(databaseId, scansCollection.$id, 'mediumCount', false, 0, 100000, 0));
        await createAttribute(databases.createIntegerAttribute(databaseId, scansCollection.$id, 'lowCount', false, 0, 100000, 0));
        await createAttribute(databases.createDatetimeAttribute(databaseId, scansCollection.$id, 'timestamp', true));
        await createAttribute(databases.createStringAttribute(databaseId, scansCollection.$id, 'scannerVersion', 255, true));
        
        console.log("Waiting for Scans attributes to be ready...");
        await new Promise(resolve => setTimeout(resolve, 3000));

        console.log("Creating Findings collection...");
        let findingsCollection;
        try {
            findingsCollection = await databases.createCollection(
                databaseId,
                'findings', // ID for Findings collection
                'Findings'  // Name for Findings collection
            );
            console.log("Findings collection created:", findingsCollection.$id);
        } catch (error) {
            if (error.type === 'collection_already_exists') {
                console.log("Findings collection already exists. Fetching...");
                findingsCollection = await databases.getCollection(databaseId, 'findings');
            } else {
                throw error;
            }
        }

        console.log("Creating Findings attributes...");
        await createAttribute(databases.createStringAttribute(databaseId, findingsCollection.$id, 'scanId', 255, true));
        await createAttribute(databases.createStringAttribute(databaseId, findingsCollection.$id, 'title', 255, true));
        await createAttribute(databases.createStringAttribute(databaseId, findingsCollection.$id, 'severity', 50, true));
        await createAttribute(databases.createStringAttribute(databaseId, findingsCollection.$id, 'package', 255, true));
        await createAttribute(databases.createStringAttribute(databaseId, findingsCollection.$id, 'installedVersion', 255, true));
        await createAttribute(databases.createStringAttribute(databaseId, findingsCollection.$id, 'fixedVersion', 255, false));
        await createAttribute(databases.createStringAttribute(databaseId, findingsCollection.$id, 'description', 5000, true));

        console.log("Waiting for Findings attributes to be ready...");
        await new Promise(resolve => setTimeout(resolve, 3000));

        console.log("\nSuccess! Both collections and their attributes have been processed.");
        
    } catch (error) {
        console.error("Error creating collections/attributes:", error);
    }
}

createCollections();
