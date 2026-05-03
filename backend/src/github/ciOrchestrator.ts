import { createAppAuth } from '@octokit/auth-app';
import { Octokit } from '@octokit/rest';
import { setCommitStatus } from './statusService';
import { evaluatePolicy } from './policyEngine';
import { runScanPipeline } from '../scanners/pipeline';
import { databases, DB_ID, COLLECTIONS, ID } from '../lib/appwrite';
import { logScanCompleted, logCIGateBlocked } from '../services/logEvents';
import { scansTotal, ciGateDecisions, scanDuration, activeScans } from '../services/metrics';
import { withSpan } from '../services/tracing';

export interface CIJobOptions {
  owner: string;
  repo: string;
  branch: string;
  sha: string;
  prNumber: number;
  installationId: number;
  cloneUrl: string;
}

export async function triggerCIScan(options: CIJobOptions) {
  const privateKey = process.env.GITHUB_APP_PRIVATE_KEY?.replace(/\\n/g, '\n') || '';
  
  const octokit = new Octokit({
    authStrategy: createAppAuth,
    auth: {
      appId: process.env.GITHUB_APP_ID,
      privateKey: privateKey,
      installationId: options.installationId
    }
  });

  // 1. Immediately set status to "pending"
  const end = scanDuration.startTimer({ scan_type: 'ci_pipeline' });
  activeScans.inc();

  await setCommitStatus(octokit, {
    owner: options.owner,
    repo: options.repo,
    sha: options.sha,
    state: 'pending',
    description: 'SCORPION security scan running...',
    context: 'scorpion/security-gate'
  });

  try {
    // 2. Run scan pipeline
    console.log(`[CI] Starting scan for ${options.owner}/${options.repo} on branch ${options.branch}`);
    const scanResults = await withSpan(
      'ci.scan_pipeline',
      { 
        repo: options.repo, 
        sha: options.sha, 
        scan_type: 'ci_pipeline' 
      },
      () => runScanPipeline({
        owner: options.owner,
        repo: options.repo,
        branch: options.branch,
        cloneUrl: options.cloneUrl
      })
    );

    // 3. Evaluate against policy
    const { passed, summary, criticalCount, highCount } = evaluatePolicy(scanResults);

    // 4. Set final commit status
    await setCommitStatus(octokit, {
      owner: options.owner,
      repo: options.repo,
      sha: options.sha,
      state: passed ? 'success' : 'failure',
      description: passed
        ? `✅ ${summary}`
        : `❌ Blocked: ${criticalCount} critical, ${highCount} high vulnerabilities`,
      context: 'scorpion/security-gate',
      target_url: `${process.env.FRONTEND_URL}/scans/${options.sha}`
    });

    // 5. Store results in Appwrite
    await databases.createDocument(DB_ID, COLLECTIONS.SCANS, ID.unique(), {
      repo_id: options.repo,
      repoUrl: options.cloneUrl,
      status: 'completed',
      scan_type: 'ci_pipeline', // legacy field
      scanType: 'ci_pipeline',  // new field
      gateStatus: passed ? 'passed' : 'failed',
      prNumber: options.prNumber,
      prUrl: `https://github.com/${options.owner}/${options.repo}/pull/${options.prNumber}`,
      prBranch: options.branch,
      details: JSON.stringify({
        sha: options.sha,
        prNumber: options.prNumber,
        passed,
        summary
      }),
      criticalCount,
      highCount,
      timestamp: new Date().toISOString()
    });

    console.log(`[CI] Scan completed for ${options.repo} (${options.sha}). Passed: ${passed}`);
    
    // Metrics
    scansTotal.inc({ scan_type: 'ci_pipeline', status: passed ? 'passed' : 'failed' });
    ciGateDecisions.inc({ result: passed ? 'pass' : 'fail' });
    activeScans.dec();
    end();

    // Loki Logging
    
    // Loki Logging
    logScanCompleted(options.repo, criticalCount, passed);
    if (!passed) {
      logCIGateBlocked(options.repo, options.sha, `${criticalCount} critical CVEs`);
    }

    // Compliance Evaluation
    const { evaluateCompliance } = await import('../services/complianceEngine');
    evaluateCompliance().catch(err => console.error('[Compliance] Auto-eval failed:', err));

  } catch (err) {
    console.error(`[CI] Error during scan for ${options.repo}:`, err);
    await setCommitStatus(octokit, {
      owner: options.owner,
      repo: options.repo,
      sha: options.sha,
      state: 'error',
      description: 'SCORPION scan encountered an error',
      context: 'scorpion/security-gate'
    });
    activeScans.dec();
    end();
  }
}
