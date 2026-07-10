import request from 'supertest';
import express from 'express';
import { PodSecurityConfig } from '../services/podSecurityService';

jest.mock('../services/imageStore', () => ({
  getScan: jest.fn().mockResolvedValue(undefined),
  getSignature: jest.fn().mockResolvedValue(undefined),
}));
jest.mock('../services/cosignService', () => ({ verifyImageDigest: jest.fn() }));
jest.mock('../services/logger', () => ({ logger: { warn: jest.fn(), info: jest.fn(), error: jest.fn() } }));
jest.mock('../repositories/gateRulesRepository', () => ({
  gateRulesRepository: {
    get: jest.fn().mockResolvedValue({
      rules: [
        { id: 'seed-critical', severity: 'critical', threshold: 0, action: 'block', enabled: true },
        { id: 'seed-high', severity: 'high', threshold: 5, action: 'warn', enabled: true },
      ],
      env: 'prod',
    }),
  },
}));
jest.mock('../repositories/podSecurityRepository', () => ({
  podSecurityRepository: { get: jest.fn() },
}));

import k8sAdmissionRoutes from './k8sAdmission';
import { podSecurityRepository } from '../repositories/podSecurityRepository';

const mockGetConfig = podSecurityRepository.get as jest.MockedFunction<typeof podSecurityRepository.get>;

const buildApp = () => {
  const app = express();
  app.use(express.json());
  app.use('/api/v1/webhook', k8sAdmissionRoutes);
  return app;
};

const allEnforced: PodSecurityConfig = {
  modes: {
    'registry-allowlist': 'enforce',
    'no-privileged': 'enforce',
    'run-as-non-root': 'enforce',
    'drop-dangerous-capabilities': 'enforce',
    'read-only-root-fs': 'enforce',
    'no-host-namespaces': 'enforce',
    'required-labels': 'enforce',
  },
  allowedRegistries: [],
  requiredLabels: [],
};

const review = (namespace: string, object: Record<string, unknown>) => ({
  request: { uid: 'uid-1', namespace, object },
});

const hardenedObject = (image: string) => ({
  metadata: { labels: { app: 'demo' } },
  spec: {
    securityContext: { runAsNonRoot: true },
    containers: [{ name: 'app', image, securityContext: { readOnlyRootFilesystem: true } }],
  },
});

describe('k8s admission webhook pod-security gate', () => {
  beforeEach(() => jest.clearAllMocks());

  it('denies a privileged pod when the rule is enforced', async () => {
    mockGetConfig.mockResolvedValue(allEnforced);
    const res = await request(buildApp())
      .post('/api/v1/webhook/k8s-admission')
      .send(review('dev', {
        metadata: { labels: { app: 'demo' } },
        spec: {
          securityContext: { runAsNonRoot: true },
          containers: [{ name: 'app', image: 'x:1', securityContext: { privileged: true, readOnlyRootFilesystem: true } }],
        },
      }));
    expect(res.body.response.allowed).toBe(false);
    expect(res.body.response.status.message).toMatch(/runs privileged/i);
  });

  it('surfaces audit-mode violations as warnings without denying (dev)', async () => {
    const auditCfg: PodSecurityConfig = { ...allEnforced, modes: { ...allEnforced.modes, 'no-privileged': 'audit' } };
    mockGetConfig.mockResolvedValue(auditCfg);
    const res = await request(buildApp())
      .post('/api/v1/webhook/k8s-admission')
      .send(review('dev', {
        metadata: { labels: { app: 'demo' } },
        spec: {
          securityContext: { runAsNonRoot: true },
          containers: [{ name: 'app', image: 'x:1', securityContext: { privileged: true, readOnlyRootFilesystem: true } }],
        },
      }));
    // dev + unscanned image → vuln gate warns, doesn't block; audit shows in message
    expect(res.body.response.allowed).toBe(true);
    expect(res.body.response.status.message).toMatch(/\[audit\] no-privileged/);
  });

  it('fails closed in prod when the pod-security config cannot be loaded', async () => {
    mockGetConfig.mockRejectedValue(new Error('appwrite down'));
    const res = await request(buildApp())
      .post('/api/v1/webhook/k8s-admission')
      .send(review('production', hardenedObject('x:1')));
    expect(res.body.response.allowed).toBe(false);
    expect(res.body.response.status.message).toMatch(/pod-security config unavailable/i);
  });

  it('falls back to defaults in dev when config load fails', async () => {
    mockGetConfig.mockRejectedValue(new Error('appwrite down'));
    const res = await request(buildApp())
      .post('/api/v1/webhook/k8s-admission')
      .send(review('dev', hardenedObject('x:1')));
    // Defaults: no-privileged enforce (pod is clean), rest audit → allowed.
    expect(res.body.response.allowed).toBe(true);
  });

  it('lets a clean pod proceed to the image gate', async () => {
    mockGetConfig.mockResolvedValue(allEnforced);
    const res = await request(buildApp())
      .post('/api/v1/webhook/k8s-admission')
      .send(review('dev', hardenedObject('registry/app@sha256:abc')));
    // Pod security passes; unscanned digest → unknown reachability → dev warns.
    expect(res.body.response.allowed).toBe(true);
    expect(res.body.response.status.message).toMatch(/Reachability unknown/i);
  });

  it('denies with every enforced violation listed', async () => {
    mockGetConfig.mockResolvedValue({ ...allEnforced, allowedRegistries: ['registry.company.com/'] });
    const res = await request(buildApp())
      .post('/api/v1/webhook/k8s-admission')
      .send(review('dev', {
        spec: {
          hostNetwork: true,
          containers: [{ name: 'app', image: 'docker.io/nginx:latest', securityContext: { privileged: true } }],
        },
      }));
    expect(res.body.response.allowed).toBe(false);
    const msg = res.body.response.status.message as string;
    expect(msg).toMatch(/privileged/);
    expect(msg).toMatch(/approved registry/);
    expect(msg).toMatch(/host namespace/);
  });
});
