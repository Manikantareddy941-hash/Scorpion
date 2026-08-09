import { databases, DB_ID, Query, ID } from '../lib/appwrite';
import type { Models } from 'node-appwrite';
import { logger, errorContext } from '../services/logger';
import type { GateSeverity } from './gateRulesRepository';
import type { DriftAnomaly } from '../workers/driftMonitor';
import { isPostgresEnabled } from '../db/pool';
import { driftPgRepository } from './pg/driftPgRepository';
import {
  bufferRecord, clampLimit, flushBuffer, readMock, selectFallback, toRecord,
  type DriftRecord, type ListDriftOptions,
} from './driftShared';

/**
 * Persistence for runtime drift anomalies. Appwrite is the source of truth; on
 * any Appwrite failure we degrade to a local JSON store — the same resilience
 * pattern as gateRulesRepository/planRepository. A derived `severity` +
 * numeric `severityRank` are stored so records can be ordered server-side.
 * Record shape, severity derivation and the fallback store live in
 * ./driftShared so the Postgres implementation behaves identically.
 */

export { deriveSeverity } from './driftShared';
export type { DriftRecord, ListDriftOptions } from './driftShared';

const COLLECTION = 'drift_anomalies';

// Appwrite stores severityCounts as a JSON string column; everything else maps
// one-to-one. Kept as an explicit wire shape so reads stay zero-any.
interface DriftDocWire {
  driftType: DriftAnomaly['driftType'];
  namespace: string;
  podName: string;
  containerName: string;
  image: string;
  imageDigest: string;
  previousDigest?: string | null;
  env: DriftAnomaly['env'];
  gateStatus: DriftAnomaly['gateStatus'];
  reason: string;
  severity: GateSeverity;
  severityRank: number;
  severityCounts: string;
  timestamp: string;
  active: boolean;
}

function toDoc(r: DriftRecord): DriftDocWire {
  return {
    driftType: r.driftType,
    namespace: r.namespace,
    podName: r.podName,
    containerName: r.containerName,
    image: r.image,
    imageDigest: r.imageDigest,
    previousDigest: r.previousDigest ?? null,
    env: r.env,
    gateStatus: r.gateStatus,
    reason: r.reason,
    severity: r.severity,
    severityRank: r.severityRank,
    severityCounts: JSON.stringify(r.severityCounts),
    timestamp: r.timestamp,
    active: r.active,
  };
}

function fromDoc(doc: Models.Document): DriftRecord {
  const w = doc as unknown as DriftDocWire & Models.Document;
  return {
    id: doc.$id,
    driftType: w.driftType,
    namespace: w.namespace,
    podName: w.podName,
    containerName: w.containerName,
    image: w.image,
    imageDigest: w.imageDigest,
    previousDigest: w.previousDigest ?? undefined,
    env: w.env,
    gateStatus: w.gateStatus,
    reason: w.reason,
    severity: w.severity,
    severityRank: w.severityRank,
    severityCounts: JSON.parse(w.severityCounts) as DriftRecord['severityCounts'],
    timestamp: w.timestamp,
    active: w.active,
  };
}

async function insert(record: DriftRecord): Promise<void> {
  await databases.createDocument(DB_ID, COLLECTION, ID.unique(), toDoc(record));
}

const legacyDriftRepository = {
  /** Persist one detected anomaly. Never throws on a storage failure — the JSON
   *  fallback guarantees the drift signal is recorded even when Appwrite is down. */
  async save(anomaly: DriftAnomaly): Promise<DriftRecord> {
    const record = toRecord(anomaly);
    try {
      await insert(record);
      return record;
    } catch (err) {
      logger.warn('[DriftRepository] Appwrite write failed, using local JSON fallback', errorContext(err));
      await bufferRecord(record);
      return record;
    }
  },

  /** Flush fallback-buffered anomalies back into Appwrite. Called on an interval
   *  by the fallback replayer once connectivity recovers. Each record that lands
   *  is dropped from the buffer; failures stay for the next tick. Returns the
   *  count flushed. Never throws — a still-down Appwrite just yields 0. */
  async flushFallback(): Promise<number> {
    return flushBuffer(insert);
  },

  /** Active records ordered by severity (desc) then recency (desc). */
  async listActive(opts: ListDriftOptions = {}): Promise<DriftRecord[]> {
    const limit = clampLimit(opts.limit);
    try {
      const queries = [
        Query.equal('active', true),
        Query.orderDesc('severityRank'),
        Query.orderDesc('timestamp'),
        Query.limit(limit),
      ];
      if (opts.driftType) queries.push(Query.equal('driftType', opts.driftType));
      if (opts.severity) queries.push(Query.equal('severity', opts.severity));
      const list = await databases.listDocuments(DB_ID, COLLECTION, queries);
      return list.documents.map(fromDoc);
    } catch (err) {
      logger.warn('[DriftRepository] Appwrite read failed, using local JSON fallback', errorContext(err));
      return selectFallback(await readMock(), opts, limit);
    }
  },
};

/** Storage facade: Postgres when DATABASE_URL is configured, legacy Appwrite otherwise. */
export const driftRepository: typeof legacyDriftRepository =
  isPostgresEnabled() ? driftPgRepository : legacyDriftRepository;
