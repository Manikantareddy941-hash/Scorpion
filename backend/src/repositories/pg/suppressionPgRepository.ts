import { getPool } from '../../db/pool';
import { logger, errorContext } from '../../services/logger';
import { newId } from './docTable';
import type { SuppressionRule } from '../../monitor/suppressionMatcher';

/** Postgres implementation of suppressionRepository (facade-selected). */

interface SuppressionRow {
  id: string;
  match_type: string;
  match_value: string;
  expires_at: string | null;
  reason: string | null;
}

function fromRow(row: SuppressionRow): SuppressionRule {
  return {
    id: row.id,
    matchType: row.match_type as SuppressionRule['matchType'],
    matchValue: row.match_value,
    expiresAt: row.expires_at != null ? Number(row.expires_at) : undefined,
    reason: row.reason ?? undefined,
  };
}

export const suppressionPgRepository = {
  async listForOwner(owner: string): Promise<SuppressionRule[]> {
    try {
      const result = await getPool().query(
        'SELECT id, match_type, match_value, expires_at, reason FROM suppression_rules WHERE owner = $1 LIMIT 100',
        [owner]
      );
      return (result.rows as SuppressionRow[]).map(fromRow);
    } catch (err) {
      logger.error('[suppressionPgRepository] list failed', { event: 'SUPPRESSION_LIST_FAILED', ...errorContext(err) });
      return [];
    }
  },

  async create(owner: string, rule: Omit<SuppressionRule, 'id'>): Promise<SuppressionRule> {
    const id = newId();
    await getPool().query(
      `INSERT INTO suppression_rules (id, owner, match_type, match_value, expires_at, reason)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [id, owner, rule.matchType, rule.matchValue, rule.expiresAt ?? null, rule.reason ?? null]
    );
    return { id, ...rule };
  },

  /** Tenancy guard: only the owner may remove their rule. Returns false otherwise. */
  async remove(owner: string, id: string): Promise<boolean> {
    const result = await getPool().query(
      'DELETE FROM suppression_rules WHERE id = $1 AND owner = $2',
      [id, owner]
    );
    return (result.rowCount ?? 0) > 0;
  },
};
