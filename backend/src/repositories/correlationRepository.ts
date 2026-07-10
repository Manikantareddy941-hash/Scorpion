import type { Models } from 'node-appwrite';
import { databases, DB_ID, ID, Query } from '../lib/appwrite';
import { logger } from '../services/logger';
import type { Correlation, RuleState, Severity } from '../monitor/securityEvent.types';

const FIRED = 'correlations';
const RULE_STATE = 'correlation_rule_states';

export const correlationRepository = {
  async wasFired(owner: string, ruleId: string, key: string, bucket: number): Promise<boolean> {
    try {
      const res = await databases.listDocuments(DB_ID, FIRED, [
        Query.equal('owner', owner), Query.equal('ruleId', ruleId),
        Query.equal('correlationKey', key), Query.equal('bucket', bucket), Query.limit(1),
      ]);
      return res.total > 0;
    } catch (err) {
      logger.error('[correlationRepository] wasFired failed', err);
      return true; // fail-secure: assume already fired → don't double-page
    }
  },

  async recordFired(c: Correlation, incidentId: string): Promise<void> {
    await databases.createDocument(DB_ID, FIRED, ID.unique(), {
      owner: c.ownerUserId, ruleId: c.ruleId, correlationKey: c.correlationKey,
      bucket: c.bucket, severity: c.severity, incidentId,
      matchedEventIds: JSON.stringify(c.matchedEventIds),
    });
  },

  async listFired(ownerField: 'owner', ownerValue: string): Promise<Array<Correlation & { incidentId: string; createdAt: string }>> {
    const res = await databases.listDocuments(DB_ID, FIRED, [
      Query.equal(ownerField, ownerValue), Query.orderDesc('$createdAt'), Query.limit(100),
    ]);
    return res.documents.map((d: Models.Document) => {
      const w = d as unknown as Record<string, string>;
      return {
        ruleId: w.ruleId, title: w.ruleId, severity: w.severity as Severity,
        correlationKey: w.correlationKey, bucket: Number(w.bucket),
        matchedEventIds: JSON.parse(w.matchedEventIds || '[]'),
        ownerUserId: w.owner, incidentId: w.incidentId, createdAt: d.$createdAt,
      };
    });
  },

  async listRuleStates(owner: string): Promise<RuleState[]> {
    try {
      const res = await databases.listDocuments(DB_ID, RULE_STATE, [Query.equal('owner', owner), Query.limit(50)]);
      return res.documents.map((d: Models.Document) => {
        const w = d as unknown as Record<string, string | boolean>;
        return { id: w.ruleId as string, enabled: w.enabled as boolean, severityOverride: w.severityOverride as Severity | undefined };
      });
    } catch (err) {
      logger.error('[correlationRepository] listRuleStates failed', err);
      return []; // no overrides → catalog defaults (all enabled)
    }
  },

  async upsertRuleState(owner: string, state: RuleState): Promise<void> {
    const existing = await databases.listDocuments(DB_ID, RULE_STATE, [
      Query.equal('owner', owner), Query.equal('ruleId', state.id), Query.limit(1),
    ]);
    const payload = { owner, ruleId: state.id, enabled: state.enabled, severityOverride: state.severityOverride ?? null };
    if (existing.total > 0) {
      await databases.updateDocument(DB_ID, RULE_STATE, existing.documents[0].$id, payload);
    } else {
      await databases.createDocument(DB_ID, RULE_STATE, ID.unique(), payload);
    }
  },
};
