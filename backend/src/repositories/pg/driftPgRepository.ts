import { getPool } from '../../db/pool';
import { logger, errorContext } from '../../services/logger';
import type { DriftAnomaly } from '../../workers/driftMonitor';
import {
  bufferRecord, clampLimit, flushBuffer, readMock, selectFallback, toMessage, toRecord,
  type DriftRecord, type ListDriftOptions,
} from '../driftShared';

/** Postgres implementation of driftRepository (facade-selected). Keeps the
 *  local JSON fallback: a drift signal must survive a storage outage. */

interface DriftRow {
  id: string;
  drift_type: DriftRecord['driftType'];
  namespace: string;
  pod_name: string;
  container_name: string;
  image: string;
  image_digest: string;
  previous_digest: string | null;
  env: DriftRecord['env'];
  gate_status: DriftRecord['gateStatus'];
  reason: string;
  severity: DriftRecord['severity'];
  severity_rank: number;
  severity_counts: unknown;
  timestamp: string;
  active: boolean;
}

const COLUMNS = `id, drift_type, namespace, pod_name, container_name, image, image_digest,
  previous_digest, env, gate_status, reason, severity, severity_rank, severity_counts,
  timestamp, active`;

function fromRow(row: DriftRow): DriftRecord {
  return {
    id: row.id,
    driftType: row.drift_type,
    namespace: row.namespace,
    podName: row.pod_name,
    containerName: row.container_name,
    image: row.image,
    imageDigest: row.image_digest,
    previousDigest: row.previous_digest ?? undefined,
    env: row.env,
    gateStatus: row.gate_status,
    reason: row.reason,
    severity: row.severity,
    severityRank: row.severity_rank,
    severityCounts: (row.severity_counts ?? {}) as DriftRecord['severityCounts'],
    timestamp: row.timestamp,
    active: row.active,
  };
}

async function insert(r: DriftRecord): Promise<void> {
  await getPool().query(
    `INSERT INTO drift_anomalies (${COLUMNS})
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14::jsonb,$15,$16)`,
    [
      r.id, r.driftType, r.namespace, r.podName, r.containerName, r.image, r.imageDigest,
      r.previousDigest ?? null, r.env, r.gateStatus, r.reason, r.severity, r.severityRank,
      JSON.stringify(r.severityCounts), r.timestamp, r.active,
    ]
  );
}

export const driftPgRepository = {
  /** Persist one detected anomaly. Never throws on a storage failure — the JSON
   *  fallback guarantees the drift signal is recorded even when Postgres is down. */
  async save(anomaly: DriftAnomaly): Promise<DriftRecord> {
    const record = toRecord(anomaly);
    try {
      await insert(record);
      return record;
    } catch (err) {
      logger.warn('[DriftPgRepository] Postgres write failed, using local JSON fallback', errorContext(err));
      await bufferRecord(record);
      return record;
    }
  },

  /** Flush fallback-buffered anomalies back into Postgres. Called on an interval
   *  by the fallback replayer once connectivity recovers. */
  async flushFallback(): Promise<number> {
    return flushBuffer(insert);
  },

  /** Active records ordered by severity (desc) then recency (desc). */
  async listActive(opts: ListDriftOptions = {}): Promise<DriftRecord[]> {
    const limit = clampLimit(opts.limit);
    try {
      const filters = ['active = true'];
      const values: unknown[] = [];
      if (opts.driftType) { values.push(opts.driftType); filters.push(`drift_type = $${values.length}`); }
      if (opts.severity) { values.push(opts.severity); filters.push(`severity = $${values.length}`); }
      values.push(limit);
      const res = await getPool().query(
        `SELECT ${COLUMNS} FROM drift_anomalies WHERE ${filters.join(' AND ')}
         ORDER BY severity_rank DESC, timestamp DESC LIMIT $${values.length}`,
        values
      );
      return (res.rows as DriftRow[]).map(fromRow);
    } catch (err) {
      logger.warn('[DriftPgRepository] Postgres read failed, using local JSON fallback', errorContext(err));
      return selectFallback(await readMock(), opts, limit);
    }
  },
};
