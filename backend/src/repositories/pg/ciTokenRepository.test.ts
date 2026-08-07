import { describeDb, truncateAll } from '../../db/testDb';
import { closePool } from '../../db/pool';
import { ciTokenRepository } from './ciTokenRepository';

const ALICE = { user_id: 'user-alice', team_id: null };
const BOB = { user_id: 'user-bob', team_id: null };

describeDb('ciTokenRepository', () => {
  beforeEach(() => truncateAll(['ci_tokens']));
  afterAll(() => closePool());

  it('issues a token that resolves to its owner', async () => {
    const { token } = await ciTokenRepository.create(ALICE, 'ci-runner');
    const identity = await ciTokenRepository.verify(token);
    expect(identity?.user_id).toBe('user-alice');
  });

  it('returns a high-entropy prefixed token', async () => {
    const { token } = await ciTokenRepository.create(ALICE, 'ci-runner');
    expect(token).toMatch(/^scrp_[0-9a-f]{64}$/); // 32 bytes hex
  });

  it('never stores the plaintext token', async () => {
    const { token, summary } = await ciTokenRepository.create(ALICE, 'ci-runner');
    // A leaked database must not yield usable credentials.
    expect(JSON.stringify(summary)).not.toContain(token);
    const listed = await ciTokenRepository.listForOwner('user-alice');
    expect(JSON.stringify(listed)).not.toContain(token);
  });

  it('rejects an unknown token', async () => {
    expect(await ciTokenRepository.verify('scrp_deadbeef')).toBeNull();
  });

  it('rejects an empty token without hitting the database', async () => {
    expect(await ciTokenRepository.verify('')).toBeNull();
  });

  it('rejects a revoked token immediately', async () => {
    const { token, summary } = await ciTokenRepository.create(ALICE, 'ci-runner');
    expect(await ciTokenRepository.revoke(summary.id, 'user-alice')).toBe(true);
    expect(await ciTokenRepository.verify(token)).toBeNull();
  });

  it('does not let one tenant revoke another tenant token', async () => {
    const { token, summary } = await ciTokenRepository.create(ALICE, 'ci-runner');
    expect(await ciTokenRepository.revoke(summary.id, 'user-bob')).toBe(false);
    // Still valid — the revoke attempt must not have taken effect.
    expect(await ciTokenRepository.verify(token)).not.toBeNull();
  });

  it('enforces the requested scope', async () => {
    const { token } = await ciTokenRepository.create(ALICE, 'ingest-only', 'ingest');
    expect(await ciTokenRepository.verify(token, 'ingest')).not.toBeNull();
    // An ingest token must not be usable to read the admission gate.
    expect(await ciTokenRepository.verify(token, 'admission')).toBeNull();
  });

  it('resolves a team token to the team, so teammates share a namespace', async () => {
    const { token } = await ciTokenRepository.create(
      { user_id: 'user-alice', team_id: 'team-acme' },
      'team-runner'
    );
    const identity = await ciTokenRepository.verify(token);
    expect(identity?.team_id).toBe('team-acme');
  });

  it('lists only the calling tenant tokens', async () => {
    await ciTokenRepository.create(ALICE, 'alice-runner');
    await ciTokenRepository.create(BOB, 'bob-runner');
    const aliceTokens = await ciTokenRepository.listForOwner('user-alice');
    expect(aliceTokens).toHaveLength(1);
    expect(aliceTokens[0].name).toBe('alice-runner');
  });

  it('records last use', async () => {
    const { token, summary } = await ciTokenRepository.create(ALICE, 'ci-runner');
    expect(summary.lastUsedAt).toBeNull();
    await ciTokenRepository.verify(token);
    expect((await ciTokenRepository.listForOwner('user-alice'))[0].lastUsedAt).not.toBeNull();
  });
});
