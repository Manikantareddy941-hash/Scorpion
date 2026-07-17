import { getPool } from '../../db/pool';
import { DEFAULT_CONFIG, GateConfig, GateEnv, GateRule } from '../gateRulesRepository';

/**
 * Postgres implementation of the gate-rules repository. Selected by the facade
 * in gateRulesRepository.ts when DATABASE_URL is set. No JSON-file fallback:
 * Postgres is the system of record, an outage surfaces as an error.
 */
export const gateRulesPgRepository = {
  async get(userId: string): Promise<GateConfig> {
    const result = await getPool().query(
      'SELECT rules, env FROM gate_rules WHERE user_id = $1',
      [userId]
    );
    if (result.rowCount === 0) return DEFAULT_CONFIG;
    return {
      rules: result.rows[0].rules as GateRule[],
      env: result.rows[0].env as GateEnv,
    };
  },

  async save(userId: string, config: GateConfig): Promise<GateConfig> {
    await getPool().query(
      `INSERT INTO gate_rules (user_id, rules, env, updated_at)
       VALUES ($1, $2::jsonb, $3, now())
       ON CONFLICT (user_id) DO UPDATE SET rules = $2::jsonb, env = $3, updated_at = now()`,
      [userId, JSON.stringify(config.rules), config.env]
    );
    return config;
  },

  /** The legacy impl flushes its JSON fallback buffer; Postgres has none. */
  async flushFallback(): Promise<number> {
    return 0;
  },
};
