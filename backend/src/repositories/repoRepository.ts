import { ID } from 'node-appwrite';
import { databases, DB_ID, COLLECTIONS, Query } from '../lib/appwrite';
import { isPostgresEnabled } from '../db/pool';
import { repoPgRepository } from './pg/repoPgRepository';
import { canonicalizeRepoUrl } from '../utils/repoUrl';

/** Upper bound on the fallback scan; a tenant's repo list is small. */
const TENANT_SCAN_LIMIT = 500;

const legacyRepoRepository = {
  /**
   * Finds a tenant's repo by URL, matching on canonical identity rather than
   * exact string. The same repository reaches us as several strings depending
   * on the source (CI remote, hand-typed dashboard entry, SSH remote), and an
   * exact-match miss doesn't just fail a lookup — the caller then CREATES a
   * second repo row. The tenant's findings then split across two records that
   * are the same repository.
   *
   * Exact match first so the common case stays on the indexed query; the
   * canonical scan is the fallback, and stays scoped to the same owner so it
   * can never surface another tenant's repo as "already exists".
   */
  async findByOwnershipAndUrl(field: string, value: string, url: string) {
    const exact = await databases.listDocuments(DB_ID, COLLECTIONS.REPOSITORIES, [
      Query.equal(field, value),
      Query.equal('url', url),
      Query.limit(1)
    ]);
    if (exact.total > 0) return exact;

    const target = canonicalizeRepoUrl(url);
    if (!target) return exact; // nothing to canonicalize; don't scan

    const owned = await databases.listDocuments(DB_ID, COLLECTIONS.REPOSITORIES, [
      Query.equal(field, value),
      Query.limit(TENANT_SCAN_LIMIT)
    ]);
    const match = owned.documents.find(
      (d) => canonicalizeRepoUrl(String((d as unknown as Record<string, unknown>).url ?? '')) === target
    );
    return match ? { total: 1, documents: [match] } : exact;
  },

  async updateRepo(id: string, fields: Record<string, unknown>) {
    return databases.updateDocument(DB_ID, COLLECTIONS.REPOSITORIES, id, fields);
  },

  async createRepo(data: Record<string, unknown>) {
    return databases.createDocument(DB_ID, COLLECTIONS.REPOSITORIES, ID.unique(), data);
  },

  async getRepo(id: string) {
    return databases.getDocument(DB_ID, COLLECTIONS.REPOSITORIES, id);
  },

  async deleteRepo(id: string) {
    return databases.deleteDocument(DB_ID, COLLECTIONS.REPOSITORIES, id);
  },

  async listByScope(field: string, value: string) {
    return databases.listDocuments(DB_ID, COLLECTIONS.REPOSITORIES, [
      Query.equal(field, value),
      Query.orderDesc('updated_at')
    ]);
  },

  async findActiveScan(repoId: string) {
    return databases.listDocuments(DB_ID, COLLECTIONS.SCANS, [
      Query.equal('repo_id', repoId),
      Query.equal('status', ['pending', 'running']),
      Query.limit(1)
    ]);
  },

  async createScan(data: Record<string, unknown>) {
    return databases.createDocument(DB_ID, COLLECTIONS.SCANS, ID.unique(), data);
  },

  async getScan(scanId: string) {
    return databases.getDocument(DB_ID, COLLECTIONS.SCANS, scanId);
  },

  async listScans(repoIds: string[], status: string | undefined, limit: number) {
    const filters = [
      Query.equal('repo_id', repoIds),
      Query.orderDesc('$createdAt'),
      Query.limit(limit)
    ];
    if (status) filters.push(Query.equal('status', status));
    return databases.listDocuments(DB_ID, COLLECTIONS.SCANS, filters);
  }
};

/**
 * Storage facade: Postgres when DATABASE_URL is configured, legacy Appwrite
 * otherwise. Typed as the pg impl — its return shapes ({ $id, ...fields },
 * { total, documents }) are what every consumer already destructures; the
 * legacy Appwrite SDK return types are structurally compatible for those uses.
 */
export const repoRepository = isPostgresEnabled() ? repoPgRepository : legacyRepoRepository;
