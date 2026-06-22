import { databases, COLLECTIONS, DB_ID, ID, Query } from '../lib/appwrite';
import { logger } from '../services/logger';
import { execFile } from 'child_process';
import util from 'util';
import fs from 'fs/promises';
import path from 'path';
import os from 'os';
import axios from 'axios';

const execFileAsync = util.promisify(execFile);

export interface TrivyVulnerability {
  Severity: string;
}

export interface TrivyResult {
  Vulnerabilities?: TrivyVulnerability[];
}

export interface TrivyReport {
  Results?: TrivyResult[];
}

export interface DeployTargetConfig {
  portMapping: string;
}

export const deployRepository = {
  async getPipelineRun(buildId: string) {
    return databases.getDocument(DB_ID, 'pipeline_runs', buildId);
  },

  async getBuildPipeline(buildId: string) {
    return databases.getDocument(DB_ID, COLLECTIONS.BUILD_PIPELINES, buildId);
  },

  async getRepository(repoId: string) {
    return databases.getDocument(DB_ID, COLLECTIONS.REPOSITORIES, repoId);
  },

  async listDeployTargets(environment: string) {
    return databases.listDocuments(DB_ID, 'deploy_targets', [
      Query.equal('environment', environment),
      Query.limit(1)
    ]);
  },

  async createDeployTarget(environment: string, name: string, type: string, config: DeployTargetConfig) {
    return databases.createDocument(DB_ID, 'deploy_targets', ID.unique(), {
      name,
      type,
      config: JSON.stringify(config),
      environment
    });
  },

  async findPreviousSuccessfulDeployment(repoId: string, environment: string) {
    return databases.listDocuments(DB_ID, 'deployments', [
      Query.equal('repoId', repoId),
      Query.equal('environment', environment),
      Query.equal('status', 'success'),
      Query.orderDesc('$createdAt'),
      Query.limit(1)
    ]);
  },

  async createDeployment(deploymentId: string, data: Record<string, unknown>) {
    return databases.createDocument(DB_ID, 'deployments', deploymentId, data);
  },

  async updateDeploymentStatus(deploymentId: string, fields: Record<string, unknown>) {
    return databases.updateDocument(DB_ID, 'deployments', deploymentId, fields);
  },

  async getDeployment(deploymentId: string) {
    return databases.getDocument(DB_ID, 'deployments', deploymentId);
  },

  async runTrivyScan(imageTag: string): Promise<TrivyReport> {
    logger.info(`[DeployRepository] Running Trivy scan on image: ${imageTag}`);
    const { stdout } = await execFileAsync('trivy', ['image', '-q', '-f', 'json', imageTag]);
    return JSON.parse(stdout);
  },

  async deployToDocker(containerName: string, hostPort: string, containerPort: string, imageTag: string): Promise<void> {
    logger.info(`[DeployRepository] Docker deploy: Stopping and removing container ${containerName}...`);
    try {
      await execFileAsync('docker', ['stop', containerName]);
    } catch { /* container may not exist yet */ }
    try {
      await execFileAsync('docker', ['rm', containerName]);
    } catch { /* container may not exist yet */ }

    logger.info(`[DeployRepository] Docker deploy: Starting new container ${containerName} on port ${hostPort}...`);
    await execFileAsync('docker', ['run', '-d', '--name', containerName, '-p', `${hostPort}:${containerPort}`, imageTag]);
  },

  async deployToKubernetes(containerName: string, namespace: string, imageTag: string): Promise<void> {
    const manifestPath = path.join(os.tmpdir(), `k8s-${containerName}.yaml`);

    const k8sManifest = `
apiVersion: apps/v1
kind: Deployment
metadata:
  name: ${containerName}
  namespace: ${namespace}
spec:
  replicas: 1
  selector:
    matchLabels:
      app: ${containerName}
  template:
    metadata:
      labels:
        app: ${containerName}
    spec:
      containers:
      - name: web
        image: ${imageTag}
        ports:
        - containerPort: 80
`;

    await fs.writeFile(manifestPath, k8sManifest, 'utf8');
    logger.info(`[DeployRepository] Kubernetes deploy: Applying manifest to namespace ${namespace}...`);

    try {
      await execFileAsync('kubectl', ['create', 'namespace', namespace]);
    } catch { /* namespace may already exist */ }

    await execFileAsync('kubectl', ['apply', '-f', manifestPath]);
  },

  async pingHealth(port: number): Promise<boolean> {
    try {
      const res = await axios.get(`http://localhost:${port}`, { timeout: 5000 });
      return res.status >= 200 && res.status < 400;
    } catch {
      // A connection failure means the deployment isn't actually serving traffic -
      // treat it as unhealthy rather than guessing, even in local/no-docker setups.
      return false;
    }
  }
};
