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

  it('POST /generate rejects bad namespace with 400', async () => {
    const res = await request(buildApp()).post('/api/netpol/generate')
      .send({ namespace: 'Not_Valid', flows: [] });
    expect(res.statusCode).toBe(400);
  });
});
