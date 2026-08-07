import { getPool } from '../../db/pool';
import { logger, errorContext } from '../../services/logger';
import type { PostureFinding } from '../../posture/postureChecks';
import type { NamespaceSnapshot } from '../postureRepository';

/** Postgres implementation of postureRepository (facade-selected). */

interface SnapshotRow {
  namespace: string;
  score: number;
  findings: unknown;
  updated_at: Date;
}

export const posturePgRepository = {
  // Upsert one row per namespace. Mutations log-and-rethrow (silent fake success
  // is data loss); the scanner tick catches so the interval loop never crashes.
  async saveSnapshot(
    namespaces: { namespace: string; score: number; findings: PostureFinding[] }[]
  ): Promise<void> {
    const updatedAt = new Date().toISOString();
    for (const ns of namespaces) {
      try {
        await getPool().query(
          `INSERT INTO posture_snapshots (namespace, score, findings, updated_at)
           VALUES ($1, $2, $3::jsonb, $4)
           ON CONFLICT (namespace) DO UPDATE SET score = $2, findings = $3::jsonb, updated_at = $4`,
          [ns.namespace, ns.score, JSON.stringify(ns.findings), updatedAt]
        );
      } catch (err) {
        logger.error(`[PosturePgRepository] save for '${ns.namespace}' failed`, errorContext(err));
        throw err;
      }
    }
  },

  /** [] on failure — a read outage must not take the posture read path down. */
  async listSnapshots(): Promise<NamespaceSnapshot[]> {
    try {
      const result = await getPool().query(
        'SELECT namespace, score, findings, updated_at FROM posture_snapshots ORDER BY updated_at DESC LIMIT 200'
      );
      return (result.rows as SnapshotRow[]).map(row => ({
        namespace: row.namespace,
        score: row.score,
        findings: (row.findings ?? []) as PostureFinding[],
        updatedAt: row.updated_at.toISOString(),
      }));
    } catch (err) {
      logger.warn('[PosturePgRepository] list failed', errorContext(err));
      return [];
    }
  },
};
