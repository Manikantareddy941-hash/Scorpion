import { cloneRepo } from '../utils/git';
import { runScanPipeline } from '../scanners/pipeline';
import { logger } from '../services/logger';
import { buildsTotal, buildDuration } from '../services/metrics';
import { auditLog } from '../services/auditService';
import { databases, COLLECTIONS, DB_ID, ID } from '../lib/appwrite';
import fs from 'fs/promises';
import path from 'path';
import os from 'os';
import crypto from 'crypto';
import { exec } from 'child_process';
import util from 'util';

const execAsync = util.promisify(exec);

/**
 * Detect the build tool based on files in the repository.
 */
async function detectBuildTool(dir: string): Promise<string> {
  const files = await fs.readdir(dir);
  if (files.includes('Dockerfile')) return 'docker';
  if (files.includes('package.json')) return 'npm';
  if (files.includes('build.gradle') || files.includes('build.gradle.kts')) return 'gradle';
  if (files.includes('requirements.txt')) return 'python';
  return 'unknown';
}

/**
 * Executes a shell command and appends output to the Appwrite document logs.
 */
async function execWithLogs(
  command: string, 
  cwd: string, 
  pipelineId: string, 
  existingLogs: string
): Promise<{ stdout: string; stderr: string; logs: string }> {
  let logs = existingLogs + `\n> ${command}\n`;
  try {
    const { stdout, stderr } = await execAsync(command, { cwd });
    if (stdout) logs += `${stdout}\n`;
    if (stderr) logs += `[stderr]: ${stderr}\n`;
    return { stdout, stderr, logs };
  } catch (error: any) {
    logs += `[ERROR]: ${error.message}\n`;
    if (error.stdout) logs += `${error.stdout}\n`;
    if (error.stderr) logs += `[stderr]: ${error.stderr}\n`;
    throw { ...error, logs };
  }
}

/**
 * Starts a CI build pipeline, clones the repo, runs build and security scan.
 */
export async function startBuild(repoId: string, branch: string, triggeredBy: string): Promise<string> {
  logger.info(`[BuildService] Starting build for repo ${repoId} on branch ${branch}`);
  
  const pipelineId = ID.unique();
  const startTime = Date.now();
  const startTimeIso = new Date(startTime).toISOString();
  
  let repoUrl = '';
  let repoName = repoId;
  let logs = 'Initializing build pipeline...\n';

  try {
    // 1. Fetch Repository Details
    const repoDoc = await databases.getDocument(DB_ID, COLLECTIONS.REPOSITORIES, repoId);
    repoUrl = repoDoc.url;
    repoName = repoDoc.name || repoId;
    logs += `Fetched repo: ${repoUrl}\n`;
  } catch (err: any) {
    logger.error(`[BuildService] Failed to fetch repo ${repoId}`, err);
    throw new Error(`Failed to find repository with ID ${repoId}`);
  }

  // 2. Create Initial Build Pipeline Record
  try {
    await databases.createDocument(DB_ID, COLLECTIONS.BUILD_PIPELINES, pipelineId, {
      name: `Build ${repoName} - ${branch}`,
      repoId,
      status: 'running',
      buildTool: 'detecting',
      branch,
      triggeredBy,
      startedAt: startTimeIso,
      logs
    });
  } catch (err: any) {
    logger.error(`[BuildService] Failed to create pipeline document`, err);
    throw err;
  }

  // Run the rest asynchronously in the background so we can return the ID immediately
  (async () => {
    const randomId = crypto.randomBytes(6).toString('hex');
    const tempDir = path.join(os.tmpdir(), `scorpion-build-${repoId}-${randomId}`);
    
    let buildTool = 'unknown';
    let finalStatus = 'failed';

    try {
      // 3. Clone Repository
      logs += `Cloning repository branch '${branch}'...\n`;
      await databases.updateDocument(DB_ID, COLLECTIONS.BUILD_PIPELINES, pipelineId, { logs });
      
      await cloneRepo({
        cloneUrl: repoUrl,
        branch,
        destination: tempDir
      });
      logs += `Successfully cloned repository.\n`;

      // 4. Detect Build Tool
      buildTool = await detectBuildTool(tempDir);
      logs += `Detected build tool: ${buildTool}\n`;
      await databases.updateDocument(DB_ID, COLLECTIONS.BUILD_PIPELINES, pipelineId, { logs, buildTool });

      // 5. Run Security Scan
      logs += `Running security scans via pipeline...\n`;
      await databases.updateDocument(DB_ID, COLLECTIONS.BUILD_PIPELINES, pipelineId, { logs });
      
      const scanResults = await runScanPipeline({ localPath: tempDir });
      logs += `Security scans completed.\n`;

      // 6. Run Build
      logs += `Executing build phase...\n`;
      if (buildTool === 'npm') {
        const res1 = await execWithLogs('npm install', tempDir, pipelineId, logs);
        logs = res1.logs;
        const res2 = await execWithLogs('npm run build --if-present', tempDir, pipelineId, logs);
        logs = res2.logs;
      } else if (buildTool === 'docker') {
        const imageName = `repo-${repoId}:${randomId}`;
        const res1 = await execWithLogs(`docker build -t ${imageName} .`, tempDir, pipelineId, logs);
        logs = res1.logs;
        logs += `Docker image ${imageName} built successfully.\n`;
      } else if (buildTool === 'gradle') {
        const res1 = await execWithLogs('./gradlew build -x test', tempDir, pipelineId, logs);
        logs = res1.logs;
      } else {
        logs += `No default build command for ${buildTool}. Skipping build execution.\n`;
      }

      finalStatus = 'success';
      logs += `Build pipeline completed successfully.\n`;
      
    } catch (error: any) {
      logger.error(`[BuildService] Build pipeline failed for ${repoId}`, error);
      finalStatus = 'failed';
      logs = error.logs || (logs + `\n[FATAL ERROR]: ${error.message || JSON.stringify(error)}\n`);
    } finally {
      // 7. Cleanup & Update Final Status
      try {
        await fs.rm(tempDir, { recursive: true, force: true });
        logs += `Cleaned up workspace.\n`;
      } catch (cleanupErr) {
        logger.error(`[BuildService] Failed to clean up ${tempDir}`, cleanupErr);
      }

      const durationSeconds = (Date.now() - startTime) / 1000;

      try {
        await databases.updateDocument(DB_ID, COLLECTIONS.BUILD_PIPELINES, pipelineId, {
          status: finalStatus,
          finishedAt: new Date().toISOString(),
          logs: logs.substring(0, 4999) 
        });
        
        // Record Prometheus Metrics
        buildsTotal.labels({ status: finalStatus, tool: buildTool }).inc();
        buildDuration.labels({ tool: buildTool }).observe(durationSeconds);

        // Audit Log Completion
        await auditLog({
          action: 'build.completed',
          actor: 'system',
          actorEmail: 'system@scorpion.local',
          resource: 'build_pipelines',
          resourceId: pipelineId,
          details: { status: finalStatus, duration: durationSeconds, buildTool }
        });

        logger.info(`[BuildService] Pipeline ${pipelineId} finished with status: ${finalStatus}`);
        
      } catch (updateErr) {
        logger.error(`[BuildService] Failed to update final pipeline status`, updateErr);
      }
    }
  })();

  return pipelineId;
}
