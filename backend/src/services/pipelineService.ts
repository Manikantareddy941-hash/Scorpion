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
import { EnvironmentDocument, PipelineRunDocument, StageUpdate } from '../types/pipeline.types';
import { GateBlocker } from '../types/gate.types';



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

export function notifyStageChange(runId: string, data: Record<string, unknown>) {
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

  async error(message: string, error?: unknown) {
    const errorDetail = error instanceof Error ? (error.stack || error.message) : (error ? JSON.stringify(error) : '');
    const formatted = `[${new Date().toISOString()}] [ERROR] ${message} ${errorDetail}\n`;
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
    return 'node:24-alpine';
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
  } catch (error) {
    await pipeLogger.error(`Command failed: ${safeCommand}`, error);
    throw error;
  }
}

/**
 * Runs a build/test command for a detected build tool inside its runtime container,
 * and throws with a stage-appropriate message on non-zero exit.
 */
async function executeStageInContainer(
  buildTool: string,
  cmd: string[],
  workspaceDir: string,
  pipeLogger: PipelineLogger,
  stageLabel: 'Build' | 'Test'
): Promise<void> {
  const executionImage = getRuntimeImageForTool(buildTool);
  const executionOutcome = await dockerRunnerService.runInContainer({
    image: executionImage,
    cmd,
    workspacePath: workspaceDir,
    logger: pipeLogger
  });
  if (executionOutcome.exitCode !== 0) {
    throw new Error(`${stageLabel} failed with exit code: ${executionOutcome.exitCode}`);
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
  let runDoc: PipelineRunDocument | null = null;

  try {
    // 1. Fetch the pipeline run document
    runDoc = await databases.getDocument<PipelineRunDocument>(DB_ID, 'pipeline_runs', runId);
    
    // Update main status to running
    await databases.updateDocument(DB_ID, 'pipeline_runs', runId, {
      status: 'running',
      startedAt: new Date().toISOString(),
    });

    // A missing repository fails the run rather than conjuring a placeholder.
    // Pipeline runs are authorized through their repository (canAccessRun ->
    // canAccessResource), and nothing at execution time knows who owns this
    // run — pipeline_runs carries no owner field. The previous fallback
    // stamped user_id:'system', which belongs to no tenant, so the repo and
    // every result hanging off it were unreachable by everyone including the
    // user who triggered the run. Failing loudly beats producing dark data.
    // The outer catch marks the run failed and notifies the stage.
    let repoDoc;
    try {
      repoDoc = await databases.getDocument(DB_ID, COLLECTIONS.REPOSITORIES, runDoc.repoId);
    } catch {
      throw new Error(
        `Repository ${runDoc.repoId} no longer exists; cannot run pipeline ${runId} without an owning repository.`
      );
    }
    const repoUrl = repoDoc.url;

    workspaceDir = path.join(os.tmpdir(), 'scorpion-builds', runId);
    await fs.mkdir(workspaceDir, { recursive: true });

    const notifyUpdate = async (stage: string, updates: StageUpdate) => {
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
      await executeStageInContainer(
        buildTool,
        ['sh', '-c', 'npm install --legacy-peer-deps && npm run build --if-present'],
        workspaceDir,
        pipeLogger,
        'Build'
      );
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
      } catch (signErr) {
        const message = signErr instanceof Error ? signErr.message : String(signErr);
        logger.warn(`[PipelineService] Image signing step failed for ${imageTag}:`, message);
        await pipeLogger.log(`Image signing step failed: ${message}`);
      }
    } else if (buildTool === 'gradle') {
      await executeStageInContainer(
        buildTool,
        ['gradle', 'build', '-x', 'test', '--no-daemon'],
        workspaceDir,
        pipeLogger,
        'Build'
      );
    } else {
      await pipeLogger.log(`No specific build setup for ${buildTool}, skipping compile.`);
    }

    await notifyUpdate('build', { buildStatus: 'success' });

    // --- STAGE 3: TEST ---
    await pipeLogger.log(`--- Stage: test (Running) ---`);
    await notifyUpdate('test', { testStatus: 'running', currentStage: 'test' });
    
    if (buildTool === 'npm') {
      await executeStageInContainer(buildTool, ['npm', 'test', '--if-present'], workspaceDir, pipeLogger, 'Test');
    } else if (buildTool === 'gradle') {
      await executeStageInContainer(buildTool, ['gradle', 'test', '--no-daemon'], workspaceDir, pipeLogger, 'Test');
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
    } catch (secError) {
      await pipeLogger.log(`[Security Stage Fault] ${secError instanceof Error ? secError.message : secError}`);
    }
    
    await notifyUpdate('security_scan', { securityScanStatus: 'success' });

    // --- STAGE 5: GATE CHECK ---
    await pipeLogger.log(`--- Stage: gate_check (Running) ---`);
    await notifyUpdate('gate_check', { gateCheckStatus: 'running', currentStage: 'gate_check' });
    
    await pipeLogger.log('Evaluating release gate thresholds...');
    const gateRes = await checkReleaseGate(runDoc.repoId);
    await pipeLogger.log(`Gate score: ${gateRes.score}%, Blocker count: ${gateRes.blocker_count}`);
    
    if (!gateRes.allowed) {
      const blockers = gateRes.blockers.map((b: GateBlocker) => `[${b.severity}] ${b.title}`).join(', ');
      throw new Error(`Policy gates failed (Allowed: false). Blockers: ${blockers}`);
    }
    
    await pipeLogger.log('All gate checks passed.');
    await notifyUpdate('gate_check', { gateCheckStatus: 'success' });

    // --- STAGE 6: DEPLOY ---
    await pipeLogger.log(`--- Stage: deploy (Running) ---`);
    await notifyUpdate('deploy', { deployStatus: 'running', currentStage: 'deploy' });

    await pipeLogger.log('Resolving deployment target environment...');
    let envDoc: EnvironmentDocument | null = null;
    try {
      const envName = (runDoc.targetEnvironment || 'production').toString();
      const envRes = await databases.listDocuments<EnvironmentDocument>(
        DB_ID,
        COLLECTIONS.ENVIRONMENTS,
        [Query.equal('name', envName)]
      );
      if (envRes.documents.length > 0) {
        envDoc = envRes.documents[0];
      }
    } catch (e) {
      await pipeLogger.log(`[Deploy] Environment lookup error: ${e instanceof Error ? e.message : e}`);
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

  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : JSON.stringify(err);
    await pipeLogger.error(`Pipeline run failed: ${errorMsg}`);

    // Find active stage
    const current = runDoc ? runDoc.currentStage : 'trigger';
    const updates: StageUpdate = {
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
      } catch (cleanupErr) {
        logger.error(`[PipelineService] Cleanup failed for ${workspaceDir}: ${cleanupErr instanceof Error ? cleanupErr.message : cleanupErr}`);
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
  cloneUrl?: string,
  /**
   * Owner to stamp if the repository has to be created. Required for that
   * path: a repo with no real owner fails canAccessResource for everyone, so
   * the run's own results become unreachable.
   */
  ownerUserId?: string
): Promise<string> {
  let repoDoc;
  try {
    repoDoc = await databases.getDocument(DB_ID, COLLECTIONS.REPOSITORIES, repoId);
  } catch {
    if (!ownerUserId) {
      throw new Error(
        `Cannot create repository ${repoId}: no owner supplied. Refusing to create an unowned repository.`
      );
    }
    repoDoc = await databases.createDocument(DB_ID, COLLECTIONS.REPOSITORIES, repoId, {
      name: repoName || repoId,
      url: cloneUrl || '',
      user_id: ownerUserId,
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

  // 2. Reuse an in-flight run for the same commit instead of starting a duplicate
  // one - webhook providers (GitHub/GitLab) retry delivery on timeout/non-2xx, and
  // without this guard each retry re-ran the full build/test/deploy pipeline.
  // A deterministic doc ID (keyed on repo+branch+commit) makes the claim atomic:
  // two concurrent retries both call createDocument with the SAME id, Appwrite
  // only lets one succeed, and the loser fetches the winner's doc instead of
  // racing past a read-then-write check. 'MANUAL' commits (button-triggered runs)
  // skip this since every manual trigger should be allowed to run independently.
  const dedupeWindowMs = 15 * 60 * 1000;
  const isRetriable = commitHash !== 'MANUAL';
  const runId = isRetriable
    ? `run_${crypto.createHash('sha1').update(`${repoId}:${branch}:${commitHash}`).digest('hex').slice(0, 32)}`
    : ID.unique();

  const runData = {
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
  };

  // 3. Create pipeline run doc
  try {
    await databases.createDocument(DB_ID, 'pipeline_runs', runId, runData);
  } catch (err: any) {
    if (!isRetriable || err?.code !== 409) throw err;

    // Lost the atomic create race, or a prior run already occupies this
    // deterministic id. Either way, resolve it deterministically instead of
    // racing: reuse it if still active, otherwise restart it in place.
    const existingRun = await databases.getDocument(DB_ID, 'pipeline_runs', runId);
    const isActive = (existingRun.status === 'pending' || existingRun.status === 'running') &&
      Date.now() - new Date(existingRun.startedAt).getTime() < dedupeWindowMs;

    if (isActive) {
      logger.info(`[PipelineTrigger] Reusing in-flight run ${existingRun.$id} for ${repoId}@${branch}#${commitHash}`);
      return existingRun.$id;
    }

    await databases.updateDocument(DB_ID, 'pipeline_runs', runId, runData);
  }

  // 4. Run pipeline asynchronously
  runPipeline(runId).catch(err => {
    logger.error(`[PipelineTrigger] Async execution failed for run ${runId}:`, err);
  });

  return runId;
}
