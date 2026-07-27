import { getPool } from '../../db/pool';
import { canonicalizeRepoUrl } from '../../utils/repoUrl';
import { DocRow, newId, toDoc } from './docTable';

/** Upper bound on the canonical fallback scan; a tenant's repo list is small. */
const TENANT_SCAN_LIMIT = 500;

// The dynamic ownership field arrives from route code (e.g. 'user_id'). It is
// used as a JSONB key parameter, never interpolated into SQL — safe by
// parameterization, but restrict to known fields anyway (defense in depth).
//
// 'team_id' belongs here: tenancyService resolves ownership to exactly
// `user_id | team_id` and stamps both onto the repo document, and
// repoService.syncRepo passes 'team_id' whenever a team is active. Its absence
// made every team-scoped repo sync throw on the Postgres path.
//
// 'org_id' is retained but appears nowhere else in the backend — no migration
// declares it, nothing writes it, nothing queries it. Kept rather than removed
// pending confirmation that it is genuinely dead.
const OWNERSHIP_FIELDS = new Set(['user_id', 'team_id', 'org_id']);

function assertOwnershipField(field: string): void {
  if (!OWNERSHIP_FIELDS.has(field)) {
    throw new Error(`Unsupported ownership field: ${field}`);
  }
}

type ListResult = { total: number; documents: DocRow[] };

/**
 * Postgres implementation of repoRepository (facade-selected). Rows live in
 * document tables (id + data JSONB) so returned shapes match the Appwrite
 * documents existing services destructure. Missing ids REJECT like Appwrite.
 */
export const repoPgRepository = {
  /**
   * Mirrors the Appwrite implementation: exact match first (the common case),
   * then a canonical-identity fallback scoped to the same owner.
   *
   * An exact-match miss here doesn't merely fail a lookup — syncRepo then
   * creates a SECOND repo row for what is the same repository, splitting the
   * tenant's findings across two records. The variants are routine:
   * .git suffixes, trailing slashes, casing, SSH remotes.
   */
  async findByOwnershipAndUrl(field: string, value: string, url: string): Promise<ListResult> {
    assertOwnershipField(field);
    const result = await getPool().query(
      `SELECT id, data, created_at FROM app_repositories WHERE data->>$1 = $2 AND data->>'url' = $3 LIMIT 1`,
      [field, value, url]
    );
    if ((result.rowCount ?? 0) > 0) {
      return { total: result.rowCount ?? 0, documents: result.rows.map(toDoc) };
    }

    const target = canonicalizeRepoUrl(url);
    if (!target) return { total: 0, documents: [] };

    const owned = await getPool().query(
      `SELECT id, data, created_at FROM app_repositories WHERE data->>$1 = $2 LIMIT $3`,
      [field, value, TENANT_SCAN_LIMIT]
    );
    const match = owned.rows
      .map(toDoc)
      .find((d) => canonicalizeRepoUrl(String(d.url ?? '')) === target);

    return match ? { total: 1, documents: [match] } : { total: 0, documents: [] };
  },

  async updateRepo(id: string, fields: Record<string, unknown>): Promise<DocRow> {
    const result = await getPool().query(
      `UPDATE app_repositories SET data = data || $2::jsonb WHERE id = $1 RETURNING id, data, created_at`,
      [id, JSON.stringify(fields)]
    );
    if (result.rowCount === 0) throw new Error('document not found');
    return toDoc(result.rows[0]);
  },

  async createRepo(data: Record<string, unknown>): Promise<DocRow> {
    const id = newId();
    const result = await getPool().query(
      `INSERT INTO app_repositories (id, data) VALUES ($1, $2::jsonb) RETURNING id, data, created_at`,
      [id, JSON.stringify(data)]
    );
    return toDoc(result.rows[0]);
  },

  async getRepo(id: string): Promise<DocRow> {
    const result = await getPool().query(`SELECT id, data, created_at FROM app_repositories WHERE id = $1`, [id]);
    if (result.rowCount === 0) throw new Error('document not found');
    return toDoc(result.rows[0]);
  },

  async deleteRepo(id: string): Promise<void> {
    await getPool().query(`DELETE FROM app_repositories WHERE id = $1`, [id]);
  },

  async listByScope(field: string, value: string): Promise<ListResult> {
    assertOwnershipField(field);
    const result = await getPool().query(
      `SELECT id, data, created_at FROM app_repositories WHERE data->>$1 = $2 ORDER BY data->>'updated_at' DESC NULLS LAST`,
      [field, value]
    );
    return { total: result.rowCount ?? 0, documents: result.rows.map(toDoc) };
  },

  async findActiveScan(repoId: string): Promise<ListResult> {
    const result = await getPool().query(
      `SELECT id, data, created_at FROM app_scans WHERE data->>'repo_id' = $1 AND data->>'status' IN ('pending','running') LIMIT 1`,
      [repoId]
    );
    return { total: result.rowCount ?? 0, documents: result.rows.map(toDoc) };
  },

  async createScan(data: Record<string, unknown>): Promise<DocRow> {
    const id = newId();
    const result = await getPool().query(
      `INSERT INTO app_scans (id, data) VALUES ($1, $2::jsonb) RETURNING id, data, created_at`,
      [id, JSON.stringify(data)]
    );
    return toDoc(result.rows[0]);
  },

  async getScan(scanId: string): Promise<DocRow> {
    const result = await getPool().query(`SELECT id, data, created_at FROM app_scans WHERE id = $1`, [scanId]);
    if (result.rowCount === 0) throw new Error('document not found');
    return toDoc(result.rows[0]);
  },

  async listScans(repoIds: string[], status: string | undefined, limit: number): Promise<ListResult> {
    // An empty repoIds means the caller can reach no repositories. `= ANY('{}')`
    // already yields nothing, but returning early keeps that explicit — a bug
    // that widened this to "all scans" would be a cross-tenant leak.
    if (repoIds.length === 0) return { total: 0, documents: [] };
    const result = await getPool().query(
      `SELECT id, data, created_at FROM app_scans
        WHERE data->>'repo_id' = ANY($1)
          AND ($2::text IS NULL OR data->>'status' = $2)
        ORDER BY created_at DESC
        LIMIT $3`,
      [repoIds, status ?? null, limit]
    );
    return { total: result.rowCount ?? 0, documents: result.rows.map(toDoc) };
  },
};
