import { getPool } from '../../db/pool';
import { DEFAULT_POD_SECURITY_CONFIG, PodSecurityConfig } from '../../services/podSecurityService';

/** Postgres implementation of the pod-security config repository (facade-selected). */
export const podSecurityPgRepository = {
  async get(userId: string): Promise<PodSecurityConfig> {
    const result = await getPool().query(
      'SELECT config FROM pod_security_rules WHERE user_id = $1',
      [userId]
    );
    if (result.rowCount === 0) return DEFAULT_POD_SECURITY_CONFIG;
    return result.rows[0].config as PodSecurityConfig;
  },

  async save(userId: string, config: PodSecurityConfig): Promise<PodSecurityConfig> {
    await getPool().query(
      `INSERT INTO pod_security_rules (user_id, config, updated_at)
       VALUES ($1, $2::jsonb, now())
       ON CONFLICT (user_id) DO UPDATE SET config = $2::jsonb, updated_at = now()`,
      [userId, JSON.stringify(config)]
    );
    return config;
  },

  async flushFallback(): Promise<number> {
    return 0;
  },
};
