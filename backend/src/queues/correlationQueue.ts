import { Queue } from 'bullmq';
import { redisConnection } from './redisConnection';

export const CORRELATION_QUEUE_NAME = 'security-correlation';
export interface CorrelationTickPayload { ownerUserId: string; }

export const correlationQueue = new Queue<CorrelationTickPayload>(CORRELATION_QUEUE_NAME, {
  connection: redisConnection,
  defaultJobOptions: { attempts: 2, backoff: { type: 'exponential', delay: 15000 },
    removeOnComplete: { count: 200 }, removeOnFail: { count: 200 } },
});

// jobId buckets by target-fire minute: re-enqueues land in distinct minute
// buckets (unique -> always scheduled, so the self-perpetuating loop never
// stalls), while repeated seeds within the same minute still collapse onto
// the same jobId (dedupe preserved).
export const enqueueCorrelationTick = (payload: CorrelationTickPayload, delayMs: number) =>
  correlationQueue.add('correlation-tick', payload, {
    delay: delayMs,
    jobId: `corr-${payload.ownerUserId}-${Math.floor((Date.now() + delayMs) / 60000)}`,
  });
