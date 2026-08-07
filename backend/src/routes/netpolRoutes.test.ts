import request from 'supertest';
import express, { Request } from 'express';

jest.mock('../netpol/netpolPr', () => ({ openNetpolPr: jest.fn() }));
// Pass-through mock: real generator by default, overridable per test to
// exercise the route's throw-handling paths (400 safety net, outer 500).
jest.mock('../netpol/networkPolicyGenerator', () => {
  const actual = jest.requireActual<typeof import('../netpol/networkPolicyGenerator')>(
    '../netpol/networkPolicyGenerator',
  );
  return { ...actual, generateNetworkPolicies: jest.fn(actual.generateNetworkPolicies) };
});
jest.mock('../middleware/requireRole', () => ({
  requireRole: () => (_req: Request, _res: unknown, next: () => void) => next(),
}));
jest.mock('../services/logger', () => ({
    // Spread rather than replace: this module also exports errorContext,
    // and a factory that returns only `logger` makes it undefined at runtime.
    ...jest.requireActual('../services/logger'),
    logger: { warn: jest.fn(), info: jest.fn(), error: jest.fn() },
}));

import netpolRoutes from './netpolRoutes';
import { openNetpolPr } from '../netpol/netpolPr';
import { generateNetworkPolicies } from '../netpol/networkPolicyGenerator';

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

  it('POST /generate rejects bad namespace with 400 at the zod boundary', async () => {
    const res = await request(buildApp()).post('/api/netpol/generate')
      .send({ namespace: 'Not_Valid', flows: [] });
    expect(res.statusCode).toBe(400);
    expect(generateNetworkPolicies).not.toHaveBeenCalled();
  });

  it('generator invalid-namespace throw on a zod-passing payload maps to 400 (safety net)', async () => {
    (generateNetworkPolicies as jest.Mock).mockImplementationOnce(() => {
      throw new Error('Invalid namespace: must be a DNS-1123 label');
    });
    const res = await request(buildApp()).post('/api/netpol/generate').send(body);
    expect(res.statusCode).toBe(400);
    expect(res.body.error).toContain('Invalid namespace');
  });

  it('unexpected generator error maps to the fixed 500 body', async () => {
    (generateNetworkPolicies as jest.Mock).mockImplementationOnce(() => {
      throw new Error('unexpected internal failure');
    });
    const res = await request(buildApp()).post('/api/netpol/generate').send(body);
    expect(res.statusCode).toBe(500);
    expect(res.body).toEqual({ error: 'Failed to generate network policies' });
  });
});
