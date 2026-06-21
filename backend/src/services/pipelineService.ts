import fs from 'fs/promises';
import path from 'path';
import os from 'os';
import crypto from 'crypto';
import { execFile } from 'child_process';
import util from 'util';
import { Response } from 'express';
import { databases, COLLECTIONS, DB_ID, ID, Query } from '../lib/appwrite';
import { triggerScan } from './scanService';
import { checkReleaseGate } from '../routes/gateRoutes';
import { triggerDeploy } from '../deploy/deployService';
import { logger } from './logger';
import { dockerRunnerService } from './dockerRunnerService';
import { sshService } from './sshService';
import { containerizedTrivyService } from './containerizedTrivyService';
import { getImageDigest, signImageDigest } from './cosignService';



// SSE Client Store
const sseClients = new Map<string, Response[]>();

export function registerSseClient(runId: string, res: Response) {
  if (!sseClients.has(runId)) {
    sseClients.set(runId, []);
  }
  sseClients.get(runId)!.push(res);
}

export function unregisterSseClient(runId: string, res: Response) {
  const clients = sseClients.get(runId);
  if (clients) {
    sseClients.set(runId, clients.filter(c => c !== res));
  }
}

export function notifyStageChange(runId: string, data: any) {
  const clients = sseClients.get(runId);
  if (clients) {
    clients.forEach(client => {
      try {
        client.write(`data: ${JSON.stringify(data)}\n\n`);
      } catch (err) {
        // client disconnected
      }
    });
  }
}

// Log utility to write logs to disk
export class PipelineLogger {
  private logPath: string;

  constructor(runId: string) {
    // Use process.cwd() to ensure log path is consistent regardless of __dirname context
    this.logPath = path.resolve(process.cwd(), 'logs', 'pipelines', `${runId}.log`);
  }

  async init() {
    await fs.mkdir(path.dirname(this.logPath), { recursive: true });
    await fs.writeFile(this.logPath, `=== PIPELINE LOGS INITIALIZED AT ${new Date().toISOString()} ===\n`);
  }

  async log(message: string) {
    const formatted = `[${new Date().toISOString()}] [INFO] ${message}\n`;
    await fs.appendFile(this.logPath, formatted);
    logger.info(`[PipelineLogger] ${message}`);
  }

  async error(message: string, error?: any) {
    const formatted = `[${new Date().toISOString()}] [ERROR] ${message} ${error ? error.stack || JSON.stringify(error) : ''}\n`;
    await fs.appendFile(this.logPath, formatted);
    logger.error(`[PipelineLogger] ${message}`, error);
  }

  async getLogs(): Promise<string> {
    try {
      return await fs.readFile(this.logPath, 'utf8');
    } catch {
      return 'Log file not found.';
    }
  }
}

/**
 * Detect build tool from repository contents
 */
async function detectBuildTool(dir: string): Promise<string> {
  const files = await fs.readdir(dir);
  if (files.includes('package.json')) return 'npm';
  if (files.includes('Dockerfile')) return 'docker';
  if (files.includes('build.gradle') || files.includes('build.gradle.kts')) return 'gradle';
  if (files.includes('requirements.txt')) return 'python';
  return 'unknown';
}

/**
 * Maps incoming repository meta-configurations to pre-warmed container runtimes dynamically.
 */
function getRuntimeImageForTool(tool: string): string {
  const normalized = tool.toLowerCase();
  if (normalized.includes('npm') || normalized.includes('node') || normalized.includes('vite')) {
    return 'node:18-alpine';
  }
  if (normalized.includes('gradle')) {
    return 'gradle:8-jdk17';
  }
  if (normalized.includes('python') || normalized.includes('pip')) {
    return 'python:3.10-alpine';
  }
  // Safe base fallback option for basic shell executions
  return 'alpine:latest';
}

/**
 * Helper to run shell commands appending output to the Pipeline logger
 */
// Helper to sanitize URLs by redacting embedded credentials
const sanitizeUrl = (url: string): string => {
  return url.replace(/https:\/\/[^@]+@/, 'https://**REDACTED**@');
};

const execFileAsync = util.promisify(execFile);

/**
 * Runs a command with arguments passed as an array (no shell interpolation), so
 * attacker-influenced values (branch names, repo URLs) can't break out into shell syntax.
 */
async function execFileCommand(file: string, args: string[], cwd: string, pipeLogger: PipelineLogger) {
  const safeCommand = sanitizeUrl(`${file} ${args.join(' ')}`);
  await pipeLogger.log(`Running: ${safeCommand}`);
  try {
    const { stdout, stderr } = await execFileAsync(file, args, { cwd });
    if (stdout) await pipeLogger.log(sanitizeUrl(stdout));
    if (stderr) await pipeLogger.log(`[stderr]: ${sanitizeUrl(stderr)}`);
  } catch (error: any) {
    await pipeLogger.error(`Command failed: ${safeCommand}`, error);
    throw error;
  }
}

/**
 * Orchestrates and executes the pipeline run stages sequentially
 */
export async function runPipeline(runId: string) {
  const pipeLogger = new PipelineLogger(runId);
  await pipeLogger.init();

  const startTime = Date.now();
  let workspaceDir = '';
  let runDoc: any = null;

  try {
    // 1. Fetch the pipeline run document
    runDoc = await databases.getDocument(DB_ID, 'pipeline_runs', runId);
    
    // Update main status to running
    await databases.updateDocument(DB_ID, 'pipeline_runs', runId, {
      status: 'running',
      startedAt: new Date().toISOString(),
    });

    let repoDoc;
    try {
      repoDoc = await databases.getDocument(DB_ID, COLLECTIONS.REPOSITORIES, runDoc.repoId);
    } catch (e) {
      // If the repository document does not exist, create a minimal entry
      repoDoc = await databases.createDocument(DB_ID, COLLECTIONS.REPOSITORIES, runDoc.repoId, {
  name: runDoc.repoName || runDoc.repoId,
  url: runDoc.cloneUrl || '',

  user_id: 'system',
  created_at: new Date().toISOString(),
});
    }
    const repoUrl = repoDoc.url;

    workspaceDir = path.join(os.tmpdir(), 'scorpion-builds', runId);
    await fs.mkdir(workspaceDir, { recursive: true });

    const notifyUpdate = async (stage: string, updates: any) => {
      notifyStageChange(runId, { stage, status: updates[`${stage}Status`] || updates.status });
      await databases.updateDocument(DB_ID, 'pipeline_runs', runId, updates);
    };

    // --- STAGE 1: TRIGGER ---
    await pipeLogger.log(`--- Stage: trigger (Running) ---`);
    await notifyUpdate('trigger', { triggerStatus: 'running', currentStage: 'trigger' });
    await pipeLogger.log(`Trigger details: Repo URL=${repoUrl}, Branch=${runDoc.branch}, TriggerType=Webhook`);
    await notifyUpdate('trigger', { triggerStatus: 'success' });

    // --- STAGE 2: BUILD ---
    await pipeLogger.log(`--- Stage: build (Running) ---`);
    await notifyUpdate('build', { buildStatus: 'running', currentStage: 'build' });
    
    await pipeLogger.log(`Cloning repository into temporary directory: ${workspaceDir}...`);
    // Local check/clone
    if (repoUrl.startsWith('upload://') || repoUrl.startsWith('c:')) {
      const localPath = repoDoc.local_path;
      if (!localPath) {
        throw new Error('Local path not found for repo');
      }
      await pipeLogger.log(`Copying local repo path: ${localPath}...`);
      await fs.cp(localPath, workspaceDir, { recursive: true });
    } else {
      // Inject GitHub token if provided and sanitize URL for logging
      let cloneUrl = repoUrl;
      const token = process.env.GITHUB_TOKEN;
      if (token && repoUrl.startsWith('https://')) {
        cloneUrl = repoUrl.replace('https://', `https://${token}@`);
      }
      await execFileCommand('git', ['clone', '--depth', '1', '--branch', runDoc.branch, cloneUrl, workspaceDir], os.tmpdir(), pipeLogger);
    }
    
    const buildTool = await detectBuildTool(workspaceDir);
    await pipeLogger.log(`Detected build tool: ${buildTool}`);

    if (buildTool === 'npm') {
      const executionImage = getRuntimeImageForTool(buildTool);
      const executionOutcome = await dockerRunnerService.runInContainer({
        image: executionImage,
        cmd: ['sh', '-c', 'npm install --legacy-peer-deps && npm run build --if-present'],
        workspacePath: workspaceDir,
        logger: pipeLogger
      });
      if (executionOutcome.exitCode !== 0) {
        throw new Error(`Build failed with exit code: ${executionOutcome.exitCode}`);
      }
    } else if (buildTool === 'docker') {
      const imageTag = `repo-${runDoc.repoId}:${runId}`;
      await execFileCommand('docker', ['build', '-t', imageTag, '.'], workspaceDir, pipeLogger);
      await pipeLogger.log(`Docker image ${imageTag} built.`);

      try {
        const digest = await getImageDigest(imageTag);
        const signed = await signImageDigest(digest);
        if (signed) {
          await databases.updateDocument(DB_ID, 'pipeline_runs', runId, {
            imageDigest: digest,
            imageSignature: signed.signature,
          });
          await pipeLogger.log(`Image digest signed: ${digest}`);
        } else {
          await pipeLogger.log('Image signing skipped (cosign/COSIGN_KEY_PATH not configured).');
        }
      } catch (signErr: any) {
        logger.warn(`[PipelineService] Image signing step failed for ${imageTag}:`, signErr.message);
        await pipeLogger.log(`Image signing step failed: ${signErr.message}`);
      }
    } else if (buildTool === 'gradle') {
      const executionImage = getRuntimeImageForTool(buildTool);
      const executionOutcome = await dockerRunnerService.runInContainer({
        image: executionImage,
        cmd: ['gradle', 'build', '-x', 'test', '--no-daemon'],
        workspacePath: workspaceDir,
        logger: pipeLogger
      });
      if (executionOutcome.exitCode !== 0) {
        throw new Error(`Build failed with exit code: ${executionOutcome.exitCode}`);
      }
    } else {
      await pipeLogger.log(`No specific build setup for ${buildTool}, skipping compile.`);
    }

    await notifyUpdate('build', { buildStatus: 'success' });

    // --- STAGE 3: TEST ---
    await pipeLogger.log(`--- Stage: test (Running) ---`);
    await notifyUpdate('test', { testStatus: 'running', currentStage: 'test' });
    
    if (buildTool === 'npm') {
      const executionImage = getRuntimeImageForTool(buildTool);
      const executionOutcome = await dockerRunnerService.runInContainer({
        image: executionImage,
        cmd: ['npm', 'test', '--if-present'],
        workspacePath: workspaceDir,
        logger: pipeLogger
      });
      if (executionOutcome.exitCode !== 0) {
        throw new Error(`Test stage failed with exit code: ${executionOutcome.exitCode}`);
      }
    } else if (buildTool === 'gradle') {
      const executionImage = getRuntimeImageForTool(buildTool);
      const executionOutcome = await dockerRunnerService.runInContainer({
        image: executionImage,
        cmd: ['gradle', 'test', '--no-daemon'],
        workspacePath: workspaceDir,
        logger: pipeLogger
      });
      if (executionOutcome.exitCode !== 0) {
        throw new Error(`Test stage failed with exit code: ${executionOutcome.exitCode}`);
      }
    } else {
      await pipeLogger.log(`Skipping tests (no standard command for ${buildTool}).`);
    }

    await notifyUpdate('test', { testStatus: 'success' });

    // --- STAGE 4: SECURITY SCAN ---
    await pipeLogger.log(`--- Stage: security_scan (Running) ---`);
    await notifyUpdate('security_scan', { securityScanStatus: 'running', currentStage: 'security_scan' });
    
    try {
      const criticalThreats = await containerizedTrivyService.runTrivyScan(
        runDoc.$id,
        workspaceDir,
        pipeLogger,
        databases
      );
      // optional: halt pipeline on critical threats
    } catch (secError: any) {
      await pipeLogger.log(`[Security Stage Fault] ${secError.message}`);
    }
    
    await notifyUpdate('security_scan', { securityScanStatus: 'success' });

    // --- STAGE 5: GATE CHECK ---
    await pipeLogger.log(`--- Stage: gate_check (Running) ---`);
    await notifyUpdate('gate_check', { gateCheckStatus: 'running', currentStage: 'gate_check' });
    
    await pipeLogger.log('Evaluating release gate thresholds...');
    const gateRes = await checkReleaseGate(runDoc.repoId);
    await pipeLogger.log(`Gate score: ${gateRes.score}%, Blocker count: ${gateRes.blocker_count}`);
    
    if (!gateRes.allowed) {
      const blockers = gateRes.blockers.map((b: any) => `[${b.severity}] ${b.title}`).join(', ');
      throw new Error(`Policy gates failed (Allowed: false). Blockers: ${blockers}`);
    }
    
    await pipeLogger.log('All gate checks passed.');
    await notifyUpdate('gate_check', { gateCheckStatus: 'success' });

    // --- STAGE 6: DEPLOY ---
    await pipeLogger.log(`--- Stage: deploy (Running) ---`);
    await notifyUpdate('deploy', { deployStatus: 'running', currentStage: 'deploy' });

    await pipeLogger.log('Resolving deployment target environment...');
    let envDoc: any = null;
    try {
      const envName = (runDoc.targetEnvironment || 'production').toString();
      const envRes = await databases.listDocuments(
        DB_ID,
        COLLECTIONS.ENVIRONMENTS,
        [Query.equal('name', envName)]
      );
      if (envRes.documents.length > 0) {
        envDoc = envRes.documents[0];
      }
    } catch (e: any) {
      await pipeLogger.log(`[Deploy] Environment lookup error: ${e.message}`);
    }

    if (envDoc) {
      await pipeLogger.log(`Deploying to remote environment "${envDoc.name}" via SSH.`);
      const serverConfig = {
        host: envDoc.host,
        port: Number(envDoc.port),
        username: envDoc.username,
        privateKey: envDoc.privateKey,
      };
      // repoName can be caller-supplied free text (pipelineRoutes.ts POST /trigger).
      // sshService joins these into one remote shell command without escaping each
      // element individually, so the identifier itself must be stripped of shell
      // metacharacters before it's interpolated - mirrors deployService.ts's
      // executeTargetDeployment sanitization for the same class of identifier.
      const containerName = (runDoc.repoName || runDoc.repoId).replace(/[^a-zA-Z0-9_.-]/g, '-').toLowerCase();
      const remoteCommands = [
        `docker pull scorpion-registry.local/${containerName}:latest`,
        `docker stop ${containerName} || true`,
        `docker rm ${containerName} || true`,
        `docker run -d --name ${containerName} --restart unless-stopped -p 8080:8080 scorpion-registry.local/${containerName}:latest`,
      ];
      const deployResult = await sshService.executeDeployment({
        server: serverConfig,
        deployPath: envDoc.deployPath,
        commands: remoteCommands,
        logger: pipeLogger,
      });
      if (!deployResult.success) {
        throw new Error('Remote SSH deployment failed');
      }
    } else {
      await pipeLogger.log('[Deploy] No remote environment configured; falling back to local deployment.');
      const deployEnv = 'dev';
      const deployRes = await triggerDeploy(runId, deployEnv, 'pipeline-runner');
      if (deployRes.status === 'failed') {
        throw new Error(`Deploy failed: ${deployRes.reason}`);
      }
      await pipeLogger.log(`Successfully deployed. Deployment ID: ${deployRes.deploymentId}`);
    }
    await notifyUpdate('deploy', { deployStatus: 'success' });

    // --- COMPLETE ---
    await pipeLogger.log(`--- Pipeline Completed Successfully ---`);
    const duration = Math.round((Date.now() - startTime) / 1000);
    await notifyUpdate('completed', {
      status: 'success',
      currentStage: 'completed',
      finishedAt: new Date().toISOString(),
      duration
    });

  } catch (err: any) {
    const errorMsg = err.message || JSON.stringify(err);
    await pipeLogger.error(`Pipeline run failed: ${errorMsg}`);
    
    // Find active stage
    const current = runDoc ? runDoc.currentStage : 'trigger';
    const updates: any = {
      status: 'failed',
      finishedAt: new Date().toISOString(),
      duration: Math.round((Date.now() - startTime) / 1000)
    };
    updates[`${current}Status`] = 'failed';

    if (runDoc) {
      await databases.updateDocument(DB_ID, 'pipeline_runs', runDoc.$id, updates);
      notifyStageChange(runDoc.$id, { stage: current, status: 'failed' });
    }
  } finally {
    // Workspace cleanup
    if (workspaceDir) {
      try {
        await fs.rm(workspaceDir, { recursive: true, force: true });
        await pipeLogger.log(`Temporary workspace directory ${workspaceDir} cleaned up.`);
      } catch (cleanupErr: any) {
        logger.error(`[PipelineService] Cleanup failed for ${workspaceDir}: ${cleanupErr.message}`);
      }
    }
  }
}

/**
 * Creates and triggers a new pipeline run for a repository branch.
 */
export async function triggerPipelineRun(
  repoId: string,
  branch: string = 'main',
  commitHash: string = 'MANUAL',
  commitMessage: string = 'Triggered execution',
  author: string = 'unknown',
  repoName?: string,
  cloneUrl?: string
): Promise<string> {
  let repoDoc;
try {
  repoDoc = await databases.getDocument(DB_ID, COLLECTIONS.REPOSITORIES, repoId);
} catch {
  repoDoc = await databases.createDocument(DB_ID, COLLECTIONS.REPOSITORIES, repoId, {
    name: repoName || repoId,
    url: cloneUrl || '',

    user_id: 'system',
    created_at: new Date().toISOString(),
});
}
  
  // 1. Resolve or create pipeline config
  let pipelineId = '';
  const existingPipelines = await databases.listDocuments(DB_ID, 'pipelines', [
    Query.equal('repoId', repoId),
    Query.limit(1)
  ]);

  if (existingPipelines.total > 0) {
    pipelineId = existingPipelines.documents[0].$id;
  } else {
    const newPipeline = await databases.createDocument(DB_ID, 'pipelines', ID.unique(), {
      repoId,
      name: `Pipeline for ${repoDoc.name || repoId}`,
      branch,
      triggerType: 'webhook',
      stages: JSON.stringify(['trigger', 'build', 'test', 'security_scan', 'gate_check', 'deploy']),
      isActive: true
    });
    pipelineId = newPipeline.$id;
  }

  // 2. Create pipeline run doc
  const runId = ID.unique();
  await databases.createDocument(DB_ID, 'pipeline_runs', runId, {
    pipelineId,
    repoId,
    repoName: repoDoc.name || repoId,
    branch,
    commitHash,
    commitMessage,
    author,
    status: 'pending',
    currentStage: 'trigger',
    triggerStatus: 'pending',
    buildStatus: 'pending',
    testStatus: 'pending',
    securityScanStatus: 'pending',
    gateCheckStatus: 'pending',
    deployStatus: 'pending',
    startedAt: new Date().toISOString(),
    finishedAt: '',
    duration: 0
  });

  // 3. Run pipeline asynchronously
  runPipeline(runId).catch(err => {
    logger.error(`[PipelineTrigger] Async execution failed for run ${runId}:`, err);
  });

  return runId;
}
