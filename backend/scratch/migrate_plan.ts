import { Client, Databases, Permission, Role } from 'node-appwrite';
import fs from 'fs';
import path from 'path';

require('dotenv').config({ path: path.join(__dirname, '../.env') });

const client = new Client()
  .setEndpoint(process.env.APPWRITE_ENDPOINT || 'https://sgp.cloud.appwrite.io/v1')
  .setProject(process.env.APPWRITE_PROJECT_ID || '')
  .setKey(process.env.APPWRITE_API_KEY || '');

const databases = new Databases(client);
const DB_ID = process.env.APPWRITE_DATABASE_ID || '';

const MOCK_DB_PATH = path.join(__dirname, 'plan_mock_db.json');
const data = JSON.parse(fs.readFileSync(MOCK_DB_PATH, 'utf-8'));

async function migrate() {
  const collections = ['plan_projects', 'plan_sprints', 'plan_epics', 'plan_issues'];
  const perms = [
    Permission.read(Role.users()),
    Permission.create(Role.users()),
    Permission.update(Role.users()),
    Permission.delete(Role.users())
  ];

  for (const name of collections) {
    try {
      await databases.createCollection(DB_ID, name, name, perms);
      console.log(`Created collection ${name}`);
      
      // Wait a moment for Appwrite to create the collection
      await new Promise(r => setTimeout(r, 1000));
    } catch (err: any) {
      if (err.code === 409) {
        console.log(`Collection ${name} already exists.`);
      } else {
        console.error(`Error creating ${name}:`, err.message);
      }
    }
  }

  // Create attributes
  // plan_projects
  try { await databases.createStringAttribute(DB_ID, 'plan_projects', 'name', 255, true); } catch (e: any) {}
  try { await databases.createStringAttribute(DB_ID, 'plan_projects', 'repoId', 255, false); } catch (e: any) {}
  try { await databases.createStringAttribute(DB_ID, 'plan_projects', 'type', 50, false); } catch (e: any) {}
  try { await databases.createStringAttribute(DB_ID, 'plan_projects', 'createdAt', 50, false); } catch (e: any) {}

  // plan_epics
  try { await databases.createStringAttribute(DB_ID, 'plan_epics', 'projectId', 255, true); } catch (e: any) {}
  try { await databases.createStringAttribute(DB_ID, 'plan_epics', 'title', 255, true); } catch (e: any) {}
  try { await databases.createStringAttribute(DB_ID, 'plan_epics', 'color', 50, false); } catch (e: any) {}
  try { await databases.createStringAttribute(DB_ID, 'plan_epics', 'startDate', 50, false); } catch (e: any) {}
  try { await databases.createStringAttribute(DB_ID, 'plan_epics', 'endDate', 50, false); } catch (e: any) {}
  try { await databases.createStringAttribute(DB_ID, 'plan_epics', 'status', 50, false); } catch (e: any) {}

  // plan_sprints
  try { await databases.createStringAttribute(DB_ID, 'plan_sprints', 'projectId', 255, true); } catch (e: any) {}
  try { await databases.createStringAttribute(DB_ID, 'plan_sprints', 'name', 255, true); } catch (e: any) {}
  try { await databases.createStringAttribute(DB_ID, 'plan_sprints', 'goal', 1000, false); } catch (e: any) {}
  try { await databases.createStringAttribute(DB_ID, 'plan_sprints', 'startDate', 50, false); } catch (e: any) {}
  try { await databases.createStringAttribute(DB_ID, 'plan_sprints', 'endDate', 50, false); } catch (e: any) {}
  try { await databases.createStringAttribute(DB_ID, 'plan_sprints', 'status', 50, false); } catch (e: any) {}

  // plan_issues
  try { await databases.createStringAttribute(DB_ID, 'plan_issues', 'projectId', 255, true); } catch (e: any) {}
  try { await databases.createStringAttribute(DB_ID, 'plan_issues', 'epicId', 255, false); } catch (e: any) {}
  try { await databases.createStringAttribute(DB_ID, 'plan_issues', 'sprintId', 255, false); } catch (e: any) {}
  try { await databases.createStringAttribute(DB_ID, 'plan_issues', 'type', 50, false); } catch (e: any) {}
  try { await databases.createStringAttribute(DB_ID, 'plan_issues', 'title', 500, true); } catch (e: any) {}
  try { await databases.createStringAttribute(DB_ID, 'plan_issues', 'description', 5000, false); } catch (e: any) {}
  try { await databases.createStringAttribute(DB_ID, 'plan_issues', 'priority', 50, false); } catch (e: any) {}
  try { await databases.createStringAttribute(DB_ID, 'plan_issues', 'status', 50, false); } catch (e: any) {}
  try { await databases.createStringAttribute(DB_ID, 'plan_issues', 'assignee', 255, false); } catch (e: any) {}
  try { await databases.createIntegerAttribute(DB_ID, 'plan_issues', 'storyPoints', false); } catch (e: any) {}
  try { await databases.createIntegerAttribute(DB_ID, 'plan_issues', 'timeEstimate', false); } catch (e: any) {}
  try { await databases.createIntegerAttribute(DB_ID, 'plan_issues', 'timeLogged', false); } catch (e: any) {}
  try { await databases.createStringAttribute(DB_ID, 'plan_issues', 'vulnId', 255, false); } catch (e: any) {}
  try { await databases.createStringAttribute(DB_ID, 'plan_issues', 'labels', 255, false, undefined, true); } catch (e: any) {} // array
  try { await databases.createStringAttribute(DB_ID, 'plan_issues', 'dueDate', 50, false); } catch (e: any) {}
  try { await databases.createStringAttribute(DB_ID, 'plan_issues', 'createdAt', 50, false); } catch (e: any) {}
  
  console.log("Attributes created.");
  
  // Wait for attributes to be ready
  await new Promise(r => setTimeout(r, 4000));
  
  // Insert data
  for (const doc of data.projects || []) {
    try {
      const { $id, ...rest } = doc;
      await databases.createDocument(DB_ID, 'plan_projects', $id, rest);
      console.log(`Inserted project ${$id}`);
    } catch(err: any) { console.log(`Skipped project ${doc.$id}: ${err.message}`) }
  }

  for (const doc of data.epics || []) {
    try {
      const { $id, ...rest } = doc;
      await databases.createDocument(DB_ID, 'plan_epics', $id, rest);
      console.log(`Inserted epic ${$id}`);
    } catch(err: any) { console.log(`Skipped epic ${doc.$id}: ${err.message}`) }
  }

  for (const doc of data.sprints || []) {
    try {
      const { $id, ...rest } = doc;
      await databases.createDocument(DB_ID, 'plan_sprints', $id, rest);
      console.log(`Inserted sprint ${$id}`);
    } catch(err: any) { console.log(`Skipped sprint ${doc.$id}: ${err.message}`) }
  }

  for (const doc of data.issues || []) {
    try {
      const { $id, ...rest } = doc;
      const payload: any = { ...rest };
      Object.keys(payload).forEach(k => {
        if (payload[k] === null) delete payload[k];
      });
      await databases.createDocument(DB_ID, 'plan_issues', $id, payload);
      console.log(`Inserted issue ${$id}`);
    } catch(err: any) { console.log(`Skipped issue ${doc.$id}: ${err.message}`) }
  }
  
  console.log("Migration complete.");
}

migrate();
