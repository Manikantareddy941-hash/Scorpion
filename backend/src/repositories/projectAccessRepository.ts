import { databases, DB_ID, Query, ID } from '../lib/appwrite';
import { fetchAllDocuments } from '../lib/paginate';
import { ACCESS_COLLECTION } from '../authz/backfill';

export interface Grant {
  $id: string;
  projectId: string;
  subject_type: 'user' | 'team';
  subject_id: string;
  role_key: string;
  granted_by: string;
  granted_at: string;
}

/**
 * Data access for project_access. Business rules — who may grant what, and the
 * refusal to remove the last admin — live in projectAccessService.
 */
export const projectAccessRepository = {
  /**
   * Every grant on a project. Reads to completion: this list is what an admin
   * uses to decide who to remove, so a silently capped page would hide a
   * collaborator they believe they have revoked.
   */
  async listForProject(projectId: string): Promise<Grant[]> {
    const page = await fetchAllDocuments(ACCESS_COLLECTION, [Query.equal('projectId', projectId)]);
    if (page.truncated) throw new Error(`grant list truncated at ${page.items.length}/${page.total}`);
    return page.items as unknown as Grant[];
  },

  /**
   * Grants for one subject on one project. Returns a list rather than a single
   * document because subject_id alone is not unique — the same id could in
   * principle exist as both a user and a team.
   */
  async findBySubject(projectId: string, subjectId: string): Promise<Grant[]> {
    const page = await fetchAllDocuments(ACCESS_COLLECTION, [
      Query.equal('projectId', projectId),
      Query.equal('subject_id', subjectId),
    ]);
    return page.items as unknown as Grant[];
  },

  /** Throws on the unique index when the subject already holds a grant here. */
  async create(input: Omit<Grant, '$id'>): Promise<Grant> {
    const doc = await databases.createDocument(DB_ID, ACCESS_COLLECTION, ID.unique(), {
      projectId: input.projectId,
      subject_type: input.subject_type,
      subject_id: input.subject_id,
      role_key: input.role_key,
      granted_by: input.granted_by,
      granted_at: input.granted_at,
    });
    return doc as unknown as Grant;
  },

  async updateRole(grantId: string, roleKey: string, grantedBy: string): Promise<Grant> {
    const doc = await databases.updateDocument(DB_ID, ACCESS_COLLECTION, grantId, {
      role_key: roleKey,
      // A role change is a new grant decision, so it re-stamps the audit fields.
      granted_by: grantedBy,
      granted_at: new Date().toISOString(),
    });
    return doc as unknown as Grant;
  },

  async remove(grantId: string): Promise<void> {
    await databases.deleteDocument(DB_ID, ACCESS_COLLECTION, grantId);
  },
};
