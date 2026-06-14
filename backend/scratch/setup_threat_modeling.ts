import { Client, Databases, Permission, Role } from 'node-appwrite';
import path from 'path';

require('dotenv').config({ path: path.join(__dirname, '../.env') });

const client = new Client()
  .setEndpoint(process.env.APPWRITE_ENDPOINT || 'https://sgp.cloud.appwrite.io/v1')
  .setProject(process.env.APPWRITE_PROJECT_ID || '')
  .setKey(process.env.APPWRITE_API_KEY || '');

const databases = new Databases(client);
const DB_ID = process.env.APPWRITE_DATABASE_ID || '';

async function setup() {
  const collectionName = 'plan_threats';
  const perms = [
    Permission.read(Role.users()),
    Permission.create(Role.users()),
    Permission.update(Role.users()),
    Permission.delete(Role.users())
  ];

  try {
    await databases.createCollection(DB_ID, collectionName, collectionName, perms);
    console.log(`Created collection ${collectionName}`);
    await new Promise(r => setTimeout(r, 1000));
  } catch (err: any) {
    if (err.code === 409) {
      console.log(`Collection ${collectionName} already exists.`);
    } else {
      console.error(`Error creating ${collectionName}:`, err.message);
      return;
    }
  }

  // Create attributes
  try { await databases.createStringAttribute(DB_ID, collectionName, 'projectId', 255, true); } catch (e: any) {}
  try { await databases.createStringAttribute(DB_ID, collectionName, 'title', 500, true); } catch (e: any) {}
  try { await databases.createStringAttribute(DB_ID, collectionName, 'strideCategory', 100, true); } catch (e: any) {}
  try { await databases.createStringAttribute(DB_ID, collectionName, 'severity', 50, true); } catch (e: any) {}
  try { await databases.createStringAttribute(DB_ID, collectionName, 'description', 5000, false); } catch (e: any) {}
  try { await databases.createStringAttribute(DB_ID, collectionName, 'mitigation', 5000, false); } catch (e: any) {}
  try { await databases.createStringAttribute(DB_ID, collectionName, 'status', 50, true, 'identified'); } catch (e: any) {}
  try { await databases.createStringAttribute(DB_ID, collectionName, 'issueId', 255, false); } catch (e: any) {}

  console.log("Setup complete.");
}

setup();
