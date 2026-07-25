jest.mock('../lib/appwrite', () => ({
  databases: { listDocuments: jest.fn(), createDocument: jest.fn(), updateDocument: jest.fn() },
  DB_ID: 'test-db',
  COLLECTIONS: { REPOSITORIES: 'repositories', SCANS: 'scans' },
  ID: { unique: () => 'scan-1' },
  Query: { equal: (f: string, v: unknown) => ({ equal: [f, v] }), limit: (n: number) => ({ limit: n }) },
}));
jest.mock('./scanService', () => ({ ingestVulnerabilitiesDelta: jest.fn().mockResolvedValue({ uniqueIncoming: [] }) }));
jest.mock('./securityRequirementsService', () => ({ securityRequirementsService: { fanOutCorrelation: jest.fn().mockResolvedValue([]) } }));
jest.mock('./logger', () => ({ logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn() } }));

import { databases } from '../lib/appwrite';
import { ingestVulnerabilitiesDelta } from './scanService';
import { securityRequirementsService } from './securityRequirementsService';
import { ingestSarif } from './sarifIngestService';

const mockList = databases.listDocuments as jest.Mock;
const mockCreate = databases.createDocument as jest.Mock;
const mockDelta = ingestVulnerabilitiesDelta as jest.Mock;
const mockFanOut = securityRequirementsService.fanOutCorrelation as jest.Mock;

const sarifLog = {
  version: '2.1.0',
  runs: [{
    tool: { driver: { name: 'CodeQL', rules: [] } },
    results: [{
      ruleId: 'js/sql-injection', level: 'error', message: { text: 'tainted' },
      locations: [{ physicalLocation: { artifactLocation: { uri: 'src/db.js' }, region: { startLine: 3 } } }],
    }],
  }],
};

beforeEach(() => {
  jest.clearAllMocks();
  mockCreate.mockResolvedValue({ $id: 'scan-1' });
});

describe('ingestSarif', () => {
  it('returns repo_not_found when no repo matches the URL', async () => {
    mockList.mockResolvedValue({ documents: [] });
    const res = await ingestSarif({ tenant: 'user-1', repoUrl: 'https://x/y', sarif: sarifLog });
    expect(res).toEqual({ ok: false, reason: 'repo_not_found' });
    expect(mockCreate).not.toHaveBeenCalled();
  });

  it('does not match a repo owned by a different tenant', async () => {
    mockList.mockResolvedValue({ documents: [{ $id: 'r1', url: 'https://x/y', user_id: 'someone-else' }] });
    const res = await ingestSarif({ tenant: 'user-1', repoUrl: 'https://x/y', sarif: sarifLog });
    expect(res).toEqual({ ok: false, reason: 'repo_not_found' });
  });

  it('stores SARIF findings under the resolved repo via the delta path, then fans out to bound projects', async () => {
    mockList.mockResolvedValue({ documents: [{ $id: 'r1', url: 'https://x/y', user_id: 'user-1' }] });
    mockFanOut.mockResolvedValue([{ projectId: 'pA', violated: 1, total: 5 }]);

    const res = await ingestSarif({ tenant: 'user-1', repoUrl: 'https://x/y', sarif: sarifLog });

    expect(res).toEqual({ ok: true, scanId: 'scan-1', findings: 1, affectedProjects: [{ projectId: 'pA', violated: 1, total: 5 }] });
    const [repoId, scanId, issues] = mockDelta.mock.calls[0];
    expect(repoId).toBe('r1');
    expect(scanId).toBe('scan-1');
    expect(issues).toHaveLength(1);
    expect(issues[0]).toMatchObject({ tool: 'codeql', ruleId: 'js/sql-injection' });
    // Fan-out runs against the resolved repo id.
    expect(mockFanOut).toHaveBeenCalledWith('r1');
  });

  it('matches by URL alone for the legacy global key (tenant null)', async () => {
    mockList.mockResolvedValue({ documents: [{ $id: 'r9', url: 'https://x/y', user_id: 'whoever' }] });
    const res = await ingestSarif({ tenant: null, repoUrl: 'https://x/y', sarif: sarifLog });
    expect(res).toMatchObject({ ok: true, scanId: 'scan-1' });
  });
});
