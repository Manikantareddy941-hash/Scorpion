# Incident Response & Feedback Loop Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Post-mortem/RCA on resolved incidents, one-click routing of lessons to a Plan-phase issue, and a viewer for SOAR-captured forensic evidence — closing the DevSecOps figure-8.

**Architecture:** Two pure helpers + one cross-store service (Appwrite incident → Prisma plan issue, mirroring the existing threats bridge) + three owner-scoped routes on the existing `incidentRoutes.ts` + one new React panel (incidents' first UI). No new collections — 4 new attributes on `incidents`.

**Tech Stack:** TypeScript, Express, node-appwrite, Prisma (plan side), Jest + supertest, React.

## Global Constraints

- Backend files < 250 lines; strict typing, **never `any`** (`backend/CLAUDE.md`).
- Every route owner-scoped: incident's `user_id` must equal caller's `$id` before ANY read/write (mirror the existing PATCH `/:id/status` handler's check in `incidentRoutes.ts`). Convert additionally requires `assertProjectAccess` (exported from `planService`).
- `escapedPhase` enum, exact: `plan | code | build | test | release | deploy | operate | monitor`. `rootCause` AND `escapedPhase` mandatory; `lessons` optional.
- Post-mortem only on `status === 'resolved'` incidents (400 otherwise). Convert requires an existing `rootCause` (400 `no_postmortem`) and is idempotent via `actionItemIssueId`.
- Runtime prereq (user creates, tests mock): 4 attributes on the existing `incidents` collection — `rootCause` (string), `escapedPhase` (string), `lessons` (string, 4096), `actionItemIssueId` (string, nullable).
- Verify per task from `backend/`: `npx jest <paths>`, `npx tsc --noEmit` (clean except pre-existing `@prisma/adapter-better-sqlite3` error), `npm run lint`.

---

## File Structure

- Create `backend/src/services/incidentPostmortem.ts` — pure `buildPostmortemPatch`.
- Create `backend/src/services/incidentFeedbackService.ts` — pure `buildIncidentIssueFields` + impure `convertIncidentToIssue` (cross-store bridge).
- Modify `backend/src/services/planService.ts` — export the existing private `severityToPriority`.
- Modify `backend/src/routes/incidentRoutes.ts` — add PATCH `/:id/postmortem`, POST `/:id/convert-to-issue`, GET `/:id/evidence`.
- Modify `backend/src/repositories/soarRepository.ts` — add `listEvidenceForIncident(incidentId)`.
- Create `src/components/IncidentsPanel.tsx`; modify `src/pages/Monitor.tsx` (mount).
- Create `docs/lifecycle/incident-response.md` (as-built doc + runtime prereqs).

---

### Task 1: Pure post-mortem patch builder

**Files:**
- Create: `backend/src/services/incidentPostmortem.ts`
- Test: `backend/src/services/incidentPostmortem.test.ts`

**Interfaces:**
- Produces: `LIFECYCLE_PHASES: readonly string[]`; `PostmortemInput = { rootCause?: unknown; escapedPhase?: unknown; lessons?: unknown }`; `buildPostmortemPatch(input: PostmortemInput): { ok: true; patch: { rootCause: string; escapedPhase: string; lessons: string } } | { ok: false; error: string }`.

- [ ] **Step 1: Write the failing test**

```ts
// backend/src/services/incidentPostmortem.test.ts
import { buildPostmortemPatch, LIFECYCLE_PHASES } from './incidentPostmortem';

test('valid input yields a trimmed patch', () => {
  const out = buildPostmortemPatch({ rootCause: '  SQLi in search  ', escapedPhase: 'test', lessons: 'add DAST auth\nfix param binding' });
  expect(out).toEqual({ ok: true, patch: { rootCause: 'SQLi in search', escapedPhase: 'test', lessons: 'add DAST auth\nfix param binding' } });
});

test('missing rootCause rejected', () => {
  const out = buildPostmortemPatch({ rootCause: '   ', escapedPhase: 'test' });
  expect(out.ok).toBe(false);
});

test('unknown escapedPhase rejected', () => {
  const out = buildPostmortemPatch({ rootCause: 'x', escapedPhase: 'qa' });
  expect(out.ok).toBe(false);
});

test('lessons optional, defaults empty; non-string inputs rejected', () => {
  const ok = buildPostmortemPatch({ rootCause: 'x', escapedPhase: 'build' });
  expect(ok).toEqual({ ok: true, patch: { rootCause: 'x', escapedPhase: 'build', lessons: '' } });
  expect(buildPostmortemPatch({ rootCause: 42, escapedPhase: 'build' }).ok).toBe(false);
});

test('phase enum is the 8 lifecycle stages', () => {
  expect([...LIFECYCLE_PHASES]).toEqual(['plan', 'code', 'build', 'test', 'release', 'deploy', 'operate', 'monitor']);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && npx jest src/services/incidentPostmortem.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write minimal implementation**

```ts
// backend/src/services/incidentPostmortem.ts
export const LIFECYCLE_PHASES = ['plan', 'code', 'build', 'test', 'release', 'deploy', 'operate', 'monitor'] as const;

export interface PostmortemInput { rootCause?: unknown; escapedPhase?: unknown; lessons?: unknown; }
export interface PostmortemPatch { rootCause: string; escapedPhase: string; lessons: string; }

export function buildPostmortemPatch(input: PostmortemInput):
  { ok: true; patch: PostmortemPatch } | { ok: false; error: string } {
  if (typeof input.rootCause !== 'string' || input.rootCause.trim() === '') {
    return { ok: false, error: 'rootCause is required' };
  }
  if (typeof input.escapedPhase !== 'string' || !(LIFECYCLE_PHASES as readonly string[]).includes(input.escapedPhase)) {
    return { ok: false, error: `escapedPhase must be one of: ${LIFECYCLE_PHASES.join(', ')}` };
  }
  if (input.lessons !== undefined && typeof input.lessons !== 'string') {
    return { ok: false, error: 'lessons must be a string' };
  }
  return { ok: true, patch: { rootCause: input.rootCause.trim(), escapedPhase: input.escapedPhase, lessons: (input.lessons ?? '') as string } };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd backend && npx jest src/services/incidentPostmortem.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add backend/src/services/incidentPostmortem.ts backend/src/services/incidentPostmortem.test.ts
git commit -m "feat(ir): pure post-mortem patch builder with lifecycle-phase enum"
```

---

### Task 2: Incident→issue fields + cross-store convert service

**Files:**
- Create: `backend/src/services/incidentFeedbackService.ts`
- Modify: `backend/src/services/planService.ts` (export `severityToPriority` — move the function declaration above the `export function buildThreatIssueFields` if hoisting requires, and add `export` keyword; do not change its logic)
- Test: `backend/src/services/incidentFeedbackService.test.ts`

**Interfaces:**
- Consumes: `Issue` from `../types/plan.types`; `planRepository.createIssue(issue: Issue): Promise<Issue>`; `assertProjectAccess(projectId, userId)` and `severityToPriority(severity: string): Issue['priority']` from `./planService`; `databases, DB_ID, COLLECTIONS` from `../lib/appwrite` (incidents collection = `COLLECTIONS.INCIDENTS`).
- Produces: `buildIncidentIssueFields(incident: IncidentDoc, projectId: string): Issue` (pure); `convertIncidentToIssue(projectId: string, incidentId: string, userId?: string): Promise<'forbidden' | 'not_found' | 'not_resolved' | 'no_postmortem' | { ok: true; issueId: string }>`; `IncidentDoc = { $id: string; title: string; severity: string; user_id?: string; status?: string; rootCause?: string; escapedPhase?: string; lessons?: string; actionItemIssueId?: string }`.

- [ ] **Step 1: Write the failing test**

```ts
// backend/src/services/incidentFeedbackService.test.ts
jest.mock('../lib/appwrite', () => ({
  databases: { getDocument: jest.fn(), updateDocument: jest.fn() },
  DB_ID: 'db', COLLECTIONS: { INCIDENTS: 'incidents' },
}));
jest.mock('../repositories/planRepository', () => ({
  planRepository: { createIssue: jest.fn(), getProjectOwner: jest.fn() },
}));
import { databases } from '../lib/appwrite';
import { planRepository } from '../repositories/planRepository';
import { buildIncidentIssueFields, convertIncidentToIssue, IncidentDoc } from './incidentFeedbackService';

const incident: IncidentDoc = {
  $id: 'inc1', title: 'Account takeover on API', severity: 'critical', user_id: 'u1',
  status: 'resolved', rootCause: 'Missing rate limit', escapedPhase: 'test',
  lessons: 'add rate-limit tests\nenable lockout',
};

test('buildIncidentIssueFields maps postmortem to a security story', () => {
  const issue = buildIncidentIssueFields(incident, 'p1');
  expect(issue.type).toBe('story');
  expect(issue.title).toBe('[Post-mortem] Account takeover on API');
  expect(issue.priority).toBe('critical');
  expect(issue.labels).toEqual(['security', 'incident-response', 'escaped:test']);
  expect(issue.description).toContain('Missing rate limit');
  expect(issue.description).toContain('- [ ] add rate-limit tests');
  expect(issue.description).toContain('- [ ] enable lockout');
});

describe('convertIncidentToIssue', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (planRepository.getProjectOwner as jest.Mock).mockResolvedValue('u1');
    (databases.getDocument as jest.Mock).mockResolvedValue(incident);
    (planRepository.createIssue as jest.Mock).mockImplementation(async (i) => i);
  });

  test('creates issue and writes actionItemIssueId back', async () => {
    const out = await convertIncidentToIssue('p1', 'inc1', 'u1');
    expect(out).toMatchObject({ ok: true });
    expect(planRepository.createIssue).toHaveBeenCalled();
    expect(databases.updateDocument).toHaveBeenCalledWith('db', 'incidents', 'inc1',
      expect.objectContaining({ actionItemIssueId: expect.any(String) }));
  });

  test('idempotent: existing actionItemIssueId returns it without creating', async () => {
    (databases.getDocument as jest.Mock).mockResolvedValue({ ...incident, actionItemIssueId: 'issue-9' });
    const out = await convertIncidentToIssue('p1', 'inc1', 'u1');
    expect(out).toEqual({ ok: true, issueId: 'issue-9' });
    expect(planRepository.createIssue).not.toHaveBeenCalled();
  });

  test('forbidden when caller does not own the plan project', async () => {
    (planRepository.getProjectOwner as jest.Mock).mockResolvedValue('someone-else');
    expect(await convertIncidentToIssue('p1', 'inc1', 'u1')).toBe('forbidden');
  });

  test('forbidden when caller does not own the incident', async () => {
    (databases.getDocument as jest.Mock).mockResolvedValue({ ...incident, user_id: 'other' });
    expect(await convertIncidentToIssue('p1', 'inc1', 'u1')).toBe('forbidden');
  });

  test('not_resolved and no_postmortem guards', async () => {
    (databases.getDocument as jest.Mock).mockResolvedValue({ ...incident, status: 'open' });
    expect(await convertIncidentToIssue('p1', 'inc1', 'u1')).toBe('not_resolved');
    (databases.getDocument as jest.Mock).mockResolvedValue({ ...incident, rootCause: undefined });
    expect(await convertIncidentToIssue('p1', 'inc1', 'u1')).toBe('no_postmortem');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && npx jest src/services/incidentFeedbackService.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write minimal implementation**

First, in `backend/src/services/planService.ts`, add `export` to the existing `function severityToPriority(...)` declaration (function declarations hoist — position is fine as-is).

```ts
// backend/src/services/incidentFeedbackService.ts
import { randomUUID } from 'crypto';
import { databases, DB_ID, COLLECTIONS } from '../lib/appwrite';
import { planRepository } from '../repositories/planRepository';
import { assertProjectAccess, severityToPriority } from './planService';
import { Issue } from '../types/plan.types';
import { logger } from './logger';

export interface IncidentDoc {
  $id: string; title: string; severity: string; user_id?: string; status?: string;
  rootCause?: string; escapedPhase?: string; lessons?: string; actionItemIssueId?: string;
}

function lessonsToChecklist(lessons?: string): string {
  const lines = (lessons || '').split('\n').map((l) => l.trim().replace(/^[-*]\s*/, '')).filter(Boolean);
  if (lines.length === 0) return '- [ ] Define and implement the remediation';
  return lines.map((l) => `- [ ] ${l}`).join('\n');
}

// Pure: resolved incident's post-mortem -> Plan-phase security story.
export function buildIncidentIssueFields(incident: IncidentDoc, projectId: string): Issue {
  return {
    $id: `issue-${randomUUID()}`,
    projectId,
    title: `[Post-mortem] ${incident.title}`,
    type: 'story',
    priority: severityToPriority(incident.severity),
    storyPoints: 3,
    description:
      `**Root cause:** ${incident.rootCause || 'N/A'}\n` +
      `**Escaped at phase:** ${incident.escapedPhase || 'unknown'}\n\n` +
      `**Action items (lessons learned):**\n${lessonsToChecklist(incident.lessons)}`,
    createdAt: new Date().toISOString(),
    status: 'todo',
    timeLogged: 0,
    labels: ['security', 'incident-response', `escaped:${incident.escapedPhase || 'unknown'}`],
  };
}

export async function convertIncidentToIssue(
  projectId: string, incidentId: string, userId?: string,
): Promise<'forbidden' | 'not_found' | 'not_resolved' | 'no_postmortem' | { ok: true; issueId: string }> {
  if (!(await assertProjectAccess(projectId, userId))) return 'forbidden';

  let incident: IncidentDoc;
  try {
    incident = await databases.getDocument(DB_ID, COLLECTIONS.INCIDENTS, incidentId) as unknown as IncidentDoc;
  } catch {
    return 'not_found';
  }
  if (!userId || incident.user_id !== userId) return 'forbidden';
  if (incident.status !== 'resolved') return 'not_resolved';
  if (!incident.rootCause) return 'no_postmortem';
  if (incident.actionItemIssueId) return { ok: true, issueId: incident.actionItemIssueId }; // idempotent

  const issue = await planRepository.createIssue(buildIncidentIssueFields(incident, projectId));
  try {
    await databases.updateDocument(DB_ID, COLLECTIONS.INCIDENTS, incidentId, { actionItemIssueId: issue.$id });
  } catch (err) {
    // Issue exists but the link-back failed: log loudly; a retry will create a
    // duplicate only if this write keeps failing (acceptable at-least-once).
    logger.error('[incidentFeedback] failed to link issue back to incident', err);
  }
  return { ok: true, issueId: issue.$id };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd backend && npx jest src/services/incidentFeedbackService.test.ts`
Expected: PASS (6 tests). Also `npx jest src/services/planService` if planService tests exist — export change must not break them.

- [ ] **Step 5: Commit**

```bash
git add backend/src/services/incidentFeedbackService.ts backend/src/services/incidentFeedbackService.test.ts backend/src/services/planService.ts
git commit -m "feat(ir): incident->plan issue bridge (idempotent, cross-store, mirrors threats)"
```

---

### Task 3: Routes — postmortem PATCH, convert POST, evidence GET

**Files:**
- Modify: `backend/src/routes/incidentRoutes.ts`
- Modify: `backend/src/repositories/soarRepository.ts` (add `listEvidenceForIncident`)
- Test: `backend/src/routes/incidentRoutes.postmortem.test.ts`

**Interfaces:**
- Consumes: `buildPostmortemPatch` (Task 1); `convertIncidentToIssue` (Task 2); `soarRepository` (extended below); `databases, DB_ID, COLLECTIONS, Query` from `../lib/appwrite`; existing `updateIncidentStatus` handler as the ownership-check reference.
- Produces: `PATCH /api/incidents/:id/postmortem` (body `{rootCause, escapedPhase, lessons?}`) → 200 `{ok:true}` | 400 validation/not-resolved | 403 | 404; `POST /api/incidents/:id/convert-to-issue` (body `{projectId}`) → 200 `{ok:true, issueId}` | 400 | 403 | 404; `GET /api/incidents/:id/evidence` → 200 `[{actionId, playbookName, createdAt, evidence}]` | 403 | 404. `soarRepository.listEvidenceForIncident(incidentId: string): Promise<Array<{ id: string; playbookName: string; createdAt: string; result?: string }>>` ([] on error — read-only viewer, fail-quiet).

**IMPORTANT for the implementer:** read `backend/src/routes/incidentRoutes.ts` first and copy its EXISTING auth/ownership convention (it reads `req.user?.$id` and compares to the incident doc's `user_id`; check how it's mounted in `backend/src/index.ts` for middleware). Read `backend/src/repositories/soarRepository.ts` and model `listEvidenceForIncident` on its existing list/query style (collection `soar_actions`, `Query.equal('incidentId', incidentId)`, filter `actionType === 'capture_evidence'`, `Query.limit(25)`).

- [ ] **Step 1: Write the failing test** — mock `../lib/appwrite`, `../services/incidentFeedbackService`, `../repositories/soarRepository`, and the auth convention the file actually uses (check first; if the router relies on `req.user` injected upstream, build the test app with a stub middleware setting `req.user = { $id: 'u1' }`).

```ts
// backend/src/routes/incidentRoutes.postmortem.test.ts
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && npx jest src/routes/incidentRoutes.postmortem.test.ts`
Expected: FAIL — routes not defined (404s).

- [ ] **Step 3: Write minimal implementation**

Add to `backend/src/repositories/soarRepository.ts` (match the file's existing style and `soar_actions` collection constant):

```ts
  /** capture_evidence rows for one incident; [] on error (read-only viewer). */
  async listEvidenceForIncident(incidentId: string): Promise<Array<{ id: string; playbookName: string; createdAt: string; result?: string }>> {
    try {
      const res = await databases.listDocuments(DB_ID, COLLECTION, [
        Query.equal('incidentId', incidentId),
        Query.equal('actionType', 'capture_evidence'),
        Query.limit(25),
      ]);
      return res.documents.map((d) => {
        const w = d as unknown as Record<string, string>;
        return { id: d.$id, playbookName: w.playbookName || '', createdAt: d.$createdAt, result: w.result || undefined };
      });
    } catch (err) {
      logger.error('[soarRepository] listEvidenceForIncident failed', err);
      return [];
    }
  },
```

Add to `backend/src/routes/incidentRoutes.ts` (imports: `buildPostmortemPatch` from `../services/incidentPostmortem`, `convertIncidentToIssue` from `../services/incidentFeedbackService`, `soarRepository` from `../repositories/soarRepository`; reuse the file's existing `databases/DB_ID/COLLECTIONS` imports and `AuthenticatedRequest` type):

```ts
// Blameless post-mortem: only after containment (resolved), only by the owner.
router.patch('/:id/postmortem', async (req: AuthenticatedRequest, res) => {
  try {
    const userId = req.user?.$id;
    let incident: Record<string, unknown>;
    try {
      incident = await databases.getDocument(DB_ID, COLLECTIONS.INCIDENTS, req.params.id) as unknown as Record<string, unknown>;
    } catch {
      return res.status(404).json({ error: 'Incident not found' });
    }
    if (!userId || incident.user_id !== userId) return res.status(403).json({ error: 'Forbidden' });
    if (incident.status !== 'resolved') return res.status(400).json({ error: 'Post-mortem requires a resolved incident' });

    const built = buildPostmortemPatch(req.body ?? {});
    if (!built.ok) return res.status(400).json({ error: built.error });

    await databases.updateDocument(DB_ID, COLLECTIONS.INCIDENTS, req.params.id, built.patch);
    res.json({ ok: true });
  } catch {
    res.status(500).json({ error: 'Failed to save post-mortem' });
  }
});

// Loop restart: route the post-mortem's lessons to the Plan backlog.
router.post('/:id/convert-to-issue', async (req: AuthenticatedRequest, res) => {
  try {
    const projectId = req.body?.projectId;
    if (typeof projectId !== 'string' || !projectId) return res.status(400).json({ error: 'projectId is required' });
    const out = await convertIncidentToIssue(projectId, req.params.id, req.user?.$id);
    if (out === 'forbidden') return res.status(403).json({ error: 'Forbidden' });
    if (out === 'not_found') return res.status(404).json({ error: 'Incident not found' });
    if (out === 'not_resolved') return res.status(400).json({ error: 'Incident must be resolved first' });
    if (out === 'no_postmortem') return res.status(400).json({ error: 'Fill in the post-mortem before converting' });
    res.json(out);
  } catch {
    res.status(500).json({ error: 'Failed to convert incident' });
  }
});

// Forensic evidence captured by SOAR for this incident (read-only).
router.get('/:id/evidence', async (req: AuthenticatedRequest, res) => {
  try {
    const userId = req.user?.$id;
    let incident: Record<string, unknown>;
    try {
      incident = await databases.getDocument(DB_ID, COLLECTIONS.INCIDENTS, req.params.id) as unknown as Record<string, unknown>;
    } catch {
      return res.status(404).json({ error: 'Incident not found' });
    }
    if (!userId || incident.user_id !== userId) return res.status(403).json({ error: 'Forbidden' });

    const rows = await soarRepository.listEvidenceForIncident(req.params.id);
    res.json(rows.map((r) => {
      let evidence: unknown = r.result ?? null;
      if (typeof r.result === 'string') { try { evidence = JSON.parse(r.result); } catch { /* keep raw */ } }
      return { actionId: r.id, playbookName: r.playbookName, createdAt: r.createdAt, evidence };
    }));
  } catch {
    res.status(500).json({ error: 'Failed to load evidence' });
  }
});
```

NOTE: if `incidentRoutes.ts` approaches the 250-line cap with these additions, extract the three new handlers to `backend/src/routes/incidentPostmortemRoutes.ts` and mount it from `incidentRoutes.ts` (`router.use(postmortemRouter)`) — reviewer will check the cap.

- [ ] **Step 4: Run test to verify it passes**

Run: `cd backend && npx jest src/routes/incidentRoutes.postmortem.test.ts src/services/incidentService.test.ts`
Expected: new tests PASS (6), existing incidentService tests still green. Then `npx tsc --noEmit` — clean except pre-existing prisma error.

- [ ] **Step 5: Commit**

```bash
git add backend/src/routes/incidentRoutes.ts backend/src/repositories/soarRepository.ts backend/src/routes/incidentRoutes.postmortem.test.ts
git commit -m "feat(ir): postmortem/convert/evidence routes + soar evidence lookup"
```

---

### Task 4: IncidentsPanel (incidents' first UI) + doc

**Files:**
- Create: `src/components/IncidentsPanel.tsx`
- Modify: `src/pages/Monitor.tsx` (mount after `<FeedbackPanel />`)
- Create: `docs/lifecycle/incident-response.md`

**Interfaces:**
- Consumes: `GET /api/incidents` (existing; returns Appwrite list `{documents,total}` of incidents `{$id,title,severity,source,status,$createdAt,rootCause?,escapedPhase?,lessons?,actionItemIssueId?}`); `PATCH /api/incidents/:id/postmortem`; `POST /api/incidents/:id/convert-to-issue`; `GET /api/incidents/:id/evidence`; the Plan projects list endpoint used by PlanWorkspace (read `src/pages/PlanWorkspace.tsx` or its data hook to find the exact projects fetch and reuse it for the dropdown).

- [ ] **Step 1: Build IncidentsPanel** — read `src/components/FalcoRulesPanel.tsx` + `src/components/FeedbackPanel.tsx` first and mirror their auth-fetch helper, loading/error/empty states, and styling. Panel content: incident list (title, severity pill, source, status, time). Expanding a `status === 'resolved'` incident reveals: post-mortem form (rootCause textarea, escapedPhase `<select>` with the 8 phases, lessons textarea, Save → PATCH, prefilled from existing fields); "Create Plan Issue" (project `<select>` + button → POST convert; when `actionItemIssueId` set, render the linked issue id text instead of the button); Evidence accordion (lazy GET on expand, `<pre>` pretty-print `JSON.stringify(evidence, null, 2)`, scrollable). Toast on save/convert success/failure per sibling panels' toast usage.

- [ ] **Step 2: Mount on Monitor.tsx**

```tsx
import IncidentsPanel from '../components/IncidentsPanel';
// after <FeedbackPanel />:
<IncidentsPanel />
```

- [ ] **Step 3: Write `docs/lifecycle/incident-response.md`** — as-built: the three components, what already existed (SOAR containment, release-gate freeze — link `docs/lifecycle/operate-phase.md`), Runtime Prerequisites (4 new attributes on `incidents`: `rootCause` string, `escapedPhase` string, `lessons` string 4096, `actionItemIssueId` string nullable — no new collections), the figure-8 loop narrative (incident → post-mortem → Plan issue → next sprint), and deferred items (DFIR tooling, timeline reconstruction, auto-suggest escapedPhase).

- [ ] **Step 4: Verify**

Run: `npx tsc -p tsconfig.app.json --noEmit` (repo root) — clean. `cd backend && npm run test` — full suite green. `npm run lint` in backend — 0 errors on changed files.

- [ ] **Step 5: Commit**

```bash
git add src/components/IncidentsPanel.tsx src/pages/Monitor.tsx docs/lifecycle/incident-response.md
git commit -m "feat(ir): IncidentsPanel (postmortem form, plan-issue convert, evidence viewer) + docs"
```

---

## Self-Review

**Spec coverage:** A (post-mortem) → Tasks 1, 3 ✓. B (incident→Plan) → Tasks 2, 3 ✓. C (evidence) → Task 3 ✓. Frontend → Task 4 ✓. Runtime prereqs documented → Task 4 ✓. Tenancy invariants → ownership checks in every route (Task 3 tests cover 403), project access in Task 2 ✓.

**Placeholder scan:** none — all code steps carry real code; Task 4's panel step names the exact sibling files to mirror and the exact endpoints.

**Type consistency:** `buildPostmortemPatch` return shape used identically in Tasks 1/3. `convertIncidentToIssue` union `'forbidden'|'not_found'|'not_resolved'|'no_postmortem'|{ok,issueId}` mapped 1:1 to HTTP in Task 3. `listEvidenceForIncident` row shape matches Task 3's mapping. `IncidentDoc` fields match the attributes Task 4's doc tells the user to create.

**Known deviations:** none from spec. Line-cap contingency for incidentRoutes.ts stated inline (extract to `incidentPostmortemRoutes.ts` if needed).
