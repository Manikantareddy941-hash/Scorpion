import { Worker } from 'bullmq';
import { redisConnection } from './redisConnection';
import { CORRELATION_QUEUE_NAME, enqueueCorrelationTick, CorrelationTickPayload } from './correlationQueue';
import { evaluate } from '../monitor/correlationEngine';
import { CORRELATION_CATALOG } from '../monitor/correlationCatalog';
import { detectStatusSpike } from '../monitor/anomalyDetector';
import { statusTelemetry } from '../monitor/statusTelemetry';
import { securityEventSource, recordSecurityEvent } from '../monitor/securityEventSource';
import { correlationRepository } from '../repositories/correlationRepository';
import { suppressionRepository } from '../repositories/suppressionRepository';
import { isSuppressed } from '../monitor/suppressionMatcher';
import { createIncident } from '../services/incidentService';
import { logger } from '../services/logger';
import type { Correlation, CorrelationRule } from '../monitor/securityEvent.types';

const MAX_WINDOW = 30 * 60_000;
const TICK_MS = 60_000;
const RETENTION_MINUTES = 5;
const SYSTEM_OWNER = 'system';

// ponytail: in-memory spike dedupe keyed by `${key}:${minute}`, pruned each tick to the
// same 5-minute retention window as statusTelemetry (see pruneSpikeDedupe below).
const spikeIncidentKeys = new Set<string>();

/** Test-only: clears the module-level spike dedupe set between test cases. */
export function __resetSpikeDedupeForTests(): void {
  spikeIncidentKeys.clear();
}

function pruneSpikeDedupe(now: number): void {
  const cutoff = Math.floor(now / 60_000) - RETENTION_MINUTES;
  for (const dedupeKey of spikeIncidentKeys) {
    const minute = Number(dedupeKey.slice(dedupeKey.lastIndexOf(':') + 1));
    if (minute < cutoff) spikeIncidentKeys.delete(dedupeKey);
  }
}

export async function runCorrelationTick(ownerUserId: string): Promise<Correlation[]> {
  const now = Date.now();

  statusTelemetry.prune(now);
  pruneSpikeDedupe(now);
  const suppressions = await suppressionRepository.listForOwner(ownerUserId);

  // status_spike telemetry is a single app-global counter (no ownerUserId), so it is only
  // ever processed on the system tick — per-owner ticks would misattribute a global spike
  // to whichever owner's tick happens to run first.
  if (ownerUserId === SYSTEM_OWNER) {
    const spikes = detectStatusSpike(statusTelemetry.snapshot(), { minDenied: 10, minShare: 0.5 });

    for (const s of spikes) {
      const dedupeKey = `${s.key}:${s.minute}`;
      if (spikeIncidentKeys.has(dedupeKey)) continue;

      const candidate = { ruleId: 'apm-status-spike', severity: 'high', actor: s.key };
      const suppression = isSuppressed(candidate, suppressions, now);
      if (suppression.suppressed) {
        logger.warn('apm_spike_suppressed', { srcIp: s.key, ownerUserId });
        continue;
      }

      await recordSecurityEvent({ type: 'status_spike', srcIp: s.key, ownerUserId, severity: 'high',
        timestamp: now, metadata: { denied: s.denied, total: s.total } });

      await createIncident({
        title: `Auth failure / access-denial spike from ${s.key}`,
        severity: 'high',
        source: 'apm',
        description: `${s.denied}/${s.total} denied responses in one minute`,
        userId: ownerUserId,
      });
      spikeIncidentKeys.add(dedupeKey);
    }
  }

  const events = await securityEventSource.collect(ownerUserId, MAX_WINDOW);
  const states = await correlationRepository.listRuleStates(ownerUserId);
  const disabled = new Set(states.filter(s => !s.enabled).map(s => s.id));
  const overrides = new Map(states.filter(s => s.severityOverride).map(s => [s.id, s.severityOverride!]));
  const activeRules: CorrelationRule[] = CORRELATION_CATALOG
    .filter(r => !disabled.has(r.id))
    .map(r => overrides.has(r.id) ? { ...r, severity: overrides.get(r.id)! } : r);

  const correlations = evaluate(events, activeRules, now);

  const fired: Correlation[] = [];
  for (const c of correlations) {
    if (await correlationRepository.wasFired(ownerUserId, c.ruleId, c.correlationKey, c.bucket)) continue;
    const s = isSuppressed({ ruleId: c.ruleId, severity: c.severity, actor: c.correlationKey }, suppressions, now);
    if (s.suppressed) {
      logger.warn('correlation_suppressed', { ruleId: c.ruleId, suppressionId: s.ruleId, ownerUserId });
      continue;
    }
    const incident = await createIncident({
      title: c.title, severity: c.severity, source: 'correlation',
      description: `Correlated attack pattern (${c.ruleId}) on ${c.correlationKey}`, userId: ownerUserId,
    });
    await correlationRepository.recordFired(c, incident.$id);
    fired.push(c);
  }
  return fired;
}

let worker: Worker<CorrelationTickPayload> | undefined;

export function startCorrelationWorker(): Worker<CorrelationTickPayload> {
  worker = new Worker<CorrelationTickPayload>(CORRELATION_QUEUE_NAME, async (job) => {
    const { ownerUserId } = job.data;
    try { await runCorrelationTick(ownerUserId); }
    catch (err) { logger.error('[correlationWorker] tick failed', err); }
    finally { await enqueueCorrelationTick({ ownerUserId }, TICK_MS); } // self-re-enqueue
  }, { connection: redisConnection });
  return worker;
}

export async function stopCorrelationWorker(): Promise<void> { await worker?.close(); }
