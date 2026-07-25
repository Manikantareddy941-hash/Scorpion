import { Router, Request, Response } from 'express';
import { rateLimit, ipKeyGenerator } from 'express-rate-limit';
import { z } from 'zod';
import { putScan } from '../services/imageStore';
import { recordScanResult, summarizeSeverity } from '../services/scanAudit';
import { VulnerablePackage } from '../services/reachabilityService';
import { requireCiApiKey } from '../middleware/ciApiKey';
import { ingestSarif } from '../services/sarifIngestService';
import { logger } from '../services/logger';

/**
 * CI pipeline pushes scan results here, keyed by image digest, so the K8s
 * admission webhook can gate on them later.
 *
 * Trust boundary: requireCiApiKey authenticates the runner, the Zod schema
 * rejects malformed payloads before anything reaches the store. Anyone able to
 * POST a clean scan here can bypass the gate — both checks are load-bearing.
 */
const router = Router();

// Mirrors VulnerablePackage; strict() rejects unexpected keys outright.
const vulnerablePackageSchema = z.object({
  pkgName: z.string().min(1),
  installedVersion: z.string().optional(),
  vulnerabilityId: z.string().optional(),
  severity: z.string().optional(),
  fixedVersion: z.string().optional(),
}).strict() satisfies z.ZodType<VulnerablePackage>;

const ingestScanSchema = z.object({
  imageDigest: z.string().min(1),
  results: z.array(vulnerablePackageSchema).max(10_000),
  // Optional cosign blob-signature of the image digest, produced by the CI
  // signing step. Recorded so the K8s admission webhook can enforce signed
  // images when REQUIRE_IMAGE_SIGNATURE is enabled.
  imageSignature: z.string().min(1).optional(),
}).strict();

const clientIp = (req: Request): string => req.ip ?? req.socket.remoteAddress ?? 'unknown';

// Caps per-runner ingest throughput so a misfiring CI matrix can't flood the
// in-memory scan store. Keyed by the CI API key (the machine identity) so one
// runner's burst can't starve another; falls back to IP for unkeyed requests.
// ponytail: memory store = per-replica limit. Swap rate-limit-redis if ingest
// runs multi-replica and the cap must be global.
const RATE_WINDOW_MS = 60_000;
const RATE_MAX_PER_WINDOW = 120;

const ingestRateLimiter = rateLimit({
  windowMs: RATE_WINDOW_MS,
  limit: RATE_MAX_PER_WINDOW,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req: Request): string => req.header('x-api-key') ?? ipKeyGenerator(req.ip ?? 'unknown'),
  handler: (req: Request, res: Response) => {
    logger.warn('ci-ingest rate limited', {
      event: 'ci_ingest_rate_limited',
      clientIp: clientIp(req),
      method: req.method,
      path: req.originalUrl,
    });
    return res.status(429).json({ error: 'Too many requests' });
  },
});

// POST /api/v1/ingest/scan
// Rate limit before auth so abusive callers are shed without a crypto compare.
router.post('/scan', ingestRateLimiter, requireCiApiKey, async (req: Request, res: Response) => {
  try {
    const parsed = ingestScanSchema.safeParse(req.body);
    if (!parsed.success) {
      logger.warn('ci-ingest validation failure', {
        event: 'ci_ingest_validation_failure',
        clientIp: clientIp(req),
        method: req.method,
        path: req.originalUrl,
        issues: parsed.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
      });
      return res.status(400).json({ error: 'Invalid scan payload', details: parsed.error.flatten() });
    }

    const { imageDigest, results, imageSignature } = parsed.data;
    // req.ciTenant is set by requireCiApiKey from the presented token, never
    // from the request body — a body-supplied tenant would let one customer
    // write into another's namespace.
    await putScan(req.ciTenant ?? null, imageDigest, results, Date.now(), imageSignature);
    // Best-effort durable audit alongside the Redis hot store. Fire-and-forget:
    // an audit write failure must never fail an ingest the gate depends on.
    recordScanResult(imageDigest, summarizeSeverity(results)).catch((err) =>
      logger.warn('ci-ingest audit write failed', {
        event: 'ci_ingest_audit_failed',
        imageDigest,
        error: err instanceof Error ? err.message : String(err),
      }),
    );
    logger.info('ci-ingest stored scan', { event: 'ci_ingest_stored', imageDigest, findings: results.length, clientIp: clientIp(req) });
    return res.status(202).json({ stored: results.length, imageDigest });
  } catch (err) {
    // Last-resort guard: a synchronous throw here would otherwise reach Express's default
    // handler. Log with context and fail closed with 500 rather than leak a stack trace.
    logger.error('ci-ingest unexpected failure', {
      event: 'ci_ingest_error',
      clientIp: clientIp(req),
      method: req.method,
      path: req.originalUrl,
      error: err instanceof Error ? err.message : String(err),
    });
    return res.status(500).json({ error: 'Ingest failed' });
  }
});

// SARIF report pushed from the customer's own CI (CodeQL/Semgrep/Trivy/Snyk/...).
// Findings are stored under the named repo and become correlatable like any
// orchestrator-produced finding. Tenant is taken from the token, never the body.
const sarifIngestSchema = z.object({
  repo_url: z.string().url(),
  branch: z.string().max(255).optional(),
  sarif: z.object({ runs: z.array(z.unknown()).optional() }).passthrough(),
}).strict();

// POST /api/v1/ingest/sarif — rate limit before auth so abusive callers are shed.
router.post('/sarif', ingestRateLimiter, requireCiApiKey, async (req: Request, res: Response) => {
  const parsed = sarifIngestSchema.safeParse(req.body);
  if (!parsed.success) {
    logger.warn('sarif-ingest validation failure', {
      event: 'sarif_ingest_validation_failure',
      clientIp: clientIp(req),
      issues: parsed.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
    });
    return res.status(400).json({ error: 'Invalid SARIF payload', details: parsed.error.flatten() });
  }
  try {
    const result = await ingestSarif({
      tenant: req.ciTenant ?? null,
      repoUrl: parsed.data.repo_url,
      sarif: parsed.data.sarif,
      branch: parsed.data.branch,
    });
    if (!result.ok) {
      return res.status(404).json({ error: 'Repository not connected to Scorpion. Add it via the dashboard first.' });
    }
    return res.status(202).json({ scanId: result.scanId, findings: result.findings, affectedProjects: result.affectedProjects });
  } catch (err) {
    logger.error('sarif-ingest unexpected failure', {
      event: 'sarif_ingest_error',
      clientIp: clientIp(req),
      error: err instanceof Error ? err.message : String(err),
    });
    return res.status(500).json({ error: 'SARIF ingest failed' });
  }
});

export default router;
