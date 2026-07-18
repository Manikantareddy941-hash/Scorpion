import { getPool } from '../../db/pool';
import { logger } from '../../services/logger';
import { newId } from './docTable';
import type { Playbook } from '../../soar/playbookMatcher';
import type { SoarActionRecord, SoarActionStatus } from '../soarRepository';

/** Postgres implementation of soarRepository (facade-selected). */

interface PlaybookRow {
  id: string;
  name: string;
  enabled: boolean;
  trigger: unknown;
  actions: unknown;
}

interface ActionRow {
  id: string;
  incident_id: string;
  action_type: SoarActionRecord['actionType'];
  playbook_id: string;
  playbook_name: string;
  status: SoarActionStatus;
  namespace: string | null;
  pod_name: string | null;
  owner_user_id: string | null;
  container_image: string;
  falco_rule: string;
  created_at: string;
  resolved_at: string | null;
  resolved_by: string | null;
  result: string | null;
  error: string | null;
}

const ACTION_COLUMNS = `id, incident_id, action_type, playbook_id, playbook_name, status,
  namespace, pod_name, owner_user_id, container_image, falco_rule,
  created_at, resolved_at, resolved_by, result, error`;

function toMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function actionFromRow(row: ActionRow): SoarActionRecord {
  return {
    id: row.id,
    incidentId: row.incident_id,
    actionType: row.action_type,
    playbookId: row.playbook_id,
    playbookName: row.playbook_name,
    status: row.status,
    namespace: row.namespace ?? undefined,
    podName: row.pod_name ?? undefined,
    ownerUserId: row.owner_user_id ?? undefined,
    containerImage: row.container_image,
    falcoRule: row.falco_rule,
    createdAt: row.created_at,
    resolvedAt: row.resolved_at ?? undefined,
    resolvedBy: row.resolved_by ?? undefined,
    result: row.result ?? undefined,
    error: row.error ?? undefined,
  };
}

export const soarPgRepository = {
  /** Fail-secure: storage down → no playbooks → no SOAR actions (existing
   *  incident path still runs). Never throws. */
  async listPlaybooks(): Promise<Playbook[]> {
    try {
      const res = await getPool().query('SELECT id, name, enabled, trigger, actions FROM playbooks LIMIT 100');
      return (res.rows as PlaybookRow[]).map(row => ({
        id: row.id,
        name: row.name,
        enabled: row.enabled,
        trigger: row.trigger as Playbook['trigger'],
        actions: row.actions as Playbook['actions'],
      }));
    } catch (err) {
      logger.warn('[SoarPgRepository] playbook load failed:', toMessage(err));
      return [];
    }
  },

  // Mutations log with context then rethrow — silent fake success is data
  // loss; callers (route error-middleware, BullMQ worker) handle propagation.
  async createPlaybook(p: Omit<Playbook, 'id'>): Promise<Playbook> {
    const id = newId();
    try {
      await getPool().query(
        `INSERT INTO playbooks (id, name, enabled, trigger, actions)
         VALUES ($1, $2, $3, $4::jsonb, $5::jsonb)`,
        [id, p.name, p.enabled, JSON.stringify(p.trigger), JSON.stringify(p.actions)]
      );
      return { ...p, id };
    } catch (err) {
      logger.error('[SoarPgRepository] createPlaybook failed:', toMessage(err));
      throw err;
    }
  },

  async updatePlaybook(id: string, p: Partial<Omit<Playbook, 'id'>>): Promise<void> {
    const sets: string[] = [];
    const values: unknown[] = [];
    // COALESCE-style dynamic patch: only the fields the caller actually sent,
    // matching the legacy partial-update semantics.
    if (p.name !== undefined) { values.push(p.name); sets.push(`name = $${values.length}`); }
    if (p.enabled !== undefined) { values.push(p.enabled); sets.push(`enabled = $${values.length}`); }
    if (p.trigger !== undefined) { values.push(JSON.stringify(p.trigger)); sets.push(`trigger = $${values.length}::jsonb`); }
    if (p.actions !== undefined) { values.push(JSON.stringify(p.actions)); sets.push(`actions = $${values.length}::jsonb`); }
    if (sets.length === 0) return;
    values.push(id);
    try {
      await getPool().query(`UPDATE playbooks SET ${sets.join(', ')} WHERE id = $${values.length}`, values);
    } catch (err) {
      logger.error('[SoarPgRepository] updatePlaybook failed:', toMessage(err));
      throw err;
    }
  },

  async createAction(a: Omit<SoarActionRecord, 'id' | 'createdAt'>): Promise<SoarActionRecord> {
    const id = newId();
    const createdAt = new Date().toISOString();
    try {
      await getPool().query(
        `INSERT INTO soar_actions (${ACTION_COLUMNS})
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)`,
        [
          id, a.incidentId, a.actionType, a.playbookId, a.playbookName, a.status,
          a.namespace ?? null, a.podName ?? null, a.ownerUserId ?? null,
          a.containerImage, a.falcoRule, createdAt,
          a.resolvedAt ?? null, a.resolvedBy ?? null, a.result ?? null, a.error ?? null,
        ]
      );
      return { ...a, id, createdAt };
    } catch (err) {
      logger.error('[SoarPgRepository] createAction failed:', toMessage(err));
      throw err;
    }
  },

  async getAction(id: string): Promise<SoarActionRecord | null> {
    try {
      const res = await getPool().query(`SELECT ${ACTION_COLUMNS} FROM soar_actions WHERE id = $1`, [id]);
      if (res.rows.length === 0) return null;
      return actionFromRow(res.rows[0] as ActionRow);
    } catch (err) {
      // Logged so a storage outage is distinguishable from a clean not-found.
      logger.warn('[SoarPgRepository] getAction failed:', toMessage(err));
      return null;
    }
  },

  /** Read path — fail-secure like listPlaybooks: storage down → []. */
  async listActions(status?: SoarActionStatus): Promise<SoarActionRecord[]> {
    try {
      const res = status
        ? await getPool().query(
            `SELECT ${ACTION_COLUMNS} FROM soar_actions WHERE status = $1 ORDER BY created_at DESC LIMIT 100`,
            [status]
          )
        : await getPool().query(`SELECT ${ACTION_COLUMNS} FROM soar_actions ORDER BY created_at DESC LIMIT 100`);
      return (res.rows as ActionRow[]).map(actionFromRow);
    } catch (err) {
      logger.warn('[SoarPgRepository] action list failed:', toMessage(err));
      return [];
    }
  },

  async setActionStatus(
    id: string,
    status: SoarActionStatus,
    extra: { resolvedBy?: string; result?: string; error?: string } = {},
  ): Promise<void> {
    try {
      // COALESCE keeps an omitted field at its stored value, matching the
      // legacy partial-document update.
      await getPool().query(
        `UPDATE soar_actions
         SET status = $2, resolved_at = $3,
             resolved_by = COALESCE($4, resolved_by),
             result = COALESCE($5, result),
             error = COALESCE($6, error)
         WHERE id = $1`,
        [id, status, new Date().toISOString(), extra.resolvedBy ?? null, extra.result ?? null, extra.error ?? null]
      );
    } catch (err) {
      logger.error('[SoarPgRepository] setActionStatus failed:', toMessage(err));
      throw err;
    }
  },

  /** capture_evidence rows for one incident; [] on error (read-only viewer). */
  async listEvidenceForIncident(
    incidentId: string
  ): Promise<Array<{ id: string; playbookName: string; createdAt: string; result?: string }>> {
    try {
      const res = await getPool().query(
        `SELECT id, playbook_name, created_at, result FROM soar_actions
         WHERE incident_id = $1 AND action_type = 'capture_evidence' LIMIT 25`,
        [incidentId]
      );
      return (res.rows as Pick<ActionRow, 'id' | 'playbook_name' | 'created_at' | 'result'>[]).map(row => ({
        id: row.id,
        playbookName: row.playbook_name || '',
        createdAt: row.created_at,
        result: row.result ?? undefined,
      }));
    } catch (err) {
      logger.error('[SoarPgRepository] listEvidenceForIncident failed:', toMessage(err));
      return [];
    }
  },
};
