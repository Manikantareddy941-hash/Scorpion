import { databases, DB_ID, Query, ID } from '../lib/appwrite';
import { logger, errorContext } from '../services/logger';
import { PodSecurityConfig, DEFAULT_POD_SECURITY_CONFIG } from '../services/podSecurityService';
import { isPostgresEnabled } from '../db/pool';
import { podSecurityPgRepository } from './pg/podSecurityPgRepository';
import { bufferConfig, flushBuffer, readBufferedConfig } from './podSecurityShared';

const COLLECTION = 'pod_security_rules';

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
      logger.warn('[PodSecurityRepository] Appwrite read failed, using local JSON fallback', {
        event: 'POD_SECURITY_CONFIG_READ_FAILED', userId, ...errorContext(err),
      });
      return (await readBufferedConfig(userId)) ?? DEFAULT_POD_SECURITY_CONFIG;
    }
  },

  async save(userId: string, config: PodSecurityConfig): Promise<PodSecurityConfig> {
    try {
      await persistConfig(userId, config);
      return config;
    } catch (err) {
      logger.warn('[PodSecurityRepository] Appwrite write failed, using local JSON fallback', {
        event: 'POD_SECURITY_CONFIG_WRITE_FAILED', userId, ...errorContext(err),
      });
      await bufferConfig(userId, config);
      return config;
    }
  },

  /** Flush fallback-buffered configs back into Appwrite. Never throws. */
  async flushFallback(): Promise<number> {
    return flushBuffer(persistConfig);
  },
};

/** Storage facade: Postgres when DATABASE_URL is configured, legacy Appwrite/JSON otherwise. */
export const podSecurityRepository: typeof legacyPodSecurityRepository =
  isPostgresEnabled() ? podSecurityPgRepository : legacyPodSecurityRepository;
