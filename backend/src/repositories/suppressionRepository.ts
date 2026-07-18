import type { Models } from 'node-appwrite';
import { databases, DB_ID, ID, Query } from '../lib/appwrite';
import { logger } from '../services/logger';
import type { SuppressionRule } from '../monitor/suppressionMatcher';
import { isPostgresEnabled } from '../db/pool';
import { suppressionPgRepository } from './pg/suppressionPgRepository';

const COLLECTION = 'suppression_rules';

const legacySuppressionRepository = {
  async listForOwner(owner: string): Promise<SuppressionRule[]> {
    try {
      const res = await databases.listDocuments(DB_ID, COLLECTION, [Query.equal('owner', owner), Query.limit(100)]);
      return res.documents.map((d: Models.Document) => {
        const w = d as unknown as Record<string, string | number | null>;
        return {
          id: d.$id, matchType: w.matchType as SuppressionRule['matchType'],
          matchValue: String(w.matchValue), expiresAt: w.expiresAt ? Number(w.expiresAt) : undefined,
          reason: (w.reason as string) || undefined,
        };
      });
    } catch (err) { logger.error('[suppressionRepository] list failed', err); return []; }
  },

  async create(owner: string, rule: Omit<SuppressionRule, 'id'>): Promise<SuppressionRule> {
    const doc = await databases.createDocument(DB_ID, COLLECTION, ID.unique(), {
      owner, matchType: rule.matchType, matchValue: rule.matchValue,
      expiresAt: rule.expiresAt ?? null, reason: rule.reason ?? null,
    });
    return { id: doc.$id, ...rule };
  },

  async remove(owner: string, id: string): Promise<boolean> {
    const doc = await databases.getDocument(DB_ID, COLLECTION, id);
    if ((doc as unknown as Record<string, string>).owner !== owner) return false; // tenancy guard
    await databases.deleteDocument(DB_ID, COLLECTION, id);
    return true;
  },
};

/** Storage facade: Postgres when DATABASE_URL is configured, legacy Appwrite otherwise. */
export const suppressionRepository: typeof legacySuppressionRepository =
  isPostgresEnabled() ? suppressionPgRepository : legacySuppressionRepository;
