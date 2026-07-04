# Deploy Phase (Stage 6) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close the two real Deploy-phase gaps: Kyverno-style pod-security rules in the existing k8s admission webhook, and a Flagger-style canary analysis controller with metric-driven auto-rollback.

**Architecture:** Component 1 extends `backend/src/routes/k8sAdmission.ts` with a pure `evaluatePodSecurity` function fed by a per-env rule config (Appwrite-backed repository, fail-secure in prod). Component 2 is a new BullMQ queue/worker pair (copying the dastQueue pattern) that polls Prometheus per tick, feeds a pure decision function, and on breach reuses the existing `triggerRollback` + `createIncident` + Slack flow.

**Tech Stack:** Express + TypeScript (strict, no `any`), Appwrite (node-appwrite `databases`), BullMQ + ioredis, Jest + supertest, zod validation, React 18 + Tailwind CSS-variables theme (frontend at repo-root `src/`).

## Global Constraints

- Backend files < 250 lines where feasible (backend/CLAUDE.md); no `any` types.
- Every route validates payloads at entry (zod or manual checks) and returns 4xx with clear messages.
- Fail-secure everywhere: config load failure in prod → block; missing metrics → failed canary check.
- Verify each task: `npx tsc --noEmit` clean (except pre-existing `@prisma/adapter-better-sqlite3` error), `npm run test` green, `npm run lint` clean on new files. Run from `backend/`.
- Commits: conventional format, one per task, ask user before each commit (user's git-workflow preference).
- Branch: `feat/deploy-phase` (create off current `feat/release-phase`).

---

### Task 0: Branch

- [ ] **Step 1:** `git checkout -b feat/deploy-phase`
- [ ] **Step 2:** Commit spec + this plan: `git add docs/superpowers && git commit -m "docs: deploy-phase spec and implementation plan"` (ask user first)

---

### Task 1: Pure pod-security evaluator + tests

**Files:**
- Create: `backend/src/services/podSecurityService.ts`
- Test: `backend/src/services/podSecurityService.test.ts`

**Interfaces:**
- Produces:
  ```typescript
  export type PodSecurityMode = 'enforce' | 'audit' | 'off';
  export type PodSecurityRuleId =
    | 'registry-allowlist' | 'no-privileged' | 'run-as-non-root'
    | 'drop-dangerous-capabilities' | 'read-only-root-fs'
    | 'no-host-namespaces' | 'required-labels';
  export interface PodSecurityConfig {
    modes: Record<PodSecurityRuleId, PodSecurityMode>;
    allowedRegistries: string[];   // prefixes, e.g. "registry.company.com/"
    requiredLabels: string[];      // label keys that must be present
  }
  export interface PodSecurityViolation { rule: PodSecurityRuleId; message: string; mode: 'enforce' | 'audit'; }
  export interface PodLikeSpec {
    metadata?: { labels?: Record<string, string> };
    spec?: {
      hostNetwork?: boolean; hostPID?: boolean; hostIPC?: boolean;
      volumes?: { name?: string; hostPath?: unknown }[];
      securityContext?: { runAsNonRoot?: boolean };
      containers?: PodSecurityContainer[]; initContainers?: PodSecurityContainer[];
    };
  }
  export interface PodSecurityContainer {
    name?: string; image?: string;
    securityContext?: {
      privileged?: boolean; runAsNonRoot?: boolean; readOnlyRootFilesystem?: boolean;
      capabilities?: { add?: string[] };
    };
  }
  export const DEFAULT_POD_SECURITY_CONFIG: PodSecurityConfig; // all 'audit' except no-privileged 'enforce'; empty allowlists
  export function evaluatePodSecurity(pod: PodLikeSpec, config: PodSecurityConfig): PodSecurityViolation[];
  ```
- Rule semantics (each rule skipped entirely when mode `off`; violation carries the rule's configured mode):
  - `registry-allowlist`: if `allowedRegistries` non-empty, every container+initContainer image must start with one of the prefixes. Empty allowlist → rule inert (no violation) even when enforced.
  - `no-privileged`: any container `securityContext.privileged === true` → violation.
  - `run-as-non-root`: violation unless pod-level `spec.securityContext.runAsNonRoot === true` OR the container's own `securityContext.runAsNonRoot === true` (per container).
  - `drop-dangerous-capabilities`: violation if `capabilities.add` includes any of `SYS_ADMIN`, `NET_ADMIN`, `SYS_PTRACE`, `ALL` (case-insensitive).
  - `read-only-root-fs`: violation for any container without `readOnlyRootFilesystem === true`.
  - `no-host-namespaces`: violation if `hostNetwork` / `hostPID` / `hostIPC` true, or any volume has a `hostPath` key.
  - `required-labels`: if `requiredLabels` non-empty, every listed key must exist in `metadata.labels`.
  - Malformed/missing spec sections: treat as "not proven safe" only for rules that require a positive assertion (`run-as-non-root`, `read-only-root-fs`); absence of `privileged`/`hostNetwork`/capabilities = safe.
  - Messages: human-readable, name the container, e.g. `container "app" runs privileged`, `image "nginx:latest" not from an approved registry`.

- [ ] **Step 1: Write failing tests** — `backend/src/services/podSecurityService.test.ts`. Cover: privileged blocked / absent-privileged safe; registry prefix pass+fail; empty allowlist inert; runAsNonRoot pod-level pass, container-level pass, absent fail; each dangerous capability + lowercase `sys_admin`; readOnlyRootFilesystem absent fail / true pass; hostNetwork+hostPath fail; required labels missing fail / present pass / empty list inert; mode `off` skips; mode carried on violation; multiple violations accumulate; empty pod `{}` with DEFAULT config → only positive-assertion audit violations, no crash.
- [ ] **Step 2:** `cd backend && npx jest src/services/podSecurityService.test.ts` → FAIL (module not found).
- [ ] **Step 3:** Implement `podSecurityService.ts` per semantics above. Pure — zero imports besides types. Keep < 200 lines.
- [ ] **Step 4:** Same jest command → PASS. `npx tsc --noEmit` clean.
- [ ] **Step 5:** Commit `feat(deploy): add pure pod-security rule evaluator (Kyverno-style)` (ask user).

---

### Task 2: Config repository + wire into admission webhook

**Files:**
- Create: `backend/src/repositories/podSecurityRepository.ts` (clone shape of `gateRulesRepository.ts`: Appwrite collection `pod_security_rules`, JSON-string `config` column keyed by `user_id`, local-JSON fallback at `scratch/pod_security_mock_db.json`, `get`/`save`/`flushFallback`)
- Modify: `backend/src/routes/k8sAdmission.ts` (webhook handler, after signature check, before vuln preflight)
- Modify: `backend/src/workers/fallbackReplayer.ts` (add `podSecurityRepository.flushFallback()` to tick)
- Create: `backend/src/routes/k8sAdmission.podsecurity.test.ts`
- Modify: `backend/src/routes/gateRulesRoutes.ts` (add GET/PUT `/pod-security` endpoints, zod-validated, reusing the router — config UI needs them)

**Interfaces:**
- Consumes: `evaluatePodSecurity`, `PodSecurityConfig`, `DEFAULT_POD_SECURITY_CONFIG` from Task 1; existing `withTimeout`, `SYSTEM_USER_ID`, `logDecision`, `admissionResponse`, `namespaceToEnv` in k8sAdmission.ts.
- Produces: `podSecurityRepository.get(userId): Promise<PodSecurityConfig>`; webhook behavior below.

Webhook wiring (inside the existing POST handler loop, pod-level — runs once per AdmissionReview, not per image):
```typescript
// after rules load, before per-image loop:
let podConfig: PodSecurityConfig;
try {
  podConfig = await withTimeout(podSecurityRepository.get(SYSTEM_USER_ID), GATE_TIMEOUT_MS);
} catch (err) {
  if (env === 'prod') {
    const reason = 'pod-security config unavailable — fail-closed in prod';
    logDecision({ decision: 'deny', reason, uid, namespace, env, durationMs: Date.now() - start, error: toMessage(err) });
    return res.status(200).json(admissionResponse(uid, false, reason));
  }
  podConfig = DEFAULT_POD_SECURITY_CONFIG;
}
const violations = evaluatePodSecurity({ metadata: admission.object?.metadata, spec: admission.object?.spec }, podConfig);
const enforced = violations.filter(v => v.mode === 'enforce');
const audited = violations.filter(v => v.mode === 'audit');
if (enforced.length > 0) {
  const reason = `Pod security policy violation: ${enforced.map(v => v.message).join('; ')}`;
  logDecision({ decision: 'deny', reason, uid, namespace, env, durationMs: Date.now() - start });
  return res.status(200).json(admissionResponse(uid, false, `Deployment blocked: ${reason}`));
}
for (const v of audited) warnings.push(`[audit] ${v.rule}: ${v.message}`);
```
Also extend the `AdmissionRequest` interface's `object` to include `metadata?: { labels?: Record<string,string> }` and container `securityContext`, and extend pod-level `spec` fields (hostNetwork etc.) — reuse `PodLikeSpec` types from Task 1 instead of redefining.

Routes (in gateRulesRoutes.ts):
```typescript
const podSecurityConfigSchema = z.object({
  modes: z.record(z.enum([...RULE_IDS]), z.enum(['enforce', 'audit', 'off'])),
  allowedRegistries: z.array(z.string().min(1).max(512)).max(50),
  requiredLabels: z.array(z.string().min(1).max(128)).max(50),
});
// GET /api/v1/rules/pod-security  → podSecurityRepository.get(req.user.$id)
// PUT /api/v1/rules/pod-security  → validate, podSecurityRepository.save(req.user.$id, parsed.data)
```
(zod `z.record` with enum keys yields partial record — normalize by merging over `DEFAULT_POD_SECURITY_CONFIG.modes` before save.)

- [ ] **Step 1: Write failing tests** — `k8sAdmission.podsecurity.test.ts`: supertest against express app mounting the router (mock `../repositories/podSecurityRepository`, `../repositories/gateRulesRepository` (return DEFAULT rules), `../services/imageStore` (getScan→undefined, getSignature→undefined), `../services/cosignService`, `../services/logger`). Cases: (a) privileged container + enforce mode → allowed:false, message contains "runs privileged"; (b) same in audit mode → allowed depends on vuln gate but message contains `[audit]` warning (use dev namespace so unknown-reachability warns instead of blocks); (c) repository.get rejects + namespace prod → deny "fail-closed"; (d) repository.get rejects + namespace dev → falls back to defaults, no crash; (e) clean pod, enforce config → passes pod-security, proceeds to image gate.
- [ ] **Step 2:** Run → FAIL.
- [ ] **Step 3:** Implement repository, webhook wiring, routes, fallbackReplayer line.
- [ ] **Step 4:** Full `npm run test` green + tsc clean + lint new files.
- [ ] **Step 5:** Commit `feat(deploy): enforce Kyverno-style pod-security policies in admission webhook` (ask user).

---

### Task 3: Pure canary decision function + tests

**Files:**
- Create: `backend/src/gitops/canaryAnalysis.ts`
- Test: `backend/src/gitops/canaryAnalysis.test.ts`

**Interfaces:**
- Produces:
  ```typescript
  export interface CanaryThresholds { maxErrorRatePct: number; maxP95LatencyMs?: number; }
  export interface CanaryCheckInput {
    errorRatePct: number | null;    // null = metric unavailable
    p95LatencyMs: number | null;
  }
  export interface CanaryCheckResult { passed: boolean; reason: string; }
  export interface CanaryProgress { consecutiveFailures: number; passedChecks: number; }
  export type CanaryVerdict = 'continue' | 'promote' | 'rollback';
  export function evaluateCanaryCheck(input: CanaryCheckInput, thresholds: CanaryThresholds): CanaryCheckResult;
  export function nextCanaryState(prev: CanaryProgress, check: CanaryCheckResult, maxFailures: number, requiredChecks: number): { progress: CanaryProgress; verdict: CanaryVerdict };
  ```
- Semantics:
  - `evaluateCanaryCheck`: fail if `errorRatePct === null` (reason "error-rate metric unavailable — fail-secure"); fail if `errorRatePct > maxErrorRatePct`; if `maxP95LatencyMs` set: fail if `p95LatencyMs === null` or `> maxP95LatencyMs`. Latency ignored entirely when threshold unset. Pass reason: `error rate 0.4% ≤ 2%`.
  - `nextCanaryState`: pass → `consecutiveFailures: 0`, `passedChecks + 1`; fail → `consecutiveFailures + 1`, passedChecks unchanged. Verdict `rollback` when new consecutiveFailures ≥ maxFailures; `promote` when new passedChecks ≥ requiredChecks; else `continue`. Rollback checked before promote.

- [ ] **Step 1: Write failing tests**: threshold breach fails; under-threshold passes; boundary (equal = pass); null error rate fails; latency null fails only when threshold set; latency ignored when unset; pass resets consecutiveFailures; maxFailures reached → rollback; requiredChecks reached → promote; interleaved fail/pass sequence ends in promote; rollback wins if both conditions somehow met.
- [ ] **Step 2:** Run → FAIL. **Step 3:** Implement (pure, < 100 lines). **Step 4:** PASS + tsc.
- [ ] **Step 5:** Commit `feat(deploy): add pure canary analysis decision core` (ask user).

---

### Task 4: Prometheus metric source

**Files:**
- Create: `backend/src/gitops/prometheusMetrics.ts`
- Test: `backend/src/gitops/prometheusMetrics.test.ts`

**Interfaces:**
- Produces:
  ```typescript
  export interface CanaryMetrics { errorRatePct: number | null; p95LatencyMs: number | null; }
  export function queryCanaryMetrics(app: string, namespace: string): Promise<CanaryMetrics>;
  ```
- Implementation: `axios.get(`${PROMETHEUS_URL}/api/v1/query`, { params: { query }, timeout: 5000 })` against `process.env.PROMETHEUS_URL` (unset → both metrics null, one warn log). Queries (rate over 5m, standard http metric names, app matched by label):
  - error rate: `100 * sum(rate(http_requests_total{app="<app>",namespace="<ns>",status=~"5.."}[5m])) / sum(rate(http_requests_total{app="<app>",namespace="<ns>"}[5m]))`
  - p95: `1000 * histogram_quantile(0.95, sum(rate(http_request_duration_seconds_bucket{app="<app>",namespace="<ns>"}[5m])) by (le))`
  - Escape `"` and `\` in app/namespace before interpolation. Parse `data.result[0].value[1]`; missing/NaN/non-`success` status/HTTP error → null (never throw). Each metric independently null.

- [ ] **Step 1: Failing tests** (mock axios): valid response parses; empty result → null; axios reject → null; NaN value → null; PROMETHEUS_URL unset → nulls without calling axios; label values escaped.
- [ ] **Step 2:** FAIL. **Step 3:** Implement. **Step 4:** PASS + tsc.
- [ ] **Step 5:** Commit `feat(deploy): add Prometheus canary metric source` (ask user).

---

### Task 5: Canary service + queue/worker + routes

**Files:**
- Create: `backend/src/gitops/canaryService.ts`
- Create: `backend/src/queues/canaryQueue.ts` (clone dastQueue shape: queue name `canary-analysis`, `enqueueCanaryCheck(payload, delayMs)` using `{ delay: delayMs, jobId: `canary-${canaryId}-${tick}` }`)
- Create: `backend/src/queues/canaryQueueWorker.ts` (clone dastQueueWorker: `initCanaryQueueWorker`, concurrency 4)
- Create: `backend/src/routes/canaryRoutes.ts`
- Modify: `backend/src/index.ts` (import + `app.use('/api/canary', authenticate, canaryRoutes)` next to other routes; `initCanaryQueueWorker()` next to the other init calls)
- Modify: `backend/src/lib/appwrite.ts` (add `CANARIES: 'canaries'` to COLLECTIONS)
- Modify: `backend/src/services/auditService.ts` (extend AuditAction union: `'canary.started' | 'canary.promoted' | 'canary.rolled_back' | 'canary.aborted'`)
- Test: `backend/src/gitops/canaryService.test.ts`, `backend/src/routes/canaryRoutes.test.ts`

**Interfaces:**
- Consumes: Task 3 + 4 exports; `triggerRollback` from `./rollbackService`; `createIncident` from `../services/incidentService`; `auditLog`; appwrite `databases/DB_ID/COLLECTIONS/ID/Query`.
- Produces:
  ```typescript
  // canaryService.ts
  export interface StartCanaryInput {
    app: string; namespace: string; image: string; repo: string;
    stableRevision: string; canaryRevision: string;
    thresholds: CanaryThresholds;
    intervalSec: number; maxFailures: number; requiredChecks: number;
    userId: string;
  }
  export async function startCanary(input: StartCanaryInput): Promise<{ canaryId: string }>;
  export async function runCanaryTick(canaryId: string, tick: number): Promise<void>; // worker entry
  export async function abortCanary(canaryId: string, userId: string): Promise<void>;
  export interface CanaryWorkerPayload { canaryId: string; tick: number; }
  ```
- `startCanary`: create Appwrite doc in `CANARIES` — fields `{ user_id, app, namespace, image, repo, stableRevision, canaryRevision, thresholds: JSON string, intervalSec, maxFailures, requiredChecks, status: 'running', consecutiveFailures: 0, passedChecks: 0, checks: JSON string '[]', startedAt ISO }`; clamp inputs (intervalSec 10–3600, maxFailures 1–10, requiredChecks 1–100); enqueue tick 1 with delay `intervalSec * 1000`; auditLog `canary.started`.
- `runCanaryTick`: load doc; if status !== 'running' → return (terminal/aborted while queued). Query metrics → `evaluateCanaryCheck` → `nextCanaryState`. Append check entry `{ at: ISO, errorRatePct, p95LatencyMs, passed, reason }` to parsed `checks` (cap stored array at last 50). Verdict:
  - `continue` → update doc (progress + checks), enqueue tick+1 with same delay.
  - `promote` → status 'promoted', promotedAt; auditLog `canary.promoted`.
  - `rollback` → status 'rolled_back'; `triggerRollback({ app, image, revision: canaryRevision, repo, criticalCount: 0 })` wrapped in try/catch (log failure, still record status — rollback PR failure must not crash tick); `createIncident({ title: 'Canary rolled back: <app>', severity: 'High', source: 'gitops', description: <last check reason>, userId })`; auditLog `canary.rolled_back`.
  - Whole tick body in try/catch; on unexpected error log + rethrow (BullMQ retry).
- `abortCanary`: load doc, verify `user_id === userId` (else throw `CanaryAccessError`), if running → status 'aborted', abortedAt; auditLog `canary.aborted`. No rollback PR.
- Routes (all behind `authenticate` mount; same AuthenticatedRequest pattern as dastRoutes):
  - `POST /` — zod schema: app/namespace/image/repo/stableRevision/canaryRevision `z.string().min(1).max(512)`, thresholds `{ maxErrorRatePct: z.number().min(0).max(100), maxP95LatencyMs: z.number().positive().optional() }`, intervalSec/maxFailures/requiredChecks positive ints with the clamp ranges. → 202 `{ canaryId, status: 'running' }`.
  - `GET /` — list caller's canaries (`Query.equal('user_id', userId)`, orderDesc `$createdAt`, limit 50), parse `checks`/`thresholds` JSON in response.
  - `GET /:id` — ownership check → doc with parsed checks. 404 unknown, 403 foreign.
  - `POST /:id/abort` — → `{ status: 'aborted' }`; 403 foreign; 409 if already terminal.

- [ ] **Step 1: Failing tests.** Service (mock appwrite/rollbackService/incidentService/auditService/prometheusMetrics/canaryQueue): breach path triggers rollback+incident+status; promote path sets promoted and does NOT re-enqueue; continue path re-enqueues tick+1; non-running doc → no-op; rollback PR throw doesn't prevent status update. Routes (supertest, mock canaryService + appwrite): 202 on valid start; 400 on missing app / bad thresholds; GET list scoped to user; abort 403 foreign / 409 terminal.
- [ ] **Step 2:** FAIL. **Step 3:** Implement all files + index.ts wiring + COLLECTIONS + AuditAction. **Step 4:** Full suite + tsc + lint.
- [ ] **Step 5:** Commit `feat(deploy): add Flagger-style canary analysis controller with auto-rollback` (ask user).

---

### Task 6: Frontend — Canary panel + Pod-security rules panel

**Files:**
- Create: `src/components/CanaryPanel.tsx` (used inside Deploy page)
- Create: `src/components/PodSecurityRulesPanel.tsx`
- Modify: `src/pages/Deploy.tsx` (render `<CanaryPanel />` below env grid and `<PodSecurityRulesPanel />` below that; both full-width sections)

**Interfaces:**
- Consumes: `useAuth().getJWT()` bearer-fetch pattern exactly as `PolicyBuilder.tsx`; endpoints `GET/POST /api/canary`, `POST /api/canary/:id/abort`, `GET/PUT /api/v1/rules/pod-security`. Styling: `premium-card`, `btn-premium`, `btn-ghost`, CSS-variable tokens, uppercase-label conventions from PolicyBuilder.
- CanaryPanel: "Start Canary" collapsible form (app, namespace, image, repo, stable/canary revisions, maxErrorRate%, optional p95 ms, interval s, maxFailures, requiredChecks) → POST, toast result; list of canaries with status badge (running amber pulse / promoted emerald / rolled_back red / aborted gray), per-canary check timeline (dots: pass emerald, fail red, hover = reason tooltip via `title`), Abort button on running rows (confirm → POST abort). Poll list every 10s (setInterval + cleanup, same as Deploy.tsx pattern).
- PodSecurityRulesPanel: GET config on mount; 7 rows (rule name + 3-way mode select enforce/audit/off), textarea for allowed registries (one per line), textarea for required labels (one per line); Save → PUT, toast. Typed `PodSecurityConfig` interface mirroring backend.

- [ ] **Step 1:** Implement both components + Deploy.tsx integration (UI: manual verification, no component test — matches repo convention; frontend suite has no per-page tests for Deploy).
- [ ] **Step 2:** From repo root: `npx tsc --noEmit` (frontend tsconfig) clean; `npm run lint` clean on new files; `npm run build` succeeds.
- [ ] **Step 3:** Commit `feat(deploy): canary + pod-security panels on Deploy page` (ask user).

---

### Task 7: Docs

**Files:**
- Create: `docs/lifecycle/deploy-phase.md` (what was built, what already existed, what's deliberately deferred — same format as `docs/lifecycle/test-phase.md`)
- Modify: `README.md` feature matrix Deploy row if present

- [ ] **Step 1:** Write doc: existing (ArgoCD gate, admission vuln+signature, drift, rollback PR), new (pod-security rules table w/ modes, canary controller flow diagram in text, fail-secure notes, env vars `PROMETHEUS_URL`), deferred (traffic shifting = mesh's job, GitOps pull agent = ArgoCD integration seam, YAML policy authoring).
- [ ] **Step 2:** Commit `docs: document Deploy phase (admission policies + canary analysis)` (ask user).

---

## Self-review notes

- Spec coverage: rule catalog ✔ (Task 1), per-env modes — simplified to single cluster-scoped config with per-rule mode (env-differentiation happens via prod-only fail-closed, consistent with existing gate rules being cluster-scoped under SYSTEM_USER_ID); registry allowlist + required labels ✔; deny lists all violations ✔; check order signature→pod-security→vuln ✔; canary model/loop/decision/API/UI ✔; error handling ✔; build order matches spec ✔.
- Deviation from spec (documented): spec said "per-env, per-rule mode". Existing gateRules pattern is one cluster-scoped config; matching it keeps admission-path reads to ONE doc within the 2s budget. Audit/enforce/off per rule preserved; prod-vs-lower-env difference preserved via fail-closed semantics. Flag to user at review.
