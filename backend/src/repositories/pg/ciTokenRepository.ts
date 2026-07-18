import { createHash, randomBytes } from 'crypto';
import { getPool } from '../../db/pool';
import { logger } from '../../services/logger';
import { newId } from './docTable';

/**
 * Per-tenant CI tokens for the ingest and admission endpoints.
 *
 * Only the hash is ever stored, so the plaintext is returned exactly once at
 * creation and is unrecoverable afterwards. A leaked database gives an attacker
 * hashes, not usable tokens.
 */

export type TokenScope = 'ingest' | 'admission';

/** The tenant a token acts as — same shape tenancyService stamps on resources. */
export interface TokenIdentity {
  tokenId: string;
  user_id: string;
  team_id: string | null;
  scope: TokenScope;
}

export interface CiTokenSummary {
  id: string;
  name: string;
  scope: TokenScope;
  createdAt: string;
  lastUsedAt: string | null;
  revokedAt: string | null;
}

const TOKEN_BYTES = 32; // 256 bits of CSPRNG output
const TOKEN_PREFIX = 'scrp_';

/**
 * Tokens are high-entropy random values, so a single SHA-256 is correct here.
 * bcrypt/argon2 exist to slow brute force against low-entropy human passwords;
 * against 256 random bits they buy nothing and add latency to every ingest.
 */
function hashToken(token: string): string {
  return createHash('sha256').update(token, 'utf8').digest('hex');
}

interface TokenRow {
  id: string;
  user_id: string;
  team_id: string | null;
  scope: TokenScope;
  name: string;
  created_at: Date;
  last_used_at: Date | null;
  revoked_at: Date | null;
}

function toSummary(row: TokenRow): CiTokenSummary {
  return {
    id: row.id,
    name: row.name,
    scope: row.scope,
    createdAt: row.created_at.toISOString(),
    lastUsedAt: row.last_used_at ? row.last_used_at.toISOString() : null,
    revokedAt: row.revoked_at ? row.revoked_at.toISOString() : null,
  };
}

export const ciTokenRepository = {
  /** Returns the plaintext token once. It cannot be retrieved again. */
  async create(
    owner: { user_id: string; team_id?: string | null },
    name: string,
    scope: TokenScope = 'ingest'
  ): Promise<{ token: string; summary: CiTokenSummary }> {
    const token = TOKEN_PREFIX + randomBytes(TOKEN_BYTES).toString('hex');
    const id = newId();
    const res = await getPool().query(
      `INSERT INTO ci_tokens (id, token_hash, user_id, team_id, name, scope)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING id, user_id, team_id, scope, name, created_at, last_used_at, revoked_at`,
      [id, hashToken(token), owner.user_id, owner.team_id ?? null, name, scope]
    );
    return { token, summary: toSummary(res.rows[0] as TokenRow) };
  },

  /**
   * Resolves a presented token to its tenant, or null.
   *
   * Lookup is by hash equality, so the database never sees the plaintext and the
   * comparison is not timing-sensitive in the way a string compare would be —
   * an attacker cannot learn a prefix from response time because a wrong hash
   * simply misses the index.
   *
   * Returns null for unknown, revoked, or wrong-scope tokens alike: the caller
   * must not be able to distinguish those cases.
   */
  async verify(token: string, requiredScope?: TokenScope): Promise<TokenIdentity | null> {
    if (!token) return null;
    try {
      // Lookup and last_used_at stamp in one round trip. A fire-and-forget
      // UPDATE would leave a query in flight past shutdown (and past a test's
      // closePool), and awaiting a second query would double latency on an
      // auth path that runs for every ingest.
      const res = await getPool().query(
        `UPDATE ci_tokens SET last_used_at = now()
         WHERE token_hash = $1 AND revoked_at IS NULL
         RETURNING id, user_id, team_id, scope`,
        [hashToken(token)]
      );
      if (res.rows.length === 0) return null;

      const row = res.rows[0] as TokenRow;
      if (requiredScope && row.scope !== requiredScope) return null;

      return { tokenId: row.id, user_id: row.user_id, team_id: row.team_id, scope: row.scope };
    } catch (err) {
      // Fail closed: a storage outage must reject, never admit.
      logger.error('[ciTokenRepository] verify failed — rejecting', err);
      return null;
    }
  },

  async listForOwner(userId: string): Promise<CiTokenSummary[]> {
    const res = await getPool().query(
      `SELECT id, user_id, team_id, scope, name, created_at, last_used_at, revoked_at
       FROM ci_tokens WHERE user_id = $1 ORDER BY created_at DESC LIMIT 100`,
      [userId]
    );
    return (res.rows as TokenRow[]).map(toSummary);
  },

  /** Revocation is immediate and irreversible; the row is kept for audit. */
  async revoke(id: string, userId: string): Promise<boolean> {
    const res = await getPool().query(
      // Ownership is part of the WHERE clause, so a caller cannot revoke
      // another tenant's token by guessing its id.
      `UPDATE ci_tokens SET revoked_at = now()
       WHERE id = $1 AND user_id = $2 AND revoked_at IS NULL`,
      [id, userId]
    );
    return (res.rowCount ?? 0) > 0;
  },
};
