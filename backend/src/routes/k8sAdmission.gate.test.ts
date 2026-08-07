import request from 'supertest';
import express from 'express';

jest.mock('../services/imageStore', () => ({
  getScan: jest.fn().mockResolvedValue(undefined),
  getSignature: jest.fn().mockResolvedValue(undefined),
}));
jest.mock('../services/cosignService', () => ({ verifyImageDigest: jest.fn() }));
jest.mock('../services/logger', () => ({
    // Spread rather than replace: this module also exports errorContext,
    // and a factory that returns only `logger` makes it undefined at runtime.
    ...jest.requireActual('../services/logger'),
    logger: { warn: jest.fn(), info: jest.fn(), error: jest.fn() },
}));
jest.mock('../repositories/gateRulesRepository', () => ({
  gateRulesRepository: { get: jest.fn() },
}));
jest.mock('../repositories/podSecurityRepository', () => ({
  podSecurityRepository: { get: jest.fn() },
}));

import k8sAdmissionRoutes, { evaluatePreflight, resolveSignal } from './k8sAdmission';
import { getScan, getSignature } from '../services/imageStore';
import { gateRulesRepository } from '../repositories/gateRulesRepository';
import { podSecurityRepository } from '../repositories/podSecurityRepository';
import { DEFAULT_POD_SECURITY_CONFIG } from '../services/podSecurityService';

const mockGetScan = getScan as jest.MockedFunction<typeof getScan>;
const mockGetSignature = getSignature as jest.MockedFunction<typeof getSignature>;
const mockGetRules = gateRulesRepository.get as jest.Mock;
const mockGetPodConfig = podSecurityRepository.get as jest.Mock;

const DEFAULT_RULES = [
  { severity: 'critical' as const, threshold: 0, action: 'block' as const, enabled: true },
  { severity: 'high' as const, threshold: 5, action: 'warn' as const, enabled: true },
];
const NO_COUNTS = { critical: 0, high: 0, medium: 0, low: 0 };

const buildApp = () => {
  const app = express();
  app.use(express.json());
  app.use('/api/v1/webhook', k8sAdmissionRoutes);
  return app;
};

const review = (namespace: string, images: string[]) => ({
  request: {
    uid: 'uid-1',
    namespace,
    object: {
      metadata: { labels: { app: 'demo' } },
      spec: { containers: images.map(image => ({ name: 'app', image })) },
    },
  },
});

afterEach(() => {
  delete process.env.REQUIRE_IMAGE_SIGNATURE;
  jest.clearAllMocks();
  jest.useRealTimers();
});

describe('evaluatePreflight', () => {
  it('blocks when a vulnerable dependency is reachable, in any env', () => {
    const r = evaluatePreflight(DEFAULT_RULES, NO_COUNTS, 'dev', 'reachable');
    expect(r.status).toBe('blocked');
    expect(r.reason).toMatch(/reachable/i);
  });

  it('is ready when every vulnerable dependency is proven unreachable', () => {
    const r = evaluatePreflight(DEFAULT_RULES, { ...NO_COUNTS, critical: 3 }, 'prod', 'unreachable');
    expect(r.status).toBe('ready');
  });

  it('falls back to count rules without a reachability verdict: block beats warn', () => {
    const r = evaluatePreflight(DEFAULT_RULES, { ...NO_COUNTS, critical: 1, high: 9 }, 'stage');
    expect(r.status).toBe('blocked');
    expect(r.reason).toContain('Critical > 0');
  });

  it('warns when only a warn-action rule is violated', () => {
    const r = evaluatePreflight(DEFAULT_RULES, { ...NO_COUNTS, high: 6 }, 'stage');
    expect(r.status).toBe('warning');
    expect(r.reason).toContain('High > 5');
  });

  it('ignores disabled rules and reports ready', () => {
    const rules = [{ severity: 'critical' as const, threshold: 0, action: 'block' as const, enabled: false }];
    expect(evaluatePreflight(rules, { ...NO_COUNTS, critical: 5 }, 'prod').status).toBe('ready');
  });
});

describe('resolveSignal', () => {
  it('counts severities case-insensitively and skips unknown labels', async () => {
    mockGetScan.mockResolvedValue([
      { pkgName: 'a', severity: 'CRITICAL' },
      { pkgName: 'b', severity: 'high' },
      { pkgName: 'c', severity: 'bogus' },
      { pkgName: 'd' },
    ]);
    const s = await resolveSignal('repo/app@sha256:abc');
    expect(s.counts).toEqual({ critical: 1, high: 1, medium: 0, low: 0 });
    expect(s.reachability).toBeUndefined();
  });

  it('any reachable package makes the whole image reachable', async () => {
    mockGetScan.mockResolvedValue([
      { pkgName: 'a', severity: 'low', reachability: 'unreachable' },
      { pkgName: 'b', severity: 'low', reachability: 'reachable' },
    ] as never);
    expect((await resolveSignal('repo/app@sha256:abc')).reachability).toBe('reachable');
  });

  it('all packages proven unreachable aggregates to unreachable', async () => {
    mockGetScan.mockResolvedValue([
      { pkgName: 'a', severity: 'low', reachability: 'unreachable' },
      { pkgName: 'b', severity: 'low', reachability: 'unreachable' },
    ] as never);
    expect((await resolveSignal('repo/app@sha256:abc')).reachability).toBe('unreachable');
  });

  it('a mix with unproven entries aggregates to unknown', async () => {
    mockGetScan.mockResolvedValue([
      { pkgName: 'a', severity: 'low', reachability: 'unreachable' },
      { pkgName: 'b', severity: 'low', reachability: 'unknown' },
    ] as never);
    expect((await resolveSignal('repo/app@sha256:abc')).reachability).toBe('unknown');
  });

  it('tag-only image (no digest) resolves fail-secure unknown without a store read', async () => {
    const s = await resolveSignal('repo/app:v1');
    expect(s.reachability).toBe('unknown');
    expect(mockGetScan).not.toHaveBeenCalled();
  });

  it('a hung scan-store read hits the deadline and fails secure to unknown', async () => {
    jest.useFakeTimers();
    mockGetScan.mockReturnValue(new Promise(() => {}) as never);
    const pending = resolveSignal('repo/app@sha256:slow');
    await jest.advanceTimersByTimeAsync(1500);
    const s = await pending;
    expect(s.reachability).toBe('unknown');
    expect(s.counts).toEqual(NO_COUNTS);
  });
});

describe('k8s admission webhook gate flow', () => {
  beforeEach(() => {
    mockGetRules.mockResolvedValue({ rules: DEFAULT_RULES, env: 'prod' });
    mockGetPodConfig.mockResolvedValue(DEFAULT_POD_SECURITY_CONFIG);
    mockGetScan.mockResolvedValue(undefined);
    mockGetSignature.mockResolvedValue(undefined);
  });

  it('denies a malformed AdmissionReview payload (fail closed)', async () => {
    const res = await request(buildApp()).post('/api/v1/webhook/k8s-admission').send({});
    expect(res.status).toBe(200);
    expect(res.body.response.allowed).toBe(false);
    expect(res.body.response.status.message).toMatch(/invalid admissionreview/i);
  });

  it('denies in prod when gate rules cannot be loaded (fail closed)', async () => {
    mockGetRules.mockRejectedValue(new Error('appwrite down'));
    const res = await request(buildApp())
      .post('/api/v1/webhook/k8s-admission')
      .send(review('default', ['repo/app@sha256:abc']));
    expect(res.body.response.allowed).toBe(false);
    expect(res.body.response.status.message).toMatch(/gate rules unavailable/i);
  });

  it('degrades to built-in default rules in dev when gate rules cannot be loaded', async () => {
    mockGetRules.mockRejectedValue(new Error('appwrite down'));
    // unscanned tag-only image -> unknown reachability -> warning (allowed) in dev
    const res = await request(buildApp())
      .post('/api/v1/webhook/k8s-admission')
      .send(review('dev', ['repo/app:v1']));
    expect(res.body.response.allowed).toBe(true);
    expect(res.body.response.status.message).toMatch(/reachability unknown/i);
  });

  it('denies an unsigned image in prod when signature enforcement is on', async () => {
    process.env.REQUIRE_IMAGE_SIGNATURE = 'true';
    const res = await request(buildApp())
      .post('/api/v1/webhook/k8s-admission')
      .send(review('default', ['repo/app@sha256:abc']));
    expect(res.body.response.allowed).toBe(false);
    expect(res.body.response.status.message).toMatch(/no signature on record/i);
  });

  it('denies an image whose scan violates a block rule', async () => {
    mockGetScan.mockResolvedValue([{ pkgName: 'openssl', severity: 'critical' }]);
    const res = await request(buildApp())
      .post('/api/v1/webhook/k8s-admission')
      .send(review('dev', ['repo/app@sha256:abc']));
    expect(res.body.response.allowed).toBe(false);
    expect(res.body.response.status.message).toContain('Critical > 0');
  });

  it('admits a clean scanned image', async () => {
    mockGetScan.mockResolvedValue([]);
    const res = await request(buildApp())
      .post('/api/v1/webhook/k8s-admission')
      .send(review('dev', ['repo/app@sha256:abc']));
    expect(res.body.response.allowed).toBe(true);
  });

  it('denies in prod when the pod-security config cannot be loaded (fail closed)', async () => {
    mockGetPodConfig.mockRejectedValue(new Error('appwrite down'));
    const res = await request(buildApp())
      .post('/api/v1/webhook/k8s-admission')
      .send(review('default', ['repo/app@sha256:abc']));
    expect(res.body.response.allowed).toBe(false);
    expect(res.body.response.status.message).toMatch(/pod-security config unavailable/i);
  });
});
