import { Worker } from 'bullmq';
import { redisConnection } from './redisConnection';
import { SOAR_QUEUE_NAME, SoarJobPayload } from './soarQueue';
import { soarRepository } from '../repositories/soarRepository';
import { executeSoarAction, createK8sPodActions, K8sPodActions } from '../soar/soarActions';
import { createIncident } from '../services/incidentService';
import { logger } from '../services/logger';

/** Exported for unit tests; the worker below is the production entry. */
export async function processSoarJob(
  payload: SoarJobPayload,
  k8s: K8sPodActions = createK8sPodActions(),
): Promise<void> {
  const action = await soarRepository.getAction(payload.actionId);
  if (!action) {
    logger.warn(`[SOAR] action ${payload.actionId} not found, skipping`);
    return;
  }

  // Idempotency backstop: only 'approved' executes. A retried/duplicated job
  // for an already-executed action is a no-op, never a second kill.
  if (action.status !== 'approved') {
    logger.info(`[SOAR] action ${action.id} is '${action.status}', skipping`);
    return;
  }

  const outcome = await executeSoarAction(action, {
    k8s,
    falcoEventJson: payload.falcoEventJson,
    // Fall back to the action record's own owner so Slack scoping stays
    // correct even if a future enqueue path forgets to pass ownerUserId.
    ownerUserId: payload.ownerUserId ?? action.ownerUserId,
  });

  if (outcome.ok) {
    // Trade-off: if this record-write fails we swallow the error instead of
    // rethrowing. A rethrow makes BullMQ retry the job against a record still
    // marked 'approved', re-running an already-executed destructive action
    // (second kill_pod). Stale status beats double execution.
    try {
      await soarRepository.setActionStatus(action.id, 'executed', { result: outcome.result });
    } catch (err) {
      logger.error(
        `[SOAR] action ${action.id} executed but status write failed; record may still read 'approved':`,
        err instanceof Error ? err.message : String(err),
      );
    }
    return;
  }

  // Fail-loud: a containment action that could not run is itself an incident.
  // createIncident runs first and in its own try/catch: if it threw after a
  // successful setActionStatus('failed'), a BullMQ retry would see status
  // 'failed', skip re-processing (see the status check above), and the
  // "containment failed" incident would never get created. Isolating the two
  // writes means one failing can never suppress the other.
  try {
    await createIncident({
      title: `SOAR action failed: ${action.actionType} for ${action.falcoRule}`,
      severity: 'Critical',
      source: 'soar',
      description: outcome.error,
    });
  } catch (err) {
    logger.error(
      `[SOAR] action ${action.id} failed but incident creation also failed:`,
      err instanceof Error ? err.message : String(err),
    );
  }
  await soarRepository.setActionStatus(action.id, 'failed', { error: outcome.error });
}

let soarWorker: Worker<SoarJobPayload> | null = null;

export const initSoarQueueWorker = () => {
  soarWorker = new Worker<SoarJobPayload>(
    SOAR_QUEUE_NAME,
    async (job) => processSoarJob(job.data),
    { connection: redisConnection, concurrency: 2 },
  );

  soarWorker.on('failed', (job, err) => {
    logger.error(`[SoarQueue] Job ${job?.id} failed:`, err.message);
  });

  logger.info('[SoarQueue] Worker initialized.');
  return soarWorker;
};
