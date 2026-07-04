# Operate Phase (Stage 7) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add four Operate-phase capabilities to Scorpion: SOAR playbook response to Falco events, Falco rule management with YAML export, k8s-scoped CSPM posture checks, and a zero-trust NetworkPolicy generator.

**Architecture:** Each component is a pure decision/render core (fully unit-tested, zero I/O) wired to thin infrastructure: Appwrite persistence, BullMQ queue/worker where async, Express routes with zod validation, and the existing `falcoHandler` ingestion path. SOAR is the only component that writes to the cluster (containment); CSPM is read-only; NetworkPolicy output is artifacts/PRs, never `kubectl apply`.

**Tech Stack:** TypeScript (strict, no `any`), Express + zod, Appwrite (node-appwrite), BullMQ + ioredis, @kubernetes/client-node, Octokit (GitHub App), Jest + supertest, React (frontend panels).

**Spec:** `docs/superpowers/specs/2026-07-04-operate-phase-design.md` — read it first.

## Global Constraints

- Branch: `feat/operate-phase` (create from `feat/deploy-phase` HEAD, or from `main` after that branch merges — ask the user which).
- Backend layering per `backend/CLAUDE.md`: routes validate + translate HTTP only; business logic in pure modules; persistence in repositories. Files < 250 lines.
- **No `any`.** Use `unknown` + narrowing, or explicit wire interfaces (see `driftRepository.ts` for the pattern).
- All commands run from `backend/` (NOT repo root): `npx tsc --noEmit`, `npm run lint`, `npm run test`.
- Every task ends: typecheck + lint + full backend suite green, then commit (conventional commits, no attribution footer).
- New Appwrite collections used (create in Appwrite console or accept graceful degradation — repositories must catch Appwrite errors and log, never crash): `playbooks`, `soar_actions`, `falco_rules`, `posture_snapshots`. All complex fields stored as JSON-string columns (existing convention, see `canaries.checks`).
- Falco event fields used: `output_fields['k8s.ns.name']`, `output_fields['k8s.pod.name']`, `output_fields['container.id']`, `output_fields['container.image.repository']`. Missing pod/ns → destructive actions fail with a recorded reason, never throw.
- Fail-secure defaults: playbook load failure → no SOAR actions but the existing incident path still runs; unknown Falco rules are never suppressed; new playbook actions default to `approval` mode.

---

### Task 1: SOAR playbook matcher (pure)

**Files:**
- Create: `backend/src/soar/playbookMatcher.ts`
- Test: `backend/src/soar/playbookMatcher.test.ts`

**Interfaces:**
- Consumes: nothing (pure module).
- Produces (later tasks import these exact names from `../soar/playbookMatcher`):
  - `type FalcoPriority = 'Emergency' | 'Alert' | 'Critical' | 'Error' | 'Warning' | 'Notice' | 'Informational' | 'Debug'`
  - `type SoarActionType = 'capture_evidence' | 'slack_escalate' | 'isolate_pod' | 'kill_pod'`
  - `type SoarActionMode = 'auto' | 'approval'`
  - `interface PlaybookAction { type: SoarActionType; mode: SoarActionMode }`
  - `interface Playbook { id: string; name: string; enabled: boolean; trigger: { rulePattern?: string; minPriority: FalcoPriority }; actions: PlaybookAction[] }`
  - `interface MatchedAction { playbookId: string; playbookName: string; type: SoarActionType; execution: 'auto' | 'approval' }`
  - `matchPlaybooks(event: { rule: string; priority: FalcoPriority }, playbooks: Playbook[]): MatchedAction[]`
  - `normalizePriority(raw: string): FalcoPriority` (unknown → `'Notice'`)
  - `DESTRUCTIVE_ACTIONS: ReadonlySet<SoarActionType>`
  - `PRIORITY_RANK: Record<FalcoPriority, number>`

- [ ] **Step 1: Write the failing test**

```typescript
// backend/src/soar/playbookMatcher.test.ts
import { matchPlaybooks, normalizePriority, Playbook } from './playbookMatcher';

const pb = (over: Partial<Playbook> = {}): Playbook => ({
  id: 'pb-1',
  name: 'Shell response',
  enabled: true,
  trigger: { rulePattern: 'Terminal shell*', minPriority: 'Warning' },
  actions: [
    { type: 'capture_evidence', mode: 'auto' },
    { type: 'isolate_pod', mode: 'auto' },
    { type: 'kill_pod', mode: 'approval' },
  ],
  ...over,
});

describe('matchPlaybooks', () => {
  it('matches rule prefix pattern and min priority', () => {
    const out = matchPlaybooks({ rule: 'Terminal shell in container', priority: 'Critical' }, [pb()]);
    expect(out).toHaveLength(3);
  });

  it('skips disabled playbooks', () => {
    expect(matchPlaybooks({ rule: 'Terminal shell in container', priority: 'Critical' }, [pb({ enabled: false })])).toEqual([]);
  });

  it('skips when priority below minPriority', () => {
    expect(matchPlaybooks({ rule: 'Terminal shell in container', priority: 'Notice' }, [pb()])).toEqual([]);
  });

  it('exact match when pattern has no wildcard', () => {
    const p = pb({ trigger: { rulePattern: 'Write below etc', minPriority: 'Warning' } });
    expect(matchPlaybooks({ rule: 'Write below etc', priority: 'Error' }, [p])).toHaveLength(3);
    expect(matchPlaybooks({ rule: 'Write below etc dir', priority: 'Error' }, [p])).toEqual([]);
  });

  it('missing rulePattern matches every rule', () => {
    const p = pb({ trigger: { minPriority: 'Critical' } });
    expect(matchPlaybooks({ rule: 'Anything', priority: 'Critical' }, [p])).toHaveLength(3);
  });

  it('non-destructive auto actions always execute auto', () => {
    const out = matchPlaybooks({ rule: 'Terminal shell x', priority: 'Warning' }, [pb()]);
    expect(out.find((a) => a.type === 'capture_evidence')?.execution).toBe('auto');
  });

  it('destructive auto action downgrades to approval below Critical', () => {
    const out = matchPlaybooks({ rule: 'Terminal shell x', priority: 'Warning' }, [pb()]);
    expect(out.find((a) => a.type === 'isolate_pod')?.execution).toBe('approval');
  });

  it('destructive auto action stays auto at Critical and above', () => {
    const out = matchPlaybooks({ rule: 'Terminal shell x', priority: 'Alert' }, [pb()]);
    expect(out.find((a) => a.type === 'isolate_pod')?.execution).toBe('auto');
  });

  it('destructive approval action never auto-executes', () => {
    const out = matchPlaybooks({ rule: 'Terminal shell x', priority: 'Emergency' }, [pb()]);
    expect(out.find((a) => a.type === 'kill_pod')?.execution).toBe('approval');
  });
});

describe('normalizePriority', () => {
  it('passes known priorities through', () => expect(normalizePriority('Critical')).toBe('Critical'));
  it('is case-insensitive', () => expect(normalizePriority('critical')).toBe('Critical'));
  it('defaults unknown to Notice', () => expect(normalizePriority('weird')).toBe('Notice'));
});
```

- [ ] **Step 2: Run test to verify it fails**

Run (from `backend/`): `npx jest src/soar/playbookMatcher.test.ts`
Expected: FAIL — cannot find module './playbookMatcher'.

- [ ] **Step 3: Write minimal implementation**

```typescript
// backend/src/soar/playbookMatcher.ts
/**
 * Pure SOAR decision core: which playbook actions fire for a Falco event, and
 * whether each runs automatically or waits for human approval. Zero I/O.
 *
 * Tier rule (fail-secure): destructive actions auto-execute only when the
 * playbook explicitly opts in (mode 'auto') AND the event is Critical+.
 */

export type FalcoPriority =
  | 'Emergency' | 'Alert' | 'Critical' | 'Error'
  | 'Warning' | 'Notice' | 'Informational' | 'Debug';

export type SoarActionType = 'capture_evidence' | 'slack_escalate' | 'isolate_pod' | 'kill_pod';
export type SoarActionMode = 'auto' | 'approval';

export interface PlaybookAction { type: SoarActionType; mode: SoarActionMode }

export interface Playbook {
  id: string;
  name: string;
  enabled: boolean;
  trigger: { rulePattern?: string; minPriority: FalcoPriority };
  actions: PlaybookAction[];
}

export interface MatchedAction {
  playbookId: string;
  playbookName: string;
  type: SoarActionType;
  execution: 'auto' | 'approval';
}

export const PRIORITY_RANK: Record<FalcoPriority, number> = {
  Emergency: 8, Alert: 7, Critical: 6, Error: 5,
  Warning: 4, Notice: 3, Informational: 2, Debug: 1,
};

export const DESTRUCTIVE_ACTIONS: ReadonlySet<SoarActionType> = new Set(['isolate_pod', 'kill_pod']);

const PRIORITIES = Object.keys(PRIORITY_RANK) as FalcoPriority[];

export function normalizePriority(raw: string): FalcoPriority {
  return PRIORITIES.find((p) => p.toLowerCase() === raw.toLowerCase()) ?? 'Notice';
}

function ruleMatches(rule: string, pattern?: string): boolean {
  if (!pattern) return true;
  const r = rule.toLowerCase();
  const p = pattern.toLowerCase();
  return p.endsWith('*') ? r.startsWith(p.slice(0, -1)) : r === p;
}

function resolveExecution(action: PlaybookAction, priority: FalcoPriority): 'auto' | 'approval' {
  if (!DESTRUCTIVE_ACTIONS.has(action.type)) return action.mode === 'auto' ? 'auto' : 'approval';
  const criticalPlus = PRIORITY_RANK[priority] >= PRIORITY_RANK.Critical;
  return action.mode === 'auto' && criticalPlus ? 'auto' : 'approval';
}

export function matchPlaybooks(
  event: { rule: string; priority: FalcoPriority },
  playbooks: Playbook[],
): MatchedAction[] {
  return playbooks
    .filter((p) => p.enabled)
    .filter((p) => PRIORITY_RANK[event.priority] >= PRIORITY_RANK[p.trigger.minPriority])
    .filter((p) => ruleMatches(event.rule, p.trigger.rulePattern))
    .flatMap((p) =>
      p.actions.map((a) => ({
        playbookId: p.id,
        playbookName: p.name,
        type: a.type,
        execution: resolveExecution(a, event.priority),
      })),
    );
}
```

Note: non-destructive actions with `mode: 'approval'` also wait for approval — mode is respected for every action; the Critical+ gate applies only to destructive ones.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest src/soar/playbookMatcher.test.ts` → PASS. Then `npx tsc --noEmit` and `npm run lint` → clean.

- [ ] **Step 5: Commit**

```bash
git add backend/src/soar/playbookMatcher.ts backend/src/soar/playbookMatcher.test.ts
git commit -m "feat(soar): add pure playbook matcher with tiered destructive-action gating"
```

---

### Task 2: SOAR repository (playbooks + action records)

**Files:**
- Create: `backend/src/repositories/soarRepository.ts`
- Test: `backend/src/repositories/soarRepository.test.ts`

**Interfaces:**
- Consumes: `Playbook`, `PlaybookAction`, `SoarActionType` from `../soar/playbookMatcher`; `databases, DB_ID, ID, Query` from `../lib/appwrite`.
- Produces:
  - `type SoarActionStatus = 'pending' | 'approved' | 'rejected' | 'executed' | 'failed'`
  - `interface SoarActionRecord { id: string; incidentId: string; actionType: SoarActionType; playbookId: string; playbookName: string; status: SoarActionStatus; namespace?: string; podName?: string; containerImage: string; falcoRule: string; createdAt: string; resolvedAt?: string; resolvedBy?: string; result?: string; error?: string }`
  - `soarRepository.listPlaybooks(): Promise<Playbook[]>` — Appwrite failure → `[]` + warn (fail-secure: no playbooks, no actions)
  - `soarRepository.createPlaybook(p: Omit<Playbook, 'id'>): Promise<Playbook>`
  - `soarRepository.updatePlaybook(id: string, p: Partial<Omit<Playbook, 'id'>>): Promise<void>`
  - `soarRepository.createAction(a: Omit<SoarActionRecord, 'id' | 'createdAt'>): Promise<SoarActionRecord>`
  - `soarRepository.getAction(id: string): Promise<SoarActionRecord | null>`
  - `soarRepository.listActions(status?: SoarActionStatus): Promise<SoarActionRecord[]>`
  - `soarRepository.setActionStatus(id: string, status: SoarActionStatus, extra?: { resolvedBy?: string; result?: string; error?: string }): Promise<void>`

Appwrite collections: `playbooks` (columns: `name`, `enabled`, `trigger` JSON-string, `actions` JSON-string) and `soar_actions` (columns: `incidentId`, `actionType`, `playbookId`, `playbookName`, `status`, `namespace`, `podName`, `containerImage`, `falcoRule`, `createdAt`, `resolvedAt`, `resolvedBy`, `result`, `error`).

- [ ] **Step 1: Write the failing test**

```typescript
// backend/src/repositories/soarRepository.test.ts
jest.mock('../lib/appwrite', () => ({
  databases: {
    listDocuments: jest.fn(),
    createDocument: jest.fn(),
    getDocument: jest.fn(),
    updateDocument: jest.fn(),
  },
  DB_ID: 'test-db',
  ID: { unique: () => 'new-id' },
  Query: {
    equal: (f: string, v: unknown) => ({ equal: [f, v] }),
    orderDesc: (f: string) => ({ orderDesc: f }),
    limit: (n: number) => ({ limit: n }),
  },
}));
jest.mock('../services/logger', () => ({ logger: { warn: jest.fn(), info: jest.fn(), error: jest.fn() } }));

import { soarRepository } from './soarRepository';
import { databases } from '../lib/appwrite';

const mocked = databases as jest.Mocked<typeof databases>;

beforeEach(() => jest.clearAllMocks());

describe('soarRepository.listPlaybooks', () => {
  it('parses JSON-string trigger and actions columns', async () => {
    mocked.listDocuments.mockResolvedValue({
      total: 1,
      documents: [{
        $id: 'pb-1', name: 'Shell response', enabled: true,
        trigger: JSON.stringify({ rulePattern: 'Terminal*', minPriority: 'Warning' }),
        actions: JSON.stringify([{ type: 'kill_pod', mode: 'approval' }]),
      }],
    } as never);
    const out = await soarRepository.listPlaybooks();
    expect(out).toEqual([{
      id: 'pb-1', name: 'Shell response', enabled: true,
      trigger: { rulePattern: 'Terminal*', minPriority: 'Warning' },
      actions: [{ type: 'kill_pod', mode: 'approval' }],
    }]);
  });

  it('returns [] when Appwrite is down (fail-secure)', async () => {
    mocked.listDocuments.mockRejectedValue(new Error('down'));
    await expect(soarRepository.listPlaybooks()).resolves.toEqual([]);
  });
});

describe('soarRepository actions', () => {
  it('createAction stamps createdAt and returns the record', async () => {
    mocked.createDocument.mockResolvedValue({ $id: 'act-1' } as never);
    const rec = await soarRepository.createAction({
      incidentId: 'inc-1', actionType: 'kill_pod', playbookId: 'pb-1', playbookName: 'Shell response',
      status: 'pending', containerImage: 'img', falcoRule: 'Terminal shell in container',
      namespace: 'prod', podName: 'web-1',
    });
    expect(rec.id).toBe('act-1');
    expect(rec.createdAt).toBeTruthy();
  });

  it('setActionStatus stamps resolvedAt', async () => {
    mocked.updateDocument.mockResolvedValue({} as never);
    await soarRepository.setActionStatus('act-1', 'executed', { result: 'ok' });
    expect(mocked.updateDocument).toHaveBeenCalledWith('test-db', 'soar_actions', 'act-1',
      expect.objectContaining({ status: 'executed', result: 'ok', resolvedAt: expect.any(String) }));
  });

  it('getAction returns null on not-found', async () => {
    mocked.getDocument.mockRejectedValue(new Error('404'));
    await expect(soarRepository.getAction('missing')).resolves.toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest src/repositories/soarRepository.test.ts`
Expected: FAIL — cannot find module './soarRepository'.

- [ ] **Step 3: Write minimal implementation**

```typescript
// backend/src/repositories/soarRepository.ts
import type { Models } from 'node-appwrite';
import { databases, DB_ID, ID, Query } from '../lib/appwrite';
import { logger } from '../services/logger';
import type { Playbook, SoarActionType } from '../soar/playbookMatcher';

const PLAYBOOKS = 'playbooks';
const ACTIONS = 'soar_actions';

export type SoarActionStatus = 'pending' | 'approved' | 'rejected' | 'executed' | 'failed';

export interface SoarActionRecord {
  id: string;
  incidentId: string;
  actionType: SoarActionType;
  playbookId: string;
  playbookName: string;
  status: SoarActionStatus;
  namespace?: string;
  podName?: string;
  containerImage: string;
  falcoRule: string;
  createdAt: string;
  resolvedAt?: string;
  resolvedBy?: string;
  result?: string;
  error?: string;
}

interface PlaybookWire { name: string; enabled: boolean; trigger: string; actions: string }
type ActionWire = Omit<SoarActionRecord, 'id'>;

function toMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function playbookFromDoc(doc: Models.Document): Playbook {
  const w = doc as unknown as PlaybookWire & Models.Document;
  return {
    id: doc.$id,
    name: w.name,
    enabled: w.enabled,
    trigger: JSON.parse(w.trigger) as Playbook['trigger'],
    actions: JSON.parse(w.actions) as Playbook['actions'],
  };
}

function actionFromDoc(doc: Models.Document): SoarActionRecord {
  const w = doc as unknown as ActionWire & Models.Document;
  return {
    id: doc.$id,
    incidentId: w.incidentId,
    actionType: w.actionType,
    playbookId: w.playbookId,
    playbookName: w.playbookName,
    status: w.status,
    namespace: w.namespace ?? undefined,
    podName: w.podName ?? undefined,
    containerImage: w.containerImage,
    falcoRule: w.falcoRule,
    createdAt: w.createdAt,
    resolvedAt: w.resolvedAt ?? undefined,
    resolvedBy: w.resolvedBy ?? undefined,
    result: w.result ?? undefined,
    error: w.error ?? undefined,
  };
}

export const soarRepository = {
  /** Fail-secure: Appwrite down → no playbooks → no SOAR actions (existing
   *  incident path still runs). Never throws. */
  async listPlaybooks(): Promise<Playbook[]> {
    try {
      const list = await databases.listDocuments(DB_ID, PLAYBOOKS, [Query.limit(100)]);
      return list.documents.map(playbookFromDoc);
    } catch (err) {
      logger.warn('[SoarRepository] playbook load failed:', toMessage(err));
      return [];
    }
  },

  async createPlaybook(p: Omit<Playbook, 'id'>): Promise<Playbook> {
    const doc = await databases.createDocument(DB_ID, PLAYBOOKS, ID.unique(), {
      name: p.name,
      enabled: p.enabled,
      trigger: JSON.stringify(p.trigger),
      actions: JSON.stringify(p.actions),
    });
    return { ...p, id: doc.$id };
  },

  async updatePlaybook(id: string, p: Partial<Omit<Playbook, 'id'>>): Promise<void> {
    const patch: Record<string, unknown> = {};
    if (p.name !== undefined) patch.name = p.name;
    if (p.enabled !== undefined) patch.enabled = p.enabled;
    if (p.trigger !== undefined) patch.trigger = JSON.stringify(p.trigger);
    if (p.actions !== undefined) patch.actions = JSON.stringify(p.actions);
    await databases.updateDocument(DB_ID, PLAYBOOKS, id, patch);
  },

  async createAction(a: Omit<SoarActionRecord, 'id' | 'createdAt'>): Promise<SoarActionRecord> {
    const createdAt = new Date().toISOString();
    const doc = await databases.createDocument(DB_ID, ACTIONS, ID.unique(), { ...a, createdAt });
    return { ...a, id: doc.$id, createdAt };
  },

  async getAction(id: string): Promise<SoarActionRecord | null> {
    try {
      return actionFromDoc(await databases.getDocument(DB_ID, ACTIONS, id));
    } catch {
      return null;
    }
  },

  async listActions(status?: SoarActionStatus): Promise<SoarActionRecord[]> {
    const queries = [Query.orderDesc('createdAt'), Query.limit(100)];
    if (status) queries.push(Query.equal('status', status));
    const list = await databases.listDocuments(DB_ID, ACTIONS, queries);
    return list.documents.map(actionFromDoc);
  },

  async setActionStatus(
    id: string,
    status: SoarActionStatus,
    extra: { resolvedBy?: string; result?: string; error?: string } = {},
  ): Promise<void> {
    await databases.updateDocument(DB_ID, ACTIONS, id, {
      status,
      resolvedAt: new Date().toISOString(),
      ...extra,
    });
  },
};
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest src/repositories/soarRepository.test.ts` → PASS. `npx tsc --noEmit`, `npm run lint` → clean.

- [ ] **Step 5: Commit**

```bash
git add backend/src/repositories/soarRepository.ts backend/src/repositories/soarRepository.test.ts
git commit -m "feat(soar): add playbook and action-record repository"
```

---

### Task 3: SOAR action executors with k8s seam

**Files:**
- Create: `backend/src/soar/soarActions.ts`
- Test: `backend/src/soar/soarActions.test.ts`

**Interfaces:**
- Consumes: `SoarActionRecord` from `../repositories/soarRepository`; `sendSlackNotification` from `../services/slackService`; `auditLog` from `../services/auditService`.
- Produces:
  - `interface K8sPodActions { getPodJson(namespace: string, pod: string): Promise<string>; labelPod(namespace: string, pod: string, key: string, value: string): Promise<void>; deletePod(namespace: string, pod: string): Promise<void>; ensureQuarantinePolicy(namespace: string): Promise<void> }`
  - `createK8sPodActions(): K8sPodActions` — real impl over `@kubernetes/client-node` (same client bootstrap as `workers/driftMonitor.ts` — copy its KubeConfig loading)
  - `executeSoarAction(action: SoarActionRecord, deps: { k8s: K8sPodActions; falcoEventJson?: string }): Promise<{ ok: true; result: string } | { ok: false; error: string }>` — never throws
  - `QUARANTINE_LABEL = 'scorpion-quarantine'`, `QUARANTINE_POLICY_NAME = 'scorpion-quarantine-deny-all'`

Isolation mechanics: `ensureQuarantinePolicy` creates (idempotently — 409 conflict is success) a NetworkPolicy in the namespace with `podSelector: { matchLabels: { 'scorpion-quarantine': 'true' } }`, `policyTypes: ['Ingress', 'Egress']`, and no rules (deny all). `isolate_pod` then labels the target pod `scorpion-quarantine=true`. Idempotent by construction.

- [ ] **Step 1: Write the failing test**

```typescript
// backend/src/soar/soarActions.test.ts
jest.mock('../services/slackService', () => ({ sendSlackNotification: jest.fn() }));
jest.mock('../services/auditService', () => ({ auditLog: jest.fn() }));
jest.mock('../services/logger', () => ({ logger: { warn: jest.fn(), info: jest.fn(), error: jest.fn() } }));
jest.mock('../lib/appwrite', () => ({
  databases: { listDocuments: jest.fn().mockResolvedValue({ total: 0, documents: [] }) },
  DB_ID: 'test-db',
  Query: { equal: jest.fn(), limit: jest.fn() },
}));

import { executeSoarAction, K8sPodActions } from './soarActions';
import type { SoarActionRecord } from '../repositories/soarRepository';

const k8s = (): jest.Mocked<K8sPodActions> => ({
  getPodJson: jest.fn().mockResolvedValue('{"kind":"Pod"}'),
  labelPod: jest.fn().mockResolvedValue(undefined),
  deletePod: jest.fn().mockResolvedValue(undefined),
  ensureQuarantinePolicy: jest.fn().mockResolvedValue(undefined),
});

const action = (over: Partial<SoarActionRecord> = {}): SoarActionRecord => ({
  id: 'act-1', incidentId: 'inc-1', actionType: 'isolate_pod', playbookId: 'pb-1',
  playbookName: 'Shell response', status: 'approved', namespace: 'prod', podName: 'web-1',
  containerImage: 'img', falcoRule: 'Terminal shell in container',
  createdAt: new Date().toISOString(),
  ...over,
});

beforeEach(() => jest.clearAllMocks());

describe('executeSoarAction', () => {
  it('isolate_pod ensures quarantine policy then labels the pod', async () => {
    const deps = { k8s: k8s() };
    const out = await executeSoarAction(action(), deps);
    expect(out.ok).toBe(true);
    expect(deps.k8s.ensureQuarantinePolicy).toHaveBeenCalledWith('prod');
    expect(deps.k8s.labelPod).toHaveBeenCalledWith('prod', 'web-1', 'scorpion-quarantine', 'true');
  });

  it('kill_pod deletes the pod', async () => {
    const deps = { k8s: k8s() };
    const out = await executeSoarAction(action({ actionType: 'kill_pod' }), deps);
    expect(out.ok).toBe(true);
    expect(deps.k8s.deletePod).toHaveBeenCalledWith('prod', 'web-1');
  });

  it('capture_evidence returns pod json + event json as result', async () => {
    const deps = { k8s: k8s(), falcoEventJson: '{"rule":"x"}' };
    const out = await executeSoarAction(action({ actionType: 'capture_evidence' }), deps);
    expect(out).toEqual({ ok: true, result: expect.stringContaining('"kind":"Pod"') });
  });

  it('destructive action without namespace/pod fails with a reason, never throws', async () => {
    const out = await executeSoarAction(action({ namespace: undefined, podName: undefined }), { k8s: k8s() });
    expect(out).toEqual({ ok: false, error: expect.stringContaining('namespace/pod') });
  });

  it('k8s failure is captured, not thrown', async () => {
    const deps = { k8s: k8s() };
    deps.k8s.deletePod.mockRejectedValue(new Error('forbidden'));
    const out = await executeSoarAction(action({ actionType: 'kill_pod' }), deps);
    expect(out).toEqual({ ok: false, error: expect.stringContaining('forbidden') });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest src/soar/soarActions.test.ts` → FAIL, module not found.

- [ ] **Step 3: Write minimal implementation**

```typescript
// backend/src/soar/soarActions.ts
import * as k8sClient from '@kubernetes/client-node';
import { databases, DB_ID, Query } from '../lib/appwrite';
import { sendSlackNotification } from '../services/slackService';
import { auditLog } from '../services/auditService';
import { logger } from '../services/logger';
import type { SoarActionRecord } from '../repositories/soarRepository';

export const QUARANTINE_LABEL = 'scorpion-quarantine';
export const QUARANTINE_POLICY_NAME = 'scorpion-quarantine-deny-all';

/** DIP seam: the executor is pure orchestration; cluster writes live here. */
export interface K8sPodActions {
  getPodJson(namespace: string, pod: string): Promise<string>;
  labelPod(namespace: string, pod: string, key: string, value: string): Promise<void>;
  deletePod(namespace: string, pod: string): Promise<void>;
  ensureQuarantinePolicy(namespace: string): Promise<void>;
}

export function createK8sPodActions(): K8sPodActions {
  const kc = new k8sClient.KubeConfig();
  kc.loadFromDefault();
  const core = kc.makeApiClient(k8sClient.CoreV1Api);
  const net = kc.makeApiClient(k8sClient.NetworkingV1Api);
  return {
    async getPodJson(namespace, pod) {
      const res = await core.readNamespacedPod({ name: pod, namespace });
      return JSON.stringify(res);
    },
    async labelPod(namespace, pod, key, value) {
      await core.patchNamespacedPod(
        { name: pod, namespace, body: { metadata: { labels: { [key]: value } } } },
      );
    },
    async deletePod(namespace, pod) {
      await core.deleteNamespacedPod({ name: pod, namespace });
    },
    async ensureQuarantinePolicy(namespace) {
      try {
        await net.createNamespacedNetworkPolicy({
          namespace,
          body: {
            metadata: { name: QUARANTINE_POLICY_NAME, namespace },
            spec: {
              podSelector: { matchLabels: { [QUARANTINE_LABEL]: 'true' } },
              policyTypes: ['Ingress', 'Egress'],
            },
          },
        });
      } catch (err) {
        // 409 already-exists is success (idempotent); anything else propagates.
        const status = (err as { code?: number; statusCode?: number }).code
          ?? (err as { statusCode?: number }).statusCode;
        if (status !== 409) throw err;
      }
    },
  };
}

export interface SoarExecutionDeps {
  k8s: K8sPodActions;
  /** Raw Falco event JSON, attached to evidence captures when available. */
  falcoEventJson?: string;
}

type ExecutionResult = { ok: true; result: string } | { ok: false; error: string };

function toMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

async function slackEscalate(action: SoarActionRecord): Promise<string> {
  // Reuses the integration lookup convention from falcoHandler.
  const integrations = await databases.listDocuments(DB_ID, 'integrations', [Query.limit(25)]);
  let sent = 0;
  for (const doc of integrations.documents) {
    const integ = doc as unknown as { isEnabled?: boolean; slack_webhook?: string };
    if (integ.isEnabled && integ.slack_webhook) {
      await sendSlackNotification(integ.slack_webhook, {
        title: `SOAR escalation: ${action.falcoRule}`,
        repository: action.containerImage,
        severity: 'Critical',
        rule: action.falcoRule,
        incidentId: action.incidentId,
      });
      sent++;
    }
  }
  return `slack escalation sent to ${sent} integration(s)`;
}

/** Executes one approved action. Never throws — every failure is a returned
 *  error so the worker can mark the record 'failed' and escalate (fail-loud). */
export async function executeSoarAction(
  action: SoarActionRecord,
  deps: SoarExecutionDeps,
): Promise<ExecutionResult> {
  try {
    switch (action.actionType) {
      case 'capture_evidence': {
        let podSpec = 'unavailable';
        if (action.namespace && action.podName) {
          podSpec = await deps.k8s.getPodJson(action.namespace, action.podName).catch(toMessage);
        }
        const evidence = JSON.stringify({ event: deps.falcoEventJson ?? null, podSpec });
        return { ok: true, result: evidence };
      }
      case 'slack_escalate':
        return { ok: true, result: await slackEscalate(action) };
      case 'isolate_pod': {
        if (!action.namespace || !action.podName) {
          return { ok: false, error: 'missing namespace/pod on event; cannot isolate' };
        }
        await deps.k8s.ensureQuarantinePolicy(action.namespace);
        await deps.k8s.labelPod(action.namespace, action.podName, QUARANTINE_LABEL, 'true');
        return { ok: true, result: `pod ${action.namespace}/${action.podName} quarantined` };
      }
      case 'kill_pod': {
        if (!action.namespace || !action.podName) {
          return { ok: false, error: 'missing namespace/pod on event; cannot kill' };
        }
        await deps.k8s.deletePod(action.namespace, action.podName);
        return { ok: true, result: `pod ${action.namespace}/${action.podName} deleted` };
      }
    }
  } catch (err) {
    logger.error(`[SOAR] action ${action.actionType} failed:`, toMessage(err));
    return { ok: false, error: toMessage(err) };
  } finally {
    await auditLog({
      action: `soar.${action.actionType}`,
      actor: 'system',
      actorEmail: 'system@scorpion',
      resource: 'soar_action',
      details: { actionId: action.id, incidentId: action.incidentId, pod: action.podName ?? '' },
    }).catch(() => undefined);
  }
}
```

Note: if `@kubernetes/client-node`'s installed major version uses positional args instead of object args (check how `workers/driftMonitor.ts` calls the API), match that call style exactly — the seam interface stays the same either way.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest src/soar/soarActions.test.ts` → PASS. `npx tsc --noEmit`, `npm run lint` → clean. If tsc flags k8s client call signatures, fix to the installed version's style per the note above.

- [ ] **Step 5: Commit**

```bash
git add backend/src/soar/soarActions.ts backend/src/soar/soarActions.test.ts
git commit -m "feat(soar): add action executors with quarantine-label isolation and k8s seam"
```

---

### Task 4: SOAR queue + worker

**Files:**
- Create: `backend/src/queues/soarQueue.ts`
- Create: `backend/src/queues/soarQueueWorker.ts`
- Test: `backend/src/queues/soarQueueWorker.test.ts`

**Interfaces:**
- Consumes: `soarRepository`, `executeSoarAction`, `createK8sPodActions`, `createIncident` from `../services/incidentService`.
- Produces:
  - `SOAR_QUEUE_NAME = 'soar-actions'`, `soarQueue` (BullMQ Queue)
  - `enqueueSoarAction(payload: { actionId: string; falcoEventJson?: string }): Promise<unknown>` — jobId `soar-<actionId>` (dedupes double-enqueue)
  - `initSoarQueueWorker(): Worker` and `processSoarJob(payload, deps)` (exported for tests)
- Worker contract: load action → execute only if `status === 'approved'` (anything else is a logged no-op — this is the idempotency backstop) → `executed` + result on success; on failure → `failed` + error + escalation incident (fail-loud).

- [ ] **Step 1: Write the failing test**

```typescript
// backend/src/queues/soarQueueWorker.test.ts
jest.mock('./redisConnection', () => ({ redisConnection: {} }));
jest.mock('bullmq', () => ({
  Queue: jest.fn().mockImplementation(() => ({ add: jest.fn() })),
  Worker: jest.fn(),
}));
jest.mock('../repositories/soarRepository', () => ({
  soarRepository: { getAction: jest.fn(), setActionStatus: jest.fn() },
}));
jest.mock('../soar/soarActions', () => ({
  executeSoarAction: jest.fn(),
  createK8sPodActions: jest.fn().mockReturnValue({}),
}));
jest.mock('../services/incidentService', () => ({ createIncident: jest.fn() }));
jest.mock('../services/logger', () => ({ logger: { warn: jest.fn(), info: jest.fn(), error: jest.fn() } }));

import { processSoarJob } from './soarQueueWorker';
import { soarRepository } from '../repositories/soarRepository';
import { executeSoarAction } from '../soar/soarActions';
import { createIncident } from '../services/incidentService';

const repo = soarRepository as jest.Mocked<typeof soarRepository>;
const exec = executeSoarAction as jest.Mock;

const approved = {
  id: 'act-1', status: 'approved', actionType: 'kill_pod', incidentId: 'inc-1',
  playbookId: 'pb-1', playbookName: 'p', containerImage: 'img',
  falcoRule: 'r', createdAt: 'now', namespace: 'prod', podName: 'web-1',
};

beforeEach(() => jest.clearAllMocks());

describe('processSoarJob', () => {
  it('executes an approved action and marks executed', async () => {
    repo.getAction.mockResolvedValue(approved as never);
    exec.mockResolvedValue({ ok: true, result: 'done' });
    await processSoarJob({ actionId: 'act-1' });
    expect(repo.setActionStatus).toHaveBeenCalledWith('act-1', 'executed', { result: 'done' });
  });

  it('marks failed and escalates on execution failure', async () => {
    repo.getAction.mockResolvedValue(approved as never);
    exec.mockResolvedValue({ ok: false, error: 'forbidden' });
    await processSoarJob({ actionId: 'act-1' });
    expect(repo.setActionStatus).toHaveBeenCalledWith('act-1', 'failed', { error: 'forbidden' });
    expect(createIncident).toHaveBeenCalled();
  });

  it('skips non-approved actions (idempotency backstop)', async () => {
    repo.getAction.mockResolvedValue({ ...approved, status: 'executed' } as never);
    await processSoarJob({ actionId: 'act-1' });
    expect(exec).not.toHaveBeenCalled();
    expect(repo.setActionStatus).not.toHaveBeenCalled();
  });

  it('skips missing actions without throwing', async () => {
    repo.getAction.mockResolvedValue(null);
    await expect(processSoarJob({ actionId: 'gone' })).resolves.toBeUndefined();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest src/queues/soarQueueWorker.test.ts` → FAIL, module not found.

- [ ] **Step 3: Write minimal implementation**

```typescript
// backend/src/queues/soarQueue.ts
import { Queue } from 'bullmq';
import { redisConnection } from './redisConnection';

export const SOAR_QUEUE_NAME = 'soar-actions';

export interface SoarJobPayload {
  actionId: string;
  falcoEventJson?: string;
}

export const soarQueue = new Queue<SoarJobPayload>(SOAR_QUEUE_NAME, {
  connection: redisConnection,
  defaultJobOptions: {
    attempts: 3,
    backoff: { type: 'exponential', delay: 5000 },
    removeOnComplete: { count: 500 },
    removeOnFail: { count: 500 },
  },
});

/** jobId dedupes a double-enqueue of the same action (e.g. double approve). */
export const enqueueSoarAction = (payload: SoarJobPayload) =>
  soarQueue.add('soar-action', payload, { jobId: `soar-${payload.actionId}` });
```

```typescript
// backend/src/queues/soarQueueWorker.ts
import { Worker } from 'bullmq';
import { redisConnection } from './redisConnection';
import { SOAR_QUEUE_NAME, SoarJobPayload } from './soarQueue';
import { soarRepository } from '../repositories/soarRepository';
import { executeSoarAction, createK8sPodActions, K8sPodActions } from '../soar/soarActions';
import { createIncident } from '../services/incidentService';
import { logger } from '../services/logger';

/** Exported for unit tests; the worker below is the production entry. */
export async function processSoarJob(
  payload: SoarJobPayload,
  k8s: K8sPodActions = createK8sPodActions(),
): Promise<void> {
  const action = await soarRepository.getAction(payload.actionId);
  if (!action) {
    logger.warn(`[SOAR] action ${payload.actionId} not found, skipping`);
    return;
  }
  // Idempotency backstop: only 'approved' executes. A retried/duplicated job
  // for an already-executed action is a no-op, never a second kill.
  if (action.status !== 'approved') {
    logger.info(`[SOAR] action ${action.id} is '${action.status}', skipping`);
    return;
  }

  const outcome = await executeSoarAction(action, { k8s, falcoEventJson: payload.falcoEventJson });
  if (outcome.ok) {
    await soarRepository.setActionStatus(action.id, 'executed', { result: outcome.result });
    return;
  }

  // Fail-loud: a containment action that could not run is itself an incident.
  await soarRepository.setActionStatus(action.id, 'failed', { error: outcome.error });
  await createIncident({
    title: `SOAR action failed: ${action.actionType} for ${action.falcoRule}`,
    severity: 'Critical',
    source: 'soar',
    description: outcome.error,
  });
}

let soarWorker: Worker<SoarJobPayload> | null = null;

export const initSoarQueueWorker = () => {
  soarWorker = new Worker<SoarJobPayload>(
    SOAR_QUEUE_NAME,
    async (job) => processSoarJob(job.data),
    { connection: redisConnection, concurrency: 2 },
  );
  soarWorker.on('failed', (job, err) => {
    logger.error(`[SoarQueue] Job ${job?.id} failed:`, err.message);
  });
  logger.info('[SoarQueue] Worker initialized.');
  return soarWorker;
};
```

Check `createIncident`'s exact signature in `backend/src/services/incidentService.ts` before writing — match its required fields (falcoHandler's call at `backend/src/runtime/falcoHandler.ts:97-104` shows the shape in use).

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest src/queues/soarQueueWorker.test.ts` → PASS. `npx tsc --noEmit`, `npm run lint` → clean.

- [ ] **Step 5: Commit**

```bash
git add backend/src/queues/soarQueue.ts backend/src/queues/soarQueueWorker.ts backend/src/queues/soarQueueWorker.test.ts
git commit -m "feat(soar): add BullMQ action queue and idempotent execution worker"
```

---

### Task 5: SOAR routes + mount

**Files:**
- Create: `backend/src/routes/soarRoutes.ts`
- Test: `backend/src/routes/soarRoutes.test.ts`
- Modify: `backend/src/index.ts` (import + mount + worker init)

**Interfaces:**
- Consumes: `soarRepository`, `enqueueSoarAction`, `requireRole` from `../middleware/requireRole`.
- Produces (HTTP, mounted at `/api/soar`, `authenticate` + `requireRole('admin', 'security')`):
  - `GET /playbooks`, `POST /playbooks`, `PATCH /playbooks/:id`
  - `GET /actions?status=pending`
  - `POST /actions/:id/approve` → 409 unless current status is `pending`; sets `approved` + `resolvedBy`, enqueues
  - `POST /actions/:id/reject` → 409 unless `pending`

- [ ] **Step 1: Write the failing test**

```typescript
// backend/src/routes/soarRoutes.test.ts
import request from 'supertest';
import express, { Request } from 'express';

type MockAuthRequest = Request & { user?: { $id: string; email?: string; role?: string } };

jest.mock('../repositories/soarRepository', () => ({
  soarRepository: {
    listPlaybooks: jest.fn(), createPlaybook: jest.fn(), updatePlaybook: jest.fn(),
    getAction: jest.fn(), listActions: jest.fn(), setActionStatus: jest.fn(),
  },
}));
jest.mock('../queues/soarQueue', () => ({ enqueueSoarAction: jest.fn() }));
jest.mock('../middleware/requireRole', () => ({
  requireRole: () => (_req: Request, _res: unknown, next: () => void) => next(),
}));
jest.mock('../services/logger', () => ({ logger: { warn: jest.fn(), info: jest.fn(), error: jest.fn() } }));

import soarRoutes from './soarRoutes';
import { soarRepository } from '../repositories/soarRepository';
import { enqueueSoarAction } from '../queues/soarQueue';

const repo = soarRepository as jest.Mocked<typeof soarRepository>;

const buildApp = () => {
  const app = express();
  app.use(express.json());
  app.use((req: MockAuthRequest, _res, next) => {
    req.user = { $id: 'user-1', email: 'sec@scorpion' };
    next();
  });
  app.use('/api/soar', soarRoutes);
  return app;
};

const validPlaybook = {
  name: 'Shell response',
  enabled: true,
  trigger: { rulePattern: 'Terminal shell*', minPriority: 'Warning' },
  actions: [{ type: 'isolate_pod', mode: 'approval' }],
};

const pendingAction = {
  id: 'act-1', incidentId: 'inc-1', actionType: 'kill_pod', playbookId: 'pb-1',
  playbookName: 'p', status: 'pending', containerImage: 'img', falcoRule: 'r',
  createdAt: 'now',
};

beforeEach(() => jest.clearAllMocks());

describe('soarRoutes', () => {
  it('POST /playbooks creates and returns 201', async () => {
    repo.createPlaybook.mockResolvedValue({ id: 'pb-1', ...validPlaybook } as never);
    const res = await request(buildApp()).post('/api/soar/playbooks').send(validPlaybook);
    expect(res.statusCode).toBe(201);
    expect(res.body.playbook.id).toBe('pb-1');
  });

  it('POST /playbooks rejects unknown action type with 400', async () => {
    const bad = { ...validPlaybook, actions: [{ type: 'rm_rf', mode: 'auto' }] };
    const res = await request(buildApp()).post('/api/soar/playbooks').send(bad);
    expect(res.statusCode).toBe(400);
    expect(repo.createPlaybook).not.toHaveBeenCalled();
  });

  it('POST /actions/:id/approve approves a pending action and enqueues', async () => {
    repo.getAction.mockResolvedValue(pendingAction as never);
    const res = await request(buildApp()).post('/api/soar/actions/act-1/approve');
    expect(res.statusCode).toBe(200);
    expect(repo.setActionStatus).toHaveBeenCalledWith('act-1', 'approved', { resolvedBy: 'sec@scorpion' });
    expect(enqueueSoarAction).toHaveBeenCalledWith({ actionId: 'act-1' });
  });

  it('POST /actions/:id/approve returns 409 for non-pending (no double execution)', async () => {
    repo.getAction.mockResolvedValue({ ...pendingAction, status: 'executed' } as never);
    const res = await request(buildApp()).post('/api/soar/actions/act-1/approve');
    expect(res.statusCode).toBe(409);
    expect(enqueueSoarAction).not.toHaveBeenCalled();
  });

  it('POST /actions/:id/reject rejects a pending action', async () => {
    repo.getAction.mockResolvedValue(pendingAction as never);
    const res = await request(buildApp()).post('/api/soar/actions/act-1/reject');
    expect(res.statusCode).toBe(200);
    expect(repo.setActionStatus).toHaveBeenCalledWith('act-1', 'rejected', { resolvedBy: 'sec@scorpion' });
  });

  it('GET /actions filters by status', async () => {
    repo.listActions.mockResolvedValue([pendingAction] as never);
    const res = await request(buildApp()).get('/api/soar/actions?status=pending');
    expect(res.statusCode).toBe(200);
    expect(repo.listActions).toHaveBeenCalledWith('pending');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest src/routes/soarRoutes.test.ts` → FAIL, module not found.

- [ ] **Step 3: Write minimal implementation**

```typescript
// backend/src/routes/soarRoutes.ts
import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { soarRepository, SoarActionStatus } from '../repositories/soarRepository';
import { enqueueSoarAction } from '../queues/soarQueue';
import { requireRole } from '../middleware/requireRole';
import { logger } from '../services/logger';

interface AuthenticatedRequest extends Request {
  user?: { $id: string; email?: string };
}

const prioritySchema = z.enum(['Emergency', 'Alert', 'Critical', 'Error', 'Warning', 'Notice', 'Informational', 'Debug']);

const playbookSchema = z.object({
  name: z.string().min(1).max(128),
  enabled: z.boolean(),
  trigger: z.object({
    rulePattern: z.string().min(1).max(256).optional(),
    minPriority: prioritySchema,
  }),
  actions: z.array(z.object({
    type: z.enum(['capture_evidence', 'slack_escalate', 'isolate_pod', 'kill_pod']),
    mode: z.enum(['auto', 'approval']),
  })).min(1).max(10),
});

const actionStatusSchema = z.enum(['pending', 'approved', 'rejected', 'executed', 'failed']);

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : 'Unknown error';
}

const router = Router();

// Runtime response controls are sensitive — same RBAC posture as driftRoutes.
router.use(requireRole('admin', 'security'));

router.get('/playbooks', async (_req: Request, res: Response) => {
  res.json({ playbooks: await soarRepository.listPlaybooks() });
});

router.post('/playbooks', async (req: Request, res: Response) => {
  const parsed = playbookSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: 'Invalid playbook', details: parsed.error.flatten() });
  }
  try {
    const playbook = await soarRepository.createPlaybook(parsed.data);
    res.status(201).json({ playbook });
  } catch (err) {
    logger.error('[SOAR API] create playbook failed:', errorMessage(err));
    res.status(500).json({ error: 'Failed to create playbook' });
  }
});

router.patch('/playbooks/:id', async (req: Request, res: Response) => {
  const parsed = playbookSchema.partial().safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: 'Invalid playbook update', details: parsed.error.flatten() });
  }
  try {
    await soarRepository.updatePlaybook(req.params.id, parsed.data);
    res.json({ status: 'updated' });
  } catch (err) {
    logger.error('[SOAR API] update playbook failed:', errorMessage(err));
    res.status(500).json({ error: 'Failed to update playbook' });
  }
});

router.get('/actions', async (req: Request, res: Response) => {
  const status = req.query.status !== undefined ? actionStatusSchema.safeParse(req.query.status) : undefined;
  if (status && !status.success) return res.status(400).json({ error: 'Invalid status filter' });
  try {
    const actions = await soarRepository.listActions(status?.data as SoarActionStatus | undefined);
    res.json({ actions });
  } catch (err) {
    logger.error('[SOAR API] list actions failed:', errorMessage(err));
    res.status(500).json({ error: 'Failed to list actions' });
  }
});

/** Shared approve/reject resolution: only a 'pending' action can be resolved. */
async function resolveAction(
  req: AuthenticatedRequest,
  res: Response,
  target: 'approved' | 'rejected',
): Promise<void> {
  const action = await soarRepository.getAction(req.params.id);
  if (!action) {
    res.status(404).json({ error: 'Action not found' });
    return;
  }
  if (action.status !== 'pending') {
    res.status(409).json({ error: `Action is '${action.status}', not pending` });
    return;
  }
  const resolvedBy = req.user?.email ?? req.user?.$id ?? 'unknown';
  await soarRepository.setActionStatus(action.id, target, { resolvedBy });
  if (target === 'approved') await enqueueSoarAction({ actionId: action.id });
  res.json({ status: target });
}

router.post('/actions/:id/approve', (req: AuthenticatedRequest, res: Response) => {
  resolveAction(req, res, 'approved').catch((err) => {
    logger.error('[SOAR API] approve failed:', errorMessage(err));
    res.status(500).json({ error: 'Failed to approve action' });
  });
});

router.post('/actions/:id/reject', (req: AuthenticatedRequest, res: Response) => {
  resolveAction(req, res, 'rejected').catch((err) => {
    logger.error('[SOAR API] reject failed:', errorMessage(err));
    res.status(500).json({ error: 'Failed to reject action' });
  });
});

export default router;
```

Then modify `backend/src/index.ts` — three additions following existing patterns exactly:

1. With the route imports (near line 63): `import soarRoutes from './routes/soarRoutes';`
2. With the mounts (near line 309, next to `canaryRoutes`): `app.use('/api/soar', authenticate, soarRoutes);`
3. With the worker inits (near line 381, next to `initCanaryQueueWorker()`): `import { initSoarQueueWorker } from './queues/soarQueueWorker';` (top) and `const soarQueueWorker = initSoarQueueWorker();` — mirror however `canaryQueueWorker` is referenced afterwards (e.g. graceful shutdown), searching `canaryQueueWorker` usages in the file and replicating each.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest src/routes/soarRoutes.test.ts` → PASS. Then `npx tsc --noEmit`, `npm run lint`, `npm run test` (full suite) → green.

- [ ] **Step 5: Commit**

```bash
git add backend/src/routes/soarRoutes.ts backend/src/routes/soarRoutes.test.ts backend/src/index.ts
git commit -m "feat(soar): add playbook CRUD and action approval routes, mount + worker init"
```

---

### Task 6: Wire falcoHandler → SOAR

**Files:**
- Modify: `backend/src/runtime/falcoHandler.ts`
- Test: create `backend/src/runtime/falcoHandler.soar.test.ts`

**Interfaces:**
- Consumes: `matchPlaybooks`, `normalizePriority` (Task 1), `soarRepository` (Task 2), `enqueueSoarAction` (Task 4).
- Produces: no new exports — behavior change only. After the incident document is created (existing line ~65-75), the handler dispatches SOAR.

Wiring contract (add as a new function `dispatchSoar` at the bottom of falcoHandler.ts, called from `handleFalcoEvent` right after `incidentDoc` is created, wrapped so a SOAR failure never breaks the existing path):

```typescript
// Added inside backend/src/runtime/falcoHandler.ts
import { matchPlaybooks, normalizePriority } from '../soar/playbookMatcher';
import { soarRepository } from '../repositories/soarRepository';
import { enqueueSoarAction } from '../queues/soarQueue';

async function dispatchSoar(event: FalcoEvent, incidentId: string): Promise<void> {
  const playbooks = await soarRepository.listPlaybooks(); // [] on failure (fail-secure)
  const priority = normalizePriority(event.priority);
  const matched = matchPlaybooks({ rule: event.rule, priority }, playbooks);
  if (matched.length === 0) return;

  const namespace = event.output_fields?.['k8s.ns.name'] as string | undefined;
  const podName = event.output_fields?.['k8s.pod.name'] as string | undefined;
  const containerImage = event.output_fields?.['container.image.repository'] || 'unknown';

  for (const m of matched) {
    const record = await soarRepository.createAction({
      incidentId,
      actionType: m.type,
      playbookId: m.playbookId,
      playbookName: m.playbookName,
      status: m.execution === 'auto' ? 'approved' : 'pending',
      namespace,
      podName,
      containerImage,
      falcoRule: event.rule,
    });
    if (m.execution === 'auto') {
      await enqueueSoarAction({ actionId: record.id, falcoEventJson: JSON.stringify(event) });
    }
  }
  logger.info(`[Falco Handler] SOAR dispatched ${matched.length} action(s) for '${event.rule}'`);
}
```

Call site, inside `handleFalcoEvent` immediately after the `incidentDoc` create + auditLog block:

```typescript
    await dispatchSoar(event, incidentDoc.$id).catch((err) =>
      logger.error('[Falco Handler] SOAR dispatch failed (incident path unaffected):', err),
    );
```

- [ ] **Step 1: Write the failing test**

```typescript
// backend/src/runtime/falcoHandler.soar.test.ts
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
jest.mock('../services/auditService', () => ({ auditLog: jest.fn() }));
jest.mock('../services/slackService', () => ({ sendSlackNotification: jest.fn() }));
jest.mock('../services/logger', () => ({ logger: { warn: jest.fn(), info: jest.fn(), error: jest.fn() } }));
jest.mock('../repositories/soarRepository', () => ({
  soarRepository: { listPlaybooks: jest.fn(), createAction: jest.fn() },
}));
jest.mock('../queues/soarQueue', () => ({ enqueueSoarAction: jest.fn() }));
jest.mock('../repositories/falcoRuleRepository', () => ({
  falcoRuleRepository: { listRules: jest.fn().mockResolvedValue([]) },
}), { virtual: true });

import { handleFalcoEvent } from './falcoHandler';
import { soarRepository } from '../repositories/soarRepository';
import { enqueueSoarAction } from '../queues/soarQueue';

const repo = soarRepository as jest.Mocked<typeof soarRepository>;

const event = {
  rule: 'Terminal shell in container',
  priority: 'Critical',
  output: 'shell spawned',
  time: new Date().toISOString(),
  output_fields: {
    'container.id': 'c1',
    'container.image.repository': 'reg/app',
    'k8s.ns.name': 'prod',
    'k8s.pod.name': 'web-1',
  },
};

beforeEach(() => jest.clearAllMocks());

describe('falcoHandler SOAR dispatch', () => {
  it('creates an approved action and enqueues for auto execution', async () => {
    repo.listPlaybooks.mockResolvedValue([{
      id: 'pb-1', name: 'p', enabled: true,
      trigger: { rulePattern: 'Terminal shell*', minPriority: 'Warning' },
      actions: [{ type: 'capture_evidence', mode: 'auto' }],
    }]);
    repo.createAction.mockResolvedValue({ id: 'act-1' } as never);

    await handleFalcoEvent(event);

    expect(repo.createAction).toHaveBeenCalledWith(expect.objectContaining({
      status: 'approved', actionType: 'capture_evidence', namespace: 'prod', podName: 'web-1',
    }));
    expect(enqueueSoarAction).toHaveBeenCalledWith(expect.objectContaining({ actionId: 'act-1' }));
  });

  it('creates a pending action without enqueueing for approval-gated steps', async () => {
    repo.listPlaybooks.mockResolvedValue([{
      id: 'pb-1', name: 'p', enabled: true,
      trigger: { minPriority: 'Warning' },
      actions: [{ type: 'kill_pod', mode: 'approval' }],
    }]);
    repo.createAction.mockResolvedValue({ id: 'act-2' } as never);

    await handleFalcoEvent(event);

    expect(repo.createAction).toHaveBeenCalledWith(expect.objectContaining({ status: 'pending' }));
    expect(enqueueSoarAction).not.toHaveBeenCalled();
  });

  it('SOAR failure never breaks the incident path', async () => {
    repo.listPlaybooks.mockRejectedValue(new Error('boom'));
    await expect(handleFalcoEvent(event)).resolves.toBeUndefined();
  });
});
```

Note: the `falcoRuleRepository` virtual mock exists so this test keeps passing after Task 8 adds classification; if Jest complains about a virtual mock for a module that doesn't exist yet, drop that `jest.mock` line for now and re-add it in Task 8.

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest src/runtime/falcoHandler.soar.test.ts` → FAIL (no SOAR dispatch happens yet — `createAction` never called).

- [ ] **Step 3: Implement** — apply the wiring shown in the Interfaces block above to `backend/src/runtime/falcoHandler.ts` (imports at top, `dispatchSoar` function at bottom, one call after incident creation).

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest src/runtime/falcoHandler.soar.test.ts` → PASS. Full suite + tsc + lint → green (existing falcoHandler tests, if any, must still pass).

- [ ] **Step 5: Commit**

```bash
git add backend/src/runtime/falcoHandler.ts backend/src/runtime/falcoHandler.soar.test.ts
git commit -m "feat(soar): dispatch playbook actions from Falco ingestion"
```

---

### Task 7: Falco rule catalog + YAML renderer (pure)

**Files:**
- Create: `backend/src/runtime/falcoRuleCatalog.ts`
- Test: `backend/src/runtime/falcoRuleCatalog.test.ts`

**Interfaces:**
- Consumes: nothing (pure module).
- Produces:
  - `type FalcoTemplateId = 'terminal-shell-in-container' | 'outbound-unknown-domain' | 'write-below-etc' | 'sensitive-file-read' | 'spawn-package-manager'`
  - `interface ManagedFalcoRule { id: string; template: FalcoTemplateId; params: { allowedProcs?: string[]; allowedDomains?: string[]; watchedPaths?: string[] }; appScope?: string; severityOverride?: FalcoPriority; suppressed: boolean; enabled: boolean }` (imports `FalcoPriority` from `../soar/playbookMatcher`)
  - `FALCO_TEMPLATES: Record<FalcoTemplateId, { falcoRuleName: string; description: string }>` — maps template → the Falco rule name events arrive with
  - `renderFalcoRules(rules: ManagedFalcoRule[]): string` — YAML for `falco_rules.local.yaml`; suppressed or disabled rules are NOT rendered
  - `classifyEvent(event: { rule: string; containerImage: string }, rules: ManagedFalcoRule[]): { suppressed: boolean; overridePriority?: FalcoPriority }` — matches on `falcoRuleName` (case-insensitive) + `appScope` prefix of the image; unknown rules → `{ suppressed: false }`

- [ ] **Step 1: Write the failing test**

```typescript
// backend/src/runtime/falcoRuleCatalog.test.ts
import { renderFalcoRules, classifyEvent, ManagedFalcoRule } from './falcoRuleCatalog';

const rule = (over: Partial<ManagedFalcoRule> = {}): ManagedFalcoRule => ({
  id: 'r-1',
  template: 'terminal-shell-in-container',
  params: {},
  suppressed: false,
  enabled: true,
  ...over,
});

describe('renderFalcoRules', () => {
  it('renders an enabled rule as Falco YAML', () => {
    const yaml = renderFalcoRules([rule()]);
    expect(yaml).toContain('- rule: Terminal shell in container');
    expect(yaml).toContain('condition:');
    expect(yaml).toContain('priority:');
  });

  it('excludes suppressed and disabled rules', () => {
    expect(renderFalcoRules([rule({ suppressed: true })])).not.toContain('- rule:');
    expect(renderFalcoRules([rule({ enabled: false })])).not.toContain('- rule:');
  });

  it('folds allowedProcs into the condition as exceptions', () => {
    const yaml = renderFalcoRules([rule({ params: { allowedProcs: ['tini', 'dumb-init'] } })]);
    expect(yaml).toContain('and not proc.name in (tini, dumb-init)');
  });

  it('renders outbound-unknown-domain with allowedDomains', () => {
    const yaml = renderFalcoRules([rule({
      template: 'outbound-unknown-domain',
      params: { allowedDomains: ['api.internal', 'sts.amazonaws.com'] },
    })]);
    expect(yaml).toContain('- rule: Unexpected outbound connection destination');
    expect(yaml).toContain('api.internal');
  });

  it('renders an empty rules header when nothing is enabled', () => {
    expect(renderFalcoRules([])).toContain('# Scorpion-managed Falco rules');
  });
});

describe('classifyEvent', () => {
  it('suppresses a matching suppressed rule', () => {
    const out = classifyEvent(
      { rule: 'Terminal shell in container', containerImage: 'reg/app' },
      [rule({ suppressed: true })],
    );
    expect(out.suppressed).toBe(true);
  });

  it('respects appScope image prefix', () => {
    const scoped = rule({ suppressed: true, appScope: 'reg/batch-' });
    expect(classifyEvent({ rule: 'Terminal shell in container', containerImage: 'reg/batch-job' }, [scoped]).suppressed).toBe(true);
    expect(classifyEvent({ rule: 'Terminal shell in container', containerImage: 'reg/web' }, [scoped]).suppressed).toBe(false);
  });

  it('returns severity override for a matching rule', () => {
    const out = classifyEvent(
      { rule: 'Terminal shell in container', containerImage: 'reg/app' },
      [rule({ severityOverride: 'Critical' })],
    );
    expect(out.overridePriority).toBe('Critical');
  });

  it('never suppresses unknown rules', () => {
    expect(classifyEvent({ rule: 'Some brand new rule', containerImage: 'x' }, [rule({ suppressed: true })]).suppressed).toBe(false);
  });

  it('disabled rules do not classify', () => {
    const out = classifyEvent(
      { rule: 'Terminal shell in container', containerImage: 'reg/app' },
      [rule({ suppressed: true, enabled: false })],
    );
    expect(out.suppressed).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest src/runtime/falcoRuleCatalog.test.ts` → FAIL, module not found.

- [ ] **Step 3: Write minimal implementation**

```typescript
// backend/src/runtime/falcoRuleCatalog.ts
import type { FalcoPriority } from '../soar/playbookMatcher';

/**
 * Fixed Falco rule template catalog + pure YAML renderer + ingestion
 * classifier. Scorpion never pushes rules to the cluster; the rendered YAML is
 * exported for ConfigMap sync. Unknown rules are never suppressed (fail-open
 * on detection, fail-closed on silence).
 */

export type FalcoTemplateId =
  | 'terminal-shell-in-container'
  | 'outbound-unknown-domain'
  | 'write-below-etc'
  | 'sensitive-file-read'
  | 'spawn-package-manager';

export interface ManagedFalcoRule {
  id: string;
  template: FalcoTemplateId;
  params: { allowedProcs?: string[]; allowedDomains?: string[]; watchedPaths?: string[] };
  /** Container image prefix this rule applies to; empty/undefined = global. */
  appScope?: string;
  severityOverride?: FalcoPriority;
  suppressed: boolean;
  enabled: boolean;
}

interface TemplateDef {
  falcoRuleName: string;
  description: string;
  priority: FalcoPriority;
  baseCondition: string;
  output: string;
}

export const FALCO_TEMPLATES: Record<FalcoTemplateId, TemplateDef> = {
  'terminal-shell-in-container': {
    falcoRuleName: 'Terminal shell in container',
    description: 'Interactive shell spawned inside a running container.',
    priority: 'Critical',
    baseCondition: 'spawned_process and container and shell_procs and proc.tty != 0',
    output: 'Shell in container (user=%user.name container=%container.id image=%container.image.repository cmdline=%proc.cmdline)',
  },
  'outbound-unknown-domain': {
    falcoRuleName: 'Unexpected outbound connection destination',
    description: 'Outbound network connection to a destination outside the allowlist.',
    priority: 'Warning',
    baseCondition: 'outbound and container',
    output: 'Unexpected outbound connection (container=%container.id image=%container.image.repository connection=%fd.name)',
  },
  'write-below-etc': {
    falcoRuleName: 'Write below etc',
    description: 'File write under /etc inside a container.',
    priority: 'Error',
    baseCondition: "open_write and container and fd.name startswith /etc",
    output: 'Write below /etc (file=%fd.name container=%container.id image=%container.image.repository)',
  },
  'sensitive-file-read': {
    falcoRuleName: 'Read sensitive file untrusted',
    description: 'Read of shadow/ssh/cloud-credential files by a non-trusted program.',
    priority: 'Critical',
    baseCondition: 'open_read and container and sensitive_files',
    output: 'Sensitive file read (file=%fd.name container=%container.id image=%container.image.repository proc=%proc.name)',
  },
  'spawn-package-manager': {
    falcoRuleName: 'Launch package management process in container',
    description: 'apt/yum/apk/pip executed inside a running container.',
    priority: 'Error',
    baseCondition: 'spawned_process and container and proc.name in (apt, apt-get, yum, dnf, apk, pip, pip3)',
    output: 'Package manager launched (proc=%proc.name container=%container.id image=%container.image.repository cmdline=%proc.cmdline)',
  },
};

function conditionFor(rule: ManagedFalcoRule, def: TemplateDef): string {
  const parts = [def.baseCondition];
  if (rule.params.allowedProcs?.length) {
    parts.push(`and not proc.name in (${rule.params.allowedProcs.join(', ')})`);
  }
  if (rule.template === 'outbound-unknown-domain' && rule.params.allowedDomains?.length) {
    parts.push(`and not fd.sip.name in (${rule.params.allowedDomains.join(', ')})`);
  }
  if (rule.template === 'write-below-etc' && rule.params.watchedPaths?.length) {
    const extra = rule.params.watchedPaths.map((p) => `fd.name startswith ${p}`).join(' or ');
    parts.push(`or (open_write and container and (${extra}))`);
  }
  return parts.join(' ');
}

export function renderFalcoRules(rules: ManagedFalcoRule[]): string {
  const header = '# Scorpion-managed Falco rules — generated, do not edit by hand.\n';
  const blocks = rules
    .filter((r) => r.enabled && !r.suppressed)
    .map((r) => {
      const def = FALCO_TEMPLATES[r.template];
      const priority = r.severityOverride ?? def.priority;
      return [
        `- rule: ${def.falcoRuleName}`,
        `  desc: ${def.description}`,
        `  condition: ${conditionFor(r, def)}`,
        `  output: >`,
        `    ${def.output}`,
        `  priority: ${priority.toUpperCase()}`,
        `  tags: [scorpion_managed, runtime_defense]`,
      ].join('\n');
    });
  return header + blocks.join('\n\n') + (blocks.length ? '\n' : '');
}

export function classifyEvent(
  event: { rule: string; containerImage: string },
  rules: ManagedFalcoRule[],
): { suppressed: boolean; overridePriority?: FalcoPriority } {
  const match = rules.find((r) => {
    if (!r.enabled) return false;
    const def = FALCO_TEMPLATES[r.template];
    if (def.falcoRuleName.toLowerCase() !== event.rule.toLowerCase()) return false;
    if (r.appScope && !event.containerImage.startsWith(r.appScope)) return false;
    return true;
  });
  if (!match) return { suppressed: false };
  return { suppressed: match.suppressed, overridePriority: match.severityOverride };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest src/runtime/falcoRuleCatalog.test.ts` → PASS. tsc + lint clean.

- [ ] **Step 5: Commit**

```bash
git add backend/src/runtime/falcoRuleCatalog.ts backend/src/runtime/falcoRuleCatalog.test.ts
git commit -m "feat(falco): add rule template catalog, YAML renderer, and event classifier"
```

---

### Task 8: Falco rule repository + ingestion classification

**Files:**
- Create: `backend/src/repositories/falcoRuleRepository.ts` (no dedicated test — same mechanical Appwrite mapping as Task 2; covered through route tests in Task 9)
- Modify: `backend/src/runtime/falcoHandler.ts`
- Test: create `backend/src/runtime/falcoHandler.classify.test.ts`

**Interfaces:**
- Consumes: `ManagedFalcoRule` from `../runtime/falcoRuleCatalog`.
- Produces:
  - `falcoRuleRepository.listRules(): Promise<ManagedFalcoRule[]>` — `[]` on Appwrite failure (classification then no-ops; detection fails open to the existing incident path)
  - `falcoRuleRepository.createRule(r: Omit<ManagedFalcoRule, 'id'>): Promise<ManagedFalcoRule>`
  - `falcoRuleRepository.updateRule(id: string, r: Partial<Omit<ManagedFalcoRule, 'id'>>): Promise<void>`
  - falcoHandler behavior: at the very top of `handleFalcoEvent`, classify; suppressed → `auditLog({ action: 'falco.event.suppressed', ... })` and return (no incident, no SOAR); `overridePriority` replaces `event.priority` for everything downstream.

Repository implementation (Appwrite collection `falco_rules`, columns: `template`, `params` JSON-string, `appScope`, `severityOverride`, `suppressed`, `enabled`):

```typescript
// backend/src/repositories/falcoRuleRepository.ts
import type { Models } from 'node-appwrite';
import { databases, DB_ID, ID, Query } from '../lib/appwrite';
import { logger } from '../services/logger';
import type { ManagedFalcoRule } from '../runtime/falcoRuleCatalog';

const COLLECTION = 'falco_rules';

interface RuleWire {
  template: ManagedFalcoRule['template'];
  params: string;
  appScope?: string | null;
  severityOverride?: ManagedFalcoRule['severityOverride'] | null;
  suppressed: boolean;
  enabled: boolean;
}

function fromDoc(doc: Models.Document): ManagedFalcoRule {
  const w = doc as unknown as RuleWire & Models.Document;
  return {
    id: doc.$id,
    template: w.template,
    params: JSON.parse(w.params || '{}') as ManagedFalcoRule['params'],
    appScope: w.appScope ?? undefined,
    severityOverride: w.severityOverride ?? undefined,
    suppressed: w.suppressed,
    enabled: w.enabled,
  };
}

export const falcoRuleRepository = {
  /** [] on failure — never suppress or reprioritize when config is unreadable. */
  async listRules(): Promise<ManagedFalcoRule[]> {
    try {
      const list = await databases.listDocuments(DB_ID, COLLECTION, [Query.limit(200)]);
      return list.documents.map(fromDoc);
    } catch (err) {
      logger.warn('[FalcoRuleRepository] load failed:', err instanceof Error ? err.message : String(err));
      return [];
    }
  },

  async createRule(r: Omit<ManagedFalcoRule, 'id'>): Promise<ManagedFalcoRule> {
    const doc = await databases.createDocument(DB_ID, COLLECTION, ID.unique(), {
      template: r.template,
      params: JSON.stringify(r.params),
      appScope: r.appScope ?? null,
      severityOverride: r.severityOverride ?? null,
      suppressed: r.suppressed,
      enabled: r.enabled,
    });
    return { ...r, id: doc.$id };
  },

  async updateRule(id: string, r: Partial<Omit<ManagedFalcoRule, 'id'>>): Promise<void> {
    const patch: Record<string, unknown> = {};
    if (r.template !== undefined) patch.template = r.template;
    if (r.params !== undefined) patch.params = JSON.stringify(r.params);
    if (r.appScope !== undefined) patch.appScope = r.appScope ?? null;
    if (r.severityOverride !== undefined) patch.severityOverride = r.severityOverride ?? null;
    if (r.suppressed !== undefined) patch.suppressed = r.suppressed;
    if (r.enabled !== undefined) patch.enabled = r.enabled;
    await databases.updateDocument(DB_ID, COLLECTION, id, patch);
  },
};
```

falcoHandler classification wiring — first lines of `handleFalcoEvent`, before any existing logic:

```typescript
import { classifyEvent } from './falcoRuleCatalog';
import { falcoRuleRepository } from '../repositories/falcoRuleRepository';

  // --- classification gate (Component 2) ---
  const managedRules = await falcoRuleRepository.listRules();
  const classification = classifyEvent(
    { rule: event.rule, containerImage: event.output_fields?.['container.image.repository'] || 'unknown' },
    managedRules,
  );
  if (classification.suppressed) {
    await auditLog({
      action: 'falco.event.suppressed',
      actor: 'system',
      actorEmail: 'system@scorpion',
      resource: 'falco_event',
      details: { rule: event.rule, image: event.output_fields?.['container.image.repository'] ?? 'unknown' },
    }).catch(() => undefined);
    logger.info(`[Falco Handler] Suppressed event '${event.rule}' by managed rule`);
    return;
  }
  if (classification.overridePriority) {
    event = { ...event, priority: classification.overridePriority };
  }
```

(`event` is a parameter — reassigning via spread keeps the original immutable; alternatively bind to a new `const effectiveEvent` and use it throughout the function. Prefer the `const effectiveEvent` form if reassignment trips the linter.)

- [ ] **Step 1: Write the failing test**

```typescript
// backend/src/runtime/falcoHandler.classify.test.ts
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
jest.mock('../services/auditService', () => ({ auditLog: jest.fn() }));
jest.mock('../services/slackService', () => ({ sendSlackNotification: jest.fn() }));
jest.mock('../services/logger', () => ({ logger: { warn: jest.fn(), info: jest.fn(), error: jest.fn() } }));
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
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest src/runtime/falcoHandler.classify.test.ts` → FAIL (falcoRuleRepository doesn't exist / no classification behavior).

- [ ] **Step 3: Implement** — create the repository file and apply the falcoHandler wiring exactly as shown in the Interfaces block. Also update `falcoHandler.soar.test.ts` (Task 6) if its virtual mock now conflicts — make it a real (non-virtual) mock returning `listRules: [] `.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest src/runtime` → both falcoHandler test files PASS. Full suite + tsc + lint green.

- [ ] **Step 5: Commit**

```bash
git add backend/src/repositories/falcoRuleRepository.ts backend/src/runtime/falcoHandler.ts backend/src/runtime/falcoHandler.classify.test.ts backend/src/runtime/falcoHandler.soar.test.ts
git commit -m "feat(falco): classify ingested events against managed rules (suppression + severity override)"
```

---

### Task 9: Falco rule routes (CRUD + YAML export) + mount

**Files:**
- Create: `backend/src/routes/falcoRuleRoutes.ts`
- Test: `backend/src/routes/falcoRuleRoutes.test.ts`
- Modify: `backend/src/index.ts` (import + mount)

**Interfaces:**
- Consumes: `falcoRuleRepository` (Task 8), `renderFalcoRules` + `FALCO_TEMPLATES` (Task 7), `requireRole`.
- Produces (mounted at `/api/falco-rules`, `authenticate` + `requireRole('admin', 'security')`):
  - `GET /` → `{ rules, templates }` (templates so the UI can render the catalog)
  - `POST /` (zod-validated `ManagedFalcoRule` minus id) → 201
  - `PATCH /:id` → partial update
  - `GET /export` → `Content-Type: text/yaml`, body = `renderFalcoRules(rules)`

- [ ] **Step 1: Write the failing test**

```typescript
// backend/src/routes/falcoRuleRoutes.test.ts
import request from 'supertest';
import express, { Request } from 'express';

jest.mock('../repositories/falcoRuleRepository', () => ({
  falcoRuleRepository: { listRules: jest.fn(), createRule: jest.fn(), updateRule: jest.fn() },
}));
jest.mock('../middleware/requireRole', () => ({
  requireRole: () => (_req: Request, _res: unknown, next: () => void) => next(),
}));
jest.mock('../services/logger', () => ({ logger: { warn: jest.fn(), info: jest.fn(), error: jest.fn() } }));

import falcoRuleRoutes from './falcoRuleRoutes';
import { falcoRuleRepository } from '../repositories/falcoRuleRepository';

const repo = falcoRuleRepository as jest.Mocked<typeof falcoRuleRepository>;

const buildApp = () => {
  const app = express();
  app.use(express.json());
  app.use('/api/falco-rules', falcoRuleRoutes);
  return app;
};

const validRule = {
  template: 'terminal-shell-in-container',
  params: { allowedProcs: ['tini'] },
  suppressed: false,
  enabled: true,
};

beforeEach(() => jest.clearAllMocks());

describe('falcoRuleRoutes', () => {
  it('GET / returns rules and the template catalog', async () => {
    repo.listRules.mockResolvedValue([]);
    const res = await request(buildApp()).get('/api/falco-rules');
    expect(res.statusCode).toBe(200);
    expect(res.body.templates['terminal-shell-in-container'].falcoRuleName).toBe('Terminal shell in container');
  });

  it('POST / creates a rule', async () => {
    repo.createRule.mockResolvedValue({ id: 'r-1', ...validRule } as never);
    const res = await request(buildApp()).post('/api/falco-rules').send(validRule);
    expect(res.statusCode).toBe(201);
  });

  it('POST / rejects unknown template with 400', async () => {
    const res = await request(buildApp()).post('/api/falco-rules').send({ ...validRule, template: 'nope' });
    expect(res.statusCode).toBe(400);
    expect(repo.createRule).not.toHaveBeenCalled();
  });

  it('GET /export returns YAML with text/yaml content type', async () => {
    repo.listRules.mockResolvedValue([{ id: 'r-1', ...validRule }] as never);
    const res = await request(buildApp()).get('/api/falco-rules/export');
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toContain('text/yaml');
    expect(res.text).toContain('- rule: Terminal shell in container');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest src/routes/falcoRuleRoutes.test.ts` → FAIL, module not found.

- [ ] **Step 3: Write minimal implementation**

```typescript
// backend/src/routes/falcoRuleRoutes.ts
import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { falcoRuleRepository } from '../repositories/falcoRuleRepository';
import { renderFalcoRules, FALCO_TEMPLATES } from '../runtime/falcoRuleCatalog';
import { requireRole } from '../middleware/requireRole';
import { logger } from '../services/logger';

const prioritySchema = z.enum(['Emergency', 'Alert', 'Critical', 'Error', 'Warning', 'Notice', 'Informational', 'Debug']);

const ruleSchema = z.object({
  template: z.enum(['terminal-shell-in-container', 'outbound-unknown-domain', 'write-below-etc', 'sensitive-file-read', 'spawn-package-manager']),
  params: z.object({
    allowedProcs: z.array(z.string().min(1).max(64)).max(50).optional(),
    allowedDomains: z.array(z.string().min(1).max(256)).max(50).optional(),
    watchedPaths: z.array(z.string().min(1).max(256)).max(50).optional(),
  }),
  appScope: z.string().min(1).max(512).optional(),
  severityOverride: prioritySchema.optional(),
  suppressed: z.boolean(),
  enabled: z.boolean(),
});

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : 'Unknown error';
}

const router = Router();
router.use(requireRole('admin', 'security'));

router.get('/', async (_req: Request, res: Response) => {
  res.json({ rules: await falcoRuleRepository.listRules(), templates: FALCO_TEMPLATES });
});

// Declared before any '/:id'-style route so 'export' is never captured as an id.
router.get('/export', async (_req: Request, res: Response) => {
  try {
    const rules = await falcoRuleRepository.listRules();
    res.type('text/yaml').send(renderFalcoRules(rules));
  } catch (err) {
    logger.error('[FalcoRules API] export failed:', errorMessage(err));
    res.status(500).json({ error: 'Failed to render rules' });
  }
});

router.post('/', async (req: Request, res: Response) => {
  const parsed = ruleSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: 'Invalid rule', details: parsed.error.flatten() });
  }
  try {
    res.status(201).json({ rule: await falcoRuleRepository.createRule(parsed.data) });
  } catch (err) {
    logger.error('[FalcoRules API] create failed:', errorMessage(err));
    res.status(500).json({ error: 'Failed to create rule' });
  }
});

router.patch('/:id', async (req: Request, res: Response) => {
  const parsed = ruleSchema.partial().safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: 'Invalid rule update', details: parsed.error.flatten() });
  }
  try {
    await falcoRuleRepository.updateRule(req.params.id, parsed.data);
    res.json({ status: 'updated' });
  } catch (err) {
    logger.error('[FalcoRules API] update failed:', errorMessage(err));
    res.status(500).json({ error: 'Failed to update rule' });
  }
});

export default router;
```

`backend/src/index.ts`: `import falcoRuleRoutes from './routes/falcoRuleRoutes';` + `app.use('/api/falco-rules', authenticate, falcoRuleRoutes);` next to the other mounts (near line 309).

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest src/routes/falcoRuleRoutes.test.ts` → PASS. Full suite + tsc + lint green.

- [ ] **Step 5: Commit**

```bash
git add backend/src/routes/falcoRuleRoutes.ts backend/src/routes/falcoRuleRoutes.test.ts backend/src/index.ts
git commit -m "feat(falco): add managed-rule CRUD and falco_rules.local.yaml export routes"
```

---

### Task 10: CSPM posture checks (pure)

**Files:**
- Create: `backend/src/posture/postureChecks.ts`
- Test: `backend/src/posture/postureChecks.test.ts`

**Interfaces:**
- Consumes: nothing (pure module).
- Produces:
  - `type PostureSeverity = 'critical' | 'high' | 'medium' | 'low'`
  - `interface PostureContainer { name: string; image: string; privileged: boolean; runAsNonRoot?: boolean; hasCpuLimit: boolean; hasMemoryLimit: boolean; envVars: { name: string; hasLiteralValue: boolean }[] }`
  - `interface PodPosture { namespace: string; podName: string; serviceAccountName: string; automountServiceAccountToken?: boolean; hostPathVolumes: string[]; containers: PostureContainer[] }`
  - `interface NamespacePosture { name: string; podCount: number; networkPolicyCount: number }`
  - `interface ClusterSnapshot { pods: PodPosture[]; namespaces: NamespacePosture[] }`
  - `interface PostureFinding { checkId: string; severity: PostureSeverity; namespace: string; resource: string; reason: string }`
  - `runPostureChecks(snapshot: ClusterSnapshot): PostureFinding[]`
  - `scoreNamespace(findings: PostureFinding[]): number` — 100 minus severity weights (critical 25, high 15, medium 8, low 3), floor 0

- [ ] **Step 1: Write the failing test**

```typescript
// backend/src/posture/postureChecks.test.ts
import { runPostureChecks, scoreNamespace, ClusterSnapshot, PodPosture, PostureContainer } from './postureChecks';

const container = (over: Partial<PostureContainer> = {}): PostureContainer => ({
  name: 'app', image: 'reg/app:1.2.3', privileged: false, runAsNonRoot: true,
  hasCpuLimit: true, hasMemoryLimit: true, envVars: [], ...over,
});

const pod = (over: Partial<PodPosture> = {}): PodPosture => ({
  namespace: 'prod', podName: 'web-1', serviceAccountName: 'web-sa',
  automountServiceAccountToken: false, hostPathVolumes: [], containers: [container()],
  ...over,
});

const snapshot = (pods: PodPosture[], nsOver: Partial<ClusterSnapshot['namespaces'][number]> = {}): ClusterSnapshot => ({
  pods,
  namespaces: [{ name: 'prod', podCount: pods.length, networkPolicyCount: 1, ...nsOver }],
});

const ids = (s: ClusterSnapshot) => runPostureChecks(s).map((f) => f.checkId);

describe('runPostureChecks', () => {
  it('clean snapshot yields no findings', () => {
    expect(runPostureChecks(snapshot([pod()]))).toEqual([]);
  });

  it('flags privileged containers as critical', () => {
    const out = runPostureChecks(snapshot([pod({ containers: [container({ privileged: true })] })]));
    expect(out).toContainEqual(expect.objectContaining({ checkId: 'privileged-pod-running', severity: 'critical' }));
  });

  it('flags hostPath mounts', () => {
    expect(ids(snapshot([pod({ hostPathVolumes: ['/var/run/docker.sock'] })]))).toContain('hostpath-mounted');
  });

  it('flags default SA with token automount', () => {
    const p = pod({ serviceAccountName: 'default', automountServiceAccountToken: true });
    expect(ids(snapshot([p]))).toContain('default-sa-token-automounted');
  });

  it('does not flag default SA when automount is explicitly off', () => {
    const p = pod({ serviceAccountName: 'default', automountServiceAccountToken: false });
    expect(ids(snapshot([p]))).not.toContain('default-sa-token-automounted');
  });

  it('flags missing resource limits', () => {
    const p = pod({ containers: [container({ hasCpuLimit: false })] });
    expect(ids(snapshot([p]))).toContain('no-resource-limits');
  });

  it('flags :latest and untagged images, not digest-pinned ones', () => {
    expect(ids(snapshot([pod({ containers: [container({ image: 'reg/app:latest' })] })]))).toContain('latest-image-tag');
    expect(ids(snapshot([pod({ containers: [container({ image: 'reg/app' })] })]))).toContain('latest-image-tag');
    expect(ids(snapshot([pod({ containers: [container({ image: 'reg/app@sha256:abc' })] })]))).not.toContain('latest-image-tag');
  });

  it('flags containers without runAsNonRoot', () => {
    expect(ids(snapshot([pod({ containers: [container({ runAsNonRoot: undefined })] })]))).toContain('runs-as-root');
    expect(ids(snapshot([pod({ containers: [container({ runAsNonRoot: false })] })]))).toContain('runs-as-root');
  });

  it('flags namespaces with pods but no NetworkPolicy', () => {
    expect(ids(snapshot([pod()], { networkPolicyCount: 0 }))).toContain('namespace-without-networkpolicy');
  });

  it('does not flag empty namespaces without NetworkPolicy', () => {
    const s: ClusterSnapshot = { pods: [], namespaces: [{ name: 'empty', podCount: 0, networkPolicyCount: 0 }] };
    expect(runPostureChecks(s)).toEqual([]);
  });

  it('flags secret-looking env vars with literal values', () => {
    const p = pod({ containers: [container({ envVars: [{ name: 'DB_PASSWORD', hasLiteralValue: true }] })] });
    expect(ids(snapshot([p]))).toContain('secret-in-env');
  });

  it('does not flag secret env vars sourced from secretKeyRef', () => {
    const p = pod({ containers: [container({ envVars: [{ name: 'DB_PASSWORD', hasLiteralValue: false }] })] });
    expect(ids(snapshot([p]))).not.toContain('secret-in-env');
  });
});

describe('scoreNamespace', () => {
  it('perfect namespace scores 100', () => expect(scoreNamespace([])).toBe(100));
  it('weights severities and floors at 0', () => {
    const critical = { checkId: 'x', severity: 'critical' as const, namespace: 'prod', resource: 'r', reason: 'z' };
    expect(scoreNamespace([critical])).toBe(75);
    expect(scoreNamespace(Array.from({ length: 10 }, () => critical))).toBe(0);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest src/posture/postureChecks.test.ts` → FAIL, module not found.

- [ ] **Step 3: Write minimal implementation**

```typescript
// backend/src/posture/postureChecks.ts
/**
 * CSPM posture core: fixed CIS-flavored checks evaluated against an immutable
 * cluster snapshot. Pure — the k8s client lives in the scanner worker.
 */

export type PostureSeverity = 'critical' | 'high' | 'medium' | 'low';

export interface PostureContainer {
  name: string;
  image: string;
  privileged: boolean;
  runAsNonRoot?: boolean;
  hasCpuLimit: boolean;
  hasMemoryLimit: boolean;
  envVars: { name: string; hasLiteralValue: boolean }[];
}

export interface PodPosture {
  namespace: string;
  podName: string;
  serviceAccountName: string;
  automountServiceAccountToken?: boolean;
  hostPathVolumes: string[];
  containers: PostureContainer[];
}

export interface NamespacePosture { name: string; podCount: number; networkPolicyCount: number }
export interface ClusterSnapshot { pods: PodPosture[]; namespaces: NamespacePosture[] }

export interface PostureFinding {
  checkId: string;
  severity: PostureSeverity;
  namespace: string;
  resource: string;
  reason: string;
}

const SECRET_ENV_PATTERN = /(SECRET|TOKEN|PASSWORD|PASSWD|API_?KEY|PRIVATE_?KEY|CREDENTIAL)/i;

type PodCheck = (pod: PodPosture) => PostureFinding[];

const finding = (
  checkId: string, severity: PostureSeverity, namespace: string, resource: string, reason: string,
): PostureFinding => ({ checkId, severity, namespace, resource, reason });

const podResource = (pod: PodPosture, container?: string) =>
  container ? `${pod.namespace}/${pod.podName}/${container}` : `${pod.namespace}/${pod.podName}`;

const checkPrivileged: PodCheck = (pod) =>
  pod.containers
    .filter((c) => c.privileged)
    .map((c) => finding('privileged-pod-running', 'critical', pod.namespace, podResource(pod, c.name),
      `container '${c.name}' runs privileged`));

const checkHostPath: PodCheck = (pod) =>
  pod.hostPathVolumes.map((v) => finding('hostpath-mounted', 'high', pod.namespace, podResource(pod),
    `hostPath volume '${v}' mounted`));

const checkDefaultSaToken: PodCheck = (pod) =>
  pod.serviceAccountName === 'default' && pod.automountServiceAccountToken !== false
    ? [finding('default-sa-token-automounted', 'medium', pod.namespace, podResource(pod),
        'default service account token is automounted')]
    : [];

const checkResourceLimits: PodCheck = (pod) =>
  pod.containers
    .filter((c) => !c.hasCpuLimit || !c.hasMemoryLimit)
    .map((c) => finding('no-resource-limits', 'low', pod.namespace, podResource(pod, c.name),
      `container '${c.name}' lacks cpu/memory limits`));

const checkLatestTag: PodCheck = (pod) =>
  pod.containers
    .filter((c) => !c.image.includes('@sha256:') && (c.image.endsWith(':latest') || !c.image.includes(':')))
    .map((c) => finding('latest-image-tag', 'medium', pod.namespace, podResource(pod, c.name),
      `image '${c.image}' is not pinned`));

const checkRunAsRoot: PodCheck = (pod) =>
  pod.containers
    .filter((c) => c.runAsNonRoot !== true)
    .map((c) => finding('runs-as-root', 'high', pod.namespace, podResource(pod, c.name),
      `container '${c.name}' does not enforce runAsNonRoot`));

const checkSecretInEnv: PodCheck = (pod) =>
  pod.containers.flatMap((c) =>
    c.envVars
      .filter((e) => e.hasLiteralValue && SECRET_ENV_PATTERN.test(e.name))
      .map((e) => finding('secret-in-env', 'high', pod.namespace, podResource(pod, c.name),
        `env var '${e.name}' carries a literal secret-like value`)));

const POD_CHECKS: PodCheck[] = [
  checkPrivileged, checkHostPath, checkDefaultSaToken, checkResourceLimits,
  checkLatestTag, checkRunAsRoot, checkSecretInEnv,
];

export function runPostureChecks(snapshot: ClusterSnapshot): PostureFinding[] {
  const podFindings = snapshot.pods.flatMap((pod) => POD_CHECKS.flatMap((check) => check(pod)));
  const nsFindings = snapshot.namespaces
    .filter((ns) => ns.podCount > 0 && ns.networkPolicyCount === 0)
    .map((ns) => finding('namespace-without-networkpolicy', 'high', ns.name, ns.name,
      'namespace runs pods with no NetworkPolicy (flat network)'));
  return [...podFindings, ...nsFindings];
}

const SEVERITY_WEIGHT: Record<PostureSeverity, number> = { critical: 25, high: 15, medium: 8, low: 3 };

export function scoreNamespace(findings: PostureFinding[]): number {
  const penalty = findings.reduce((sum, f) => sum + SEVERITY_WEIGHT[f.severity], 0);
  return Math.max(0, 100 - penalty);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest src/posture/postureChecks.test.ts` → PASS. tsc + lint clean.

- [ ] **Step 5: Commit**

```bash
git add backend/src/posture/postureChecks.ts backend/src/posture/postureChecks.test.ts
git commit -m "feat(posture): add pure CIS-style posture checks and namespace scoring"
```

---

### Task 11: Posture scanner worker + repository

**Files:**
- Create: `backend/src/workers/postureScanner.ts`
- Create: `backend/src/repositories/postureRepository.ts`
- Test: `backend/src/workers/postureScanner.test.ts`
- Modify: `backend/src/index.ts` (start scanner next to where `driftMonitor` starts — search `driftMonitor` in index.ts and mirror its init/guard style, including any k8s-enabled env guard)

**Interfaces:**
- Consumes: `runPostureChecks`, `scoreNamespace`, `ClusterSnapshot` (Task 10).
- Produces:
  - `interface ClusterReader { readSnapshot(): Promise<ClusterSnapshot> }` (DIP seam)
  - `createClusterReader(): ClusterReader` — lists pods + namespaces + NetworkPolicies via `@kubernetes/client-node`; mapping fn `podToPosture(pod: V1Pod): PodPosture` exported for tests
  - `runPostureScan(reader: ClusterReader): Promise<void>` — snapshot → findings → grouped per namespace → `postureRepository.saveSnapshot`; cluster-read failure logs + returns
  - `startPostureScanner(reader?: ClusterReader): NodeJS.Timeout` — `setInterval`, `POSTURE_SCAN_INTERVAL_MS` env, default 300000
  - `postureRepository.saveSnapshot(namespaces: { namespace: string; score: number; findings: PostureFinding[] }[]): Promise<void>` — upsert per namespace into `posture_snapshots` (columns: `namespace`, `score`, `findings` JSON-string, `updatedAt`)
  - `postureRepository.listSnapshots(): Promise<NamespaceSnapshot[]>` where `interface NamespaceSnapshot { namespace: string; score: number; findings: PostureFinding[]; updatedAt: string }`

- [ ] **Step 1: Write the failing test**

```typescript
// backend/src/workers/postureScanner.test.ts
jest.mock('../repositories/postureRepository', () => ({
  postureRepository: { saveSnapshot: jest.fn(), listSnapshots: jest.fn() },
}));
jest.mock('../services/logger', () => ({ logger: { warn: jest.fn(), info: jest.fn(), error: jest.fn() } }));

import { runPostureScan, ClusterReader } from './postureScanner';
import { postureRepository } from '../repositories/postureRepository';

const repo = postureRepository as jest.Mocked<typeof postureRepository>;

beforeEach(() => jest.clearAllMocks());

describe('runPostureScan', () => {
  it('scores each namespace and persists grouped findings', async () => {
    const reader: ClusterReader = {
      readSnapshot: async () => ({
        pods: [{
          namespace: 'prod', podName: 'web-1', serviceAccountName: 'sa',
          automountServiceAccountToken: false, hostPathVolumes: [],
          containers: [{
            name: 'app', image: 'reg/app:latest', privileged: false, runAsNonRoot: true,
            hasCpuLimit: true, hasMemoryLimit: true, envVars: [],
          }],
        }],
        namespaces: [
          { name: 'prod', podCount: 1, networkPolicyCount: 1 },
          { name: 'clean', podCount: 0, networkPolicyCount: 0 },
        ],
      }),
    };

    await runPostureScan(reader);

    expect(repo.saveSnapshot).toHaveBeenCalledWith([
      expect.objectContaining({
        namespace: 'prod',
        score: 92, // one medium finding (latest-image-tag) = 100 - 8
        findings: [expect.objectContaining({ checkId: 'latest-image-tag' })],
      }),
      expect.objectContaining({ namespace: 'clean', score: 100, findings: [] }),
    ]);
  });

  it('reader failure is swallowed and logged, never thrown', async () => {
    const reader: ClusterReader = { readSnapshot: async () => { throw new Error('no cluster'); } };
    await expect(runPostureScan(reader)).resolves.toBeUndefined();
    expect(repo.saveSnapshot).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest src/workers/postureScanner.test.ts` → FAIL, module not found.

- [ ] **Step 3: Write minimal implementation**

```typescript
// backend/src/repositories/postureRepository.ts
import type { Models } from 'node-appwrite';
import { databases, DB_ID, ID, Query } from '../lib/appwrite';
import { logger } from '../services/logger';
import type { PostureFinding } from '../posture/postureChecks';

const COLLECTION = 'posture_snapshots';

export interface NamespaceSnapshot {
  namespace: string;
  score: number;
  findings: PostureFinding[];
  updatedAt: string;
}

interface SnapshotWire { namespace: string; score: number; findings: string; updatedAt: string }

function fromDoc(doc: Models.Document): NamespaceSnapshot {
  const w = doc as unknown as SnapshotWire & Models.Document;
  return {
    namespace: w.namespace,
    score: w.score,
    findings: JSON.parse(w.findings || '[]') as PostureFinding[],
    updatedAt: w.updatedAt,
  };
}

export const postureRepository = {
  /** Upsert one document per namespace. Never throws — a failed save loses one
   *  tick, not the scanner. */
  async saveSnapshot(namespaces: { namespace: string; score: number; findings: PostureFinding[] }[]): Promise<void> {
    const updatedAt = new Date().toISOString();
    for (const ns of namespaces) {
      const payload = {
        namespace: ns.namespace,
        score: ns.score,
        findings: JSON.stringify(ns.findings),
        updatedAt,
      };
      try {
        const existing = await databases.listDocuments(DB_ID, COLLECTION, [
          Query.equal('namespace', ns.namespace), Query.limit(1),
        ]);
        if (existing.documents.length > 0) {
          await databases.updateDocument(DB_ID, COLLECTION, existing.documents[0].$id, payload);
        } else {
          await databases.createDocument(DB_ID, COLLECTION, ID.unique(), payload);
        }
      } catch (err) {
        logger.warn(`[PostureRepository] save for '${ns.namespace}' failed:`,
          err instanceof Error ? err.message : String(err));
      }
    }
  },

  async listSnapshots(): Promise<NamespaceSnapshot[]> {
    const list = await databases.listDocuments(DB_ID, COLLECTION, [
      Query.orderDesc('updatedAt'), Query.limit(200),
    ]);
    return list.documents.map(fromDoc);
  },
};
```

```typescript
// backend/src/workers/postureScanner.ts
import * as k8s from '@kubernetes/client-node';
import { logger } from '../services/logger';
import {
  ClusterSnapshot, PodPosture, runPostureChecks, scoreNamespace,
} from '../posture/postureChecks';
import { postureRepository } from '../repositories/postureRepository';

/** DIP seam: check logic is pure; only this reader touches the cluster. */
export interface ClusterReader {
  readSnapshot(): Promise<ClusterSnapshot>;
}

const DEFAULT_INTERVAL_MS = Number(process.env.POSTURE_SCAN_INTERVAL_MS) || 300_000;

/** Maps a raw V1Pod to the pure check input. Exported for unit testing. */
export function podToPosture(pod: k8s.V1Pod): PodPosture {
  const spec = pod.spec;
  return {
    namespace: pod.metadata?.namespace ?? 'unknown',
    podName: pod.metadata?.name ?? 'unknown',
    serviceAccountName: spec?.serviceAccountName ?? 'default',
    automountServiceAccountToken: spec?.automountServiceAccountToken,
    hostPathVolumes: (spec?.volumes ?? [])
      .filter((v) => v.hostPath)
      .map((v) => v.hostPath?.path ?? v.name),
    containers: (spec?.containers ?? []).map((c) => ({
      name: c.name,
      image: c.image ?? '',
      privileged: c.securityContext?.privileged === true,
      runAsNonRoot: c.securityContext?.runAsNonRoot ?? spec?.securityContext?.runAsNonRoot,
      hasCpuLimit: Boolean(c.resources?.limits?.cpu),
      hasMemoryLimit: Boolean(c.resources?.limits?.memory),
      envVars: (c.env ?? []).map((e) => ({ name: e.name, hasLiteralValue: e.value !== undefined })),
    })),
  };
}

export function createClusterReader(): ClusterReader {
  const kc = new k8s.KubeConfig();
  kc.loadFromDefault();
  const core = kc.makeApiClient(k8s.CoreV1Api);
  const net = kc.makeApiClient(k8s.NetworkingV1Api);
  return {
    async readSnapshot() {
      const [pods, namespaces, policies] = await Promise.all([
        core.listPodForAllNamespaces(),
        core.listNamespace(),
        net.listNetworkPolicyForAllNamespaces(),
      ]);
      const policyCount = new Map<string, number>();
      for (const p of policies.items) {
        const ns = p.metadata?.namespace ?? '';
        policyCount.set(ns, (policyCount.get(ns) ?? 0) + 1);
      }
      const podCount = new Map<string, number>();
      for (const p of pods.items) {
        const ns = p.metadata?.namespace ?? '';
        podCount.set(ns, (podCount.get(ns) ?? 0) + 1);
      }
      return {
        pods: pods.items.map(podToPosture),
        namespaces: namespaces.items.map((n) => ({
          name: n.metadata?.name ?? 'unknown',
          podCount: podCount.get(n.metadata?.name ?? '') ?? 0,
          networkPolicyCount: policyCount.get(n.metadata?.name ?? '') ?? 0,
        })),
      };
    },
  };
}

/** One scan tick: snapshot → checks → per-namespace score → persist. */
export async function runPostureScan(reader: ClusterReader): Promise<void> {
  let snapshot: ClusterSnapshot;
  try {
    snapshot = await reader.readSnapshot();
  } catch (err) {
    logger.warn('[PostureScanner] cluster read failed, skipping tick:',
      err instanceof Error ? err.message : String(err));
    return;
  }
  const findings = runPostureChecks(snapshot);
  const grouped = snapshot.namespaces.map((ns) => {
    const nsFindings = findings.filter((f) => f.namespace === ns.name);
    return { namespace: ns.name, score: scoreNamespace(nsFindings), findings: nsFindings };
  });
  await postureRepository.saveSnapshot(grouped);
  logger.info(`[PostureScanner] scanned ${snapshot.namespaces.length} namespace(s), ${findings.length} finding(s)`);
}

export function startPostureScanner(reader: ClusterReader = createClusterReader()): NodeJS.Timeout {
  logger.info(`[PostureScanner] starting, interval ${DEFAULT_INTERVAL_MS}ms`);
  return setInterval(() => {
    runPostureScan(reader).catch((err) => logger.error('[PostureScanner] tick failed:', err));
  }, DEFAULT_INTERVAL_MS);
}
```

If the installed `@kubernetes/client-node` major version returns `res.body.items` instead of `res.items`, or takes positional args, match whatever `workers/driftMonitor.ts` does. In `index.ts`, start the scanner with the exact same enable-guard driftMonitor uses.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest src/workers/postureScanner.test.ts` → PASS. Full suite + tsc + lint green.

- [ ] **Step 5: Commit**

```bash
git add backend/src/workers/postureScanner.ts backend/src/repositories/postureRepository.ts backend/src/workers/postureScanner.test.ts backend/src/index.ts
git commit -m "feat(posture): add read-only cluster posture scanner with per-namespace scores"
```

---

### Task 12: Posture routes + mount

**Files:**
- Create: `backend/src/routes/postureRoutes.ts`
- Test: `backend/src/routes/postureRoutes.test.ts`
- Modify: `backend/src/index.ts` (mount `/api/posture` with `authenticate`)

**Interfaces:**
- Consumes: `postureRepository` (Task 11), `requireRole`.
- Produces: `GET /api/posture` → `{ success: true, data: NamespaceSnapshot[], meta: { total } }` (driftRoutes envelope), `requireRole('admin', 'security')`.

- [ ] **Step 1: Write the failing test**

```typescript
// backend/src/routes/postureRoutes.test.ts
import request from 'supertest';
import express, { Request, Response, NextFunction } from 'express';

jest.mock('../repositories/postureRepository', () => ({
  postureRepository: { listSnapshots: jest.fn() },
}));
jest.mock('../middleware/requireRole', () => ({
  requireRole: () => (_req: Request, _res: Response, next: NextFunction) => next(),
}));

import postureRoutes from './postureRoutes';
import { postureRepository } from '../repositories/postureRepository';

const repo = postureRepository as jest.Mocked<typeof postureRepository>;

const buildApp = () => {
  const app = express();
  app.use('/api/posture', postureRoutes);
  app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
    res.status(500).json({ error: err.message });
  });
  return app;
};

describe('postureRoutes', () => {
  it('GET / returns snapshots in the standard envelope', async () => {
    repo.listSnapshots.mockResolvedValue([
      { namespace: 'prod', score: 92, findings: [], updatedAt: 'now' },
    ]);
    const res = await request(buildApp()).get('/api/posture');
    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual({
      success: true,
      data: [{ namespace: 'prod', score: 92, findings: [], updatedAt: 'now' }],
      meta: { total: 1 },
    });
  });

  it('GET / surfaces repository failure as 500', async () => {
    repo.listSnapshots.mockRejectedValue(new Error('down'));
    const res = await request(buildApp()).get('/api/posture');
    expect(res.statusCode).toBe(500);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest src/routes/postureRoutes.test.ts` → FAIL, module not found.

- [ ] **Step 3: Write minimal implementation**

```typescript
// backend/src/routes/postureRoutes.ts
import { Router, Request, Response, NextFunction } from 'express';
import { postureRepository } from '../repositories/postureRepository';
import { requireRole } from '../middleware/requireRole';

const router = Router();

// Posture data reveals cluster weaknesses — same RBAC posture as driftRoutes.
router.use(requireRole('admin', 'security'));

// GET /api/posture — latest per-namespace posture snapshots.
router.get('/', async (_req: Request, res: Response, next: NextFunction) => {
  try {
    const data = await postureRepository.listSnapshots();
    res.json({ success: true, data, meta: { total: data.length } });
  } catch (err) {
    next(err);
  }
});

export default router;
```

`backend/src/index.ts`: `import postureRoutes from './routes/postureRoutes';` + `app.use('/api/posture', authenticate, postureRoutes);`

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest src/routes/postureRoutes.test.ts` → PASS. Full suite + tsc + lint green.

- [ ] **Step 5: Commit**

```bash
git add backend/src/routes/postureRoutes.ts backend/src/routes/postureRoutes.test.ts backend/src/index.ts
git commit -m "feat(posture): expose per-namespace posture snapshots via /api/posture"
```

---

### Task 13: NetworkPolicy generator (pure)

**Files:**
- Create: `backend/src/netpol/networkPolicyGenerator.ts`
- Test: `backend/src/netpol/networkPolicyGenerator.test.ts`

**Interfaces:**
- Consumes: nothing (pure module).
- Produces:
  - `interface ServiceFlow { from: string; to: string; port: number }` (`from`/`to` are `app` label values)
  - `generateNetworkPolicies(input: { namespace: string; flows: ServiceFlow[] }): string` — multi-document YAML: (1) `default-deny-all` Ingress+Egress on empty podSelector, (2) `allow-dns` egress to kube-dns port 53 UDP+TCP for all pods, (3) per flow an ingress policy on the target (`allow-<from>-to-<to>`) AND an egress policy on the source (`allow-egress-<from>-to-<to>`) — both are needed under default deny
  - Policy-name sanitization: lowercase, non-alphanumerics → `-` (DNS-1123)

- [ ] **Step 1: Write the failing test**

```typescript
// backend/src/netpol/networkPolicyGenerator.test.ts
import { generateNetworkPolicies } from './networkPolicyGenerator';

describe('generateNetworkPolicies', () => {
  const input = { namespace: 'prod', flows: [{ from: 'web', to: 'api', port: 8080 }] };

  it('emits default-deny-all covering ingress and egress', () => {
    const yaml = generateNetworkPolicies(input);
    expect(yaml).toContain('name: default-deny-all');
    expect(yaml).toContain('- Ingress');
    expect(yaml).toContain('- Egress');
  });

  it('emits a DNS egress allowance', () => {
    const yaml = generateNetworkPolicies(input);
    expect(yaml).toContain('name: allow-dns');
    expect(yaml).toContain('port: 53');
  });

  it('emits paired ingress+egress policies per flow', () => {
    const yaml = generateNetworkPolicies(input);
    expect(yaml).toContain('name: allow-web-to-api');
    expect(yaml).toContain('name: allow-egress-web-to-api');
    expect(yaml).toContain('app: web');
    expect(yaml).toContain('app: api');
    expect(yaml).toContain('port: 8080');
  });

  it('stamps the namespace on every document', () => {
    const yaml = generateNetworkPolicies(input);
    expect((yaml.match(/namespace: prod/g) ?? []).length).toBe(4); // deny-all, dns, ingress, egress
  });

  it('sanitizes service names for policy names', () => {
    const yaml = generateNetworkPolicies({ namespace: 'prod', flows: [{ from: 'My_Web', to: 'API v2', port: 80 }] });
    expect(yaml).toContain('name: allow-my-web-to-api-v2');
  });

  it('no flows yields just deny-all + dns', () => {
    const yaml = generateNetworkPolicies({ namespace: 'prod', flows: [] });
    expect((yaml.match(/kind: NetworkPolicy/g) ?? []).length).toBe(2);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest src/netpol/networkPolicyGenerator.test.ts` → FAIL, module not found.

- [ ] **Step 3: Write minimal implementation**

```typescript
// backend/src/netpol/networkPolicyGenerator.ts
/**
 * Zero-trust NetworkPolicy generator: default-deny + DNS + explicit per-flow
 * allowances. Pure string output — delivery (download / GitOps PR) happens at
 * the route layer; Scorpion never applies these to a cluster.
 */

export interface ServiceFlow { from: string; to: string; port: number }
export interface NetPolInput { namespace: string; flows: ServiceFlow[] }

const sanitize = (name: string): string =>
  name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');

const doc = (lines: string[]): string => lines.join('\n');

function denyAll(namespace: string): string {
  return doc([
    'apiVersion: networking.k8s.io/v1',
    'kind: NetworkPolicy',
    'metadata:',
    '  name: default-deny-all',
    `  namespace: ${namespace}`,
    'spec:',
    '  podSelector: {}',
    '  policyTypes:',
    '    - Ingress',
    '    - Egress',
  ]);
}

function allowDns(namespace: string): string {
  return doc([
    'apiVersion: networking.k8s.io/v1',
    'kind: NetworkPolicy',
    'metadata:',
    '  name: allow-dns',
    `  namespace: ${namespace}`,
    'spec:',
    '  podSelector: {}',
    '  policyTypes:',
    '    - Egress',
    '  egress:',
    '    - to:',
    '        - namespaceSelector: {}',
    '          podSelector:',
    '            matchLabels:',
    '              k8s-app: kube-dns',
    '      ports:',
    '        - protocol: UDP',
    '          port: 53',
    '        - protocol: TCP',
    '          port: 53',
  ]);
}

function allowIngress(namespace: string, flow: ServiceFlow): string {
  return doc([
    'apiVersion: networking.k8s.io/v1',
    'kind: NetworkPolicy',
    'metadata:',
    `  name: allow-${sanitize(flow.from)}-to-${sanitize(flow.to)}`,
    `  namespace: ${namespace}`,
    'spec:',
    '  podSelector:',
    '    matchLabels:',
    `      app: ${flow.to}`,
    '  policyTypes:',
    '    - Ingress',
    '  ingress:',
    '    - from:',
    '        - podSelector:',
    '            matchLabels:',
    `              app: ${flow.from}`,
    '      ports:',
    '        - protocol: TCP',
    `          port: ${flow.port}`,
  ]);
}

function allowEgress(namespace: string, flow: ServiceFlow): string {
  return doc([
    'apiVersion: networking.k8s.io/v1',
    'kind: NetworkPolicy',
    'metadata:',
    `  name: allow-egress-${sanitize(flow.from)}-to-${sanitize(flow.to)}`,
    `  namespace: ${namespace}`,
    'spec:',
    '  podSelector:',
    '    matchLabels:',
    `      app: ${flow.from}`,
    '  policyTypes:',
    '    - Egress',
    '  egress:',
    '    - to:',
    '        - podSelector:',
    '            matchLabels:',
    `              app: ${flow.to}`,
    '      ports:',
    '        - protocol: TCP',
    `          port: ${flow.port}`,
  ]);
}

export function generateNetworkPolicies(input: NetPolInput): string {
  const docs = [
    denyAll(input.namespace),
    allowDns(input.namespace),
    ...input.flows.flatMap((f) => [allowIngress(input.namespace, f), allowEgress(input.namespace, f)]),
  ];
  return `# Generated by Scorpion — zero-trust baseline for namespace '${input.namespace}'\n`
    + docs.join('\n---\n') + '\n';
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest src/netpol/networkPolicyGenerator.test.ts` → PASS. tsc + lint clean.

- [ ] **Step 5: Commit**

```bash
git add backend/src/netpol/networkPolicyGenerator.ts backend/src/netpol/networkPolicyGenerator.test.ts
git commit -m "feat(netpol): add zero-trust NetworkPolicy generator (deny-all + DNS + flows)"
```

---

### Task 14: NetPol route with optional GitOps PR + mount

**Files:**
- Create: `backend/src/netpol/netpolPr.ts`
- Create: `backend/src/routes/netpolRoutes.ts`
- Test: `backend/src/routes/netpolRoutes.test.ts`
- Modify: `backend/src/index.ts` (mount `/api/netpol` with `authenticate`)

**Interfaces:**
- Consumes: `generateNetworkPolicies` (Task 13); Octokit GitHub-App bootstrap copied from `backend/src/gitops/rollbackService.ts:16-44` (owner/repo URL parsing, `createAppAuth`, installation lookup).
- Produces:
  - `openNetpolPr(options: { repo: string; namespace: string; yaml: string }): Promise<{ prUrl: string }>` — branch `scorpion/netpol-<namespace>-<timestamp>` from default branch, commit YAML to `k8s/networkpolicies/<namespace>.yaml`, open PR
  - `POST /api/netpol/generate` (role-gated admin/security) body `{ namespace, flows, createPr?, repo? }` → always `{ yaml }`; `createPr: true` + `repo` → also `{ prUrl }`; PR failure → `{ yaml, prError }` with 200 (the artifact is still useful); `createPr` without `repo` → 400

- [ ] **Step 1: Write the failing test**

```typescript
// backend/src/routes/netpolRoutes.test.ts
import request from 'supertest';
import express, { Request } from 'express';

jest.mock('../netpol/netpolPr', () => ({ openNetpolPr: jest.fn() }));
jest.mock('../middleware/requireRole', () => ({
  requireRole: () => (_req: Request, _res: unknown, next: () => void) => next(),
}));
jest.mock('../services/logger', () => ({ logger: { warn: jest.fn(), info: jest.fn(), error: jest.fn() } }));

import netpolRoutes from './netpolRoutes';
import { openNetpolPr } from '../netpol/netpolPr';

const buildApp = () => {
  const app = express();
  app.use(express.json());
  app.use('/api/netpol', netpolRoutes);
  return app;
};

const body = { namespace: 'prod', flows: [{ from: 'web', to: 'api', port: 8080 }] };

beforeEach(() => jest.clearAllMocks());

describe('netpolRoutes', () => {
  it('POST /generate returns YAML', async () => {
    const res = await request(buildApp()).post('/api/netpol/generate').send(body);
    expect(res.statusCode).toBe(200);
    expect(res.body.yaml).toContain('default-deny-all');
    expect(openNetpolPr).not.toHaveBeenCalled();
  });

  it('POST /generate with createPr opens a PR and returns its URL', async () => {
    (openNetpolPr as jest.Mock).mockResolvedValue({ prUrl: 'https://github.com/o/r/pull/7' });
    const res = await request(buildApp()).post('/api/netpol/generate')
      .send({ ...body, createPr: true, repo: 'https://github.com/o/r' });
    expect(res.statusCode).toBe(200);
    expect(res.body.prUrl).toBe('https://github.com/o/r/pull/7');
  });

  it('POST /generate createPr without repo is 400', async () => {
    const res = await request(buildApp()).post('/api/netpol/generate').send({ ...body, createPr: true });
    expect(res.statusCode).toBe(400);
  });

  it('POST /generate rejects bad port with 400', async () => {
    const res = await request(buildApp()).post('/api/netpol/generate')
      .send({ namespace: 'prod', flows: [{ from: 'web', to: 'api', port: 0 }] });
    expect(res.statusCode).toBe(400);
  });

  it('PR failure still returns the YAML plus prError', async () => {
    (openNetpolPr as jest.Mock).mockRejectedValue(new Error('no installation'));
    const res = await request(buildApp()).post('/api/netpol/generate')
      .send({ ...body, createPr: true, repo: 'https://github.com/o/r' });
    expect(res.statusCode).toBe(200);
    expect(res.body.yaml).toContain('default-deny-all');
    expect(res.body.prError).toContain('no installation');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest src/routes/netpolRoutes.test.ts` → FAIL, module not found.

- [ ] **Step 3: Write minimal implementation**

```typescript
// backend/src/netpol/netpolPr.ts
import { Octokit } from '@octokit/rest';
import { createAppAuth } from '@octokit/auth-app';
import { logger } from '../services/logger';

/** Opens a GitOps PR carrying generated NetworkPolicies. Same GitHub-App
 *  bootstrap as gitops/rollbackService — keep the two in sync. */
export async function openNetpolPr(options: {
  repo: string; namespace: string; yaml: string;
}): Promise<{ prUrl: string }> {
  const match = options.repo.match(/github\.com\/([^/]+)\/([^/.]+)/);
  if (!match) throw new Error(`Invalid GitHub repository URL: ${options.repo}`);
  const owner = match[1];
  const repoName = match[2];

  const appOctokit = new Octokit({
    authStrategy: createAppAuth,
    auth: {
      appId: process.env.GITHUB_APP_ID,
      privateKey: (process.env.GITHUB_APP_PRIVATE_KEY || '').replace(/\\n/g, '\n'),
    },
  });
  const { data: installation } = await appOctokit.apps.getRepoInstallation({ owner, repo: repoName });
  const octokit = new Octokit({
    authStrategy: createAppAuth,
    auth: {
      appId: process.env.GITHUB_APP_ID,
      privateKey: (process.env.GITHUB_APP_PRIVATE_KEY || '').replace(/\\n/g, '\n'),
      installationId: installation.id,
    },
  });

  const { data: repoInfo } = await octokit.repos.get({ owner, repo: repoName });
  const base = repoInfo.default_branch;
  const { data: baseRef } = await octokit.git.getRef({ owner, repo: repoName, ref: `heads/${base}` });

  const branch = `scorpion/netpol-${options.namespace}-${Date.now()}`;
  await octokit.git.createRef({
    owner, repo: repoName, ref: `refs/heads/${branch}`, sha: baseRef.object.sha,
  });

  await octokit.repos.createOrUpdateFileContents({
    owner,
    repo: repoName,
    path: `k8s/networkpolicies/${options.namespace}.yaml`,
    message: `feat(security): zero-trust NetworkPolicies for ${options.namespace}`,
    content: Buffer.from(options.yaml).toString('base64'),
    branch,
  });

  const { data: pr } = await octokit.pulls.create({
    owner,
    repo: repoName,
    title: `feat(security): zero-trust NetworkPolicies for ${options.namespace}`,
    head: branch,
    base,
    body: 'Generated by Scorpion Operate phase: default-deny baseline plus declared service flows. Review the allowlist before merging.',
  });

  logger.info(`[NetPol] PR opened: ${pr.html_url}`);
  return { prUrl: pr.html_url };
}
```

```typescript
// backend/src/routes/netpolRoutes.ts
import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { generateNetworkPolicies } from '../netpol/networkPolicyGenerator';
import { openNetpolPr } from '../netpol/netpolPr';
import { requireRole } from '../middleware/requireRole';
import { logger } from '../services/logger';

const generateSchema = z.object({
  namespace: z.string().min(1).max(63).regex(/^[a-z0-9]([a-z0-9-]*[a-z0-9])?$/),
  flows: z.array(z.object({
    from: z.string().min(1).max(63),
    to: z.string().min(1).max(63),
    port: z.number().int().min(1).max(65535),
  })).max(100),
  createPr: z.boolean().optional(),
  repo: z.string().url().optional(),
}).refine((v) => !v.createPr || Boolean(v.repo), {
  message: 'repo is required when createPr is true',
  path: ['repo'],
});

const router = Router();
router.use(requireRole('admin', 'security'));

router.post('/generate', async (req: Request, res: Response) => {
  const parsed = generateSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: 'Invalid input', details: parsed.error.flatten() });
  }
  const { namespace, flows, createPr, repo } = parsed.data;
  const yaml = generateNetworkPolicies({ namespace, flows });

  if (!createPr || !repo) return res.json({ yaml });

  try {
    const { prUrl } = await openNetpolPr({ repo, namespace, yaml });
    res.json({ yaml, prUrl });
  } catch (err) {
    // The artifact is still useful even when the PR fails — return both.
    const msg = err instanceof Error ? err.message : 'PR creation failed';
    logger.error('[NetPol API] PR failed:', msg);
    res.json({ yaml, prError: msg });
  }
});

export default router;
```

`backend/src/index.ts`: `import netpolRoutes from './routes/netpolRoutes';` + `app.use('/api/netpol', authenticate, netpolRoutes);`

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest src/routes/netpolRoutes.test.ts` → PASS. Full suite + tsc + lint green.

- [ ] **Step 5: Commit**

```bash
git add backend/src/netpol/netpolPr.ts backend/src/routes/netpolRoutes.ts backend/src/routes/netpolRoutes.test.ts backend/src/index.ts
git commit -m "feat(netpol): add generate route with optional GitOps PR delivery"
```

---

### Task 15: UI panels (SOAR, Falco rules, Posture, NetPol)

**Files:**
- Create: `src/components/SoarPanel.tsx`
- Create: `src/components/FalcoRulesPanel.tsx`
- Create: `src/components/PosturePanel.tsx`
- Create: `src/components/NetPolPanel.tsx`
- Modify: `src/pages/Monitor.tsx` (render the four panels in an "Operate" section)

**Interfaces:**
- Consumes: the HTTP APIs from Tasks 5, 9, 12, 14. Open `src/components/CanaryPanel.tsx` FIRST and copy its data-fetch helper (axios instance / fetch wrapper, auth headers), styling primitives, and loading/error-state pattern exactly. `src/pages/Deploy.tsx` shows how CanaryPanel + PodSecurityRulesPanel were sectioned into a page — replicate that in Monitor.tsx.
- Produces: four self-contained panels, each owning its data fetching. Type every API response with interfaces matching the route payloads (Tasks 5/9/12/14). No `any`.

Panel behavior contracts (each ~150-220 lines, styled like CanaryPanel):

1. **SoarPanel** — two sections. (a) *Pending approvals*: `GET /api/soar/actions?status=pending` on mount + 15s poll; each row shows `falcoRule`, `actionType`, `namespace/podName`, age; Approve → `POST /api/soar/actions/:id/approve`, Reject → `.../reject`; a 409 response shows "already resolved" and refetches; buttons disabled while in flight. (b) *Playbooks*: `GET /api/soar/playbooks` list with an enabled toggle (`PATCH /api/soar/playbooks/:id` with `{ enabled }`) and a create form — name, optional rule pattern, min-priority select, dynamic action rows (action-type select + auto/approval toggle) → `POST /api/soar/playbooks`. `isolate_pod`/`kill_pod` rows render a "destructive" warning badge and default to `approval`.
2. **FalcoRulesPanel** — `GET /api/falco-rules`; render `templates` as the catalog with existing `rules` merged; per rule: enabled + suppressed toggles, appScope input, severity-override select, params editor (comma-separated inputs for allowedProcs / allowedDomains / watchedPaths); create → `POST /api/falco-rules`, edit → `PATCH /api/falco-rules/:id`. "Export YAML" button fetches `GET /api/falco-rules/export` and downloads the body as `falco_rules.local.yaml` (Blob + object-URL anchor click).
3. **PosturePanel** — `GET /api/posture`; one score card per namespace (color thresholds: ≥90 good, ≥70 warn, else bad — use the app's themed severity color tokens from commit bf59392, not hardcoded hex); expanding a card lists findings sorted critical→low showing `checkId`, `resource`, `reason`. A `namespace-without-networkpolicy` finding renders a "Generate policies" action that prefills NetPolPanel's namespace (lift selected namespace to the parent page state).
4. **NetPolPanel** — controlled form: namespace input (accepts a prefill prop), dynamic flow rows (`from`, `to`, `port`, add/remove), Generate → `POST /api/netpol/generate`; YAML result in a `<pre>` block with Copy and Download buttons; "Create PR" checkbox reveals a repo-URL input; on success render `prUrl` as a link; render `prError` as an inline warning while still showing the YAML.

Common requirements: fetch state as `{ data, loading, error }`; every mutation refetches; all failures render inline error text (no silent console-only errors); cleanup poll intervals on unmount.

- [ ] **Step 1: Read `src/components/CanaryPanel.tsx`, `src/pages/Deploy.tsx`, `src/pages/Monitor.tsx`** — note API helper, styling system, sectioning pattern.

- [ ] **Step 2: Implement the four panels** per the contracts above.

- [ ] **Step 3: Wire into Monitor.tsx** — an "Operate" section rendering the four panels, with the posture→netpol namespace prefill lifted to page state.

- [ ] **Step 4: Verify** — from repo root run the frontend typecheck/lint/build scripts from package.json (`npm run lint`, `npm run build`; tsc via the build). Fix until clean. If the frontend has component tests (`*.test.tsx` exists), add smoke tests following that pattern; otherwise a green build is the gate.

- [ ] **Step 5: Commit**

```bash
git add src/components/SoarPanel.tsx src/components/FalcoRulesPanel.tsx src/components/PosturePanel.tsx src/components/NetPolPanel.tsx src/pages/Monitor.tsx
git commit -m "feat(ui): add Operate panels - SOAR approvals, Falco rules, posture scores, NetworkPolicy generator"
```

---

### Task 16: Lifecycle docs + final verification

**Files:**
- Create: `docs/lifecycle/operate-phase.md`

- [ ] **Step 1: Write the doc** following the exact structure of `docs/lifecycle/deploy-phase.md` (read it first): what the industry Operate phase means (runtime detection, SOAR, CSPM, zero trust — Falco/Sysdig, Cloud Custodian/Prowler, Istio/Cilium class tools), what Scorpion had before this phase (Falco ingestion → incident/Slack, runtime drift monitor), what this phase added (the four components, their API surfaces, and the fail-secure decisions: tiered approvals, suppression-never-for-unknown-rules, read-only CSPM, artifact-only NetworkPolicies), and what was deliberately deferred (cloud-API CSPM needing cloud credentials, running a service mesh, arbitrary Falco rule authoring, direct cluster remediation outside SOAR containment).

- [ ] **Step 2: Full verification** — from `backend/`: `npx tsc --noEmit && npm run lint && npm run test` all green. From repo root: frontend build green.

- [ ] **Step 3: Commit**

```bash
git add docs/lifecycle/operate-phase.md
git commit -m "docs: document Operate phase capabilities and deferrals"
```

---

## Execution notes for the implementing agent

- Read the spec (`docs/superpowers/specs/2026-07-04-operate-phase-design.md`) and skim these reference files before Task 1: `backend/src/runtime/falcoHandler.ts`, `backend/src/workers/driftMonitor.ts`, `backend/src/queues/canaryQueue.ts` + `canaryQueueWorker.ts`, `backend/src/routes/canaryRoutes.ts` + `.test.ts`, `backend/src/repositories/driftRepository.ts`, `backend/src/gitops/rollbackService.ts`.
- Version drift risk: `@kubernetes/client-node` call style (object vs positional args) and response shapes (`res.items` vs `res.body.items`) vary by major version — always match what `driftMonitor.ts` does.
- Verify `requireRole`'s import path/signature (`backend/src/middleware/requireRole.ts`) and `createIncident`'s (`backend/src/services/incidentService.ts`) before first use; falcoHandler line ~97 shows `createIncident` in use.
- Appwrite collections (`playbooks`, `soar_actions`, `falco_rules`, `posture_snapshots`) must exist for runtime behavior; the test suite fully mocks Appwrite so it stays green without them. At the end, list the required columns for the user to create in the Appwrite console (schemas in Tasks 2, 8, 11).
- If the working tree still contains uncommitted `feat/deploy-phase` work, ask the user before creating the branch — do not sweep unrelated changes into Operate commits.
