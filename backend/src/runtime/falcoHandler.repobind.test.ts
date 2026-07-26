jest.mock('../lib/appwrite', () => ({
  databases: {
    listDocuments: jest.fn().mockResolvedValue({ total: 0, documents: [] }),
    createDocument: jest.fn().mockResolvedValue({ $id: 'inc-doc-1' }),
    getDocument: jest.fn(),
  },
  DB_ID: 'test-db',
  COLLECTIONS: { SCANS: 'scans', REPOSITORIES: 'repositories', INCIDENTS: 'incidents', INTEGRATIONS: 'integrations', BUILD_PIPELINES: 'build_pipelines' },
  ID: { unique: () => 'new-id' },
  Query: { equal: jest.fn(), orderDesc: jest.fn(), limit: jest.fn() },
}));
jest.mock('../services/logEvents', () => ({ logRuntimeThreat: jest.fn() }));
jest.mock('../services/metrics', () => ({ runtimeThreats: { inc: jest.fn() } }));
jest.mock('../services/tracing', () => ({ withSpan: (_n: string, _a: unknown, fn: () => unknown) => fn() }));
jest.mock('../services/incidentService', () => ({ createIncident: jest.fn() }));
jest.mock('../services/auditService', () => ({ auditLog: jest.fn().mockResolvedValue(undefined) }));
jest.mock('../services/slackService', () => ({ sendSlackNotification: jest.fn() }));
jest.mock('../services/logger', () => ({ logger: { warn: jest.fn(), info: jest.fn(), error: jest.fn() } }));
jest.mock('../repositories/soarRepository', () => ({
  soarRepository: { listPlaybooks: jest.fn().mockResolvedValue([]), createAction: jest.fn() },
}));
jest.mock('../queues/soarQueue', () => ({ enqueueSoarAction: jest.fn() }));
jest.mock('../repositories/falcoRuleRepository', () => ({
  falcoRuleRepository: { listRules: jest.fn().mockResolvedValue([]) },
}));

import { handleFalcoEvent } from './falcoHandler';
import { databases } from '../lib/appwrite';

const db = databases as jest.Mocked<typeof databases>;

// Scan lookup (name route) returns a doc bound to r-name; build lookup (digest
// route) returns a doc bound to r-digest. Per-test we decide which fire.
const withScanAndBuild = (scanDocs: unknown[], buildDocs: unknown[]) => {
  (db.listDocuments as jest.Mock).mockImplementation(async (_db: string, col: string) => {
    if (col === 'scans') return { total: scanDocs.length, documents: scanDocs };
    if (col === 'build_pipelines') return { total: buildDocs.length, documents: buildDocs };
    return { total: 0, documents: [] };
  });
};

const baseEvent = {
  rule: 'Terminal shell in container',
  priority: 'Warning',
  output: 'shell spawned',
  time: '2026-07-26T00:00:00.000Z',
};

const createArg = () => (db.createDocument as jest.Mock).mock.calls[0][3];

beforeEach(() => jest.clearAllMocks());

describe('falcoHandler repo_id stamping (Monitor->Plan feedback identity)', () => {
  it('stamps repo_id from the image-name route when no digest is present', async () => {
    withScanAndBuild([{ $id: 's1', repo_id: 'r-name', user_id: 'u1' }], []);

    await handleFalcoEvent({ ...baseEvent, output_fields: { 'container.image.repository': 'reg/app' } });

    expect(createArg()).toMatchObject({ repo_id: 'r-name' });
  });

  it('prefers the digest route (build pipeline) over the image-name match', async () => {
    withScanAndBuild([{ $id: 's1', repo_id: 'r-name', user_id: 'u1' }], [{ $id: 'b1', repoId: 'r-digest' }]);

    await handleFalcoEvent({
      ...baseEvent,
      output_fields: { 'container.image.repository': 'reg/app', 'container.image.digest': 'sha256:abc' },
    });

    expect(createArg()).toMatchObject({ repo_id: 'r-digest' });
  });

  it('falls back to the name-route repo_id when the digest lookup fails', async () => {
    (db.listDocuments as jest.Mock).mockImplementation(async (_db: string, col: string) => {
      if (col === 'scans') return { total: 1, documents: [{ $id: 's1', repo_id: 'r-name', user_id: 'u1' }] };
      throw new Error('redis/appwrite down');
    });

    await handleFalcoEvent({
      ...baseEvent,
      output_fields: { 'container.image.repository': 'reg/app', 'container.image.digest': 'sha256:abc' },
    });

    expect(createArg()).toMatchObject({ repo_id: 'r-name' });
  });

  it('omits repo_id (still creates the incident) when nothing resolves', async () => {
    withScanAndBuild([], []);

    await handleFalcoEvent({ ...baseEvent, output_fields: { 'container.image.repository': 'reg/app' } });

    expect(db.createDocument).toHaveBeenCalled();
    expect(createArg()).not.toHaveProperty('repo_id');
  });
});
