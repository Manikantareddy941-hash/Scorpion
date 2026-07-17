import request from 'supertest';
import express from 'express';

// Force the mock-DB fallback path: every Appwrite call rejects, so planRoutes
// uses its local JSON store (which we back with an in-memory fs mock below).
jest.mock('../lib/appwrite', () => {
  const reject = () => Promise.reject(new Error('no appwrite in test'));
  return {
    databases: {
      listDocuments: jest.fn(reject),
      getDocument: jest.fn(reject),
      createDocument: jest.fn(reject),
      updateDocument: jest.fn(reject),
      deleteDocument: jest.fn(reject),
    },
    DB_ID: 'test-db',
    COLLECTIONS: { REPOSITORIES: 'repositories', FINDINGS: 'findings' },
    Query: { equal: (f: string, v: unknown) => ({ f, v }), orderDesc: () => ({}), orderAsc: () => ({}), limit: () => ({}) },
    ID: { unique: () => 'aw-' + Math.random().toString(36).slice(2, 10) },
  };
});

const slackSpy = jest.fn();
jest.mock('../services/notificationService', () => ({
  sendSecurityAlert: (...args: any[]) => slackSpy(...args),
}));

// In-memory fs/promises so the plan mock-DB reads/writes don't touch disk and
// reset cleanly between tests.
let fileStore: Record<string, string> = {};
jest.mock('fs/promises', () => ({
  mkdir: jest.fn(async () => undefined),
  readFile: jest.fn(async (p: string) => {
    if (fileStore[p] === undefined) { const e: any = new Error('ENOENT'); e.code = 'ENOENT'; throw e; }
    return fileStore[p];
  }),
  writeFile: jest.fn(async (p: string, data: string) => { fileStore[p] = data; }),
}));

import planRoutes from './planRoutes';

const USER = { $id: 'user-1', email: 'owner@scorpion.local' };

const buildApp = () => {
  const app = express();
  app.use(express.json());
  app.use((req: any, _res, next) => { req.user = USER; next(); });
  app.use('/api/plan', planRoutes);
  return app;
};

const createProject = async (app: express.Express) => {
  const res = await request(app).post('/api/plan/projects').send({ name: 'Test Project', type: 'scrum' });
  return res.body.$id as string;
};

beforeEach(() => {
  fileStore = {};
  slackSpy.mockClear();
});

describe('PLAN automation engine', () => {
  it('fires a rule and auto-creates a follow-up task when a critical issue is created', async () => {
    const app = buildApp();
    const projectId = await createProject(app);

    await request(app)
      .post(`/api/plan/projects/${projectId}/automation-rules`)
      .send({ trigger: 'critical_vuln', action: 'auto_create_task' })
      .expect(201);

    await request(app)
      .post(`/api/plan/projects/${projectId}/issues`)
      .send({ title: 'SQL injection in login', priority: 'critical', type: 'bug' })
      .expect(201);

    // A run should have been recorded...
    const runs = await request(app).get(`/api/plan/projects/${projectId}/automation-runs`).expect(200);
    expect(runs.body.length).toBe(1);
    expect(runs.body[0]).toMatchObject({ trigger: 'critical_vuln', action: 'auto_create_task', status: 'success' });

    // ...and the follow-up task should now exist alongside the original.
    const issues = await request(app).get(`/api/plan/projects/${projectId}/issues`).expect(200);
    const titles = issues.body.map((i: any) => i.title);
    expect(titles).toContain('SQL injection in login');
    expect(titles.some((t: string) => t.startsWith('Triage:'))).toBe(true);
  });

  it('does NOT fire the critical rule for a non-critical issue', async () => {
    const app = buildApp();
    const projectId = await createProject(app);
    await request(app).post(`/api/plan/projects/${projectId}/automation-rules`).send({ trigger: 'critical_vuln', action: 'slack_notify' });

    await request(app).post(`/api/plan/projects/${projectId}/issues`).send({ title: 'Minor typo', priority: 'low' }).expect(201);

    const runs = await request(app).get(`/api/plan/projects/${projectId}/automation-runs`).expect(200);
    expect(runs.body.length).toBe(0);
    expect(slackSpy).not.toHaveBeenCalled();
  });

  it('fires slack_notify on issue resolution (transition to done)', async () => {
    const app = buildApp();
    const projectId = await createProject(app);
    await request(app).post(`/api/plan/projects/${projectId}/automation-rules`).send({ trigger: 'vuln_resolved', action: 'slack_notify' });

    const issue = await request(app).post(`/api/plan/projects/${projectId}/issues`).send({ title: 'Patch dep', priority: 'high', status: 'inprogress' });
    await request(app).patch(`/api/plan/issues/${issue.body.$id}`).send({ status: 'done' }).expect(200);

    expect(slackSpy).toHaveBeenCalledTimes(1);
    const runs = await request(app).get(`/api/plan/projects/${projectId}/automation-runs`).expect(200);
    expect(runs.body[0]).toMatchObject({ trigger: 'vuln_resolved', action: 'slack_notify', status: 'success' });
  });

  it('rejects automation routes for a project the user does not own', async () => {
    const app = buildApp();
    await request(app).get('/api/plan/projects/proj-1/automation-runs').expect(403);
  });
});

describe('PLAN time tracking', () => {
  it('logs work and increments the issue timeLogged total', async () => {
    const app = buildApp();
    const projectId = await createProject(app);
    const issue = await request(app).post(`/api/plan/projects/${projectId}/issues`).send({ title: 'Build feature', timeEstimate: 8 });

    await request(app).post(`/api/plan/issues/${issue.body.$id}/worklogs`).send({ minutes: 90, comment: 'initial work' }).expect(201);
    await request(app).post(`/api/plan/issues/${issue.body.$id}/worklogs`).send({ minutes: 30 }).expect(201);

    const logs = await request(app).get(`/api/plan/issues/${issue.body.$id}/worklogs`).expect(200);
    expect(logs.body.length).toBe(2);

    const issues = await request(app).get(`/api/plan/projects/${projectId}/issues`).expect(200);
    const updated = issues.body.find((i: any) => i.$id === issue.body.$id);
    expect(updated.timeLogged).toBeCloseTo(2); // 90 + 30 minutes = 2 hours
  });

  it('rejects non-positive worklog minutes', async () => {
    const app = buildApp();
    const projectId = await createProject(app);
    const issue = await request(app).post(`/api/plan/projects/${projectId}/issues`).send({ title: 'X' });
    await request(app).post(`/api/plan/issues/${issue.body.$id}/worklogs`).send({ minutes: 0 }).expect(400);
  });
});

describe('PLAN sprint snapshots', () => {
  it('writes a velocity snapshot when a sprint is completed', async () => {
    const app = buildApp();
    const projectId = await createProject(app);
    const sprint = await request(app)
      .post(`/api/plan/projects/${projectId}/sprints`)
      .send({ name: 'Sprint A', startDate: '2026-01-01', endDate: '2026-01-14' });
    const sprintId = sprint.body.$id;

    // Two issues in the sprint: one done (3pts), one not (5pts).
    await request(app).post(`/api/plan/projects/${projectId}/issues`).send({ title: 'Done item', storyPoints: 3, status: 'done', sprintId });
    await request(app).post(`/api/plan/projects/${projectId}/issues`).send({ title: 'Open item', storyPoints: 5, status: 'todo', sprintId });

    await request(app).patch(`/api/plan/sprints/${sprintId}`).send({ status: 'completed' }).expect(200);

    const snaps = await request(app).get(`/api/plan/projects/${projectId}/sprint-snapshots`).expect(200);
    expect(snaps.body.length).toBe(1);
    expect(snaps.body[0]).toMatchObject({ committedPoints: 8, completedPoints: 3, sprintName: 'Sprint A' });

    // The unfinished issue should have rolled back to the backlog (sprintId cleared).
    const issues = await request(app).get(`/api/plan/projects/${projectId}/issues`).expect(200);
    const open = issues.body.find((i: any) => i.title === 'Open item');
    expect(open.sprintId == null).toBe(true);
  });
});
