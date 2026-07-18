jest.mock('../lib/appwrite', () => ({
  databases: { createDocument: jest.fn(), updateDocument: jest.fn(), getDocument: jest.fn() },
  DB_ID: 'db',
  COLLECTIONS: { TASKS: 'tasks' },
}));

import express from 'express';
import request from 'supertest';
import router from './taskRoutes';
import { databases } from '../lib/appwrite';

const app = express();
app.use(express.json());
app.use((req: express.Request & { user?: { $id: string } }, _res, next) => {
  req.user = { $id: 'u1' };
  next();
});
app.use('/api/tasks', router);

const createDocument = databases.createDocument as jest.Mock;
const updateDocument = databases.updateDocument as jest.Mock;
const getDocument = databases.getDocument as jest.Mock;

beforeEach(() => {
  createDocument.mockReset().mockResolvedValue({ $id: 't1' });
  updateDocument.mockReset().mockResolvedValue({ $id: 't1' });
  getDocument.mockReset();
});

describe('POST /api/tasks', () => {
  it('stamps user_id from the session and ignores the body', async () => {
    // The browser used to supply user_id, which is the field that decides
    // whose task list a row lands in.
    const res = await request(app)
      .post('/api/tasks')
      .send({ title: 'Patch lodash', user_id: 'someone-else' });

    expect(res.status).toBe(201);
    expect(createDocument.mock.calls[0][3].user_id).toBe('u1');
  });

  it('rejects a status outside the allowlist', async () => {
    const res = await request(app)
      .post('/api/tasks')
      .send({ title: 'Patch lodash', status: 'Done' });

    expect(res.status).toBe(400);
    expect(createDocument).not.toHaveBeenCalled();
  });

  it('rejects an empty title', async () => {
    const res = await request(app).post('/api/tasks').send({ title: '   ' });

    expect(res.status).toBe(400);
    expect(createDocument).not.toHaveBeenCalled();
  });

  it('rejects an unparseable due_date rather than storing it', async () => {
    const res = await request(app)
      .post('/api/tasks')
      .send({ title: 'Patch lodash', due_date: 'next tuesday' });

    expect(res.status).toBe(400);
    expect(createDocument).not.toHaveBeenCalled();
  });

  it('defaults status and priority when omitted', async () => {
    await request(app).post('/api/tasks').send({ title: 'Patch lodash' });

    const payload = createDocument.mock.calls[0][3];
    expect(payload.status).toBe('todo');
    expect(payload.priority).toBe('medium');
  });

  it('accepts a null due_date', async () => {
    await request(app).post('/api/tasks').send({ title: 'Patch lodash', due_date: null });

    expect(createDocument.mock.calls[0][3].due_date).toBeNull();
  });
});

describe('PATCH /api/tasks/:id', () => {
  it('updates a task the caller owns', async () => {
    getDocument.mockResolvedValue({ $id: 't1', user_id: 'u1' });

    const res = await request(app).patch('/api/tasks/t1').send({ status: 'completed' });

    expect(res.status).toBe(200);
    expect(updateDocument.mock.calls[0][3]).toEqual({ status: 'completed' });
  });

  it('404s, not 403s, on another user\'s task', async () => {
    getDocument.mockResolvedValue({ $id: 't1', user_id: 'someone-else' });

    const res = await request(app).patch('/api/tasks/t1').send({ status: 'completed' });

    expect(res.status).toBe(404);
    expect(updateDocument).not.toHaveBeenCalled();
  });

  it('404s on a missing task', async () => {
    getDocument.mockRejectedValue(new Error('not found'));

    const res = await request(app).patch('/api/tasks/t1').send({ status: 'completed' });

    expect(res.status).toBe(404);
    expect(updateDocument).not.toHaveBeenCalled();
  });

  it('never writes user_id, so a task cannot be moved to another owner', async () => {
    getDocument.mockResolvedValue({ $id: 't1', user_id: 'u1' });

    await request(app).patch('/api/tasks/t1').send({ title: 'Renamed', user_id: 'someone-else' });

    expect(updateDocument.mock.calls[0][3]).not.toHaveProperty('user_id');
  });
});
