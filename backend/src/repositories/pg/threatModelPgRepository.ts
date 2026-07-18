import { getPool } from '../../db/pool';
import { newId, toDoc } from './docTable';
import type { ThreatModelDocument } from '../threatModelRepository';

/**
 * Postgres implementation of threatModelRepository (facade-selected). Uses the
 * document-table bridge (id + data JSONB + created_at → $createdAt) so callers
 * keep the Appwrite document shape. ensureCollection is a no-op: the table
 * comes from a migration, not runtime schema creation.
 */
export const threatModelPgRepository = {
  async ensureCollection(): Promise<void> {
    // No-op under Postgres — the threat_models table is created by migration.
  },

  async create(data: Record<string, unknown>): Promise<ThreatModelDocument> {
    const id = newId();
    const result = await getPool().query(
      `INSERT INTO threat_models (id, data) VALUES ($1, $2::jsonb) RETURNING id, data, created_at`,
      [id, JSON.stringify(data)]
    );
    return toDoc(result.rows[0]) as unknown as ThreatModelDocument;
  },

  async get(id: string): Promise<ThreatModelDocument> {
    const result = await getPool().query(
      `SELECT id, data, created_at FROM threat_models WHERE id = $1`,
      [id]
    );
    if (result.rowCount === 0) throw new Error('document not found');
    return toDoc(result.rows[0]) as unknown as ThreatModelDocument;
  },

  async list(userId?: string): Promise<ThreatModelDocument[]> {
    const result = userId
      ? await getPool().query(
          `SELECT id, data, created_at FROM threat_models WHERE data->>'createdBy' = $1 ORDER BY created_at DESC`,
          [userId]
        )
      : await getPool().query(`SELECT id, data, created_at FROM threat_models ORDER BY created_at DESC`);
    return result.rows.map(r => toDoc(r) as unknown as ThreatModelDocument);
  },

  async update(id: string, data: Record<string, unknown>): Promise<ThreatModelDocument> {
    const result = await getPool().query(
      `UPDATE threat_models SET data = data || $2::jsonb WHERE id = $1 RETURNING id, data, created_at`,
      [id, JSON.stringify(data)]
    );
    if (result.rowCount === 0) throw new Error('document not found');
    return toDoc(result.rows[0]) as unknown as ThreatModelDocument;
  },

  async remove(id: string): Promise<void> {
    await getPool().query(`DELETE FROM threat_models WHERE id = $1`, [id]);
  },
};
