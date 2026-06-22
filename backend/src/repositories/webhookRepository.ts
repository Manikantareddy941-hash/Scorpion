import { Models } from 'node-appwrite';
import { databases, users, DB_ID, COLLECTIONS, Query, ID } from '../lib/appwrite';

export const webhookRepository = {
  async findReposByUrl(url: string) {
    return databases.listDocuments(DB_ID, COLLECTIONS.REPOSITORIES, [Query.equal('url', url)]);
  },

  async createBuildLog(data: Record<string, unknown>) {
    return databases.createDocument(DB_ID, COLLECTIONS.BUILDS, ID.unique(), data);
  },

  async createCommitLog(data: Record<string, unknown>) {
    return databases.createDocument(DB_ID, COLLECTIONS.COMMITS, ID.unique(), data);
  },

  async createTestRun(data: Record<string, unknown>) {
    return databases.createDocument(DB_ID, COLLECTIONS.TEST_RUNS, ID.unique(), data);
  },

  async findUserByGithubId(githubUserId: string): Promise<Models.User<Models.Preferences> | undefined> {
    const allUsers = await users.list();
    return allUsers.users.find(u => u.prefs?.github_user_id === githubUserId);
  },

  async setGithubInstallationId(userId: string, prefs: Models.Preferences, installationId: string) {
    return users.updatePrefs(userId, { ...prefs, github_installation_id: installationId });
  },

  async findRepoByUserAndUrl(userId: string, url: string) {
    return databases.listDocuments(DB_ID, COLLECTIONS.REPOSITORIES, [
      Query.equal('user_id', userId),
      Query.equal('url', url),
      Query.limit(1)
    ]);
  },

  async createRepo(data: Record<string, unknown>) {
    return databases.createDocument(DB_ID, COLLECTIONS.REPOSITORIES, ID.unique(), data);
  }
};
