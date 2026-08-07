import fs from 'fs/promises';
import path from 'path';
import { databases, DB_ID, Query, ID } from '../lib/appwrite';
import { logger, errorContext } from '../services/logger';
import { PodSecurityConfig, DEFAULT_POD_SECURITY_CONFIG } from '../services/podSecurityService';
import { isPostgresEnabled } from '../db/pool';
import { podSecurityPgRepository } from './pg/podSecurityPgRepository';

const COLLECTION = 'pod_security_rules';
const MOCK_DB_PATH = path.join(process.cwd(), 'scratch', 'pod_security_mock_db.json');

async function readMock(): Promise<Record<string, PodSecurityConfig>> {
  try {
    const data = await fs.readFile(MOCK_DB_PATH, 'utf-8');
    return JSON.parse(data) as Record<string, PodSecurityConfig>;
  } catch {
    return {};
  }
}

async function writeMock(db: Record<string, PodSecurityConfig>): Promise<void> {
  await fs.mkdir(path.dirname(MOCK_DB_PATH), { recursive: true });
  await fs.writeFile(MOCK_DB_PATH, JSON.stringify(db, null, 2), 'utf-8');
}

// In-process mutex serializing read-modify-write on the fallback file — same
// rationale as gateRulesRepository (per-process file, no distributed lock).
let fileLock: Promise<unknown> = Promise.resolve();
function withLock<T>(fn: () => Promise<T>): Promise<T> {
  const run = fileLock.then(fn, fn);
  fileLock = run.catch(() => undefined);
  return run;
}

async function persistConfig(userId: string, config: PodSecurityConfig): Promise<void> {
  const payload = {
    user_id: userId,
    config: JSON.stringify(config),
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
 * Cluster-scoped pod-security configuration (stored under the admission
 * webhook's SYSTEM user, editable via /api/v1/rules/pod-security). Appwrite is
 * the source of truth; on failure we degrade to a local JSON buffer that the
 * fallbackReplayer flushes back — same resilience pattern as gateRulesRepository.
 */
const legacyPodSecurityRepository = {
  async get(userId: string): Promise<PodSecurityConfig> {
    try {
      const list = await databases.listDocuments(DB_ID, COLLECTION, [
        Query.equal('user_id', userId),
        Query.limit(1),
      ]);
      if (list.total === 0) return DEFAULT_POD_SECURITY_CONFIG;
      return JSON.parse(list.documents[0].config as string) as PodSecurityConfig;
    } catch (err) {
      logger.warn('[PodSecurityRepository] Appwrite read failed, using local JSON fallback', errorContext(err));
      const db = await readMock();
      return db[userId] ?? DEFAULT_POD_SECURITY_CONFIG;
    }
  },

  async save(userId: string, config: PodSecurityConfig): Promise<PodSecurityConfig> {
    try {
      await persistConfig(userId, config);
      return config;
    } catch (err) {
      logger.warn('[PodSecurityRepository] Appwrite write failed, using local JSON fallback', errorContext(err));
      await withLock(async () => {
        const db = await readMock();
        db[userId] = config;
        await writeMock(db);
      });
      return config;
    }
  },

  /** Flush fallback-buffered configs back into Appwrite. Never throws. */
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
          // Appwrite still unreachable — keep for next tick.
        }
      }
      if (flushed > 0) await writeMock(pending);
      return flushed;
    });
  },
};

/** Storage facade: Postgres when DATABASE_URL is configured, legacy Appwrite/JSON otherwise. */
export const podSecurityRepository: typeof legacyPodSecurityRepository =
  isPostgresEnabled() ? podSecurityPgRepository : legacyPodSecurityRepository;
