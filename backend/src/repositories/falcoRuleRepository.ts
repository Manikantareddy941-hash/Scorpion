import type { Models } from 'node-appwrite';
import { databases, DB_ID, ID, Query } from '../lib/appwrite';
import { logger } from '../services/logger';
import { FALCO_TEMPLATES } from '../runtime/falcoRuleCatalog';
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

function toMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/** null for malformed rows (unknown template / bad params JSON) — skipped
 *  rules mean no suppression, which is the fail-secure direction. */
function fromDoc(doc: Models.Document): ManagedFalcoRule | null {
  const w = doc as unknown as RuleWire & Models.Document;
  if (!(w.template in FALCO_TEMPLATES)) {
    logger.warn(`[FalcoRuleRepository] skipping rule ${doc.$id}: unknown template '${String(w.template)}'`);
    return null;
  }
  try {
    return {
      id: doc.$id,
      template: w.template,
      params: JSON.parse(w.params || '{}') as ManagedFalcoRule['params'],
      appScope: w.appScope ?? undefined,
      severityOverride: w.severityOverride ?? undefined,
      suppressed: w.suppressed,
      enabled: w.enabled,
    };
  } catch (err) {
    logger.warn(`[FalcoRuleRepository] skipping rule ${doc.$id}: ${toMessage(err)}`);
    return null;
  }
}

export const falcoRuleRepository = {
  /** [] on failure — never suppress or reprioritize when config is unreadable. */
  async listRules(): Promise<ManagedFalcoRule[]> {
    try {
      const list = await databases.listDocuments(DB_ID, COLLECTION, [Query.limit(200)]);
      return list.documents.map(fromDoc).filter((r): r is ManagedFalcoRule => r !== null);
    } catch (err) {
      logger.warn('[FalcoRuleRepository] load failed:', toMessage(err));
      return [];
    }
  },

  // Mutations log with context then rethrow — silent fake success is data
  // loss; callers handle propagation.
  async createRule(r: Omit<ManagedFalcoRule, 'id'>): Promise<ManagedFalcoRule> {
    try {
      const doc = await databases.createDocument(DB_ID, COLLECTION, ID.unique(), {
        template: r.template,
        params: JSON.stringify(r.params),
        appScope: r.appScope ?? null,
        severityOverride: r.severityOverride ?? null,
        suppressed: r.suppressed,
        enabled: r.enabled,
      });
      return { ...r, id: doc.$id };
    } catch (err) {
      logger.error('[FalcoRuleRepository] createRule failed:', toMessage(err));
      throw err;
    }
  },

  async updateRule(id: string, r: Partial<Omit<ManagedFalcoRule, 'id'>>): Promise<void> {
    const patch: Record<string, unknown> = {};
    if (r.template !== undefined) patch.template = r.template;
    if (r.params !== undefined) patch.params = JSON.stringify(r.params);
    if (r.appScope !== undefined) patch.appScope = r.appScope ?? null;
    if (r.severityOverride !== undefined) patch.severityOverride = r.severityOverride ?? null;
    if (r.suppressed !== undefined) patch.suppressed = r.suppressed;
    if (r.enabled !== undefined) patch.enabled = r.enabled;
    try {
      await databases.updateDocument(DB_ID, COLLECTION, id, patch);
    } catch (err) {
      logger.error('[FalcoRuleRepository] updateRule failed:', toMessage(err));
      throw err;
    }
  },
};
