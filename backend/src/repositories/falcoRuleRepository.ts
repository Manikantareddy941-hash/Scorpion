import type { Models } from 'node-appwrite';
import { databases, DB_ID, ID, Query } from '../lib/appwrite';
import { logger } from '../services/logger';
import type { ManagedFalcoRule } from '../runtime/falcoRuleCatalog';

const COLLECTION = 'falco_rules';

interface RuleWire {
  template: ManagedFalcoRule['template'];
  params: string;
  appScope?: string | null;
  severityOverride?: ManagedFalcoRule['severityOverride'] | null;
  suppressed: boolean;
  enabled: boolean;
}

function fromDoc(doc: Models.Document): ManagedFalcoRule {
  const w = doc as unknown as RuleWire & Models.Document;
  return {
    id: doc.$id,
    template: w.template,
    params: JSON.parse(w.params || '{}') as ManagedFalcoRule['params'],
    appScope: w.appScope ?? undefined,
    severityOverride: w.severityOverride ?? undefined,
    suppressed: w.suppressed,
    enabled: w.enabled,
  };
}

export const falcoRuleRepository = {
  /** [] on failure — never suppress or reprioritize when config is unreadable. */
  async listRules(): Promise<ManagedFalcoRule[]> {
    try {
      const list = await databases.listDocuments(DB_ID, COLLECTION, [Query.limit(200)]);
      return list.documents.map(fromDoc);
    } catch (err) {
      logger.warn('[FalcoRuleRepository] load failed:', err instanceof Error ? err.message : String(err));
      return [];
    }
  },

  async createRule(r: Omit<ManagedFalcoRule, 'id'>): Promise<ManagedFalcoRule> {
    const doc = await databases.createDocument(DB_ID, COLLECTION, ID.unique(), {
      template: r.template,
      params: JSON.stringify(r.params),
      appScope: r.appScope ?? null,
      severityOverride: r.severityOverride ?? null,
      suppressed: r.suppressed,
      enabled: r.enabled,
    });
    return { ...r, id: doc.$id };
  },

  async updateRule(id: string, r: Partial<Omit<ManagedFalcoRule, 'id'>>): Promise<void> {
    const patch: Record<string, unknown> = {};
    if (r.template !== undefined) patch.template = r.template;
    if (r.params !== undefined) patch.params = JSON.stringify(r.params);
    if (r.appScope !== undefined) patch.appScope = r.appScope ?? null;
    if (r.severityOverride !== undefined) patch.severityOverride = r.severityOverride ?? null;
    if (r.suppressed !== undefined) patch.suppressed = r.suppressed;
    if (r.enabled !== undefined) patch.enabled = r.enabled;
    await databases.updateDocument(DB_ID, COLLECTION, id, patch);
  },
};
