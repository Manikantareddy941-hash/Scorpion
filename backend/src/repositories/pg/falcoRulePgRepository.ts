import { getPool } from '../../db/pool';
import { logger, errorContext } from '../../services/logger';
import { FALCO_TEMPLATES } from '../../runtime/falcoRuleCatalog';
import type { ManagedFalcoRule } from '../../runtime/falcoRuleCatalog';
import { newId } from './docTable';

/**
 * Postgres implementation of falcoRuleRepository (facade-selected). Mirrors the
 * legacy contract exactly: reads never throw (a config read outage must not
 * reprioritize/suppress), mutations log-and-rethrow, malformed rows are skipped.
 */

interface RuleRow {
  id: string;
  template: string;
  params: unknown;
  app_scope: string | null;
  severity_override: string | null;
  suppressed: boolean;
  enabled: boolean;
}

/** null for malformed rows (unknown template) — skipping means no suppression,
 *  the fail-secure direction, same as the legacy repo. */
function fromRow(row: RuleRow): ManagedFalcoRule | null {
  if (!(row.template in FALCO_TEMPLATES)) {
    logger.warn(`[FalcoRulePgRepository] skipping rule ${row.id}: unknown template '${String(row.template)}'`);
    return null;
  }
  return {
    id: row.id,
    template: row.template as ManagedFalcoRule['template'],
    params: (row.params ?? {}) as ManagedFalcoRule['params'],
    appScope: row.app_scope ?? undefined,
    severityOverride: (row.severity_override as ManagedFalcoRule['severityOverride']) ?? undefined,
    suppressed: row.suppressed,
    enabled: row.enabled,
  };
}

export const falcoRulePgRepository = {
  async listRules(): Promise<ManagedFalcoRule[]> {
    try {
      const result = await getPool().query(
        'SELECT id, template, params, app_scope, severity_override, suppressed, enabled FROM falco_rules LIMIT 200'
      );
      return (result.rows as RuleRow[]).map(fromRow).filter((r): r is ManagedFalcoRule => r !== null);
    } catch (err) {
      logger.warn('[FalcoRulePgRepository] load failed', { event: 'FALCO_RULE_LIST_FAILED', ...errorContext(err) });
      return [];
    }
  },

  async createRule(r: Omit<ManagedFalcoRule, 'id'>): Promise<ManagedFalcoRule> {
    const id = newId();
    try {
      await getPool().query(
        `INSERT INTO falco_rules (id, template, params, app_scope, severity_override, suppressed, enabled)
         VALUES ($1, $2, $3::jsonb, $4, $5, $6, $7)`,
        [id, r.template, JSON.stringify(r.params), r.appScope ?? null, r.severityOverride ?? null, r.suppressed, r.enabled]
      );
      return { ...r, id };
    } catch (err) {
      logger.error('[FalcoRulePgRepository] createRule failed', { event: 'FALCO_RULE_CREATE_FAILED', ...errorContext(err) });
      throw err;
    }
  },

  async updateRule(id: string, r: Partial<Omit<ManagedFalcoRule, 'id'>>): Promise<void> {
    const sets: string[] = [];
    const values: unknown[] = [];
    let i = 1;
    const push = (col: string, val: unknown): void => { sets.push(`${col} = $${++i}`); values.push(val); };
    if (r.template !== undefined) push('template', r.template);
    if (r.params !== undefined) { sets.push(`params = $${++i}::jsonb`); values.push(JSON.stringify(r.params)); }
    if (r.appScope !== undefined) push('app_scope', r.appScope ?? null);
    if (r.severityOverride !== undefined) push('severity_override', r.severityOverride ?? null);
    if (r.suppressed !== undefined) push('suppressed', r.suppressed);
    if (r.enabled !== undefined) push('enabled', r.enabled);
    if (sets.length === 0) return;
    try {
      await getPool().query(`UPDATE falco_rules SET ${sets.join(', ')} WHERE id = $1`, [id, ...values]);
    } catch (err) {
      logger.error('[FalcoRulePgRepository] updateRule failed', {
        event: 'FALCO_RULE_UPDATE_FAILED', ruleId: id, ...errorContext(err),
      });
      throw err;
    }
  },
};
