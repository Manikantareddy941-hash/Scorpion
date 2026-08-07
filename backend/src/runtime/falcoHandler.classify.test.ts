jest.mock('../lib/appwrite', () => ({
  databases: {
    listDocuments: jest.fn().mockResolvedValue({ total: 0, documents: [] }),
    createDocument: jest.fn().mockResolvedValue({ $id: 'inc-doc-1' }),
    getDocument: jest.fn(),
  },
  DB_ID: 'test-db',
  COLLECTIONS: { SCANS: 'scans', REPOSITORIES: 'repositories', INCIDENTS: 'incidents', INTEGRATIONS: 'integrations' },
  ID: { unique: () => 'new-id' },
  Query: { equal: jest.fn(), orderDesc: jest.fn(), limit: jest.fn() },
}));
jest.mock('../services/logEvents', () => ({ logRuntimeThreat: jest.fn() }));
jest.mock('../services/metrics', () => ({ runtimeThreats: { inc: jest.fn() } }));
jest.mock('../services/tracing', () => ({ withSpan: (_n: string, _a: unknown, fn: () => unknown) => fn() }));
jest.mock('../services/incidentService', () => ({ createIncident: jest.fn() }));
jest.mock('../services/auditService', () => ({ auditLog: jest.fn().mockResolvedValue(undefined) }));
jest.mock('../services/slackService', () => ({ sendSlackNotification: jest.fn() }));
jest.mock('../services/logger', () => ({
    // Spread rather than replace: this module also exports errorContext,
    // and a factory that returns only `logger` makes it undefined at runtime.
    ...jest.requireActual('../services/logger'),
    logger: { warn: jest.fn(), info: jest.fn(), error: jest.fn() },
}));
jest.mock('../repositories/soarRepository', () => ({
  soarRepository: { listPlaybooks: jest.fn().mockResolvedValue([]), createAction: jest.fn() },
}));
jest.mock('../queues/soarQueue', () => ({ enqueueSoarAction: jest.fn() }));
jest.mock('../repositories/falcoRuleRepository', () => ({
  falcoRuleRepository: { listRules: jest.fn() },
}));

import { handleFalcoEvent } from './falcoHandler';
import { falcoRuleRepository } from '../repositories/falcoRuleRepository';
import { auditLog } from '../services/auditService';
import { databases } from '../lib/appwrite';

const rules = falcoRuleRepository as jest.Mocked<typeof falcoRuleRepository>;
const mockedDb = databases as jest.Mocked<typeof databases>;

const event = {
  rule: 'Terminal shell in container',
  priority: 'Warning',
  output: 'shell spawned',
  time: new Date().toISOString(),
  output_fields: { 'container.id': 'c1', 'container.image.repository': 'reg/app' },
};

beforeEach(() => jest.clearAllMocks());

describe('falcoHandler classification', () => {
  it('drops suppressed events with an audit trail (no incident doc)', async () => {
    rules.listRules.mockResolvedValue([{
      id: 'r-1', template: 'terminal-shell-in-container', params: {},
      suppressed: true, enabled: true,
    }]);
    mockedDb.listDocuments.mockResolvedValue({ total: 0, documents: [] } as never);

    await handleFalcoEvent(event);

    expect(auditLog).toHaveBeenCalledWith(expect.objectContaining({ action: 'falco.event.suppressed' }));
    expect(mockedDb.createDocument).not.toHaveBeenCalled();
  });

  it('applies severity override before incident creation', async () => {
    rules.listRules.mockResolvedValue([{
      id: 'r-1', template: 'terminal-shell-in-container', params: {},
      severityOverride: 'Critical', suppressed: false, enabled: true,
    }]);
    mockedDb.listDocuments.mockResolvedValue({ total: 0, documents: [] } as never);

    await handleFalcoEvent(event);

    expect(mockedDb.createDocument).toHaveBeenCalledWith('test-db', 'incidents', 'new-id',
      expect.objectContaining({ priority: 'Critical' }));
  });

  it('processes events normally when rule load fails', async () => {
    rules.listRules.mockResolvedValue([]);
    mockedDb.listDocuments.mockResolvedValue({ total: 0, documents: [] } as never);
    await handleFalcoEvent(event);
    expect(mockedDb.createDocument).toHaveBeenCalled();
  });

  it('processes events normally when a rule row has an invalid template (classification error swallowed)', async () => {
    rules.listRules.mockResolvedValue([{
      id: 'r-bad', template: 'not-a-real-template' as never, params: {},
      suppressed: true, enabled: true,
    }]);
    mockedDb.listDocuments.mockResolvedValue({ total: 0, documents: [] } as never);

    await expect(handleFalcoEvent(event)).resolves.toBeUndefined();

    // Fail-secure: broken rule config never suppresses — incident still created, priority untouched.
    expect(mockedDb.createDocument).toHaveBeenCalledWith('test-db', 'incidents', 'new-id',
      expect.objectContaining({ priority: 'Warning' }));
  });
});
