import { databases, DB_ID, ID } from '../lib/appwrite';
import { fetchAllDocuments } from '../lib/paginate';
import { ROLE_ADMIN } from './roles';

/**
 * Grant backfill for the RBAC rollout.
 *
 * Lives here rather than inside the migration script so the smoke test can run
 * the SAME function against a real database. A test that re-implements the
 * backfill proves only that the copy works.
 */

export const ACCESS_COLLECTION = 'project_access';
export const GRANTED_BY_MIGRATION = 'migration:rbac-v1';

export interface BackfillTally {
  projects: number;
  /** New grant rows written. */
  granted: number;
  /** Rows the unique index rejected because a previous run already wrote them. */
  existing: number;
  /** Projects with neither user_id nor team_id: nothing to grant to. */
  unowned: string[];
}

const isConflict = (raw: unknown): boolean => {
  const err = raw as { code?: number; type?: string };
  return err.code === 409 || Boolean(err.type?.includes('already_exists'));
};

/**
 * Writes one admin grant. Idempotent by way of the unique index on
 * (projectId, subject_type, subject_id) — a re-run collides rather than
 * stacking a duplicate, so this is safe to call repeatedly.
 */
export async function grantAdmin(
  projectId: string,
  subjectType: 'user' | 'team',
  subjectId: string,
  tally: BackfillTally,
  grantedBy: string = GRANTED_BY_MIGRATION,
): Promise<void> {
  try {
    await databases.createDocument(DB_ID, ACCESS_COLLECTION, ID.unique(), {
      projectId,
      subject_type: subjectType,
      subject_id: subjectId,
      role_key: ROLE_ADMIN,
      granted_by: grantedBy,
      granted_at: new Date().toISOString(),
    });
    tally.granted += 1;
  } catch (raw) {
    if (isConflict(raw)) { tally.existing += 1; return; }
    throw raw;
  }
}

export const emptyTally = (): BackfillTally => ({ projects: 0, granted: 0, existing: 0, unowned: [] });

/**
 * Two grants per project — the owner AND the owning team, both project_admin.
 *
 * Backfilling only the owner is the day-zero outage: every other member of a
 * shared project holds no grant, so enforcement takes the workspace away from
 * them. Admin for both because that is precisely today's effective access;
 * granting the team `project_editor` instead would be a silent privilege
 * reduction that breaks running work with an unexplainable 403.
 *
 * Throws if the project list could not be read to completion. A partial
 * backfill is worse than none: it passes a coverage check computed over the
 * same partial view.
 */
export async function backfillGrants(): Promise<BackfillTally> {
  const page = await fetchAllDocuments('plan_projects', [], { maxItems: 50000 });
  if (page.truncated) {
    throw new Error(`plan_projects read hit the safety cap at ${page.items.length}/${page.total} — backfill would be partial`);
  }

  const tally = emptyTally();
  tally.projects = page.items.length;

  for (const raw of page.items) {
    const project = raw as unknown as { $id: string; user_id?: string; team_id?: string | null };
    let owned = false;
    if (project.user_id) { await grantAdmin(project.$id, 'user', project.user_id, tally); owned = true; }
    if (project.team_id) { await grantAdmin(project.$id, 'team', project.team_id, tally); owned = true; }
    if (!owned) tally.unowned.push(project.$id);
  }
  return tally;
}
