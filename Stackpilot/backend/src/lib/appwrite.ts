import { Client, Account, Databases, Users, ID, Query } from 'node-appwrite';

export { ID, Query };

const client = new Client()
    .setEndpoint(process.env.APPWRITE_ENDPOINT!)
    .setProject(process.env.APPWRITE_PROJECT_ID!)
    .setKey(process.env.APPWRITE_API_KEY!);

export const account = new Account(client);
export const databases = new Databases(client);
export const users = new Users(client);

export const DB_ID = process.env.APPWRITE_DATABASE_ID!;

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
