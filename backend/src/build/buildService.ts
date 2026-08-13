import { cloneRepo } from '../utils/git';
import { runScanPipeline } from '../scanners/pipeline';
import { logger, errorContext, errorMessage } from '../services/logger';
import { buildsTotal, buildDuration } from '../services/metrics';
import { auditLog } from '../services/auditService';
import { databases, COLLECTIONS, DB_ID, ID } from '../lib/appwrite';
import { getImageDigest, signImageDigest, CosignSigningError } from '../services/cosignService';
import { attestProvenance } from '../services/provenanceService';
import { putProvenance } from '../services/imageStore';
import { isExecError, isRecord } from '../utils/errorGuards';
import { BuildCommandError } from './buildCommandError';
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
  } catch (error: unknown) {
    const stdout = isExecError(error) ? String(error.stdout ?? '') : '';
    const stderr = isExecError(error) ? String(error.stderr ?? '') : '';

    logs += `[ERROR]: ${errorMessage(error)}\n`;
    if (stdout) logs += `${stdout}\n`;
    if (stderr) logs += `[stderr]: ${stderr}\n`;

    // Was `throw { ...error, logs }`. Spreading an Error yields an object with no
    // `message` and no `stack` — V8 marks both non-enumerable — so the reason for
    // the failure was destroyed at the throw and the outer handler's
    // JSON.stringify fallback existed only to paper over it. A real Error thrown
    // by reference keeps the message, the stack, instanceof, and the cause.
    throw new BuildCommandError('Build command execution failed', {
      stdout,
      stderr,
      logs,
      cause: error,
    });
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
  } catch (err) {
    logger.error(`[BuildService] Failed to fetch repo ${repoId}`, { ...errorContext(err) });
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
  } catch (err) {
    logger.error(`[BuildService] Failed to create pipeline document`, { ...errorContext(err) });
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
        // Must match the tag deployService.ts reconstructs as `repo-${repoId}:${buildId}`
        // (buildId there IS this pipelineId) - using randomId here instead meant the
        // image deployService.ts later tried to scan/run never actually existed under
        // that tag, silently no-opping the pre-deploy Trivy CVE gate.
        const imageName = `repo-${repoId}:${pipelineId}`;
        const res1 = await execWithLogs(`docker build -t ${imageName} .`, tempDir, pipelineId, logs);
        logs = res1.logs;
        logs += `Docker image ${imageName} built successfully.\n`;

        try {
          const digest = await getImageDigest(imageName);
          const signed = await signImageDigest(digest);
          if (signed) {
            await databases.updateDocument(DB_ID, COLLECTIONS.BUILD_PIPELINES, pipelineId, {
              imageDigest: digest,
              imageSignature: signed.signature,
            });
            logs += `Image digest signed: ${digest}\n`;
          } else {
            // Reachable only when COSIGN_KEY_PATH is unset. A configured-but-
            // broken signer throws now, so this line no longer doubles as the
            // report for a failure.
            logs += `Image signing skipped (COSIGN_KEY_PATH not configured).\n`;
          }

          // SLSA provenance: statement over this digest + repo/commit, signed
          // with the same cosign key. attestProvenance skips (null) when
          // signing isn't configured — same opt-in semantics as above.
          const { stdout: shaOut } = await execAsync('git rev-parse HEAD', { cwd: tempDir });
          const provenance = await attestProvenance({
            imageName,
            imageDigest: digest,
            repoUrl,
            branch,
            commitSha: shaOut.trim(),
            invocationId: pipelineId,
            startedOn: startTimeIso,
            finishedOn: new Date().toISOString(),
          });
          if (provenance) {
            const provenanceJson = JSON.stringify(provenance);

            // Durable copy on the build record, which is what deployService's
            // gate reads. imageStore below stays as the hot path: it is Redis on
            // a 1h TTL sized for the CI-build -> admission window, so it cannot
            // answer for an image deployed later or after a restart.
            //
            // Best-effort on purpose. `provenance` is capped at 16KB by the
            // migration, and Appwrite rejects the whole document write on
            // oversize — failing a signed, scanned build to save the metadata
            // about it would be the wrong trade. A gate that finds no statement
            // reports absent, which is the truthful record.
            try {
              await databases.updateDocument(DB_ID, COLLECTIONS.BUILD_PIPELINES, pipelineId, {
                provenance: provenanceJson,
              });
            } catch (provErr) {
              logger.warn('[BuildService] provenance record write failed', {
                event: 'BUILD_PROVENANCE_PERSIST_FAILED',
                pipelineId,
                imageDigest: digest,
                ...errorContext(provErr),
              });
              logs += `Provenance could not be recorded on the build (deploy will read it as absent).\n`;
            }

            // Tenant-less HERE ONLY, and no longer load-bearing: this is the
            // short-lived cache, and the durable copy above lives on a
            // repo-scoped record. The statement is signed, and deployService now
            // verifies it against the deployed digest rather than trusting where
            // it was read from — which is what the old comment claimed and
            // nothing did (#187).
            await putProvenance(null, digest, provenanceJson);
            logs += `SLSA provenance attested for ${digest} (commit ${shaOut.trim()}).\n`;
          } else {
            logs += `Provenance attestation skipped (signing not configured).\n`;
          }
        } catch (signErr) {
          // A failed signature is not the same class of event as the rest of this
          // block. If the pipeline was configured to sign and the signer broke,
          // the build fails: an unsigned image from a host that intended to sign
          // is indistinguishable downstream from an image nobody ever meant to
          // sign, and deployService's gate deliberately waves the latter through
          // as making no claim. Swallowing this made sabotaging the signer a
          // complete bypass of the deploy signature gate — cheaper than defeating
          // the crypto, which is the wrong relative cost.
          //
          // `.logs` is attached because the outer catch prefers error.logs over
          // its own accumulator, and losing the build transcript here would hide
          // why the pipeline stopped.
          if (signErr instanceof CosignSigningError) {
            logger.error('[BuildService] image signing failed — failing the build', {
              event: 'BUILD_SIGNING_FAILED',
              imageRef: imageName,
              ...errorContext(signErr),
            });
            logs += `Image signing failed: ${errorMessage(signErr)}\n`;
            throw Object.assign(signErr, { logs });
          }

          // Everything else this block does is best-effort: reading the digest,
          // resolving the commit, writing provenance to Redis. A Redis blip is
          // not a reason to fail a build that produced a correctly signed image.
          logger.warn('[BuildService] image provenance step failed', {
            event: 'BUILD_PROVENANCE_FAILED',
            imageRef: imageName,
            ...errorContext(signErr),
          });
          logs += `Image provenance step failed: ${errorMessage(signErr)}\n`;
        }
      } else if (buildTool === 'gradle') {
        const res1 = await execWithLogs('./gradlew build -x test', tempDir, pipelineId, logs);
        logs = res1.logs;
      } else {
        logs += `No default build command for ${buildTool}. Skipping build execution.\n`;
      }

      finalStatus = 'success';
      logs += `Build pipeline completed successfully.\n`;
      
    } catch (error: unknown) {
      finalStatus = 'failed';

      // BuildCommandError first, then the structural fallback: anything thrown
      // before execWithLogs runs — a clone failure, an Appwrite write, a signing
      // error — arrives as an ordinary Error with none of these fields.
      const buildLogs = error instanceof BuildCommandError
        ? error.logs
        : isRecord(error) && 'logs' in error
          ? String(error.logs ?? '')
          : undefined;

      const stdout = error instanceof BuildCommandError
        ? error.stdout
        : isRecord(error) && 'stdout' in error
          ? String(error.stdout ?? '')
          : undefined;

      const stderr = error instanceof BuildCommandError
        ? error.stderr
        : isRecord(error) && 'stderr' in error
          ? String(error.stderr ?? '')
          : undefined;

      // The else branch is load-bearing: `logs` is the transcript persisted on the
      // pipeline document and read by a human afterwards. Without it a failure with
      // no captured transcript ends mid-step with no stated reason, even though the
      // reason still reaches Loki below. errorMessage covers what the old
      // `error.message || JSON.stringify(error)` covered, and the JSON.stringify arm
      // is no longer needed now that the throw above is a real Error.
      if (buildLogs) {
        logs = buildLogs;
      } else {
        logs += `\n[FATAL ERROR]: ${errorMessage(error)}\n`;
      }

      // `transcript`, not `logs`: the payload key would otherwise read as the same
      // name as the surrounding variable and the class field while meaning the
      // captured build output specifically.
      logger.error(`[BuildService] Build pipeline failed for ${repoId}`, {
        ...errorContext(error),
        ...(buildLogs ? { transcript: buildLogs } : {}),
        ...(stdout ? { stdout } : {}),
        ...(stderr ? { stderr } : {}),
      });
    } finally {
      // 7. Cleanup & Update Final Status
      try {
        await fs.rm(tempDir, { recursive: true, force: true });
        logs += `Cleaned up workspace.\n`;
      } catch (cleanupErr) {
        logger.error(`[BuildService] Failed to clean up ${tempDir}`, { ...errorContext(cleanupErr) });
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
        logger.error(`[BuildService] Failed to update final pipeline status`, { ...errorContext(updateErr) });
      }
    }
  })();

  return pipelineId;
}
