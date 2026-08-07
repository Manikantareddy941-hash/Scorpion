import fs from 'fs/promises';
import path from 'path';
import { databases, DB_ID, Query, ID } from '../lib/appwrite';
import { logger, errorContext } from '../services/logger';
import { isPostgresEnabled } from '../db/pool';
import { gateRulesPgRepository } from './pg/gateRulesPgRepository';

export type GateSeverity = 'critical' | 'high' | 'medium' | 'low';
export type GateAction = 'block' | 'warn';
export type GateEnv = 'dev' | 'stage' | 'prod';

export interface GateRule {
  id: string;
  severity: GateSeverity;
  threshold: number;
  action: GateAction;
  enabled: boolean;
}

export interface GateConfig {
  rules: GateRule[];
  env: GateEnv;
}

const COLLECTION = 'gate_rules';
const MOCK_DB_PATH = path.join(process.cwd(), 'scratch', 'gate_rules_mock_db.json');

// Sensible real defaults — returned on first read before a user has saved anything.
export const DEFAULT_CONFIG: GateConfig = {
  rules: [
    { id: 'seed-critical', severity: 'critical', threshold: 0, action: 'block', enabled: true },
    { id: 'seed-high', severity: 'high', threshold: 5, action: 'warn', enabled: true },
  ],
  env: 'prod',
};

async function readMock(): Promise<Record<string, GateConfig>> {
  try {
    const data = await fs.readFile(MOCK_DB_PATH, 'utf-8');
    return JSON.parse(data) as Record<string, GateConfig>;
  } catch {
    return {};
  }
}

async function writeMock(db: Record<string, GateConfig>): Promise<void> {
  await fs.mkdir(path.dirname(MOCK_DB_PATH), { recursive: true });
  await fs.writeFile(MOCK_DB_PATH, JSON.stringify(db, null, 2), 'utf-8');
}

// In-process mutex serializing read-modify-write on the fallback file so a
// concurrent save() and replayer flush can't clobber each other. The file is
// per-process — replicas never share it, so no distributed lock is warranted.
let fileLock: Promise<unknown> = Promise.resolve();
function withLock<T>(fn: () => Promise<T>): Promise<T> {
  const run = fileLock.then(fn, fn);
  fileLock = run.catch(() => undefined);
  return run;
}

// Single source of the Appwrite upsert, shared by save() and the replayer.
async function persistConfig(userId: string, config: GateConfig): Promise<void> {
  const payload = {
    user_id: userId,
    rules: JSON.stringify(config.rules),
    env: config.env,
    updated_at: new Date().toISOString(),
  };
  const list = await databases.listDocuments(DB_ID, COLLECTION, [
    Query.equal('user_id', userId),
    Query.limit(1),
  ]);
  if (list.total > 0) {
    await databases.updateDocument(DB_ID, COLLECTION, list.documents[0].$id, payload);
  } else {
    await databases.createDocument(DB_ID, COLLECTION, ID.unique(), payload);
  }
}

/**
 * Per-user gate configuration. Appwrite is the source of truth; on any Appwrite
 * failure we fall back to a local JSON store — the same resilience pattern used
 * by planRepository. Rules are persisted as a JSON string column.
 */
const legacyGateRulesRepository = {
  async get(userId: string): Promise<GateConfig> {
    try {
      const list = await databases.listDocuments(DB_ID, COLLECTION, [
        Query.equal('user_id', userId),
        Query.limit(1),
      ]);
      if (list.total === 0) return DEFAULT_CONFIG;
      const doc = list.documents[0];
      return {
        rules: JSON.parse(doc.rules as string) as GateRule[],
        env: doc.env as GateEnv,
      };
    } catch (err) {
      logger.warn('[GateRulesRepository] Appwrite read failed, using local JSON fallback', errorContext(err));
      const db = await readMock();
      return db[userId] ?? DEFAULT_CONFIG;
    }
  },

  async save(userId: string, config: GateConfig): Promise<GateConfig> {
    try {
      await persistConfig(userId, config);
      return config;
    } catch (err) {
      logger.warn('[GateRulesRepository] Appwrite write failed, using local JSON fallback', errorContext(err));
      await withLock(async () => {
        const db = await readMock();
        db[userId] = config;
        await writeMock(db);
      });
      return config;
    }
  },

  /** Flush fallback-buffered configs back into Appwrite. Called on an interval by
   *  the fallback replayer once connectivity recovers. Each user whose config
   *  lands is dropped from the buffer; failures stay for the next tick. Returns
   *  the count flushed. Never throws — a still-down Appwrite just yields 0. */
  async flushFallback(): Promise<number> {
    return withLock(async () => {
      const pending = await readMock();
      const userIds = Object.keys(pending);
      if (userIds.length === 0) return 0;
      let flushed = 0;
      for (const userId of userIds) {
        try {
          await persistConfig(userId, pending[userId]);
          delete pending[userId];
          flushed++;
        } catch {
          // Appwrite still unreachable — keep this user's config for next tick.
        }
      }
      if (flushed > 0) await writeMock(pending);
      return flushed;
    });
  },
};

/** Storage facade: Postgres when DATABASE_URL is configured, legacy Appwrite/JSON otherwise. */
export const gateRulesRepository: typeof legacyGateRulesRepository =
  isPostgresEnabled() ? gateRulesPgRepository : legacyGateRulesRepository;
