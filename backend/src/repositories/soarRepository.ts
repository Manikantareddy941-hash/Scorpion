import type { Models } from 'node-appwrite';
import { databases, DB_ID, ID, Query } from '../lib/appwrite';
import { logger } from '../services/logger';
import type { Playbook, SoarActionType } from '../soar/playbookMatcher';

const PLAYBOOKS = 'playbooks';
const ACTIONS = 'soar_actions';

export type SoarActionStatus = 'pending' | 'approved' | 'rejected' | 'executed' | 'failed';

export interface SoarActionRecord {
  id: string;
  incidentId: string;
  actionType: SoarActionType;
  playbookId: string;
  playbookName: string;
  status: SoarActionStatus;
  namespace?: string;
  podName?: string;
  /** Repo owner for owner-scoped Slack escalation (fail-secure downstream). */
  ownerUserId?: string;
  containerImage: string;
  falcoRule: string;
  createdAt: string;
  resolvedAt?: string;
  resolvedBy?: string;
  result?: string;
  error?: string;
}

interface PlaybookWire { name: string; enabled: boolean; trigger: string; actions: string }
type ActionWire = Omit<SoarActionRecord, 'id'>;

function toMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/** null for malformed rows (bad trigger/actions JSON) — skip the row, keep siblings. */
function playbookFromDoc(doc: Models.Document): Playbook | null {
  const w = doc as unknown as PlaybookWire & Models.Document;
  try {
    return {
      id: doc.$id,
      name: w.name,
      enabled: w.enabled,
      trigger: JSON.parse(w.trigger) as Playbook['trigger'],
      actions: JSON.parse(w.actions) as Playbook['actions'],
    };
  } catch (err) {
    logger.warn(`[SoarRepository] skipping playbook ${doc.$id}: ${toMessage(err)}`);
    return null;
  }
}

function actionFromDoc(doc: Models.Document): SoarActionRecord {
  const w = doc as unknown as ActionWire & Models.Document;
  return {
    id: doc.$id,
    incidentId: w.incidentId,
    actionType: w.actionType,
    playbookId: w.playbookId,
    playbookName: w.playbookName,
    status: w.status,
    namespace: w.namespace ?? undefined,
    podName: w.podName ?? undefined,
    ownerUserId: w.ownerUserId ?? undefined,
    containerImage: w.containerImage,
    falcoRule: w.falcoRule,
    createdAt: w.createdAt,
    resolvedAt: w.resolvedAt ?? undefined,
    resolvedBy: w.resolvedBy ?? undefined,
    result: w.result ?? undefined,
    error: w.error ?? undefined,
  };
}

export const soarRepository = {
  /** Fail-secure: Appwrite down → no playbooks → no SOAR actions (existing
   *  incident path still runs). Never throws. */
  async listPlaybooks(): Promise<Playbook[]> {
    try {
      const list = await databases.listDocuments(DB_ID, PLAYBOOKS, [Query.limit(100)]);
      return list.documents.map(playbookFromDoc).filter((p): p is Playbook => p !== null);
    } catch (err) {
      logger.warn('[SoarRepository] playbook load failed:', toMessage(err));
      return [];
    }
  },

  // Mutations log with context then rethrow — silent fake success is data
  // loss; callers (route error-middleware, BullMQ worker) handle propagation.
  async createPlaybook(p: Omit<Playbook, 'id'>): Promise<Playbook> {
    try {
      const doc = await databases.createDocument(DB_ID, PLAYBOOKS, ID.unique(), {
        name: p.name,
        enabled: p.enabled,
        trigger: JSON.stringify(p.trigger),
        actions: JSON.stringify(p.actions),
      });
      return { ...p, id: doc.$id };
    } catch (err) {
      logger.error('[SoarRepository] createPlaybook failed:', toMessage(err));
      throw err;
    }
  },

  async updatePlaybook(id: string, p: Partial<Omit<Playbook, 'id'>>): Promise<void> {
    const patch: Record<string, unknown> = {};
    if (p.name !== undefined) patch.name = p.name;
    if (p.enabled !== undefined) patch.enabled = p.enabled;
    if (p.trigger !== undefined) patch.trigger = JSON.stringify(p.trigger);
    if (p.actions !== undefined) patch.actions = JSON.stringify(p.actions);
    try {
      await databases.updateDocument(DB_ID, PLAYBOOKS, id, patch);
    } catch (err) {
      logger.error('[SoarRepository] updatePlaybook failed:', toMessage(err));
      throw err;
    }
  },

  async createAction(a: Omit<SoarActionRecord, 'id' | 'createdAt'>): Promise<SoarActionRecord> {
    const createdAt = new Date().toISOString();
    try {
      const doc = await databases.createDocument(DB_ID, ACTIONS, ID.unique(), { ...a, createdAt });
      return { ...a, id: doc.$id, createdAt };
    } catch (err) {
      logger.error('[SoarRepository] createAction failed:', toMessage(err));
      throw err;
    }
  },

  async getAction(id: string): Promise<SoarActionRecord | null> {
    try {
      return actionFromDoc(await databases.getDocument(DB_ID, ACTIONS, id));
    } catch (err) {
      // Logged so an Appwrite outage is distinguishable from a clean not-found.
      logger.warn('[SoarRepository] getAction failed:', toMessage(err));
      return null;
    }
  },

  /** Read path — fail-secure like listPlaybooks: Appwrite down → []. */
  async listActions(status?: SoarActionStatus): Promise<SoarActionRecord[]> {
    try {
      const queries = [Query.orderDesc('createdAt'), Query.limit(100)];
      if (status) queries.push(Query.equal('status', status));
      const list = await databases.listDocuments(DB_ID, ACTIONS, queries);
      return list.documents.map(actionFromDoc);
    } catch (err) {
      logger.warn('[SoarRepository] action list failed:', toMessage(err));
      return [];
    }
  },

  async setActionStatus(
    id: string,
    status: SoarActionStatus,
    extra: { resolvedBy?: string; result?: string; error?: string } = {},
  ): Promise<void> {
    try {
      await databases.updateDocument(DB_ID, ACTIONS, id, {
        status,
        resolvedAt: new Date().toISOString(),
        ...extra,
      });
    } catch (err) {
      logger.error('[SoarRepository] setActionStatus failed:', toMessage(err));
      throw err;
    }
  },
};
