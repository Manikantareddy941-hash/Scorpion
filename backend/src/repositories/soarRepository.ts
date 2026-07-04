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

function playbookFromDoc(doc: Models.Document): Playbook {
  const w = doc as unknown as PlaybookWire & Models.Document;
  return {
    id: doc.$id,
    name: w.name,
    enabled: w.enabled,
    trigger: JSON.parse(w.trigger) as Playbook['trigger'],
    actions: JSON.parse(w.actions) as Playbook['actions'],
  };
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
      return list.documents.map(playbookFromDoc);
    } catch (err) {
      logger.warn('[SoarRepository] playbook load failed:', toMessage(err));
      return [];
    }
  },

  async createPlaybook(p: Omit<Playbook, 'id'>): Promise<Playbook> {
    const doc = await databases.createDocument(DB_ID, PLAYBOOKS, ID.unique(), {
      name: p.name,
      enabled: p.enabled,
      trigger: JSON.stringify(p.trigger),
      actions: JSON.stringify(p.actions),
    });
    return { ...p, id: doc.$id };
  },

  async updatePlaybook(id: string, p: Partial<Omit<Playbook, 'id'>>): Promise<void> {
    const patch: Record<string, unknown> = {};
    if (p.name !== undefined) patch.name = p.name;
    if (p.enabled !== undefined) patch.enabled = p.enabled;
    if (p.trigger !== undefined) patch.trigger = JSON.stringify(p.trigger);
    if (p.actions !== undefined) patch.actions = JSON.stringify(p.actions);
    await databases.updateDocument(DB_ID, PLAYBOOKS, id, patch);
  },

  async createAction(a: Omit<SoarActionRecord, 'id' | 'createdAt'>): Promise<SoarActionRecord> {
    const createdAt = new Date().toISOString();
    const doc = await databases.createDocument(DB_ID, ACTIONS, ID.unique(), { ...a, createdAt });
    return { ...a, id: doc.$id, createdAt };
  },

  async getAction(id: string): Promise<SoarActionRecord | null> {
    try {
      return actionFromDoc(await databases.getDocument(DB_ID, ACTIONS, id));
    } catch {
      return null;
    }
  },

  async listActions(status?: SoarActionStatus): Promise<SoarActionRecord[]> {
    const queries = [Query.orderDesc('createdAt'), Query.limit(100)];
    if (status) queries.push(Query.equal('status', status));
    const list = await databases.listDocuments(DB_ID, ACTIONS, queries);
    return list.documents.map(actionFromDoc);
  },

  async setActionStatus(
    id: string,
    status: SoarActionStatus,
    extra: { resolvedBy?: string; result?: string; error?: string } = {},
  ): Promise<void> {
    await databases.updateDocument(DB_ID, ACTIONS, id, {
      status,
      resolvedAt: new Date().toISOString(),
      ...extra,
    });
  },
};
