import { databases, DB_ID, COLLECTIONS, ID } from '../lib/appwrite';
import { triggerRollback } from './rollbackService';
import { queryCanaryMetrics } from './prometheusMetrics';
import {
  CanaryThresholds,
  evaluateCanaryCheck,
  nextCanaryState,
} from './canaryAnalysis';
import { enqueueCanaryCheck } from '../queues/canaryQueue';
import { createIncident } from '../services/incidentService';
import { auditLog } from '../services/auditService';
import { logger, errorContext } from '../services/logger';

/**
 * Flagger-style canary analysis controller. Scorpion is the analysis/decision
 * brain: it watches the canary's live metrics tick by tick and decides
 * continue / promote / rollback. Traffic shifting stays with the mesh/ALB.
 * Rollback reuses the existing GitOps rollback-PR + incident + Slack flow.
 */

export class CanaryAccessError extends Error {}
export class CanaryStateError extends Error {}

export interface CanaryWorkerPayload {
  canaryId: string;
  tick: number;
}

export interface StartCanaryInput {
  app: string;
  namespace: string;
  image: string;
  repo: string;
  stableRevision: string;
  canaryRevision: string;
  thresholds: CanaryThresholds;
  intervalSec: number;
  maxFailures: number;
  requiredChecks: number;
  userId: string;
}

export interface CanaryCheckEntry {
  at: string;
  errorRatePct: number | null;
  p95LatencyMs: number | null;
  passed: boolean;
  reason: string;
}

const MAX_STORED_CHECKS = 50;

const clamp = (v: number, min: number, max: number) => Math.min(max, Math.max(min, Math.floor(v)));

export async function startCanary(input: StartCanaryInput): Promise<{ canaryId: string }> {
  const canaryId = ID.unique();
  const intervalSec = clamp(input.intervalSec, 10, 3600);
  await databases.createDocument(DB_ID, COLLECTIONS.CANARIES, canaryId, {
    user_id: input.userId,
    app: input.app,
    namespace: input.namespace,
    image: input.image,
    repo: input.repo,
    stableRevision: input.stableRevision,
    canaryRevision: input.canaryRevision,
    thresholds: JSON.stringify(input.thresholds),
    intervalSec,
    maxFailures: clamp(input.maxFailures, 1, 10),
    requiredChecks: clamp(input.requiredChecks, 1, 100),
    status: 'running',
    consecutiveFailures: 0,
    passedChecks: 0,
    checks: '[]',
    startedAt: new Date().toISOString(),
  });
  await enqueueCanaryCheck({ canaryId, tick: 1 }, intervalSec * 1000);
  await auditLog({
    action: 'canary.started',
    actor: input.userId,
    actorEmail: 'system@scorpion',
    resource: 'canary',
    resourceId: canaryId,
    details: { app: input.app, namespace: input.namespace, image: input.image },
  });
  return { canaryId };
}

/** One analysis tick: sample metrics, decide, act. BullMQ worker entrypoint. */
export async function runCanaryTick(canaryId: string, tick: number): Promise<void> {
  const doc = await databases.getDocument(DB_ID, COLLECTIONS.CANARIES, canaryId);
  if (doc.status !== 'running') return; // aborted/terminal while this tick sat in the queue

  const thresholds = JSON.parse(doc.thresholds as string) as CanaryThresholds;
  const metrics = await queryCanaryMetrics(doc.app as string, doc.namespace as string);
  const check = evaluateCanaryCheck(metrics, thresholds);
  const { progress, verdict } = nextCanaryState(
    { consecutiveFailures: doc.consecutiveFailures as number, passedChecks: doc.passedChecks as number },
    check,
    doc.maxFailures as number,
    doc.requiredChecks as number
  );

  const entry: CanaryCheckEntry = {
    at: new Date().toISOString(),
    errorRatePct: metrics.errorRatePct,
    p95LatencyMs: metrics.p95LatencyMs,
    passed: check.passed,
    reason: check.reason,
  };
  const checks = ([...JSON.parse(doc.checks as string), entry] as CanaryCheckEntry[]).slice(-MAX_STORED_CHECKS);

  logger.info(`[Canary] ${doc.app} tick ${tick}: ${check.passed ? 'PASS' : 'FAIL'} (${check.reason}) → ${verdict}`);

  if (verdict === 'rollback') {
    // Rollback PR is best-effort: a GitHub outage must not leave the canary
    // stuck 'running' — the terminal status lands regardless.
    try {
      await triggerRollback({
        app: doc.app as string,
        image: doc.image as string,
        revision: doc.canaryRevision as string,
        repo: doc.repo as string,
        criticalCount: 0,
      });
    } catch (err) {
      logger.error('[Canary] rollback PR failed', {
        event: 'CANARY_ROLLBACK_PR_FAILED',
        app: doc.app, revision: doc.canaryRevision,
        ...errorContext(err),
      });
    }
    await createIncident({
      title: `Canary rolled back: ${doc.app}`,
      severity: 'High',
      source: 'gitops',
      description: `Canary analysis failed ${progress.consecutiveFailures} consecutive check(s). Last: ${check.reason}`,
      userId: doc.user_id as string,
    });
    await databases.updateDocument(DB_ID, COLLECTIONS.CANARIES, canaryId, {
      status: 'rolled_back',
      consecutiveFailures: progress.consecutiveFailures,
      passedChecks: progress.passedChecks,
      checks: JSON.stringify(checks),
      finishedAt: new Date().toISOString(),
    });
    await auditLog({
      action: 'canary.rolled_back',
      actor: 'system',
      actorEmail: 'system@scorpion',
      resource: 'canary',
      resourceId: canaryId,
      details: { app: doc.app, reason: check.reason },
    });
    return;
  }

  if (verdict === 'promote') {
    await databases.updateDocument(DB_ID, COLLECTIONS.CANARIES, canaryId, {
      status: 'promoted',
      consecutiveFailures: progress.consecutiveFailures,
      passedChecks: progress.passedChecks,
      checks: JSON.stringify(checks),
      finishedAt: new Date().toISOString(),
    });
    await auditLog({
      action: 'canary.promoted',
      actor: 'system',
      actorEmail: 'system@scorpion',
      resource: 'canary',
      resourceId: canaryId,
      details: { app: doc.app, passedChecks: progress.passedChecks },
    });
    return;
  }

  await databases.updateDocument(DB_ID, COLLECTIONS.CANARIES, canaryId, {
    consecutiveFailures: progress.consecutiveFailures,
    passedChecks: progress.passedChecks,
    checks: JSON.stringify(checks),
  });
  await enqueueCanaryCheck({ canaryId, tick: tick + 1 }, (doc.intervalSec as number) * 1000);
}

export async function abortCanary(canaryId: string, userId: string): Promise<void> {
  const doc = await databases.getDocument(DB_ID, COLLECTIONS.CANARIES, canaryId);
  if (doc.user_id !== userId) throw new CanaryAccessError('You do not have access to this canary');
  if (doc.status !== 'running') throw new CanaryStateError(`Canary is not running (status: ${doc.status})`);
  await databases.updateDocument(DB_ID, COLLECTIONS.CANARIES, canaryId, {
    status: 'aborted',
    finishedAt: new Date().toISOString(),
  });
  await auditLog({
    action: 'canary.aborted',
    actor: userId,
    actorEmail: 'system@scorpion',
    resource: 'canary',
    resourceId: canaryId,
    details: { app: doc.app },
  });
}
