import { planRepository } from '../repositories/planRepository';
import { securityRequirementsRepository as repo } from '../repositories/securityRequirementsRepository';
import { generate as engineGenerate, reconcile } from './securityRequirementsEngine';
import { LifecycleStatus, ProjectProfile, StoredRequirement } from '../types/securityRequirements.types';

// 'denied' collapses "not owned" and "no such project" into one result so the
// transport layer can answer 404 for both — no enumeration oracle.
type Access<T> = 'denied' | { ok: true; data: T };

// Profile shape accepted from the transport layer (projectId is stamped here,
// never taken from the body).
type ProfileInput = Omit<ProjectProfile, 'projectId' | 'updatedAt'>;

async function owns(projectId: string, userId?: string): Promise<boolean> {
  if (!userId) return false;
  const owner = await planRepository.getProjectOwner(projectId);
  return owner === userId;
}

export const securityRequirementsService = {
  async getProfile(projectId: string, userId?: string): Promise<Access<ProjectProfile | null>> {
    if (!(await owns(projectId, userId))) return 'denied';
    return { ok: true, data: await repo.getProfile(projectId) };
  },

  async saveProfile(projectId: string, input: ProfileInput, userId?: string): Promise<Access<ProjectProfile>> {
    if (!(await owns(projectId, userId))) return 'denied';
    return { ok: true, data: await repo.upsertProfile({ ...input, projectId }) };
  },

  async generate(projectId: string, userId?: string): Promise<Access<StoredRequirement[]> | 'no_profile'> {
    if (!(await owns(projectId, userId))) return 'denied';
    const profile = await repo.getProfile(projectId);
    if (!profile) return 'no_profile';
    const generated = engineGenerate({ ...profile, projectId });
    const stored = await repo.listRequirements(projectId);
    await repo.applyReconcile(projectId, reconcile(generated, stored));
    return { ok: true, data: await repo.listRequirements(projectId) };
  },

  async list(projectId: string, userId?: string): Promise<Access<StoredRequirement[]>> {
    if (!(await owns(projectId, userId))) return 'denied';
    return { ok: true, data: await repo.listRequirements(projectId) };
  },

  async setLifecycle(
    reqId: string,
    input: { lifecycleStatus: LifecycleStatus; justification?: string },
    userId?: string,
    updatedBy?: string,
  ): Promise<'not_found' | { ok: true; data: StoredRequirement }> {
    const existing = await repo.getRequirement(reqId);
    // Not found and not-owned both answer 404 — never reveal which.
    if (!existing || !(await owns(existing.projectId, userId))) return 'not_found';
    const updated = await repo.updateRequirement(reqId, {
      lifecycleStatus: input.lifecycleStatus,
      justification: input.justification,
      updatedBy: updatedBy ?? 'unknown',
    });
    if (!updated) return 'not_found';
    return { ok: true, data: updated };
  },
};
