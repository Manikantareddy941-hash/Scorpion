jest.mock('../lib/appwrite', () => ({
  databases: {
    listDocuments: jest.fn(),
    getDocument: jest.fn(),
    createDocument: jest.fn(),
    updateDocument: jest.fn(),
    deleteDocument: jest.fn(),
  },
  DB_ID: 'db',
  COLLECTIONS: { CHAT_SESSIONS: 'chat_sessions' },
  Query: { equal: (f: string, v: unknown) => `equal(${f},${v})`, orderDesc: (f: string) => `orderDesc(${f})`, limit: (n: number) => `limit(${n})` },
  ID: { unique: () => 'generated-id' },
}));

import express from 'express';
import request from 'supertest';
import router from './chatRoutes';
import { databases } from '../lib/appwrite';

const app = express();
app.use(express.json({ limit: '5mb' }));
app.use((req: express.Request & { user?: { $id: string } }, _res, next) => {
  req.user = { $id: 'u1' };
  next();
});
app.use('/api/chat', router);

const listDocuments = databases.listDocuments as jest.Mock;
const getDocument = databases.getDocument as jest.Mock;
const createDocument = databases.createDocument as jest.Mock;
const updateDocument = databases.updateDocument as jest.Mock;
const deleteDocument = databases.deleteDocument as jest.Mock;

beforeEach(() => {
  listDocuments.mockReset().mockResolvedValue({ total: 0, documents: [] });
  getDocument.mockReset();
  createDocument.mockReset().mockResolvedValue({ $id: 's1' });
  updateDocument.mockReset().mockResolvedValue({ $id: 's1' });
  deleteDocument.mockReset().mockResolvedValue(undefined);
});

test('GET /sessions filters to the calling user', async () => {
  await request(app).get('/api/chat/sessions');

  expect(listDocuments.mock.calls[0][2]).toContain('equal(userId,u1)');
});

test('POST /sessions stamps userId from the session and ignores the body', async () => {
  const res = await request(app)
    .post('/api/chat/sessions')
    .send({ title: 'Chat', messages: '[]', userId: 'someone-else' });

  expect(res.status).toBe(201);
  expect(createDocument.mock.calls[0][3].userId).toBe('u1');
});

test('POST /sessions rejects a non-string messages payload', async () => {
  const res = await request(app)
    .post('/api/chat/sessions')
    .send({ title: 'Chat', messages: [{ role: 'user' }] });

  expect(res.status).toBe(400);
  expect(createDocument).not.toHaveBeenCalled();
});

test('POST /sessions rejects an oversized transcript', async () => {
  // Transcripts are conversational, not archival. Without a bound, one session
  // document grows until the write fails somewhere less predictable.
  const res = await request(app)
    .post('/api/chat/sessions')
    .send({ title: 'Chat', messages: 'x'.repeat(300 * 1024) });

  expect(res.status).toBe(413);
  expect(createDocument).not.toHaveBeenCalled();
});

test('PATCH /sessions/:id 404s, not 403s, on another user\'s session', async () => {
  getDocument.mockResolvedValue({ $id: 's1', userId: 'someone-else' });

  const res = await request(app).patch('/api/chat/sessions/s1').send({ messages: '[]' });

  expect(res.status).toBe(404);
  expect(updateDocument).not.toHaveBeenCalled();
});

test('DELETE /sessions/:id 404s on another user\'s session', async () => {
  getDocument.mockResolvedValue({ $id: 's1', userId: 'someone-else' });

  const res = await request(app).delete('/api/chat/sessions/s1');

  expect(res.status).toBe(404);
  expect(deleteDocument).not.toHaveBeenCalled();
});

test('DELETE /sessions/:id removes a session the caller owns', async () => {
  getDocument.mockResolvedValue({ $id: 's1', userId: 'u1' });

  const res = await request(app).delete('/api/chat/sessions/s1');

  expect(res.status).toBe(200);
  expect(deleteDocument).toHaveBeenCalledWith('db', 'chat_sessions', 's1');
});
