jest.mock('../db/pool', () => ({
  isPostgresEnabled: () => false,
  getPool: jest.fn(),
  closePool: jest.fn(),
}));
jest.mock('../lib/appwrite', () => ({
  databases: {
    listDocuments: jest.fn(),
    getDocument: jest.fn(),
    createDocument: jest.fn(),
    updateDocument: jest.fn(),
  },
  DB_ID: 'db',
  COLLECTIONS: { INTEGRATIONS: 'integrations', FINDINGS: 'vulnerabilities', REPOSITORIES: 'repositories', SCANS: 'scans' },
  ID: { unique: () => 'new-id' },
  Query: {
    equal: (field: string, value: unknown) => ({ equal: [field, value] }),
    limit: (n: number) => ({ limit: n }),
  },
}));
jest.mock('../utils/ssrfGuard', () => ({ assertSafeWebhookUrl: jest.fn().mockResolvedValue(undefined) }));
jest.mock('../services/alertService', () => ({ AlertService: { sendSlackAlert: jest.fn(), sendDiscordAlert: jest.fn() } }));
jest.mock('../services/tenancyService', () => ({ canAccessResource: jest.fn().mockResolvedValue(true) }));

import express, { Request } from 'express';
import request from 'supertest';
import router from './alerts';
import { databases } from '../lib/appwrite';
import { assertSafeWebhookUrl } from '../utils/ssrfGuard';

type MockAuthRequest = Request & { user?: { $id: string } };

const listDocuments = databases.listDocuments as jest.Mock;
const createDocument = databases.createDocument as jest.Mock;
const updateDocument = databases.updateDocument as jest.Mock;

const buildApp = (userId: string | null = 'user-1') => {
  const app = express();
  app.use(express.json());
  app.use((req: MockAuthRequest, _res, next) => {
    if (userId) req.user = { $id: userId } as never;
    next();
  });
  app.use('/api/alerts', router);
  return app;
};

beforeEach(() => {
  jest.clearAllMocks();
  (assertSafeWebhookUrl as jest.Mock).mockResolvedValue(undefined);
  createDocument.mockResolvedValue({ $id: 'new-id' });
  updateDocument.mockResolvedValue({ $id: 'existing-id' });
});

describe('GET /api/alerts/integrations', () => {
  it('returns the calling user settings', async () => {
    listDocuments.mockResolvedValue({
      total: 1,
      documents: [{ $id: 'i1', discord_webhook: 'https://discord/x', isEnabled: false }],
    });

    const res = await request(buildApp()).get('/api/alerts/integrations');

    expect(res.statusCode).toBe(200);
    expect(res.body.discord_webhook).toBe('https://discord/x');
    expect(res.body.isEnabled).toBe(false);
    // Scoped by the session user, never by a client-supplied id.
    expect(listDocuments.mock.calls[0][2]).toContainEqual({ equal: ['userId', 'user-1'] });
  });

  it('reports "not configured" rather than erroring when there is no row', async () => {
    listDocuments.mockResolvedValue({ total: 0, documents: [] });

    const res = await request(buildApp()).get('/api/alerts/integrations');

    expect(res.statusCode).toBe(200);
    expect(res.body.configured).toBe(false);
  });

  it('requires authentication', async () => {
    expect((await request(buildApp(null)).get('/api/alerts/integrations')).statusCode).toBe(401);
  });
});

describe('PUT /api/alerts/integrations', () => {
  it('creates a row stamped with the session user', async () => {
    listDocuments.mockResolvedValue({ total: 0, documents: [] });

    const res = await request(buildApp())
      .put('/api/alerts/integrations')
      .send({ discord_webhook: 'https://discord.com/api/webhooks/abc' });

    expect(res.statusCode).toBe(200);
    expect(createDocument.mock.calls[0][3]).toMatchObject({
      userId: 'user-1',
      discord_webhook: 'https://discord.com/api/webhooks/abc',
    });
  });

  it('updates the row it found by owner, ignoring any id the client sends', async () => {
    // The security property: a caller naming someone else's document id must
    // not be able to steer the write onto it.
    listDocuments.mockResolvedValue({ total: 1, documents: [{ $id: 'mine' }] });

    await request(buildApp())
      .put('/api/alerts/integrations')
      .send({ discord_webhook: 'https://discord/x', id: 'someone-elses', userId: 'victim' });

    expect(updateDocument.mock.calls[0][2]).toBe('mine');
    expect(updateDocument.mock.calls[0][3].userId).toBe('user-1');
    expect(createDocument).not.toHaveBeenCalled();
  });

  it('rejects a webhook the SSRF guard refuses, without storing it', async () => {
    // The backend POSTs to these itself later, so an unchecked value is an SSRF
    // primitive that outlives the request that set it.
    listDocuments.mockResolvedValue({ total: 0, documents: [] });
    (assertSafeWebhookUrl as jest.Mock).mockRejectedValueOnce(new Error('blocked host'));

    const res = await request(buildApp())
      .put('/api/alerts/integrations')
      .send({ discord_webhook: 'http://169.254.169.254/latest/meta-data' });

    expect(res.statusCode).toBe(400);
    expect(createDocument).not.toHaveBeenCalled();
    expect(updateDocument).not.toHaveBeenCalled();
  });

  it('does not run the URL guard on empty fields', async () => {
    listDocuments.mockResolvedValue({ total: 0, documents: [] });

    await request(buildApp()).put('/api/alerts/integrations').send({ discord_webhook: '' });

    expect(assertSafeWebhookUrl).not.toHaveBeenCalled();
  });

  it('coerces a non-string credential to empty rather than storing an object', async () => {
    listDocuments.mockResolvedValue({ total: 0, documents: [] });

    await request(buildApp())
      .put('/api/alerts/integrations')
      .send({ pagerduty_key: { nested: 'object' } });

    expect(createDocument.mock.calls[0][3].pagerduty_key).toBe('');
  });

  it('rejects a non-array activeSeverities', async () => {
    listDocuments.mockResolvedValue({ total: 0, documents: [] });

    const res = await request(buildApp())
      .put('/api/alerts/integrations')
      .send({ activeSeverities: 'critical' });

    expect(res.statusCode).toBe(400);
    expect(createDocument).not.toHaveBeenCalled();
  });

  it('requires authentication', async () => {
    const res = await request(buildApp(null)).put('/api/alerts/integrations').send({});
    expect(res.statusCode).toBe(401);
    expect(createDocument).not.toHaveBeenCalled();
  });
});

describe('POST /api/alerts/test', () => {
  it('accepts the `url` field the Alerts page sends', async () => {
    // This handler only read `webhookUrl`, so every click of the Test button
    // 400d. Both spellings work now.
    const res = await request(buildApp())
      .post('/api/alerts/test')
      .send({ url: 'https://discord.com/api/webhooks/abc', type: 'discord' });

    expect(res.statusCode).toBe(200);
  });

  it('still accepts webhookUrl', async () => {
    const res = await request(buildApp())
      .post('/api/alerts/test')
      .send({ webhookUrl: 'https://hooks.slack.com/services/x', type: 'slack' });

    expect(res.statusCode).toBe(200);
  });

  it('400s when neither is given', async () => {
    expect((await request(buildApp()).post('/api/alerts/test').send({ type: 'discord' })).statusCode).toBe(400);
  });
});
