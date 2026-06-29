import fs from 'fs/promises';
import path from 'path';
import { randomUUID } from 'crypto';
import { databases, DB_ID, Query, ID } from '../lib/appwrite';
import type { Models } from 'node-appwrite';
import { logger } from '../services/logger';
import type { GateSeverity } from './gateRulesRepository';
import type { DriftAnomaly } from '../workers/driftMonitor';

/**
 * Persistence for runtime drift anomalies. Appwrite is the source of truth; on
 * any Appwrite failure we degrade to a local JSON store — the same resilience
 * pattern as gateRulesRepository/planRepository. A derived `severity` +
 * numeric `severityRank` are stored so records can be ordered server-side.
 */

export interface DriftRecord extends DriftAnomaly {
  id: string;
  timestamp: string;
  severity: GateSeverity;
  severityRank: number;
  active: boolean;
}

export interface ListDriftOptions {
  limit?: number;
  driftType?: DriftAnomaly['driftType'];
  severity?: GateSeverity;
}

const COLLECTION = 'drift_anomalies';
const MOCK_DB_PATH = path.join(process.cwd(), 'scratch', 'drift_mock_db.json');
const DEFAULT_LIMIT = 100;
const MAX_LIMIT = 500;

const SEVERITY_ORDER: GateSeverity[] = ['critical', 'high', 'medium', 'low'];
const SEVERITY_RANK: Record<GateSeverity, number> = { critical: 4, high: 3, medium: 2, low: 1 };

function toMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/** Highest severity actually present in the scan counts; falls back by drift
 *  type when an anomaly carries no per-severity counts (e.g. unscanned image). */
export function deriveSeverity(anomaly: DriftAnomaly): GateSeverity {
  const present = SEVERITY_ORDER.find((s) => (anomaly.severityCounts[s] ?? 0) > 0);
  if (present) return present;
  return anomaly.driftType === 'gate-violation' ? 'high' : 'medium';
}

function toRecord(anomaly: DriftAnomaly): DriftRecord {
  const severity = deriveSeverity(anomaly);
  return {
    ...anomaly,
    id: randomUUID(),
    timestamp: new Date().toISOString(),
    severity,
    severityRank: SEVERITY_RANK[severity],
    active: true,
  };
}

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

async function readMock(): Promise<DriftRecord[]> {
  try {
    const data = await fs.readFile(MOCK_DB_PATH, 'utf-8');
    return JSON.parse(data) as DriftRecord[];
  } catch {
    return [];
  }
}

async function writeMock(db: DriftRecord[]): Promise<void> {
  await fs.mkdir(path.dirname(MOCK_DB_PATH), { recursive: true });
  await fs.writeFile(MOCK_DB_PATH, JSON.stringify(db, null, 2), 'utf-8');
}

// In-process mutex serializing every read-modify-write on the fallback file, so
// a concurrent save() append and a replayer flush can't clobber each other and
// silently drop a drift record. The fallback file is per-process (process.cwd()/
// scratch) — replicas never share it, so no cross-process/distributed lock is
// needed; this guards the only real race, which is in-process interleaving.
let fileLock: Promise<unknown> = Promise.resolve();
function withLock<T>(fn: () => Promise<T>): Promise<T> {
  const run = fileLock.then(fn, fn);
  fileLock = run.catch(() => undefined);
  return run;
}

function clampLimit(limit?: number): number {
  return Math.min(Math.max(limit ?? DEFAULT_LIMIT, 1), MAX_LIMIT);
}

export const driftRepository = {
  /** Persist one detected anomaly. Never throws on a storage failure — the JSON
   *  fallback guarantees the drift signal is recorded even when Appwrite is down. */
  async save(anomaly: DriftAnomaly): Promise<DriftRecord> {
    const record = toRecord(anomaly);
    try {
      await databases.createDocument(DB_ID, COLLECTION, ID.unique(), toDoc(record));
      return record;
    } catch (err) {
      logger.warn('[DriftRepository] Appwrite write failed, using local JSON fallback:', toMessage(err));
      await withLock(async () => {
        const db = await readMock();
        db.push(record);
        await writeMock(db);
      });
      return record;
    }
  },

  /** Flush fallback-buffered anomalies back into Appwrite. Called on an interval
   *  by the fallback replayer once connectivity recovers. Each record that lands
   *  is dropped from the buffer; failures stay for the next tick. Returns the
   *  count flushed. Never throws — a still-down Appwrite just yields 0. */
  async flushFallback(): Promise<number> {
    return withLock(async () => {
      const pending = await readMock();
      if (pending.length === 0) return 0;
      const remaining: DriftRecord[] = [];
      let flushed = 0;
      for (const record of pending) {
        try {
          await databases.createDocument(DB_ID, COLLECTION, ID.unique(), toDoc(record));
          flushed++;
        } catch {
          remaining.push(record); // Appwrite still unreachable — keep for next tick.
        }
      }
      if (flushed > 0) await writeMock(remaining);
      return flushed;
    });
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
      logger.warn('[DriftRepository] Appwrite read failed, using local JSON fallback:', toMessage(err));
      const db = await readMock();
      let rows = db.filter((r) => r.active);
      if (opts.driftType) rows = rows.filter((r) => r.driftType === opts.driftType);
      if (opts.severity) rows = rows.filter((r) => r.severity === opts.severity);
      rows.sort((a, b) => b.severityRank - a.severityRank || b.timestamp.localeCompare(a.timestamp));
      return rows.slice(0, limit);
    }
  },
};
