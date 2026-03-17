import * as dotenv from 'dotenv';
dotenv.config();

import { databases, DB_ID, ID } from '../lib/appwrite';

const delay = (ms: number) => new Promise(res => setTimeout(res, ms));

async function createAttributeWithRetry(collectionId: string, type: 'string', key: string, size: number, required: boolean, defaultVal: string | null = null, array: boolean = false) {
    try {
        console.log(`Creating attribute ${key} in ${collectionId}...`);
        if (type === 'string') {
            await databases.createStringAttribute(DB_ID, collectionId, key, size, required, defaultVal as any, array);
        }
        await delay(1000); // Give appwrite a moment
    } catch (err: any) {
        if (err.code === 409) {
            console.log(`Attribute ${key} already exists in ${collectionId}.`);
        } else {
            console.error(`Error creating attribute ${key}:`, err.message);
        }
    }
}

async function setup() {
    try {
        console.log(`Setting up collections in DB: ${DB_ID}`);
        
        // 1. Teams
        try {
            await databases.createCollection(DB_ID, 'teams', 'teams');
            console.log('Created collection: teams');
            await delay(1000);
        } catch (err: any) {
            if (err.code === 409) console.log('Collection teams already exists.');
            else throw err;
        }

        await createAttributeWithRetry('teams', 'string', 'name', 255, true);
        await createAttributeWithRetry('teams', 'string', 'description', 1000, false);
        await createAttributeWithRetry('teams', 'string', 'owner_id', 255, true);
        await createAttributeWithRetry('teams', 'string', 'created_at', 255, false);

        // 2. Team Members
        try {
            await databases.createCollection(DB_ID, 'team_members', 'team_members');
            console.log('Created collection: team_members');
            await delay(1000);
        } catch (err: any) {
            if (err.code === 409) console.log('Collection team_members already exists.');
            else throw err;
        }

        await createAttributeWithRetry('team_members', 'string', 'team_id', 255, true);
        await createAttributeWithRetry('team_members', 'string', 'user_id', 255, true);
        await createAttributeWithRetry('team_members', 'string', 'role', 100, false);
        await createAttributeWithRetry('team_members', 'string', 'joined_at', 255, false);

        console.log('Setup complete!');
        process.exit(0);
    } catch (err) {
        console.error('Setup failed:', err);
        process.exit(1);
    }
}

setup();
