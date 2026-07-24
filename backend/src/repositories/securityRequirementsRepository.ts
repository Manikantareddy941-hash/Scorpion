import fs from 'fs/promises';
import path from 'path';
import { databases, DB_ID, Query, ID } from '../lib/appwrite';
import { logger } from '../services/logger';
import {
  ProjectProfile,
  StoredRequirement,
  ReconcilePlan,
  LifecycleStatus,
} from '../types/securityRequirements.types';

const PROFILES = 'plan_project_profiles';
const REQUIREMENTS = 'plan_security_requirements';
const MOCK_DB_PATH = path.join(process.cwd(), 'scratch', 'security_requirements_mock_db.json');

interface MockDb {
  profiles: (ProjectProfile & { $id: string })[];
  requirements: StoredRequirement[];
}

const defaultMockDb: MockDb = { profiles: [], requirements: [] };

async function readMockDb(): Promise<MockDb> {
  try {
    await fs.mkdir(path.dirname(MOCK_DB_PATH), { recursive: true });
    const parsed = JSON.parse(await fs.readFile(MOCK_DB_PATH, 'utf-8'));
    return { profiles: parsed.profiles ?? [], requirements: parsed.requirements ?? [] };
  } catch {
    await fs.writeFile(MOCK_DB_PATH, JSON.stringify(defaultMockDb, null, 2), 'utf-8');
    return { profiles: [], requirements: [] };
  }
}

async function writeMockDb(db: MockDb): Promise<void> {
  await fs.mkdir(path.dirname(MOCK_DB_PATH), { recursive: true });
  await fs.writeFile(MOCK_DB_PATH, JSON.stringify(db, null, 2), 'utf-8');
}

/** Appwrite first; fall back to the local JSON store on any failure. */
async function handleQuery<T>(appwriteCall: () => Promise<T>, mockCall: () => Promise<T>): Promise<T> {
  try {
    return await appwriteCall();
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logger.warn('[SecurityRequirementsRepository] Appwrite operation failed, using local JSON fallback:', message);
    return await mockCall();
  }
}

// Whitelist the exact collection attributes on write. A stray key (e.g. $id)
// makes Appwrite reject the whole document — the ingestion-bug class.
function toRequirementPayload(r: StoredRequirement): Record<string, unknown> {
  return {
    projectId: r.projectId,
    code: r.code,
    title: r.title,
    description: r.description,
    category: r.category,
    frameworks: r.frameworks,
    controlIds: r.controlIds,
    severity: r.severity,
    status: r.status,
    lifecycleStatus: r.lifecycleStatus,
    justification: r.justification ?? '',
    updatedBy: r.updatedBy ?? '',
    sourceRuleId: r.sourceRuleId,
    remediation: r.remediation,
    createdAt: r.createdAt,
    ticketId: r.ticketId ?? '',
    jiraKey: r.jiraKey ?? '',
  };
}

function profilePayload(p: ProjectProfile): Record<string, unknown> {
  return {
    projectId: p.projectId,
    appType: p.appType,
    stack: p.stack,
    dataTypes: p.dataTypes,
    deployment: p.deployment,
    authModel: p.authModel,
    frameworks: p.frameworks,
    updatedAt: p.updatedAt ?? new Date().toISOString(),
  };
}

export const securityRequirementsRepository = {
  async getProfile(projectId: string): Promise<ProjectProfile | null> {
    return handleQuery(
      async () => {
        const res = await databases.listDocuments(DB_ID, PROFILES, [Query.equal('projectId', projectId), Query.limit(1)]);
        return (res.documents[0] as unknown as ProjectProfile) ?? null;
      },
      async () => {
        const db = await readMockDb();
        return db.profiles.find((p) => p.projectId === projectId) ?? null;
      },
    );
  },

  async upsertProfile(profile: ProjectProfile): Promise<ProjectProfile> {
    const payload = profilePayload({ ...profile, updatedAt: new Date().toISOString() });
    return handleQuery(
      async () => {
        const existing = await databases.listDocuments(DB_ID, PROFILES, [Query.equal('projectId', profile.projectId), Query.limit(1)]);
        const doc = existing.documents[0]
          ? await databases.updateDocument(DB_ID, PROFILES, existing.documents[0].$id, payload)
          : await databases.createDocument(DB_ID, PROFILES, ID.unique(), payload);
        return doc as unknown as ProjectProfile;
      },
      async () => {
        const db = await readMockDb();
        const idx = db.profiles.findIndex((p) => p.projectId === profile.projectId);
        const row = { $id: idx >= 0 ? db.profiles[idx].$id : `prof-${profile.projectId}`, ...profile, ...payload } as ProjectProfile & { $id: string };
        if (idx >= 0) db.profiles[idx] = row; else db.profiles.push(row);
        await writeMockDb(db);
        return row;
      },
    );
  },

  async listRequirements(projectId: string): Promise<StoredRequirement[]> {
    return handleQuery(
      async () => {
        const res = await databases.listDocuments(DB_ID, REQUIREMENTS, [Query.equal('projectId', projectId), Query.limit(500)]);
        return res.documents as unknown as StoredRequirement[];
      },
      async () => {
        const db = await readMockDb();
        return db.requirements.filter((r) => r.projectId === projectId);
      },
    );
  },

  /**
   * Persist a reconcile plan: create new requirements, refresh the descriptive
   * fields of still-applicable ones (preserving their lifecycle/audit, but
   * reopening any that had been obsoleted), and obsolete the ones that dropped
   * out. Never deletes — obsolete rows stay for audit.
   */
  async applyReconcile(projectId: string, plan: ReconcilePlan): Promise<void> {
    const now = new Date().toISOString();
    await handleQuery(
      async () => {
        for (const g of plan.toCreate) {
          const row: StoredRequirement = { ...g, projectId, lifecycleStatus: 'open', createdAt: now };
          await databases.createDocument(DB_ID, REQUIREMENTS, ID.unique(), toRequirementPayload(row));
        }
        for (const { stored, generated } of plan.toUpdate) {
          if (!stored.$id) continue;
          const reopened: LifecycleStatus = stored.lifecycleStatus === 'obsolete' ? 'open' : stored.lifecycleStatus;
          await databases.updateDocument(DB_ID, REQUIREMENTS, stored.$id, {
            title: generated.title, description: generated.description, category: generated.category,
            frameworks: generated.frameworks, controlIds: generated.controlIds, severity: generated.severity,
            status: generated.status, remediation: generated.remediation, sourceRuleId: generated.sourceRuleId,
            lifecycleStatus: reopened,
          });
        }
        for (const s of plan.toObsolete) {
          if (!s.$id) continue;
          await databases.updateDocument(DB_ID, REQUIREMENTS, s.$id, { lifecycleStatus: 'obsolete' });
        }
        return undefined;
      },
      async () => {
        const db = await readMockDb();
        for (const g of plan.toCreate) {
          db.requirements.push({ ...g, $id: `req-${projectId}-${g.code}`, projectId, lifecycleStatus: 'open', createdAt: now });
        }
        for (const { stored, generated } of plan.toUpdate) {
          const idx = db.requirements.findIndex((r) => r.$id === stored.$id);
          if (idx < 0) continue;
          const reopened: LifecycleStatus = db.requirements[idx].lifecycleStatus === 'obsolete' ? 'open' : db.requirements[idx].lifecycleStatus;
          db.requirements[idx] = { ...db.requirements[idx], ...generated, projectId, lifecycleStatus: reopened };
        }
        for (const s of plan.toObsolete) {
          const idx = db.requirements.findIndex((r) => r.$id === s.$id);
          if (idx >= 0) db.requirements[idx].lifecycleStatus = 'obsolete';
        }
        await writeMockDb(db);
        return undefined;
      },
    );
  },

  async getRequirement(reqId: string): Promise<StoredRequirement | null> {
    return handleQuery(
      async () => (await databases.getDocument(DB_ID, REQUIREMENTS, reqId)) as unknown as StoredRequirement,
      async () => {
        const db = await readMockDb();
        return db.requirements.find((r) => r.$id === reqId) ?? null;
      },
    );
  },

  async setTicketRef(reqId: string, ref: { ticketId: string; jiraKey?: string }): Promise<void> {
    const patch = { ticketId: ref.ticketId, jiraKey: ref.jiraKey ?? '' };
    await handleQuery(
      async () => { await databases.updateDocument(DB_ID, REQUIREMENTS, reqId, patch); return undefined; },
      async () => {
        const db = await readMockDb();
        const idx = db.requirements.findIndex((r) => r.$id === reqId);
        if (idx >= 0) { db.requirements[idx] = { ...db.requirements[idx], ...patch }; await writeMockDb(db); }
        return undefined;
      },
    );
  },

  async updateRequirement(
    reqId: string,
    update: { lifecycleStatus: LifecycleStatus; justification?: string; updatedBy: string },
  ): Promise<StoredRequirement | null> {
    const patch = { lifecycleStatus: update.lifecycleStatus, justification: update.justification ?? '', updatedBy: update.updatedBy };
    return handleQuery(
      async () => (await databases.updateDocument(DB_ID, REQUIREMENTS, reqId, patch)) as unknown as StoredRequirement,
      async () => {
        const db = await readMockDb();
        const idx = db.requirements.findIndex((r) => r.$id === reqId);
        if (idx < 0) return null;
        db.requirements[idx] = { ...db.requirements[idx], ...patch };
        await writeMockDb(db);
        return db.requirements[idx];
      },
    );
  },
};
