import { ID } from 'node-appwrite';
import { databases, DB_ID, COLLECTIONS, Query } from '../lib/appwrite';

export const repoRepository = {
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
  }
};
