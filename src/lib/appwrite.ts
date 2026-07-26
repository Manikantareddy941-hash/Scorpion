import { Client, Account, Functions, Storage, ID, Query } from 'appwrite';

export const client = new Client()
  .setEndpoint(import.meta.env.VITE_APPWRITE_ENDPOINT)
  .setProject(import.meta.env.VITE_APPWRITE_PROJECT_ID);

export const account = new Account(client);
// NOTE: `databases` is deliberately NOT exported.
//
// This client authenticates as the end user's Appwrite session, so any query
// made through it is bounded only by that collection's Appwrite permissions —
// not by the tenancy the backend enforces. Domain data must be read through the
// API (see src/lib/*Api.ts), which scopes every query to the caller.
//
// Keeping the handle off this module is the guardrail: without it, a component
// cannot re-introduce a direct browser->database query by reflex. `client` is
// still exported because realtime subscriptions need it — but treat a realtime
// event as a signal to refetch, never as data to render (see Monitor.tsx and
// ScanResults.tsx for the rule and the reason).
export const storage = new Storage(client);
export const functions = new Functions(client);
export { ID, Query };

export const DB_ID = import.meta.env.VITE_APPWRITE_DATABASE_ID;

export const COLLECTIONS = {
  REPOSITORIES:             import.meta.env.VITE_APPWRITE_REPOS_COLLECTION_ID,
  SCANS: import.meta.env.VITE_APPWRITE_SCANS_COLLECTION_ID || 'scans',
  VULNERABILITIES:          import.meta.env.VITE_APPWRITE_VULNS_COLLECTION_ID,
  TASKS:                    import.meta.env.VITE_APPWRITE_TASKS_COLLECTION_ID,
  FINDINGS:                 import.meta.env.VITE_APPWRITE_FINDINGS_COLLECTION_ID || 'findings',
  NOTIFICATION_PREFERENCES: 'notification_preferences',
  POLICY_EVALUATIONS:       'policy_evaluations',
  NOTIFICATIONS:            'notifications',
  AVATARS_BUCKET_ID:        '69ba01e5000964e8c2c0',
  POLICIES:                 import.meta.env.VITE_APPWRITE_POLICIES_COLLECTION_ID || 'policies',
  INTEGRATIONS:             import.meta.env.VITE_APPWRITE_INTEGRATIONS_COLLECTION_ID || 'integrations',
  CHAT_SESSIONS:            import.meta.env.VITE_APPWRITE_CHAT_SESSIONS_ID || 'chat_sessions',
  COMMITS:                  'commits',
  BUILDS:                   'builds',
  TEST_RUNS:                'test_runs',
  RELEASES:                 'releases',
  AUDIT_LOGS:               'audit_logs',
  CERTIFICATES:             'certificates',
  THREATS:                  'threats',
  BUILD_PIPELINES:          'build_pipelines',
  DEPLOYMENTS:              'deployments'
};

export const FUNCTION_ID = import.meta.env.VITE_APPWRITE_FUNCTION_ID;

export const OAUTH_SUCCESS_URL = `${window.location.origin}/auth/callback`;
export const OAUTH_FAILURE_URL = `${window.location.origin}/login`;

if (import.meta.env.DEV) {
  console.log('Appwrite init:', import.meta.env.VITE_APPWRITE_ENDPOINT, import.meta.env.VITE_APPWRITE_PROJECT_ID);
}
