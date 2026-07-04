import { Client, Databases, Users, Account, ID, Query } from 'node-appwrite';
import { logger } from '../services/logger';

// Connection pooling for all Appwrite (HTTP/REST) calls — gateRulesRepository included.
// node-appwrite's transport (node-fetch-native-with-agent) builds a FRESH undici
// dispatcher per request, so every call does a new TCP/TLS handshake with no keep-alive
// reuse — costly under CI/CD bursts. Patch its createAgent to reuse a single dispatcher
// (undici Agents pool + keep-alive by default), so connections are reused across requests.
// ponytail: monkeypatches the SDK's transport helper; re-verify on node-appwrite or
// node-fetch-native-with-agent upgrade. Reuses the SDK's own bundled undici Agent to
// avoid a version mismatch from importing undici separately.
type FetchAgents = { agent: unknown; dispatcher: unknown };
type CreateAgent = (endpoint?: string, opts?: { rejectUnauthorized?: boolean }) => FetchAgents;

// Best-effort: a transport-helper shape change on upgrade (or a failed require) must
// never crash the process at import time. On any failure the SDK keeps its default
// per-request dispatcher — slower, but functional.
function installAppwritePooling(): void {
  let nfnAgent: { createAgent?: CreateAgent };
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    nfnAgent = require('node-fetch-native-with-agent/agent') as { createAgent?: CreateAgent };
  } catch (err) {
    logger.warn('[appwrite] pooling patch skipped: transport helper not resolvable', {
      error: err instanceof Error ? err.message : String(err),
    });
    return;
  }

  const baseCreateAgent = nfnAgent.createAgent;
  if (typeof baseCreateAgent !== 'function') {
    logger.warn('[appwrite] pooling patch skipped: createAgent is not a function');
    return;
  }

  let sharedDispatcher: unknown;
  nfnAgent.createAgent = (endpoint?: string, opts?: { rejectUnauthorized?: boolean }): FetchAgents => {
    // Let a genuine build failure propagate — node-appwrite awaits it, so it surfaces as a
    // rejected call (handled by each repository's try/catch), not an uncaught exception.
    const built = baseCreateAgent(endpoint, opts);
    try {
      if (!sharedDispatcher) sharedDispatcher = built.dispatcher;
      return { agent: built.agent, dispatcher: sharedDispatcher };
    } catch {
      // Reuse failed — hand back the freshly built agents so transport still works.
      return built;
    }
  };
}

installAppwritePooling();

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
  TEAMS: 'teams',
  RBAC_AUDIT_LOG: 'rbac_audit_log',
  NOTIFICATIONS: 'notifications',
  SECURITY_REPORTS: 'security_reports',
  VULNERABILITY_FIXES: 'vulnerability_fixes',
  API_KEYS: 'api_keys',
  AI_METRICS: 'ai_metrics',
  SCAN_COMMITS: 'scan_commits',
  FINDING_RESOLUTIONS: 'finding_resolutions',
  PROJECTS: 'projects',
  PASSWORD_RESETS: 'password_resets',
  INCIDENTS: 'incidents',
  COMPLIANCE_CONTROLS: 'compliance_controls',
  AUDIT_LOGS: 'audit_logs',
  ROLES: 'roles',
  COMMITS: 'commits',
  BUILDS: 'builds',
  TEST_RUNS: 'test_runs',
  RELEASES: 'releases',
  REPORTS_SCHEDULE: 'reports_schedule',
  FINDINGS: 'vulnerabilities',
  INTEGRATIONS: 'integrations',
  PROJECT_POLICIES: 'project_policies',
  RBAC_AUDIT_LOGS: 'rbac_audit_log',
  THREATS: 'threats',
  BUILD_PIPELINES: 'build_pipelines',
  DEPLOYMENTS: 'deployments',
  BUILD_ARTIFACTS: 'build_artifacts',
  ENVIRONMENTS: 'environments',
  THREAT_MODELS: 'threat_models',
  AUDIT_LOGS_V2: 'audit_logs_v2',
  CANARIES: 'canaries',
};

export { ID, Query };
export default client;
