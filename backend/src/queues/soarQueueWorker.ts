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
    ownerUserId: payload.ownerUserId,
  });

  if (outcome.ok) {
    await soarRepository.setActionStatus(action.id, 'executed', { result: outcome.result });
    return;
  }

  // Fail-loud: a containment action that could not run is itself an incident.
  await soarRepository.setActionStatus(action.id, 'failed', { error: outcome.error });
  await createIncident({
    title: `SOAR action failed: ${action.actionType} for ${action.falcoRule}`,
    severity: 'Critical',
    source: 'soar',
    description: outcome.error,
  });
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
