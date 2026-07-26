jest.mock('../lib/appwrite', () => ({
  databases: { createDocument: jest.fn(), listDocuments: jest.fn(), updateDocument: jest.fn() },
  DB_ID: 'db',
  COLLECTIONS: { NOTIFICATIONS: 'notifications', NOTIFICATION_PREFERENCES: 'notification_preferences' },
  Query: { equal: (f: string, v: unknown) => `equal(${f},${v})`, orderDesc: (f: string) => `orderDesc(${f})`, limit: (n: number) => `limit(${n})` },
}));

import express from 'express';
import request from 'supertest';
import router from './notificationRoutes';
import { databases } from '../lib/appwrite';

const app = express();
app.use(express.json());
app.use((req: express.Request & { user?: { $id: string } }, _res, next) => {
  req.user = { $id: 'u1' };
  next();
});
app.use('/api/notifications', router);

const createDocument = databases.createDocument as jest.Mock;

beforeEach(() => createDocument.mockReset().mockResolvedValue({ $id: 'n1' }));

describe('POST /api/notifications', () => {
  it('stamps userId from the session and ignores the body', async () => {
    // The browser used to create these documents itself, choosing the userId —
    // so a caller could post into someone else's notification tray.
    const res = await request(app)
      .post('/api/notifications')
      .send({ title: 'Scan Completed', userId: 'someone-else' });

    expect(res.status).toBe(201);
    expect(createDocument.mock.calls[0][3].user_id).toBe('u1');
  });

  it('requires a title', async () => {
    const res = await request(app).post('/api/notifications').send({ message: 'no title' });

    expect(res.status).toBe(400);
    expect(createDocument).not.toHaveBeenCalled();
  });

  it('rejects a severity outside the allowlist', async () => {
    const res = await request(app)
      .post('/api/notifications')
      .send({ title: 'Scan Completed', severity: 'URGENT' });

    expect(res.status).toBe(400);
    expect(createDocument).not.toHaveBeenCalled();
  });

  it('defaults severity and marks the notification unread', async () => {
    await request(app).post('/api/notifications').send({ title: 'Scan Completed' });

    const payload = createDocument.mock.calls[0][3];
    expect(payload.severity).toBe('info');
    expect(payload.isRead).toBe(false);
  });
});
