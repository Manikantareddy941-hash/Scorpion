import { isPostgresEnabled } from './pool';

const describeDb = process.env.RUN_DB_IT && process.env.DATABASE_URL ? describe : describe.skip;

describe('isPostgresEnabled', () => {
  it('reflects DATABASE_URL presence', () => {
    expect(isPostgresEnabled()).toBe(Boolean(process.env.DATABASE_URL));
  });
});

describeDb('getPool (integration)', () => {
  it('executes a round-trip query', async () => {
    const { getPool, closePool } = await import('./pool');
    const result = await getPool().query('SELECT 1 AS one');
    expect(result.rows[0].one).toBe(1);
    await closePool();
  });
});
