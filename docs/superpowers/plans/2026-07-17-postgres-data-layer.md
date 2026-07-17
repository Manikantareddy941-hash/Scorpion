# Postgres Data Layer (Phase 1.1) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Introduce Postgres as the system of record behind the existing repository interfaces, with a per-repository facade that selects Postgres when `DATABASE_URL` is set and the current Appwrite/JSON implementation otherwise.

**Architecture:** Each `backend/src/repositories/<name>Repository.ts` keeps its exported name and interface. A new `backend/src/repositories/pg/<name>PgRepository.ts` implements the same interface against Postgres; the original file becomes `legacy` + a one-line facade. Services and routes change zero lines. Config-style tables use typed columns + JSONB payloads; entity tables that today return raw Appwrite document shapes use a `data JSONB` document-table bridge that preserves the exact `{ total, documents: [{ $id, ...fields }] }` shape callers already consume.

**Tech Stack:** `pg` (node-postgres), `node-pg-migrate` (SQL migrations), postgres:16-alpine (docker-compose + CI service container), existing Jest setup with `RUN_DB_IT` gating (same pattern as the dual-write ingestion tests).

## Global Constraints

- Backend coverage gate stays ≥80% statements; lint must stay at 0 errors (`npm run lint` in `backend/`).
- No `any` in new code (repo lint ratchet; `unknown` + narrowing instead).
- All commands in this plan run from `backend/` unless stated otherwise.
- DB integration tests are gated: they run only when `RUN_DB_IT=1` and `DATABASE_URL` are set (skip cleanly otherwise) — the established repo pattern.
- Facade rule: existing exported repository names and method signatures MUST NOT change; services/routes are untouched.
- The scope of THIS plan is the foundation + three exemplar repositories (`gateRulesRepository`, `podSecurityRepository`, `repoRepository`). The remaining 14 repositories follow the same recipe in the next plan (`2026-07-XX-postgres-rollout.md`) once the pattern is validated here. This is a scope boundary, not a TODO.

---

### Task 1: Postgres foundation (pool, migrations, compose, test gate)

**Files:**
- Create: `backend/src/db/pool.ts`
- Create: `backend/migrations/1752700000000_init.sql`
- Create: `backend/src/db/testDb.ts`
- Create: `backend/src/db/pool.test.ts`
- Modify: `backend/package.json` (deps + scripts)
- Modify: `docker-compose.yml` (postgres service)

**Interfaces:**
- Produces: `getPool(): Pool`, `isPostgresEnabled(): boolean`, `closePool(): Promise<void>` from `../db/pool`; `describeDb` and `truncateAll(tables: string[]): Promise<void>` from `../db/testDb`; tables `gate_rules`, `pod_security_rules`, `app_repositories`, `app_scans`.

- [ ] **Step 1: Install dependencies**

Run: `npm install pg && npm install -D node-pg-migrate @types/pg`
Expected: added to `backend/package.json` dependencies/devDependencies.

- [ ] **Step 2: Add npm scripts**

In `backend/package.json` `"scripts"`, add:

```json
"migrate:up": "node-pg-migrate up -m migrations --tsconfig tsconfig.json",
"migrate:down": "node-pg-migrate down -m migrations --tsconfig tsconfig.json"
```

- [ ] **Step 3: Write the failing pool test**

Create `backend/src/db/pool.test.ts`:

```ts
import { isPostgresEnabled } from './pool';

const describeDb = process.env.RUN_DB_IT && process.env.DATABASE_URL ? describe : describe.skip;

describe('isPostgresEnabled', () => {
  it('reflects DATABASE_URL presence', () => {
    expect(isPostgresEnabled()).toBe(Boolean(process.env.DATABASE_URL));
  });
});

describeDb('getPool (integration)', () => {
  it('executes a round-trip query', async () => {
    const { getPool, closePool } = await import('./pool');
    const result = await getPool().query('SELECT 1 AS one');
    expect(result.rows[0].one).toBe(1);
    await closePool();
  });
});
```

- [ ] **Step 4: Run test to verify it fails**

Run: `npx jest src/db/pool.test.ts`
Expected: FAIL — `Cannot find module './pool'`.

- [ ] **Step 5: Implement the pool**

Create `backend/src/db/pool.ts`:

```ts
import { Pool } from 'pg';

let pool: Pool | undefined;

export function isPostgresEnabled(): boolean {
  return Boolean(process.env.DATABASE_URL);
}

/** Lazy singleton. Throws if DATABASE_URL is missing — callers must gate on isPostgresEnabled(). */
export function getPool(): Pool {
  if (!process.env.DATABASE_URL) {
    throw new Error('DATABASE_URL is not configured');
  }
  if (!pool) {
    pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 10 });
  }
  return pool;
}

/** For tests and graceful shutdown. */
export async function closePool(): Promise<void> {
  await pool?.end();
  pool = undefined;
}
```

- [ ] **Step 6: Run test to verify it passes (unit part)**

Run: `npx jest src/db/pool.test.ts`
Expected: PASS (integration `describeDb` block shows as skipped without env).

- [ ] **Step 7: Write the initial migration**

Create `backend/migrations/1752700000000_init.sql`:

```sql
-- Up Migration
CREATE TABLE IF NOT EXISTS gate_rules (
  user_id    TEXT PRIMARY KEY,
  rules      JSONB NOT NULL,
  env        TEXT NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS pod_security_rules (
  user_id    TEXT PRIMARY KEY,
  config     JSONB NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Document-table bridge: preserves the Appwrite document shape callers consume
-- today ({ $id, ...fields }). Typed columns come later, per-table, when a real
-- query needs them. app_ prefix avoids clashing with node-pg-migrate internals.
CREATE TABLE IF NOT EXISTS app_repositories (
  id         TEXT PRIMARY KEY,
  data       JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_app_repositories_user ON app_repositories ((data->>'user_id'));
CREATE INDEX IF NOT EXISTS idx_app_repositories_url  ON app_repositories ((data->>'url'));

CREATE TABLE IF NOT EXISTS app_scans (
  id         TEXT PRIMARY KEY,
  data       JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_app_scans_repo ON app_scans ((data->>'repo_id'));

-- Down Migration
DROP TABLE IF EXISTS app_scans;
DROP TABLE IF EXISTS app_repositories;
DROP TABLE IF EXISTS pod_security_rules;
DROP TABLE IF EXISTS gate_rules;
```

- [ ] **Step 8: Add Postgres to docker-compose**

In root `docker-compose.yml`, add under `services:` (align indentation with existing services):

```yaml
  postgres:
    image: postgres:16-alpine
    environment:
      POSTGRES_USER: scorpion
      POSTGRES_PASSWORD: scorpion
      POSTGRES_DB: scorpion
    ports:
      - "5432:5432"
    volumes:
      - pgdata:/var/lib/postgresql/data
```

And add `pgdata:` under the top-level `volumes:` key (create the key if absent).

- [ ] **Step 9: Verify migration runs**

Run (repo root): `docker compose up -d postgres`
Then (backend/): `DATABASE_URL=postgres://scorpion:scorpion@localhost:5432/scorpion npm run migrate:up`
Expected: `> Migrating files: ... 1752700000000_init` then success. Verify: `docker compose exec postgres psql -U scorpion -c '\dt'` lists the four tables + `pgmigrations`.

- [ ] **Step 10: Verify integration test passes**

Run: `RUN_DB_IT=1 DATABASE_URL=postgres://scorpion:scorpion@localhost:5432/scorpion npx jest src/db/pool.test.ts`
Expected: PASS, integration block included.

- [ ] **Step 11: Create the shared test helper**

Create `backend/src/db/testDb.ts`:

```ts
/** Shared gating + cleanup for Postgres integration tests (RUN_DB_IT pattern). */
import { getPool } from './pool';

export const describeDb =
  process.env.RUN_DB_IT && process.env.DATABASE_URL ? describe : describe.skip;

/** TRUNCATE the given tables between tests. Table names are code-owned constants, never user input. */
export async function truncateAll(tables: string[]): Promise<void> {
  if (tables.length === 0) return;
  await getPool().query(`TRUNCATE ${tables.map(t => `"${t}"`).join(', ')}`);
}
```

- [ ] **Step 12: Lint + full unit suite, then commit**

Run: `npm run lint && npx jest src/db`
Expected: 0 lint errors; pool tests pass.

```bash
git add backend/package.json backend/package-lock.json backend/src/db backend/migrations ../docker-compose.yml
git commit -m "feat(db): postgres foundation - pool, migrations, compose service, RUN_DB_IT test gate"
```

---

### Task 2: gateRulesPgRepository + facade

**Files:**
- Create: `backend/src/repositories/pg/gateRulesPgRepository.ts`
- Create: `backend/src/repositories/pg/gateRulesPgRepository.test.ts`
- Modify: `backend/src/repositories/gateRulesRepository.ts` (facade at bottom; existing impl renamed internally)

**Interfaces:**
- Consumes: `getPool` from `../../db/pool`; `describeDb`, `truncateAll` from `../../db/testDb`; types `GateConfig`, `GateRule`, `DEFAULT_CONFIG` from `../gateRulesRepository`.
- Produces: `gateRulesPgRepository` with the exact existing interface: `get(userId: string): Promise<GateConfig>`, `save(userId: string, config: GateConfig): Promise<GateConfig>`, `flushFallback(): Promise<number>` (pg impl returns 0 — there is no fallback buffer to flush).

- [ ] **Step 1: Write the failing integration test**

Create `backend/src/repositories/pg/gateRulesPgRepository.test.ts`:

```ts
import { describeDb, truncateAll } from '../../db/testDb';
import { closePool } from '../../db/pool';
import { DEFAULT_CONFIG, GateConfig } from '../gateRulesRepository';
import { gateRulesPgRepository } from './gateRulesPgRepository';

describeDb('gateRulesPgRepository', () => {
  beforeEach(() => truncateAll(['gate_rules']));
  afterAll(() => closePool());

  it('returns DEFAULT_CONFIG for an unknown user', async () => {
    expect(await gateRulesPgRepository.get('nobody')).toEqual(DEFAULT_CONFIG);
  });

  it('save then get round-trips a config, scoped per user', async () => {
    const config: GateConfig = {
      rules: [{ id: 'r1', severity: 'critical', threshold: 0, action: 'block', enabled: true }],
      env: 'stage',
    };
    await gateRulesPgRepository.save('user-1', config);
    expect(await gateRulesPgRepository.get('user-1')).toEqual(config);
    expect(await gateRulesPgRepository.get('user-2')).toEqual(DEFAULT_CONFIG);
  });

  it('save is an upsert — second save overwrites', async () => {
    const first: GateConfig = { rules: [], env: 'dev' };
    const second: GateConfig = { rules: [], env: 'prod' };
    await gateRulesPgRepository.save('user-1', first);
    await gateRulesPgRepository.save('user-1', second);
    expect((await gateRulesPgRepository.get('user-1')).env).toBe('prod');
  });

  it('flushFallback is a no-op returning 0', async () => {
    expect(await gateRulesPgRepository.flushFallback()).toBe(0);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `RUN_DB_IT=1 DATABASE_URL=postgres://scorpion:scorpion@localhost:5432/scorpion npx jest src/repositories/pg/gateRulesPgRepository.test.ts`
Expected: FAIL — `Cannot find module './gateRulesPgRepository'`.

- [ ] **Step 3: Implement**

Create `backend/src/repositories/pg/gateRulesPgRepository.ts`:

```ts
import { getPool } from '../../db/pool';
import { DEFAULT_CONFIG, GateConfig, GateEnv, GateRule } from '../gateRulesRepository';

/**
 * Postgres implementation of the gate-rules repository. Selected by the facade
 * in gateRulesRepository.ts when DATABASE_URL is set. No JSON-file fallback:
 * Postgres is the system of record, an outage surfaces as an error.
 */
export const gateRulesPgRepository = {
  async get(userId: string): Promise<GateConfig> {
    const result = await getPool().query(
      'SELECT rules, env FROM gate_rules WHERE user_id = $1',
      [userId]
    );
    if (result.rowCount === 0) return DEFAULT_CONFIG;
    return {
      rules: result.rows[0].rules as GateRule[],
      env: result.rows[0].env as GateEnv,
    };
  },

  async save(userId: string, config: GateConfig): Promise<GateConfig> {
    await getPool().query(
      `INSERT INTO gate_rules (user_id, rules, env, updated_at)
       VALUES ($1, $2::jsonb, $3, now())
       ON CONFLICT (user_id) DO UPDATE SET rules = $2::jsonb, env = $3, updated_at = now()`,
      [userId, JSON.stringify(config.rules), config.env]
    );
    return config;
  },

  /** The legacy impl flushes its JSON fallback buffer; Postgres has none. */
  async flushFallback(): Promise<number> {
    return 0;
  },
};
```

- [ ] **Step 4: Run test to verify it passes**

Run: `RUN_DB_IT=1 DATABASE_URL=postgres://scorpion:scorpion@localhost:5432/scorpion npx jest src/repositories/pg/gateRulesPgRepository.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Wire the facade**

In `backend/src/repositories/gateRulesRepository.ts`: rename the existing `export const gateRulesRepository = {` to `const legacyGateRulesRepository = {`, then add at the very bottom of the file:

```ts
import { isPostgresEnabled } from '../db/pool';
import { gateRulesPgRepository } from './pg/gateRulesPgRepository';

/** Storage facade: Postgres when DATABASE_URL is configured, legacy Appwrite/JSON otherwise. */
export const gateRulesRepository: typeof legacyGateRulesRepository =
  isPostgresEnabled() ? gateRulesPgRepository : legacyGateRulesRepository;
```

Move the two new `import` lines to the top of the file with the existing imports (ESLint `import/first`).

- [ ] **Step 6: Verify nothing broke without DATABASE_URL**

Run: `npx jest gateRules k8sAdmission gateRoutes`
Expected: all existing suites PASS (facade resolves to legacy without env).

- [ ] **Step 7: Lint + commit**

Run: `npm run lint`
Expected: 0 errors.

```bash
git add backend/src/repositories/pg backend/src/repositories/gateRulesRepository.ts
git commit -m "feat(db): postgres gateRulesRepository behind storage facade"
```

---

### Task 3: CI — Postgres service container + gated DB tests

**Files:**
- Modify: `.github/workflows/` backend CI workflow (locate the job running `npm test` for `backend/` — check the file with `grep -rl "backend" .github/workflows/`)

**Interfaces:**
- Consumes: `RUN_DB_IT` gate from Task 1; `npm run migrate:up` script.
- Produces: CI runs every `describeDb` suite against a real Postgres on every push.

- [ ] **Step 1: Add the service container and env to the backend job**

In the backend CI job, add:

```yaml
    services:
      postgres:
        image: postgres:16-alpine
        env:
          POSTGRES_USER: scorpion
          POSTGRES_PASSWORD: scorpion
          POSTGRES_DB: scorpion
        ports:
          - 5432:5432
        options: >-
          --health-cmd "pg_isready -U scorpion"
          --health-interval 5s
          --health-timeout 5s
          --health-retries 10
```

And on the test step (and a new migrate step before it):

```yaml
      - name: Run DB migrations
        working-directory: backend
        run: npm run migrate:up
        env:
          DATABASE_URL: postgres://scorpion:scorpion@localhost:5432/scorpion
```

Add to the existing test step's `env:`:

```yaml
          RUN_DB_IT: "1"
          DATABASE_URL: postgres://scorpion:scorpion@localhost:5432/scorpion
```

**Caution:** with `DATABASE_URL` set, every facade in CI resolves to Postgres — the existing legacy-path suites (which mock Appwrite) must still pass because they import the module and the facade picks pg. Verify locally first (next step) before pushing.

- [ ] **Step 2: Verify the full suite locally under DATABASE_URL**

Run: `RUN_DB_IT=1 DATABASE_URL=postgres://scorpion:scorpion@localhost:5432/scorpion npx jest`
Expected: all suites pass. If a legacy suite fails because the facade now resolves to pg, that suite must import the legacy implementation explicitly (it is testing legacy behavior) — fix by importing the pg-vs-legacy selection point rather than weakening the test.

- [ ] **Step 3: Commit + push + watch CI**

```bash
git add .github/workflows/
git commit -m "ci(backend): postgres service container, migrations step, RUN_DB_IT gate on"
```

Push (on the feature branch) and confirm the backend job is green with the DB suites listed as executed, not skipped.

---

### Task 4: podSecurityPgRepository + facade

**Files:**
- Create: `backend/src/repositories/pg/podSecurityPgRepository.ts`
- Create: `backend/src/repositories/pg/podSecurityPgRepository.test.ts`
- Modify: `backend/src/repositories/podSecurityRepository.ts` (facade, same mechanical change as Task 2)

**Interfaces:**
- Consumes: `getPool`, `describeDb`, `truncateAll`; `PodSecurityConfig`, `DEFAULT_POD_SECURITY_CONFIG` from `../../services/podSecurityService`.
- Produces: `podSecurityPgRepository` with interface `get(userId: string): Promise<PodSecurityConfig>`, `save(userId: string, config: PodSecurityConfig): Promise<PodSecurityConfig>`, `flushFallback(): Promise<number>`.

- [ ] **Step 1: Write the failing test**

Create `backend/src/repositories/pg/podSecurityPgRepository.test.ts`:

```ts
import { describeDb, truncateAll } from '../../db/testDb';
import { closePool } from '../../db/pool';
import { DEFAULT_POD_SECURITY_CONFIG, PodSecurityConfig } from '../../services/podSecurityService';
import { podSecurityPgRepository } from './podSecurityPgRepository';

describeDb('podSecurityPgRepository', () => {
  beforeEach(() => truncateAll(['pod_security_rules']));
  afterAll(() => closePool());

  it('returns the default config for an unknown user', async () => {
    expect(await podSecurityPgRepository.get('nobody')).toEqual(DEFAULT_POD_SECURITY_CONFIG);
  });

  it('save then get round-trips and upserts', async () => {
    const config: PodSecurityConfig = {
      ...DEFAULT_POD_SECURITY_CONFIG,
      allowedRegistries: ['registry.example.com'],
    };
    await podSecurityPgRepository.save('system', config);
    expect(await podSecurityPgRepository.get('system')).toEqual(config);

    const updated: PodSecurityConfig = { ...config, requiredLabels: ['app'] };
    await podSecurityPgRepository.save('system', updated);
    expect((await podSecurityPgRepository.get('system')).requiredLabels).toEqual(['app']);
  });

  it('flushFallback is a no-op returning 0', async () => {
    expect(await podSecurityPgRepository.flushFallback()).toBe(0);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `RUN_DB_IT=1 DATABASE_URL=postgres://scorpion:scorpion@localhost:5432/scorpion npx jest src/repositories/pg/podSecurityPgRepository.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

Create `backend/src/repositories/pg/podSecurityPgRepository.ts`:

```ts
import { getPool } from '../../db/pool';
import { DEFAULT_POD_SECURITY_CONFIG, PodSecurityConfig } from '../../services/podSecurityService';

/** Postgres implementation of the pod-security config repository (facade-selected). */
export const podSecurityPgRepository = {
  async get(userId: string): Promise<PodSecurityConfig> {
    const result = await getPool().query(
      'SELECT config FROM pod_security_rules WHERE user_id = $1',
      [userId]
    );
    if (result.rowCount === 0) return DEFAULT_POD_SECURITY_CONFIG;
    return result.rows[0].config as PodSecurityConfig;
  },

  async save(userId: string, config: PodSecurityConfig): Promise<PodSecurityConfig> {
    await getPool().query(
      `INSERT INTO pod_security_rules (user_id, config, updated_at)
       VALUES ($1, $2::jsonb, now())
       ON CONFLICT (user_id) DO UPDATE SET config = $2::jsonb, updated_at = now()`,
      [userId, JSON.stringify(config)]
    );
    return config;
  },

  async flushFallback(): Promise<number> {
    return 0;
  },
};
```

- [ ] **Step 4: Run to verify pass**

Same command as Step 2. Expected: PASS (3 tests).

- [ ] **Step 5: Wire the facade**

In `backend/src/repositories/podSecurityRepository.ts`: rename `export const podSecurityRepository = {` to `const legacyPodSecurityRepository = {`; add imports at top and at bottom:

```ts
import { isPostgresEnabled } from '../db/pool';
import { podSecurityPgRepository } from './pg/podSecurityPgRepository';
```

```ts
/** Storage facade: Postgres when DATABASE_URL is configured, legacy Appwrite/JSON otherwise. */
export const podSecurityRepository: typeof legacyPodSecurityRepository =
  isPostgresEnabled() ? podSecurityPgRepository : legacyPodSecurityRepository;
```

- [ ] **Step 6: Verify existing suites + lint, commit**

Run: `npx jest podSecurity k8sAdmission && npm run lint`
Expected: PASS, 0 lint errors.

```bash
git add backend/src/repositories/pg/podSecurityPgRepository.ts backend/src/repositories/pg/podSecurityPgRepository.test.ts backend/src/repositories/podSecurityRepository.ts
git commit -m "feat(db): postgres podSecurityRepository behind storage facade"
```

---

### Task 5: repoPgRepository + facade (document-table bridge exemplar)

**Files:**
- Create: `backend/src/repositories/pg/docTable.ts`
- Create: `backend/src/repositories/pg/repoPgRepository.ts`
- Create: `backend/src/repositories/pg/repoPgRepository.test.ts`
- Modify: `backend/src/repositories/repoRepository.ts` (facade)

**Interfaces:**
- Consumes: `getPool`, `describeDb`, `truncateAll`.
- Produces: `docTable.ts` helpers reused by the rollout plan: `type DocRow = { $id: string } & Record<string, unknown>`, `toDoc(row: { id: string; data: Record<string, unknown> }): DocRow`, `newId(): string`. `repoPgRepository` mirrors `repoRepository`'s methods exactly, returning Appwrite-shaped results: list methods return `{ total: number; documents: DocRow[] }`, get/create/update return `DocRow`, `deleteRepo` resolves void; `getRepo`/`getScan` REJECT with `Error('document not found')` for missing ids (matching Appwrite's throw-on-missing semantics that callers' try/catch depend on).

- [ ] **Step 1: Write the doc-table helper**

Create `backend/src/repositories/pg/docTable.ts`:

```ts
import { randomUUID } from 'crypto';

/** Appwrite-document-shaped row: callers today consume { $id, ...fields }. */
export type DocRow = { $id: string } & Record<string, unknown>;

export function toDoc(row: { id: string; data: Record<string, unknown> }): DocRow {
  return { $id: row.id, ...row.data };
}

export function newId(): string {
  return randomUUID();
}
```

- [ ] **Step 2: Write the failing test**

Create `backend/src/repositories/pg/repoPgRepository.test.ts`:

```ts
import { describeDb, truncateAll } from '../../db/testDb';
import { closePool } from '../../db/pool';
import { repoPgRepository } from './repoPgRepository';

describeDb('repoPgRepository', () => {
  beforeEach(() => truncateAll(['app_repositories', 'app_scans']));
  afterAll(() => closePool());

  it('creates a repo and returns an Appwrite-shaped document', async () => {
    const doc = await repoPgRepository.createRepo({ user_id: 'u1', url: 'https://github.com/a/b', name: 'b' });
    expect(doc.$id).toBeTruthy();
    expect(doc.url).toBe('https://github.com/a/b');
  });

  it('findByOwnershipAndUrl scopes by dynamic field + url', async () => {
    await repoPgRepository.createRepo({ user_id: 'u1', url: 'https://x/1' });
    await repoPgRepository.createRepo({ user_id: 'u2', url: 'https://x/1' });
    const found = await repoPgRepository.findByOwnershipAndUrl('user_id', 'u1', 'https://x/1');
    expect(found.total).toBe(1);
    expect(found.documents[0].user_id).toBe('u1');
  });

  it('updateRepo merges fields; getRepo returns them; deleteRepo removes', async () => {
    const doc = await repoPgRepository.createRepo({ user_id: 'u1', url: 'https://x/2', name: 'old' });
    await repoPgRepository.updateRepo(doc.$id, { name: 'new' });
    const fetched = await repoPgRepository.getRepo(doc.$id);
    expect(fetched.name).toBe('new');
    expect(fetched.url).toBe('https://x/2');
    await repoPgRepository.deleteRepo(doc.$id);
    await expect(repoPgRepository.getRepo(doc.$id)).rejects.toThrow('document not found');
  });

  it('listByScope orders by updated_at descending', async () => {
    await repoPgRepository.createRepo({ user_id: 'u1', url: 'https://x/old', updated_at: '2026-01-01T00:00:00Z' });
    await repoPgRepository.createRepo({ user_id: 'u1', url: 'https://x/new', updated_at: '2026-06-01T00:00:00Z' });
    const list = await repoPgRepository.listByScope('user_id', 'u1');
    expect(list.documents[0].url).toBe('https://x/new');
  });

  it('findActiveScan matches pending or running scans for a repo', async () => {
    await repoPgRepository.createScan({ repo_id: 'r1', status: 'done' });
    expect((await repoPgRepository.findActiveScan('r1')).total).toBe(0);
    await repoPgRepository.createScan({ repo_id: 'r1', status: 'running' });
    expect((await repoPgRepository.findActiveScan('r1')).total).toBe(1);
  });

  it('getScan round-trips a created scan', async () => {
    const scan = await repoPgRepository.createScan({ repo_id: 'r1', status: 'pending' });
    expect((await repoPgRepository.getScan(scan.$id)).status).toBe('pending');
  });
});
```

- [ ] **Step 3: Run to verify failure**

Run: `RUN_DB_IT=1 DATABASE_URL=postgres://scorpion:scorpion@localhost:5432/scorpion npx jest src/repositories/pg/repoPgRepository.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 4: Implement**

Create `backend/src/repositories/pg/repoPgRepository.ts`:

```ts
import { getPool } from '../../db/pool';
import { DocRow, newId, toDoc } from './docTable';

// The dynamic ownership field arrives from route code (e.g. 'user_id'). It is
// used as a JSONB key parameter, never interpolated into SQL — safe by
// parameterization, but restrict to known fields anyway (defense in depth).
const OWNERSHIP_FIELDS = new Set(['user_id', 'org_id']);

function assertOwnershipField(field: string): void {
  if (!OWNERSHIP_FIELDS.has(field)) {
    throw new Error(`Unsupported ownership field: ${field}`);
  }
}

type ListResult = { total: number; documents: DocRow[] };

/**
 * Postgres implementation of repoRepository (facade-selected). Rows live in
 * document tables (id + data JSONB) so returned shapes match the Appwrite
 * documents existing services destructure. Missing ids REJECT like Appwrite.
 */
export const repoPgRepository = {
  async findByOwnershipAndUrl(field: string, value: string, url: string): Promise<ListResult> {
    assertOwnershipField(field);
    const result = await getPool().query(
      `SELECT id, data FROM app_repositories WHERE data->>$1 = $2 AND data->>'url' = $3 LIMIT 1`,
      [field, value, url]
    );
    return { total: result.rowCount ?? 0, documents: result.rows.map(toDoc) };
  },

  async updateRepo(id: string, fields: Record<string, unknown>): Promise<DocRow> {
    const result = await getPool().query(
      `UPDATE app_repositories SET data = data || $2::jsonb WHERE id = $1 RETURNING id, data`,
      [id, JSON.stringify(fields)]
    );
    if (result.rowCount === 0) throw new Error('document not found');
    return toDoc(result.rows[0]);
  },

  async createRepo(data: Record<string, unknown>): Promise<DocRow> {
    const id = newId();
    const result = await getPool().query(
      `INSERT INTO app_repositories (id, data) VALUES ($1, $2::jsonb) RETURNING id, data`,
      [id, JSON.stringify(data)]
    );
    return toDoc(result.rows[0]);
  },

  async getRepo(id: string): Promise<DocRow> {
    const result = await getPool().query(`SELECT id, data FROM app_repositories WHERE id = $1`, [id]);
    if (result.rowCount === 0) throw new Error('document not found');
    return toDoc(result.rows[0]);
  },

  async deleteRepo(id: string): Promise<void> {
    await getPool().query(`DELETE FROM app_repositories WHERE id = $1`, [id]);
  },

  async listByScope(field: string, value: string): Promise<ListResult> {
    assertOwnershipField(field);
    const result = await getPool().query(
      `SELECT id, data FROM app_repositories WHERE data->>$1 = $2 ORDER BY data->>'updated_at' DESC NULLS LAST`,
      [field, value]
    );
    return { total: result.rowCount ?? 0, documents: result.rows.map(toDoc) };
  },

  async findActiveScan(repoId: string): Promise<ListResult> {
    const result = await getPool().query(
      `SELECT id, data FROM app_scans WHERE data->>'repo_id' = $1 AND data->>'status' IN ('pending','running') LIMIT 1`,
      [repoId]
    );
    return { total: result.rowCount ?? 0, documents: result.rows.map(toDoc) };
  },

  async createScan(data: Record<string, unknown>): Promise<DocRow> {
    const id = newId();
    const result = await getPool().query(
      `INSERT INTO app_scans (id, data) VALUES ($1, $2::jsonb) RETURNING id, data`,
      [id, JSON.stringify(data)]
    );
    return toDoc(result.rows[0]);
  },

  async getScan(scanId: string): Promise<DocRow> {
    const result = await getPool().query(`SELECT id, data FROM app_scans WHERE id = $1`, [scanId]);
    if (result.rowCount === 0) throw new Error('document not found');
    return toDoc(result.rows[0]);
  },
};
```

- [ ] **Step 5: Run to verify pass**

Same command as Step 3. Expected: PASS (6 tests).

- [ ] **Step 6: Wire the facade**

In `backend/src/repositories/repoRepository.ts`: rename `export const repoRepository = {` to `const legacyRepoRepository = {`; add at top with other imports and at bottom:

```ts
import { isPostgresEnabled } from '../db/pool';
import { repoPgRepository } from './pg/repoPgRepository';
```

```ts
/** Storage facade: Postgres when DATABASE_URL is configured, legacy Appwrite otherwise. */
export const repoRepository = isPostgresEnabled() ? repoPgRepository : legacyRepoRepository;
```

Note: no `typeof legacyRepoRepository` annotation here — the legacy methods return Appwrite SDK types; the pg impl returns structurally compatible shapes. If tsc rejects the union, type the export as `typeof repoPgRepository` and confirm all callers still typecheck.

- [ ] **Step 7: Full suite + lint, commit**

Run: `npx jest && npm run lint`
Expected: all suites pass (legacy path — no DATABASE_URL locally unless exported), 0 lint errors.

```bash
git add backend/src/repositories/pg backend/src/repositories/repoRepository.ts
git commit -m "feat(db): postgres repoRepository via document-table bridge behind storage facade"
```

---

### Task 6: Boot wiring + graceful shutdown

**Files:**
- Modify: `backend/src/index.ts` (or the server entry — locate with `grep -n "listen(" backend/src/*.ts`)

**Interfaces:**
- Consumes: `isPostgresEnabled`, `getPool`, `closePool`.

- [ ] **Step 1: Startup check**

At boot, after env loading, add:

```ts
import { isPostgresEnabled, getPool, closePool } from './db/pool';

if (isPostgresEnabled()) {
  getPool()
    .query('SELECT 1')
    .then(() => logger.info('[db] Postgres connected — storage driver: postgres'))
    .catch((err: unknown) => {
      logger.error('[db] DATABASE_URL is set but Postgres is unreachable — refusing to start', err);
      process.exit(1);
    });
} else {
  logger.warn('[db] DATABASE_URL not set — running on legacy Appwrite/JSON storage');
}
```

Fail-fast rationale: a half-up SaaS silently writing to JSON files is worse than a crash.

- [ ] **Step 2: Graceful shutdown**

In the existing shutdown handler (SIGTERM/SIGINT), add `await closePool();`.

- [ ] **Step 3: Verify boot both ways**

Run: `npx ts-node src/index.ts` briefly without `DATABASE_URL` (expect the warn line), then with `DATABASE_URL=postgres://scorpion:scorpion@localhost:5432/scorpion` (expect the connected line). Ctrl-C cleanly both times.

- [ ] **Step 4: Full suite + lint + commit**

Run: `npx jest && npm run lint`

```bash
git add backend/src/index.ts
git commit -m "feat(db): fail-fast postgres boot check and pool shutdown"
```

---

## Follow-up plan boundary

The remaining repositories (`planRepository`, `deployRepository`, `threatsRepository`, `ticketsRepository`, `soarRepository`, `gateRepository`, `dashboardRepository`, `correlationRepository`, `driftRepository`, `falcoRuleRepository`, `postureRepository`, `suppressionRepository`, `threatModelRepository`, `webhookRepository`) migrate in `2026-07-XX-postgres-rollout.md` using exactly the Task 2 (config-shape) or Task 5 (document-table) recipe, one commit per repository, after this plan's pattern is validated in CI. Data migration from live Appwrite (if any production data exists) is part of that plan.
