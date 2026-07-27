import { Models } from 'node-appwrite';
import { databases, users, DB_ID, COLLECTIONS, Query, ID } from '../lib/appwrite';
import { repoRepository } from './repoRepository';

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

  /**
   * Delegates to the canonical lookup rather than matching the URL exactly.
   * The GitHub App install path calls this before creating a repo, so an
   * exact-match miss on a spelling variant (.git suffix, casing, SSH remote)
   * registered a second row for a repository already tracked.
   *
   * Fixed on the method rather than at its call site so any future caller
   * inherits the canonical behaviour instead of reintroducing the bug.
   */
  async findRepoByUserAndUrl(userId: string, url: string) {
    return repoRepository.findByOwnershipAndUrl('user_id', userId, url);
  },

  async createRepo(data: Record<string, unknown>) {
    return databases.createDocument(DB_ID, COLLECTIONS.REPOSITORIES, ID.unique(), data);
  }
};
