import { Client, Databases, Permission, Role } from 'node-appwrite';
import dotenv from 'dotenv';
import path from 'path';
import { isAppwriteError } from '../utils/errorGuards';
import { errorMessage } from '../services/logger';

dotenv.config({ path: path.resolve(process.cwd(), '.env') });

const client = new Client()
  .setEndpoint(process.env.APPWRITE_ENDPOINT || '')
  .setProject(process.env.APPWRITE_PROJECT_ID || '')
  .setKey(process.env.APPWRITE_API_KEY || '');

const databases = new Databases(client);
const DB_ID = process.env.APPWRITE_DATABASE_ID || '';

async function ensureCollection(id: string, name: string) {
  try {
    await databases.getCollection(DB_ID, id);
    console.log(`[INFO] Collection "${name}" (${id}) already exists.`);
  } catch (err) {
    console.log(`[INFO] Creating collection "${name}" (${id})...`);
    // standard user permissions
    const permissions = [
      Permission.read(Role.users()),
      Permission.create(Role.users()),
      Permission.update(Role.users()),
      Permission.delete(Role.users()),
    ];
    await databases.createCollection(DB_ID, id, name, permissions);
    console.log(`[SUCCESS] Collection "${name}" (${id}) created.`);
    // Wait for Appwrite to sync
    await new Promise(resolve => setTimeout(resolve, 1500));
  }
}

async function ensureStringAttribute(colId: string, key: string, size: number, required: boolean, defaultValue?: string | null) {
  try {
    await databases.createStringAttribute(DB_ID, colId, key, size, required, defaultValue ?? undefined);
    console.log(`[SUCCESS] Attribute "${key}" created in "${colId}".`);
  } catch (err) {
    if (isAppwriteError(err) && (err.code === 409 || err.type?.includes('already_exists'))) {
      console.log(`[INFO] Attribute "${key}" in "${colId}" already exists.`);
    } else {
      console.error(`[ERROR] Failed to create attribute "${key}" in "${colId}":`, errorMessage(err));
    }
  }
}

async function ensureBooleanAttribute(colId: string, key: string, required: boolean, defaultValue?: boolean | null) {
  try {
    await databases.createBooleanAttribute(DB_ID, colId, key, required, defaultValue ?? undefined);
    console.log(`[SUCCESS] Attribute "${key}" created in "${colId}".`);
  } catch (err) {
    if (isAppwriteError(err) && (err.code === 409 || err.type?.includes('already_exists'))) {
      console.log(`[INFO] Attribute "${key}" in "${colId}" already exists.`);
    } else {
      console.error(`[ERROR] Failed to create attribute "${key}" in "${colId}":`, errorMessage(err));
    }
  }
}

async function ensureIntegerAttribute(colId: string, key: string, required: boolean, min?: number, max?: number, defaultValue?: number | null) {
  try {
    await databases.createIntegerAttribute(DB_ID, colId, key, required, min, max, defaultValue ?? undefined);
    console.log(`[SUCCESS] Attribute "${key}" created in "${colId}".`);
  } catch (err) {
    if (isAppwriteError(err) && (err.code === 409 || err.type?.includes('already_exists'))) {
      console.log(`[INFO] Attribute "${key}" in "${colId}" already exists.`);
    } else {
      console.error(`[ERROR] Failed to create attribute "${key}" in "${colId}":`, errorMessage(err));
    }
  }
}

async function ensureFloatAttribute(colId: string, key: string, required: boolean, min?: number, max?: number, defaultValue?: number | null) {
  try {
    await databases.createFloatAttribute(DB_ID, colId, key, required, min, max, defaultValue ?? undefined);
    console.log(`[SUCCESS] Attribute "${key}" created in "${colId}".`);
  } catch (err) {
    if (isAppwriteError(err) && (err.code === 409 || err.type?.includes('already_exists'))) {
      console.log(`[INFO] Attribute "${key}" in "${colId}" already exists.`);
    } else {
      console.error(`[ERROR] Failed to create attribute "${key}" in "${colId}":`, errorMessage(err));
    }
  }
}

async function main() {
  console.log(`Starting migration on Database: ${DB_ID}`);

  // 1. pipelines Collection
  await ensureCollection('pipelines', 'Pipelines');
  await ensureStringAttribute('pipelines', 'repoId', 255, true);
  await ensureStringAttribute('pipelines', 'name', 255, true);
  await ensureStringAttribute('pipelines', 'branch', 255, false, 'main');
  await ensureStringAttribute('pipelines', 'triggerType', 50, false, 'push');
  await ensureStringAttribute('pipelines', 'stages', 1000, true); // JSON array string
  await ensureBooleanAttribute('pipelines', 'isActive', false, true);

  // 2. pipeline_runs Collection
  await ensureCollection('pipeline_runs', 'Pipeline Runs');
  await ensureStringAttribute('pipeline_runs', 'pipelineId', 255, true);
  await ensureStringAttribute('pipeline_runs', 'repoId', 255, true);
  await ensureStringAttribute('pipeline_runs', 'repoName', 255, true);
  await ensureStringAttribute('pipeline_runs', 'branch', 255, true);
  await ensureStringAttribute('pipeline_runs', 'commitHash', 255, false, '');
  await ensureStringAttribute('pipeline_runs', 'commitMessage', 1000, false, '');
  await ensureStringAttribute('pipeline_runs', 'author', 255, false, 'unknown');
  await ensureStringAttribute('pipeline_runs', 'status', 50, false, 'pending');
  await ensureStringAttribute('pipeline_runs', 'currentStage', 50, false, 'trigger');
  await ensureStringAttribute('pipeline_runs', 'triggerStatus', 50, false, 'pending');
  await ensureStringAttribute('pipeline_runs', 'buildStatus', 50, false, 'pending');
  await ensureStringAttribute('pipeline_runs', 'testStatus', 50, false, 'pending');
  await ensureStringAttribute('pipeline_runs', 'securityScanStatus', 50, false, 'pending');
  await ensureStringAttribute('pipeline_runs', 'gateCheckStatus', 50, false, 'pending');
  await ensureStringAttribute('pipeline_runs', 'deployStatus', 50, false, 'pending');
  await ensureStringAttribute('pipeline_runs', 'startedAt', 50, false, '');
  await ensureStringAttribute('pipeline_runs', 'finishedAt', 50, false, '');
  await ensureIntegerAttribute('pipeline_runs', 'duration', false, 0, 1000000, 0);

  // 3. deploy_targets Collection
  await ensureCollection('deploy_targets', 'Deploy Targets');
  await ensureStringAttribute('deploy_targets', 'name', 255, true);
  await ensureStringAttribute('deploy_targets', 'type', 50, true); // docker | kubernetes
  await ensureStringAttribute('deploy_targets', 'config', 4096, true);
  await ensureStringAttribute('deploy_targets', 'environment', 50, true); // dev | staging | production

  // 4. deployments Collection
  await ensureCollection('deployments', 'Deployments');
  await ensureStringAttribute('deployments', 'repoId', 255, true);
  await ensureStringAttribute('deployments', 'buildId', 255, true);
  await ensureStringAttribute('deployments', 'environment', 50, true);
  await ensureStringAttribute('deployments', 'status', 50, true);
  await ensureStringAttribute('deployments', 'imageTag', 255, true);
  await ensureStringAttribute('deployments', 'namespace', 255, false, '');
  await ensureStringAttribute('deployments', 'deployedAt', 50, false, '');
  await ensureStringAttribute('deployments', 'rolledBackAt', 50, false, '');
  await ensureStringAttribute('deployments', 'triggeredBy', 255, false, 'system');
  await ensureStringAttribute('deployments', 'previousDeploymentId', 255, false, '');
  // New field for health check URL
  await ensureStringAttribute('deployments', 'healthCheckUrl', 2048, false, '');

  // 5. metrics Collection
  await ensureCollection('metrics', 'Metrics');
  await ensureStringAttribute('metrics', 'repoId', 255, true);
  await ensureStringAttribute('metrics', 'deploymentId', 255, false, '');
  await ensureFloatAttribute('metrics', 'cpu', true, 0, 100, null);
  await ensureFloatAttribute('metrics', 'memory', true, 0, 100, null);
  await ensureFloatAttribute('metrics', 'requestRate', true, 0, 1000000, null);
  await ensureStringAttribute('metrics', 'timestamp', 50, true);

  // 6. deployment_status Collection (persist monitor status)
  await ensureCollection('deployment_status', 'Deployment Status');
  await ensureStringAttribute('deployment_status', 'deploymentId', 255, true);
  await ensureStringAttribute('deployment_status', 'repoId', 255, true);
  await ensureStringAttribute('deployment_status', 'environment', 50, true);
  await ensureStringAttribute('deployment_status', 'status', 10, true, 'up'); // up|down
  await ensureStringAttribute('deployment_status', 'lastUpdated', 50, true);
  // No need for latency here; just track state

  console.log('Migration completed successfully.');
}

main().catch(err => {
  console.error('Migration failed:', err);
  process.exit(1);
});
