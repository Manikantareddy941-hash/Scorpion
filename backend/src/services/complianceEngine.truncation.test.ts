// Compliance controls are evaluated with predicates like
//   scans.every(s => (s.criticalCount ?? 0) === 0)
// over whatever the read returned. The reads were capped — repositories with no
// limit at all (Appwrite defaults to 25) and scans at 50 — so a control could
// report PASSING because the violating scan was never fetched. A SOC 2 / ISO /
// HIPAA / GDPR verdict computed on truncated evidence is the same defect as the
// gate passing on an unreadable findings store (#162).
jest.mock('../lib/appwrite', () => ({
  databases: { listDocuments: jest.fn(), createDocument: jest.fn(), updateDocument: jest.fn() },
  DB_ID: 'db',
  ID: { unique: () => 'new-id' },
  COLLECTIONS: {
    REPOSITORIES: 'repositories', SCANS: 'scans',
    INCIDENTS: 'incidents', COMPLIANCE_CONTROLS: 'compliance_controls',
  },
  Query: {
    equal: (f: string, v: unknown) => ({ equal: [f, v] }),
    or: (q: unknown[]) => ({ or: q }),
    orderDesc: (f: string) => ({ orderDesc: f }),
    limit: (n: number) => ({ limit: n }),
    offset: (n: number) => ({ offset: n }),
  },
}));
jest.mock('./logger', () => ({ logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn() } }));

import { evaluateCompliance } from './complianceEngine';
import { databases } from '../lib/appwrite';

const listDocuments = databases.listDocuments as jest.Mock;

const docs = (n: number, make: (i: number) => Record<string, unknown>) =>
  Array.from({ length: n }, (_, i) => ({ $id: `d${i}`, ...make(i) }));

/**
 * Answers by collection, paging scans so the helper must fetch every page to
 * reach the violating record.
 */
function wire({ repoCount, scans }: { repoCount: number; scans: Record<string, unknown>[] }) {
  listDocuments.mockImplementation(async (_db: string, collection: string, queries: Record<string, number>[]) => {
    const offset = queries.find((q) => 'offset' in q)?.offset ?? 0;
    const limit = queries.find((q) => 'limit' in q)?.limit ?? 25;

    if (collection === 'repositories') {
      const all = docs(repoCount, () => ({}));
      return { total: all.length, documents: all.slice(offset, offset + limit) };
    }
    if (collection === 'scans') {
      return { total: scans.length, documents: scans.slice(offset, offset + limit) };
    }
    if (collection === 'incidents') return { total: 0, documents: [] };
    return { total: 0, documents: [] };
  });
}

beforeEach(() => {
  listDocuments.mockReset();
  (databases.createDocument as jest.Mock).mockReset().mockResolvedValue({ $id: 'c1' });
  (databases.updateDocument as jest.Mock).mockReset().mockResolvedValue({ $id: 'c1' });
});

test('a critical finding beyond the old 50-scan cap still fails the control', async () => {
  // 80 clean scans then one with a critical: under the old Query.limit(50) this
  // scan was never read and every() returned true — reported as compliant.
  const scans = [
    ...docs(80, () => ({ criticalCount: 0 })),
    { $id: 'late-bad', criticalCount: 3 },
  ];
  wire({ repoCount: 3, scans });

  const results = await evaluateCompliance('u1');

  const noCriticals = results.find((r) => r.title.includes('no unresolved critical'));
  expect(noCriticals).toBeDefined();
  expect(noCriticals!.passing).toBe(false);
});

test('the same control passes when every scan really is clean', async () => {
  wire({ repoCount: 3, scans: docs(80, () => ({ criticalCount: 0 })) });

  const results = await evaluateCompliance('u1');

  const noCriticals = results.find((r) => r.title.includes('no unresolved critical'));
  expect(noCriticals!.passing).toBe(true);
});

test('every repository reaches the compliance scope, not just the first 25', async () => {
  // The repositories read had no limit at all, so Appwrite's default of 25
  // applied and a user with more repos had the remainder excluded from the
  // compliance scope entirely. Assert the scope itself rather than the number
  // of round trips — the page size is an implementation detail.
  wire({ repoCount: 30, scans: [{ $id: 's0', criticalCount: 0 }] });

  await evaluateCompliance('u1');

  const scanCall = listDocuments.mock.calls.find((c) => c[1] === 'scans');
  const repoFilter = (scanCall![2] as { equal?: [string, string[]] }[])
    .find((q) => q.equal?.[0] === 'repo_id');
  expect(repoFilter!.equal![1]).toHaveLength(30);
});

test('scan evidence stays scoped to the caller repos on every page', async () => {
  wire({ repoCount: 2, scans: docs(150, () => ({ criticalCount: 0 })) });

  await evaluateCompliance('u1');

  // Dropping the repo filter after page one would pull another tenant's scans
  // into this tenant's compliance verdict.
  const scanCalls = listDocuments.mock.calls.filter((c) => c[1] === 'scans');
  expect(scanCalls.length).toBeGreaterThan(1);
  for (const call of scanCalls) {
    expect(JSON.stringify(call[2])).toContain('repo_id');
  }
});
