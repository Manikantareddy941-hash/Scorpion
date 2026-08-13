import { getPool } from '../../db/pool';
import { logger, errorContext } from '../../services/logger';
import { DEFAULT_POD_SECURITY_CONFIG, PodSecurityConfig } from '../../services/podSecurityService';
import { bufferConfig, flushBuffer, readBufferedConfig } from '../podSecurityShared';

async function persistConfig(userId: string, config: PodSecurityConfig): Promise<void> {
  await getPool().query(
    `INSERT INTO pod_security_rules (user_id, config, updated_at)
     VALUES ($1, $2::jsonb, now())
     ON CONFLICT (user_id) DO UPDATE SET config = $2::jsonb, updated_at = now()`,
    [userId, JSON.stringify(config)]
  );
}

/**
 * Postgres implementation of the pod-security config repository (facade-selected).
 *
 * Degrades to the shared local JSON buffer on any storage failure, matching the
 * Appwrite implementation. It previously had no catch at all: a Postgres outage
 * threw out of get()/save(), so the admission webhook's config read failed
 * outright on one backend while the other quietly served the last known config —
 * and the failure was observable in the logs on one and silent on the other.
 * Which behaviour you got depended only on whether DATABASE_URL was set.
 */
export const podSecurityPgRepository = {
  async get(userId: string): Promise<PodSecurityConfig> {
    try {
      const result = await getPool().query(
        'SELECT config FROM pod_security_rules WHERE user_id = $1',
        [userId]
      );
      if (result.rowCount === 0) return DEFAULT_POD_SECURITY_CONFIG;
      return result.rows[0].config as PodSecurityConfig;
    } catch (err) {
      logger.warn('[PodSecurityPgRepository] Postgres read failed, using local JSON fallback', {
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
      logger.warn('[PodSecurityPgRepository] Postgres write failed, using local JSON fallback', {
        event: 'POD_SECURITY_CONFIG_WRITE_FAILED', userId, ...errorContext(err),
      });
      await bufferConfig(userId, config);
      return config;
    }
  },

  /** Flush fallback-buffered configs back into Postgres. Never throws. */
  async flushFallback(): Promise<number> {
    return flushBuffer(persistConfig);
  },
};
