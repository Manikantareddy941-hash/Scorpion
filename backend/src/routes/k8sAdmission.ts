import { Router, Request, Response } from 'express';
import * as assert from 'assert';
import { logger } from '../services/logger';
import { getScan, getSignature, type Tenant } from '../services/imageStore';
import { isPostgresEnabled } from '../db/pool';
import { ciTokenRepository } from '../repositories/pg/ciTokenRepository';
import { verifyImageDigest } from '../services/cosignService';
import { VulnerablePackage, ReachabilityResult } from '../services/reachabilityService';
import { gateRulesRepository } from '../repositories/gateRulesRepository';
import { podSecurityRepository } from '../repositories/podSecurityRepository';
import {
  evaluatePodSecurity,
  DEFAULT_POD_SECURITY_CONFIG,
  PodSecurityConfig,
  PodLikeSpec,
} from '../services/podSecurityService';

/**
 * Kubernetes ValidatingWebhook. The kube-apiserver POSTs an AdmissionReview for
 * every Pod create/update; we answer allowed:true/false. Called by the apiserver
 * (not an authenticated user) so this router is mounted WITHOUT auth middleware.
 */

const router = Router();

// --- Ported pure preflight core ---------------------------------------------
// Source of truth: src/components/GateRulesDrawer.tsx (evaluatePreflight). That
// module is React/localStorage-bound and cannot be imported here, so the pure
// classifier is duplicated. ponytail: keep in sync by hand until a shared pkg
// exists; extract both to a workspace package if this drifts.

type GateSeverity = 'critical' | 'high' | 'medium' | 'low';
type GateAction = 'block' | 'warn';
type GateEnv = 'dev' | 'stage' | 'prod';
type Reachability = 'reachable' | 'unreachable' | 'unknown';

interface GateRule {
  severity: GateSeverity;
  threshold: number;
  action: GateAction;
  enabled: boolean;
}

interface PreflightResult {
  status: 'blocked' | 'warning' | 'ready';
  reason: string;
}

const DEFAULT_RULES: GateRule[] = [
  { severity: 'critical', threshold: 0, action: 'block', enabled: true },
  { severity: 'high', threshold: 5, action: 'warn', enabled: true },
];

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

export function evaluatePreflight(
  rules: GateRule[],
  counts: Record<GateSeverity, number>,
  env: GateEnv = 'prod',
  reachability?: Reachability
): PreflightResult {
  if (reachability === 'reachable') {
    return { status: 'blocked', reason: 'Vulnerable dependency is reachable' };
  }
  if (reachability === 'unreachable') {
    return { status: 'ready', reason: 'Vulnerable dependency is unreachable' };
  }
  if (reachability === 'unknown') {
    return env === 'prod'
      ? { status: 'blocked', reason: `Reachability unknown — blocked in ${env}` }
      : { status: 'warning', reason: `Reachability unknown — warning in ${env}` };
  }

  const active = rules.filter(r => r.enabled);
  const hit = (r: GateRule) => (counts[r.severity] ?? 0) > r.threshold;
  const blocked = active.find(r => r.action === 'block' && hit(r));
  if (blocked) return { status: 'blocked', reason: `Violates rule: ${cap(blocked.severity)} > ${blocked.threshold}` };
  const warned = active.find(r => r.action === 'warn' && hit(r));
  if (warned) return { status: 'warning', reason: `Violates rule: ${cap(warned.severity)} > ${warned.threshold}` };
  return { status: 'ready', reason: 'Meets all gate rules' };
}

// --- Webhook glue ------------------------------------------------------------

const EMPTY_COUNTS: Record<GateSeverity, number> = { critical: 0, high: 0, medium: 0, low: 0 };

// Hard ceiling on gate evaluation. The kube-apiserver aborts the admission call
// at its own webhook timeout; we self-impose a stricter 2s budget so a slow
// Appwrite read can never stall pod admission cluster-wide.
const GATE_TIMEOUT_MS = 2000;

// The apiserver is the caller, so there is no authenticated user. Gate config is
// cluster-scoped: stored under one well-known "system" account, overridable per
// deployment via env.
const SYSTEM_USER_ID = process.env.K8S_GATE_RULES_USER_ID || 'system';

function toMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/** Reject if the wrapped promise has not settled within `ms`. Timer is cleared
 *  on settle so a resolved read never leaks a dangling handle. */
function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  let timer: NodeJS.Timeout;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`gate evaluation timed out after ${ms}ms`)), ms);
  });
  return Promise.race([p, timeout]).finally(() => clearTimeout(timer));
}

interface AdmissionLog {
  decision: 'allow' | 'deny';
  reason: string;
  uid: string;
  namespace?: string;
  env: GateEnv;
  image?: string;
  durationMs: number;
  error?: string;
}

/** Single structured JSON line per admission decision. winston merges the meta
 *  object into the JSON output, so every field above is queryable in Loki. */
function logDecision(entry: AdmissionLog): void {
  logger.info('k8s-admission', { event: 'k8s-admission', ...entry });
}

/**
 * Load the cluster gate rules within the timeout budget. gateRulesRepository
 * already degrades Appwrite → local JSON internally; this guards the remaining
 * failure mode (a hung read) and enforces fail-closed: in prod any error blocks
 * admission, in lower envs we degrade to the built-in defaults.
 */
async function loadRulesOrFailClosed(env: GateEnv): Promise<GateRule[]> {
  try {
    const config = await withTimeout(gateRulesRepository.get(SYSTEM_USER_ID), GATE_TIMEOUT_MS);
    return config.rules;
  } catch (err) {
    if (env === 'prod') throw err;
    logger.warn('[k8s-admission] gate rules unavailable, using built-in defaults', {
      env,
      error: toMessage(err),
    });
    return DEFAULT_RULES;
  }
}

/**
 * Namespace → env. Fail-closed: namespaces are arbitrary, attacker-controllable
 * strings, so anything not explicitly a lower env is treated as prod (the
 * strictest gate). Mapping unknown namespaces to a lenient env would let a vuln
 * image into a namespace named "dev"/"default" and skip the block.
 */
export function namespaceToEnv(ns: string): GateEnv {
  const n = (ns || '').toLowerCase();
  if (n === 'dev' || n === 'development') return 'dev';
  if (n === 'stage' || n === 'staging') return 'stage';
  return 'prod';
}

export interface Signal {
  counts: Record<GateSeverity, number>;
  reachability?: Reachability;
}

const SEVERITIES: GateSeverity[] = ['critical', 'high', 'medium', 'low'];

// Per-image scan-store read deadline. The kube-apiserver enforces a ~2s webhook
// budget; a Redis latency spike inside getScan must never consume it. Cap the
// lookup at 1.5s with an AbortController and fail secure ('unknown') on breach,
// so the env gate still blocks in prod while leaving ~0.5s for the rest.
const IMAGE_LOOKUP_TIMEOUT_MS = 1500;

const TIMED_OUT = Symbol('image-lookup-timeout');

const UNKNOWN_SIGNAL: Signal = { counts: EMPTY_COUNTS, reachability: 'unknown' };

/** Digest portion of an image ref (`repo@sha256:...` → `sha256:...`). */
export function imageDigest(image: string): string | undefined {
  const at = image.lastIndexOf('@');
  return at >= 0 ? image.slice(at + 1) : undefined;
}

function countBySeverity(pkgs: VulnerablePackage[]): Record<GateSeverity, number> {
  const counts: Record<GateSeverity, number> = { ...EMPTY_COUNTS };
  for (const p of pkgs) {
    const s = (p.severity ?? '').toLowerCase();
    if ((SEVERITIES as string[]).includes(s)) counts[s as GateSeverity]++;
  }
  return counts;
}

/**
 * Aggregate per-package reachability into one image verdict. Any reachable vuln
 * → reachable (block). All proven unreachable → unreachable (ready). A mix with
 * unproven entries → unknown (env gate decides). No verdicts at all → undefined,
 * so resolveSignal falls back to count-based rules.
 */
function aggregateReachability(pkgs: VulnerablePackage[]): Reachability | undefined {
  const verdicts = pkgs
    .map(p => (p as Partial<ReachabilityResult>).reachability)
    .filter((r): r is Reachability => r === 'reachable' || r === 'unreachable' || r === 'unknown');
  if (verdicts.length === 0) return undefined;
  if (verdicts.includes('reachable')) return 'reachable';
  if (verdicts.every(r => r === 'unreachable')) return 'unreachable';
  return 'unknown';
}

/**
 * Resolve the risk signal for an image by looking up its digest in the scan
 * store (populated by POST /api/v1/ingest/scan). Found → gate on the scan's
 * reachability verdict (if any) plus severity counts. Not found (tag-only ref,
 * or never scanned) → reachability:'unknown', fail-secure: the env gate blocks
 * in prod, warns in lower envs.
 */
export async function resolveSignal(image: string, tenant: Tenant = null): Promise<Signal> {
  const digest = imageDigest(image);
  if (!digest) return UNKNOWN_SIGNAL;

  // AbortController fires the deadline; getScan can't be cancelled mid-read, so
  // abort just resolves the race to the fail-secure branch and the orphaned read
  // completes harmlessly into the LRU. clearTimeout on the happy path avoids a
  // leaked handle.
  const controller = new AbortController();
  const deadline = setTimeout(() => controller.abort(), IMAGE_LOOKUP_TIMEOUT_MS);
  const aborted = new Promise<typeof TIMED_OUT>(resolve => {
    controller.signal.addEventListener('abort', () => resolve(TIMED_OUT), { once: true });
  });

  try {
    const pkgs = await Promise.race([getScan(tenant, digest), aborted]);
    if (pkgs === TIMED_OUT) {
      logger.warn('[k8s-admission] image lookup exceeded budget — fail-secure unknown', {
        image,
        timeoutMs: IMAGE_LOOKUP_TIMEOUT_MS,
      });
      return UNKNOWN_SIGNAL;
    }
    if (!pkgs) return UNKNOWN_SIGNAL;
    return { counts: countBySeverity(pkgs), reachability: aggregateReachability(pkgs) };
  } finally {
    clearTimeout(deadline);
  }
}

/**
 * Supply-chain gate: require a valid cosign signature for the image.
 *
 * Opt-in and fail-secure. Only active when REQUIRE_IMAGE_SIGNATURE === 'true'
 * AND the target env is prod (lower envs are never blocked on signatures, so
 * dev/stage keep working). When active:
 *   - no signature on record for the digest  -> block (unsigned)
 *   - signature present but verify() is false -> block (tampered/mismatched)
 *   - verify() throws (cosign missing / no pubkey) -> block (cannot prove — the
 *     operator enabled enforcement, so an unverifiable image must not deploy)
 * Default-off means zero behavior change for installs that don't opt in.
 */
export async function checkImageSignature(
  image: string,
  env: string,
  tenant: Tenant = null
): Promise<{ status: 'ready' | 'blocked'; reason: string }> {
  if (process.env.REQUIRE_IMAGE_SIGNATURE !== 'true' || env !== 'prod') {
    return { status: 'ready', reason: 'signature enforcement off' };
  }
  const digest = imageDigest(image);
  if (!digest) {
    return { status: 'blocked', reason: 'unsigned image — no digest to verify (use an @sha256 pinned ref)' };
  }
  const signature = await getSignature(tenant, digest);
  if (!signature) {
    return { status: 'blocked', reason: 'unsigned image — no signature on record from the build pipeline' };
  }
  try {
    const ok = await verifyImageDigest(digest, signature);
    return ok
      ? { status: 'ready', reason: 'signature verified' }
      : { status: 'blocked', reason: 'image signature verification failed (tampered or substituted)' };
  } catch (err) {
    return { status: 'blocked', reason: `cannot verify image signature: ${toMessage(err)}` };
  }
}

interface K8sContainer { image?: string }
interface AdmissionRequest {
  uid?: string;
  namespace?: string;
  // Pod manifest — the container list feeds the image gate, the full shape
  // (labels, securityContext, host flags) feeds the pod-security rules.
  object?: PodLikeSpec & { spec?: { containers?: K8sContainer[]; initContainers?: K8sContainer[] } };
}

function extractImages(req: AdmissionRequest): string[] {
  const spec = req.object?.spec;
  const all = [...(spec?.containers ?? []), ...(spec?.initContainers ?? [])];
  return all.map(c => c?.image).filter((i): i is string => typeof i === 'string' && i.length > 0);
}

function admissionResponse(uid: string, allowed: boolean, message: string) {
  return {
    apiVersion: 'admission.k8s.io/v1',
    kind: 'AdmissionReview',
    response: { uid, allowed, status: { message } },
  };
}

/**
 * Resolves the calling cluster's tenant from the token in the webhook URL.
 *
 * A ValidatingWebhookConfiguration exposes only `url`, `service` and
 * `caBundle` — it cannot send custom headers — so the token has to ride the
 * path. redactUrl() keeps it out of logs.
 *
 * Returns `undefined` for an invalid token, which the caller treats as a denied
 * request rather than falling back to the shared namespace: silently reading
 * another namespace on a bad credential is how a gate starts lying.
 */
async function resolveClusterTenant(token: string | undefined): Promise<Tenant | undefined> {
  // No token: the legacy single-tenant deployment, reading the shared namespace.
  if (!token) return null;
  if (!isPostgresEnabled()) return null;
  const identity = await ciTokenRepository.verify(token, 'admission');
  if (!identity) return undefined;
  return identity.team_id ?? identity.user_id;
}

// POST /api/v1/webhook/k8s-admission[/:token]
router.post(['/k8s-admission', '/k8s-admission/:token'], async (req: Request, res: Response) => {
  const start = Date.now();
  const review = req.body as { request?: AdmissionRequest } | undefined;
  const admission = review?.request;
  const uid = admission?.uid ?? '';
  const namespace = admission?.namespace;
  const env = namespaceToEnv(namespace ?? '');

  // Malformed payload: fail closed. (uid may be empty here; the apiserver will
  // surface a uid-mismatch, which is the correct safe outcome for junk input.)
  if (!admission || !uid) {
    logDecision({ decision: 'deny', reason: 'invalid AdmissionReview payload', uid, namespace, env, durationMs: Date.now() - start });
    return res.status(200).json(admissionResponse(uid, false, 'Invalid AdmissionReview payload'));
  }

  // Registering both paths on one handler widens the param type; only the
  // single-segment form is ever matched.
  const tokenParam = req.params.token;
  const tenant = await resolveClusterTenant(Array.isArray(tokenParam) ? tokenParam[0] : tokenParam);
  if (tenant === undefined) {
    // Fail closed. The cluster's failurePolicy decides whether that blocks the
    // deploy or opens it — that call belongs to the cluster admin, not here.
    const reason = 'unrecognised or revoked admission token';
    logDecision({ decision: 'deny', reason, uid, namespace, env, durationMs: Date.now() - start });
    return res.status(200).json(admissionResponse(uid, false, reason));
  }

  const images = extractImages(admission);

  let rules: GateRule[];
  try {
    rules = await loadRulesOrFailClosed(env);
  } catch (err) {
    // Prod fail-closed: gate rules could not be loaded within budget → block.
    const reason = 'gate rules unavailable — fail-closed in prod';
    logDecision({ decision: 'deny', reason, uid, namespace, env, durationMs: Date.now() - start, error: toMessage(err) });
    return res.status(200).json(admissionResponse(uid, false, reason));
  }

  // Pod-security gate (Kyverno-style): config-driven checks over the pod spec
  // itself — registry allowlist, privileged, runAsNonRoot, capabilities, host
  // namespaces, labels. Static and cheap, so it runs before the scan-backed
  // image gate. Fail-closed in prod when the config cannot be loaded.
  let podConfig: PodSecurityConfig;
  try {
    podConfig = await withTimeout(podSecurityRepository.get(SYSTEM_USER_ID), GATE_TIMEOUT_MS);
  } catch (err) {
    if (env === 'prod') {
      const reason = 'pod-security config unavailable — fail-closed in prod';
      logDecision({ decision: 'deny', reason, uid, namespace, env, durationMs: Date.now() - start, error: toMessage(err) });
      return res.status(200).json(admissionResponse(uid, false, reason));
    }
    logger.warn('[k8s-admission] pod-security config unavailable, using built-in defaults', {
      env,
      error: toMessage(err),
    });
    podConfig = DEFAULT_POD_SECURITY_CONFIG;
  }

  const warnings: string[] = [];
  const podViolations = evaluatePodSecurity(admission.object ?? {}, podConfig);
  const enforcedViolations = podViolations.filter(v => v.mode === 'enforce');
  if (enforcedViolations.length > 0) {
    const reason = `Pod security policy violation: ${enforcedViolations.map(v => v.message).join('; ')}`;
    logDecision({ decision: 'deny', reason, uid, namespace, env, durationMs: Date.now() - start });
    return res.status(200).json(admissionResponse(uid, false, `Deployment blocked: ${reason}`));
  }
  for (const v of podViolations.filter(x => x.mode === 'audit')) {
    warnings.push(`[audit] ${v.rule}: ${v.message}`);
  }

  for (const image of images) {
    // Supply-chain gate first: an unsigned/tampered image is rejected before we
    // even weigh its vulnerabilities (opt-in via REQUIRE_IMAGE_SIGNATURE).
    const sig = await checkImageSignature(image, env, tenant);
    if (sig.status === 'blocked') {
      logDecision({ decision: 'deny', reason: sig.reason, uid, namespace, env, image, durationMs: Date.now() - start });
      return res.status(200).json(admissionResponse(uid, false, `${image}: ${sig.reason}`));
    }

    const { counts, reachability } = await resolveSignal(image, tenant);
    const result = evaluatePreflight(rules, counts, env, reachability);
    if (result.status === 'blocked') {
      logDecision({ decision: 'deny', reason: result.reason, uid, namespace, env, image, durationMs: Date.now() - start });
      return res.status(200).json(admissionResponse(uid, false, `${image}: ${result.reason}`));
    }
    if (result.status === 'warning') warnings.push(`${image}: ${result.reason}`);
  }

  // Admitted, but surface warn-level findings so they show up in the response badge.
  const message = warnings.length ? `Warning — ${warnings.join('; ')}` : 'All images pass the release gate';
  logDecision({ decision: 'allow', reason: warnings.length ? 'admitted with warnings' : 'all images pass the release gate', uid, namespace, env, durationMs: Date.now() - start });
  return res.status(200).json(admissionResponse(uid, true, message));
});

export default router;

// ponytail: one runnable self-check of the pure gate + fail-closed mapping.
// Runs only via `node k8sAdmission.js`, never under jest — excluded from coverage.
/* istanbul ignore next */
if (require.main === module) {
  // unknown reachability: prod blocks, lower envs warn (allowed)
  assert.strictEqual(evaluatePreflight(DEFAULT_RULES, EMPTY_COUNTS, 'prod', 'unknown').status, 'blocked');
  assert.strictEqual(evaluatePreflight(DEFAULT_RULES, EMPTY_COUNTS, 'dev', 'unknown').status, 'warning');
  // reachable always blocks; unreachable always ready
  assert.strictEqual(evaluatePreflight(DEFAULT_RULES, EMPTY_COUNTS, 'dev', 'reachable').status, 'blocked');
  assert.strictEqual(evaluatePreflight(DEFAULT_RULES, EMPTY_COUNTS, 'prod', 'unreachable').status, 'ready');
  // count-based rules when no reachability verdict
  assert.strictEqual(evaluatePreflight(DEFAULT_RULES, { ...EMPTY_COUNTS, critical: 1 }, 'dev').status, 'blocked');
  assert.strictEqual(evaluatePreflight(DEFAULT_RULES, { ...EMPTY_COUNTS, high: 6 }, 'dev').status, 'warning');
  // fail-closed: arbitrary namespace → prod
  assert.strictEqual(namespaceToEnv('default'), 'prod');
  assert.strictEqual(namespaceToEnv('kube-system'), 'prod');
  assert.strictEqual(namespaceToEnv('staging'), 'stage');
  // digest extraction + severity counting
  assert.strictEqual(imageDigest('repo/app@sha256:abc'), 'sha256:abc');
  assert.strictEqual(imageDigest('repo/app:v1'), undefined);
  assert.deepStrictEqual(
    countBySeverity([{ pkgName: 'a', severity: 'Critical' }, { pkgName: 'b', severity: 'low' }, { pkgName: 'c' }]),
    { critical: 1, high: 0, medium: 0, low: 1 }
  );
  // unscanned digest → fail-secure unknown (blocks in prod)
  void (async () => {
    assert.strictEqual((await resolveSignal('repo/app@sha256:never-scanned')).reachability, 'unknown');
  })();
  // withTimeout rejects a hung promise within budget
  void (async () => {
    let rejected = false;
    try {
      await withTimeout(new Promise(() => {}), 10);
    } catch {
      rejected = true;
    }
    assert.strictEqual(rejected, true, 'withTimeout should reject a hung promise');
    console.log('k8sAdmission self-check passed');
  })();
}
