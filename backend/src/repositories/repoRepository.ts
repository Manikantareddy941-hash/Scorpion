import { ID } from 'node-appwrite';
import { databases, DB_ID, COLLECTIONS, Query } from '../lib/appwrite';
import { isPostgresEnabled } from '../db/pool';
import { repoPgRepository } from './pg/repoPgRepository';

const legacyRepoRepository = {
  async findByOwnershipAndUrl(field: string, value: string, url: string) {
    return databases.listDocuments(DB_ID, COLLECTIONS.REPOSITORIES, [
      Query.equal(field, value),
      Query.equal('url', url),
      Query.limit(1)
    ]);
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
