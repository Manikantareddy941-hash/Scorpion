import { Client, Account, Databases, ID, Query } from 'appwrite';

const client = new Client()
  .setEndpoint(import.meta.env.VITE_APPWRITE_ENDPOINT)
  .setProject(import.meta.env.VITE_APPWRITE_PROJECT_ID);

export const account = new Account(client);
export const databases = new Databases(client);
export { ID, Query };

export const DB_ID = import.meta.env.VITE_APPWRITE_DATABASE_ID;

export const COLLECTIONS = {
  REPOSITORIES:             import.meta.env.VITE_APPWRITE_REPOS_COLLECTION_ID,
  SCANS:                    import.meta.env.VITE_APPWRITE_SCANS_COLLECTION_ID,
  VULNERABILITIES:          import.meta.env.VITE_APPWRITE_VULNS_COLLECTION_ID,
  TASKS:                    import.meta.env.VITE_APPWRITE_TASKS_COLLECTION_ID,
  NOTIFICATION_PREFERENCES: 'notification_preferences',
  POLICY_EVALUATIONS:       'policy_evaluations',
  NOTIFICATIONS:            'notifications',
};
console.log('Appwrite init:', import.meta.env.VITE_APPWRITE_ENDPOINT, import.meta.env.VITE_APPWRITE_PROJECT_ID);
