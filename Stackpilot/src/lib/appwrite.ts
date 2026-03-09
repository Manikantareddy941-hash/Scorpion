import { Client, Account, Databases, ID, Query } from 'appwrite';

const client = new Client()
    .setEndpoint(import.meta.env.VITE_APPWRITE_ENDPOINT)
    .setProject(import.meta.env.VITE_APPWRITE_PROJECT_ID);

export const account = new Account(client);
export const databases = new Databases(client);
export { ID, Query };

export const DB_ID = import.meta.env.VITE_APPWRITE_DATABASE_ID;

export const COLLECTIONS = {
    USERS: 'users',
    TEAMS: 'teams',
    PROJECTS: 'projects',
    REPOSITORIES: 'repositories',
    SCANS: 'scans',
    VULNERABILITIES: 'vulnerabilities',
    AI_FEEDBACK: 'ai_feedback',
    AUDIT_LOGS: 'audit_logs',
    TASKS: 'tasks',
};
