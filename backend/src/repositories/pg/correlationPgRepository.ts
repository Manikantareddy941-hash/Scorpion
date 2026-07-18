import { getPool } from '../../db/pool';
import { logger } from '../../services/logger';
import { newId } from './docTable';
import type { Correlation, RuleState, Severity } from '../../monitor/securityEvent.types';

/** Postgres implementation of correlationRepository (facade-selected). */

interface FiredRow {
  rule_id: string;
  severity: Severity;
  correlation_key: string;
  bucket: string;
  matched_event_ids: unknown;
  owner: string;
  incident_id: string;
  created_at: Date;
}

interface RuleStateRow {
  rule_id: string;
  enabled: boolean;
  severity_override: Severity | null;
}

export const correlationPgRepository = {
  async wasFired(owner: string, ruleId: string, key: string, bucket: number): Promise<boolean> {
    try {
      const res = await getPool().query(
        `SELECT 1 FROM correlations
         WHERE owner = $1 AND rule_id = $2 AND correlation_key = $3 AND bucket = $4 LIMIT 1`,
        [owner, ruleId, key, bucket]
      );
      return res.rows.length > 0;
    } catch (err) {
      logger.error('[correlationPgRepository] wasFired failed', err);
      return true; // fail-secure: assume already fired → don't double-page
    }
  },

  async recordFired(c: Correlation, incidentId: string): Promise<void> {
    await getPool().query(
      `INSERT INTO correlations
         (id, owner, rule_id, correlation_key, bucket, severity, incident_id, matched_event_ids)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb)`,
      [
        newId(), c.ownerUserId, c.ruleId, c.correlationKey, c.bucket,
        c.severity, incidentId, JSON.stringify(c.matchedEventIds),
      ]
    );
  },

  async listFired(
    ownerField: 'owner',
    ownerValue: string
  ): Promise<Array<Correlation & { incidentId: string; createdAt: string }>> {
    // ownerField is a literal-typed parameter kept for signature parity with the
    // legacy repository; there is only one supported column.
    void ownerField;
    const res = await getPool().query(
      `SELECT rule_id, severity, correlation_key, bucket, matched_event_ids, owner, incident_id, created_at
       FROM correlations WHERE owner = $1 ORDER BY created_at DESC LIMIT 100`,
      [ownerValue]
    );
    return (res.rows as FiredRow[]).map(row => ({
      ruleId: row.rule_id,
      title: row.rule_id,
      severity: row.severity,
      correlationKey: row.correlation_key,
      bucket: Number(row.bucket),
      matchedEventIds: (row.matched_event_ids ?? []) as string[],
      ownerUserId: row.owner,
      incidentId: row.incident_id,
      createdAt: row.created_at.toISOString(),
    }));
  },

  async listRuleStates(owner: string): Promise<RuleState[]> {
    try {
      const res = await getPool().query(
        'SELECT rule_id, enabled, severity_override FROM correlation_rule_states WHERE owner = $1 LIMIT 50',
        [owner]
      );
      return (res.rows as RuleStateRow[]).map(row => ({
        id: row.rule_id,
        enabled: row.enabled,
        severityOverride: row.severity_override ?? undefined,
      }));
    } catch (err) {
      logger.error('[correlationPgRepository] listRuleStates failed', err);
      return []; // no overrides → catalog defaults (all enabled)
    }
  },

  async upsertRuleState(owner: string, state: RuleState): Promise<void> {
    await getPool().query(
      `INSERT INTO correlation_rule_states (id, owner, rule_id, enabled, severity_override)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (owner, rule_id)
       DO UPDATE SET enabled = $4, severity_override = $5`,
      [newId(), owner, state.id, state.enabled, state.severityOverride ?? null]
    );
  },
};
