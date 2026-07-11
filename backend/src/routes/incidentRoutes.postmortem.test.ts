jest.mock('../lib/appwrite', () => ({
  databases: { getDocument: jest.fn(), updateDocument: jest.fn(), listDocuments: jest.fn() },
  DB_ID: 'db', COLLECTIONS: { INCIDENTS: 'incidents' },
  Query: { equal: jest.fn(), limit: jest.fn(), orderDesc: jest.fn() },
}));
jest.mock('../services/incidentFeedbackService', () => ({
  convertIncidentToIssue: jest.fn(),
}));
jest.mock('../repositories/soarRepository', () => ({
  soarRepository: { listEvidenceForIncident: jest.fn() },
}));
import express from 'express';
import request from 'supertest';
import { databases } from '../lib/appwrite';
import { convertIncidentToIssue } from '../services/incidentFeedbackService';
import { soarRepository } from '../repositories/soarRepository';
import router from './incidentRoutes';

const app = express();
app.use(express.json());
app.use((req, _res, next) => { (req as express.Request & { user?: { $id: string } }).user = { $id: 'u1' }; next(); });
app.use('/api/incidents', router);

const resolvedIncident = { $id: 'inc1', user_id: 'u1', status: 'resolved', title: 't', severity: 'high' };

beforeEach(() => jest.clearAllMocks());

test('PATCH postmortem writes patch on owned resolved incident', async () => {
  (databases.getDocument as jest.Mock).mockResolvedValue(resolvedIncident);
  const res = await request(app).patch('/api/incidents/inc1/postmortem')
    .send({ rootCause: 'rc', escapedPhase: 'test', lessons: 'l1' });
  expect(res.status).toBe(200);
  expect(databases.updateDocument).toHaveBeenCalledWith('db', 'incidents', 'inc1',
    expect.objectContaining({ rootCause: 'rc', escapedPhase: 'test' }));
});

test('PATCH postmortem 400 on unresolved incident', async () => {
  (databases.getDocument as jest.Mock).mockResolvedValue({ ...resolvedIncident, status: 'open' });
  const res = await request(app).patch('/api/incidents/inc1/postmortem')
    .send({ rootCause: 'rc', escapedPhase: 'test' });
  expect(res.status).toBe(400);
});

test('PATCH postmortem 403 on foreign incident', async () => {
  (databases.getDocument as jest.Mock).mockResolvedValue({ ...resolvedIncident, user_id: 'other' });
  const res = await request(app).patch('/api/incidents/inc1/postmortem')
    .send({ rootCause: 'rc', escapedPhase: 'test' });
  expect(res.status).toBe(403);
});

test('PATCH postmortem 400 on bad phase', async () => {
  (databases.getDocument as jest.Mock).mockResolvedValue(resolvedIncident);
  const res = await request(app).patch('/api/incidents/inc1/postmortem')
    .send({ rootCause: 'rc', escapedPhase: 'qa' });
  expect(res.status).toBe(400);
});

test('POST convert maps service statuses to HTTP', async () => {
  (convertIncidentToIssue as jest.Mock).mockResolvedValue({ ok: true, issueId: 'i1' });
  let res = await request(app).post('/api/incidents/inc1/convert-to-issue').send({ projectId: 'p1' });
  expect(res.status).toBe(200);
  expect(res.body).toEqual({ ok: true, issueId: 'i1' });

  (convertIncidentToIssue as jest.Mock).mockResolvedValue('no_postmortem');
  res = await request(app).post('/api/incidents/inc1/convert-to-issue').send({ projectId: 'p1' });
  expect(res.status).toBe(400);

  (convertIncidentToIssue as jest.Mock).mockResolvedValue('forbidden');
  res = await request(app).post('/api/incidents/inc1/convert-to-issue').send({ projectId: 'p1' });
  expect(res.status).toBe(403);

  res = await request(app).post('/api/incidents/inc1/convert-to-issue').send({});
  expect(res.status).toBe(400); // missing projectId
});

test('GET evidence returns parsed capture_evidence rows for owner', async () => {
  (databases.getDocument as jest.Mock).mockResolvedValue(resolvedIncident);
  (soarRepository.listEvidenceForIncident as jest.Mock).mockResolvedValue([
    { id: 'a1', playbookName: 'pb', createdAt: 'now', result: '{"event":{"rule":"shell"}}' },
    { id: 'a2', playbookName: 'pb', createdAt: 'now', result: 'not-json' },
  ]);
  const res = await request(app).get('/api/incidents/inc1/evidence');
  expect(res.status).toBe(200);
  expect(res.body[0].evidence).toEqual({ event: { rule: 'shell' } });
  expect(res.body[1].evidence).toBe('not-json'); // tolerant parse
});
