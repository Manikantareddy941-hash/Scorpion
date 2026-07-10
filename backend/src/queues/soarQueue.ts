import { Queue } from 'bullmq';
import { redisConnection } from './redisConnection';

export const SOAR_QUEUE_NAME = 'soar-actions';

export interface SoarJobPayload {
  actionId: string;
  falcoEventJson?: string;
  ownerUserId?: string;
}

export const soarQueue = new Queue<SoarJobPayload>(SOAR_QUEUE_NAME, {
  connection: redisConnection,
  defaultJobOptions: {
    attempts: 3,
    backoff: { type: 'exponential', delay: 5000 },
    removeOnComplete: { count: 500 },
    removeOnFail: { count: 500 },
  },
});

/** jobId dedupes a double-enqueue of the same action (e.g. double approve). */
export const enqueueSoarAction = (payload: SoarJobPayload) =>
  soarQueue.add('soar-action', payload, { jobId: `soar-${payload.actionId}` });
