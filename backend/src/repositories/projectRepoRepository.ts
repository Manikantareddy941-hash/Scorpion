import fs from 'fs/promises';
import path from 'path';
import { databases, DB_ID, Query, ID } from '../lib/appwrite';
import { logger } from '../services/logger';

/**
 * Join between a Plan project and the repositories whose findings it owns
 * (Many:Many — a shared library repo can belong to several compliance projects,
 * and a project can span several repos). This is what makes requirement
 * correlation project-scoped instead of owner-scoped: a payment project no
 * longer inherits an unrelated internal tool's findings just because they share
 * an owner.
 */

const COLLECTION = 'plan_project_repos';
const MOCK_DB_PATH = path.join(process.cwd(), 'scratch', 'project_repos_mock_db.json');

export interface RepoBinding {
  $id?: string;
  projectId: string;
  repoId: string;
  repoUrl: string;
  createdAt: string;
}

interface MockDb {
  bindings: RepoBinding[];
}

async function readMockDb(): Promise<MockDb> {
  try {
    const parsed = JSON.parse(await fs.readFile(MOCK_DB_PATH, 'utf-8'));
    return { bindings: parsed.bindings ?? [] };
  } catch {
    await fs.mkdir(path.dirname(MOCK_DB_PATH), { recursive: true });
    await fs.writeFile(MOCK_DB_PATH, JSON.stringify({ bindings: [] }, null, 2), 'utf-8');
    return { bindings: [] };
  }
}

async function writeMockDb(db: MockDb): Promise<void> {
  await fs.mkdir(path.dirname(MOCK_DB_PATH), { recursive: true });
  await fs.writeFile(MOCK_DB_PATH, JSON.stringify(db, null, 2), 'utf-8');
}

async function handleQuery<T>(appwriteCall: () => Promise<T>, mockCall: () => Promise<T>): Promise<T> {
  try {
    return await appwriteCall();
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logger.warn('[ProjectRepoRepository] Appwrite operation failed, using local JSON fallback:', message);
    return await mockCall();
  }
}

const payload = (b: RepoBinding): Record<string, unknown> => ({
  projectId: b.projectId,
  repoId: b.repoId,
  repoUrl: b.repoUrl,
  createdAt: b.createdAt,
});

export const projectRepoRepository = {
  async listBindings(projectId: string): Promise<RepoBinding[]> {
    return handleQuery(
      async () => {
        const res = await databases.listDocuments(DB_ID, COLLECTION, [Query.equal('projectId', projectId), Query.limit(200)]);
        return res.documents as unknown as RepoBinding[];
      },
      async () => (await readMockDb()).bindings.filter((b) => b.projectId === projectId),
    );
  },

  async listRepoIds(projectId: string): Promise<string[]> {
    return (await this.listBindings(projectId)).map((b) => b.repoId);
  },

  /**
   * Replace the project's bindings with exactly this set (idempotent). The
   * caller is responsible for having validated repo ownership first — this
   * layer only persists.
   */
  async setBindings(projectId: string, repos: { repoId: string; repoUrl: string }[]): Promise<RepoBinding[]> {
    const now = new Date().toISOString();
    const rows: RepoBinding[] = repos.map((r) => ({ projectId, repoId: r.repoId, repoUrl: r.repoUrl, createdAt: now }));
    return handleQuery(
      async () => {
        const existing = await databases.listDocuments(DB_ID, COLLECTION, [Query.equal('projectId', projectId), Query.limit(200)]);
        await Promise.all(existing.documents.map((d) => databases.deleteDocument(DB_ID, COLLECTION, d.$id)));
        const created = await Promise.all(rows.map((r) => databases.createDocument(DB_ID, COLLECTION, ID.unique(), payload(r))));
        return created as unknown as RepoBinding[];
      },
      async () => {
        const db = await readMockDb();
        db.bindings = db.bindings.filter((b) => b.projectId !== projectId);
        db.bindings.push(...rows.map((r, i) => ({ $id: `bind-${projectId}-${i}`, ...r })));
        await writeMockDb(db);
        return db.bindings.filter((b) => b.projectId === projectId);
      },
    );
  },
};
