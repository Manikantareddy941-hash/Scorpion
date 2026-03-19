import { Client, Account, Databases, Functions, Storage, ID, Query } from 'appwrite';

const client = new Client()
  .setEndpoint(import.meta.env.VITE_APPWRITE_ENDPOINT)
  .setProject(import.meta.env.VITE_APPWRITE_PROJECT_ID);

export const account = new Account(client);
export const databases = new Databases(client);
export const storage = new Storage(client);
export const functions = new Functions(client);
export { ID, Query };

export const DB_ID = import.meta.env.VITE_APPWRITE_DATABASE_ID;

export const COLLECTIONS = {
  REPOSITORIES:             import.meta.env.VITE_APPWRITE_REPOS_COLLECTION_ID,
  SCANS:                    import.meta.env.VITE_APPWRITE_SCANS_COLLECTION_ID,
  VULNERABILITIES:          import.meta.env.VITE_APPWRITE_VULNS_COLLECTION_ID,
  TASKS:                    import.meta.env.VITE_APPWRITE_TASKS_COLLECTION_ID,
  FINDINGS:                 import.meta.env.VITE_APPWRITE_FINDINGS_COLLECTION_ID,
  NOTIFICATION_PREFERENCES: 'notification_preferences',
  POLICY_EVALUATIONS:       'policy_evaluations',
  NOTIFICATIONS:            'notifications',
  AVATARS_BUCKET_ID:        '69ba01e5000964e8c2c0',
};

export const FUNCTION_ID = import.meta.env.VITE_APPWRITE_FUNCTION_ID;

export const OAUTH_SUCCESS_URL = 'https://localhost:5173/auth/callback';
export const OAUTH_FAILURE_URL = 'https://localhost:5173/login';

console.log('Appwrite init:', import.meta.env.VITE_APPWRITE_ENDPOINT, import.meta.env.VITE_APPWRITE_PROJECT_ID);
