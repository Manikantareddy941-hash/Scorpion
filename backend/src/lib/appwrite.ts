import { Client, Databases, Users, Account, ID, Query } from 'node-appwrite';

const client = new Client();

client
  .setEndpoint(process.env.APPWRITE_ENDPOINT || 'https://sgp.cloud.appwrite.io/v1')
  .setProject(process.env.APPWRITE_PROJECT_ID || '')
  .setKey(process.env.APPWRITE_API_KEY || '');

export const databases = new Databases(client);
export const users = new Users(client);
export const account = new Account(client);

export const DB_ID = process.env.APPWRITE_DATABASE_ID || '';

export const COLLECTIONS = {
  REPOSITORIES: 'repositories',
  SCANS: 'scans',
  VULNERABILITIES: 'vulnerabilities',
  TASKS: 'tasks',
  NOTIFICATION_PREFERENCES: 'notification_preferences',
  POLICY_EVALUATIONS: 'policy_evaluations',
  PROJECT_ACCESS: 'project_access',
  TEAM_MEMBERS: 'team_members',
  RBAC_AUDIT_LOG: 'rbac_audit_log',
  NOTIFICATIONS: 'notifications',
};

export { ID, Query };
export default client;
