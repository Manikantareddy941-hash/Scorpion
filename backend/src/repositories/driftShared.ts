import fs from 'fs/promises';
import path from 'path';
import { randomUUID } from 'crypto';
import type { GateSeverity } from './gateRulesRepository';
import type { DriftAnomaly } from '../workers/driftMonitor';

/**
 * Storage-agnostic pieces of the drift repository: the record shape, severity
 * derivation, and the local JSON fallback store. Shared by both the legacy
 * Appwrite implementation and the Postgres one, so the fallback behaviour (and
 * the buffer file itself) is identical whichever backend is selected.
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

const MOCK_DB_PATH = path.join(process.cwd(), 'scratch', 'drift_mock_db.json');
const DEFAULT_LIMIT = 100;
const MAX_LIMIT = 500;

const SEVERITY_ORDER: GateSeverity[] = ['critical', 'high', 'medium', 'low'];
const SEVERITY_RANK: Record<GateSeverity, number> = { critical: 4, high: 3, medium: 2, low: 1 };

export function toMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/** Highest severity actually present in the scan counts; falls back by drift
 *  type when an anomaly carries no per-severity counts (e.g. unscanned image). */
export function deriveSeverity(anomaly: DriftAnomaly): GateSeverity {
  const present = SEVERITY_ORDER.find((s) => (anomaly.severityCounts[s] ?? 0) > 0);
  if (present) return present;
  return anomaly.driftType === 'gate-violation' ? 'high' : 'medium';
}

export function toRecord(anomaly: DriftAnomaly): DriftRecord {
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

export function clampLimit(limit?: number): number {
  return Math.min(Math.max(limit ?? DEFAULT_LIMIT, 1), MAX_LIMIT);
}

export async function readMock(): Promise<DriftRecord[]> {
  try {
    const data = await fs.readFile(MOCK_DB_PATH, 'utf-8');
    return JSON.parse(data) as DriftRecord[];
  } catch {
    return [];
  }
}

export async function writeMock(db: DriftRecord[]): Promise<void> {
  await fs.mkdir(path.dirname(MOCK_DB_PATH), { recursive: true });
  await fs.writeFile(MOCK_DB_PATH, JSON.stringify(db, null, 2), 'utf-8');
}

// In-process mutex serializing every read-modify-write on the fallback file, so
// a concurrent save() append and a replayer flush can't clobber each other and
// silently drop a drift record. The fallback file is per-process (process.cwd()/
// scratch) — replicas never share it, so no cross-process/distributed lock is
// needed; this guards the only real race, which is in-process interleaving.
let fileLock: Promise<unknown> = Promise.resolve();
export function withLock<T>(fn: () => Promise<T>): Promise<T> {
  const run = fileLock.then(fn, fn);
  fileLock = run.catch(() => undefined);
  return run;
}

/** Same filter/order/limit the database read applies, for the fallback path. */
export function selectFallback(rows: DriftRecord[], opts: ListDriftOptions, limit: number): DriftRecord[] {
  let out = rows.filter((r) => r.active);
  if (opts.driftType) out = out.filter((r) => r.driftType === opts.driftType);
  if (opts.severity) out = out.filter((r) => r.severity === opts.severity);
  out.sort((a, b) => b.severityRank - a.severityRank || b.timestamp.localeCompare(a.timestamp));
  return out.slice(0, limit);
}

/** Drain the fallback buffer through `persist`, keeping rows that still fail.
 *  Never throws — a still-down backend just yields 0. Returns the count flushed. */
export async function flushBuffer(persist: (record: DriftRecord) => Promise<void>): Promise<number> {
  return withLock(async () => {
    const pending = await readMock();
    if (pending.length === 0) return 0;
    const remaining: DriftRecord[] = [];
    let flushed = 0;
    for (const record of pending) {
      try {
        await persist(record);
        flushed++;
      } catch {
        remaining.push(record); // backend still unreachable — keep for next tick.
      }
    }
    if (flushed > 0) await writeMock(remaining);
    return flushed;
  });
}

/** Append one record to the fallback buffer under the lock. */
export async function bufferRecord(record: DriftRecord): Promise<void> {
  await withLock(async () => {
    const db = await readMock();
    db.push(record);
    await writeMock(db);
  });
}
