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

  it('POST / rejects unsafe param values with 400', async () => {
    const unsafeRule = {
      template: 'terminal-shell-in-container',
      params: { allowedProcs: ['tini; rm -rf /'] },
      suppressed: false,
      enabled: true,
    };
    const res = await request(buildApp()).post('/api/falco-rules').send(unsafeRule);
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

  it('PATCH /:id updates a rule', async () => {
    repo.updateRule.mockResolvedValue(undefined);
    const res = await request(buildApp()).patch('/api/falco-rules/r-1').send({ enabled: false });
    expect(res.statusCode).toBe(200);
    expect(repo.updateRule).toHaveBeenCalledWith('r-1', { enabled: false });
  });

  it('POST / accepts a >64-char domain and watched path (up to 256)', async () => {
    const longDomain = `${'a'.repeat(120)}.example.com`; // 132 chars
    const longPath = `/var/lib/${'d'.repeat(100)}/config`; // 116 chars
    const rule = {
      template: 'outbound-unknown-domain',
      params: { allowedDomains: [longDomain], watchedPaths: [longPath] },
      suppressed: false,
      enabled: true,
    };
    repo.createRule.mockResolvedValue({ id: 'r-2', ...rule } as never);
    const res = await request(buildApp()).post('/api/falco-rules').send(rule);
    expect(res.statusCode).toBe(201);
  });

  it('POST / rejects a >256-char domain and a >64-char proc with 400', async () => {
    const domainRes = await request(buildApp()).post('/api/falco-rules').send({
      template: 'outbound-unknown-domain',
      params: { allowedDomains: [`${'a'.repeat(260)}.example.com`] },
      suppressed: false,
      enabled: true,
    });
    expect(domainRes.statusCode).toBe(400);

    const procRes = await request(buildApp()).post('/api/falco-rules').send({
      ...validRule,
      params: { allowedProcs: ['p'.repeat(65)] },
    });
    expect(procRes.statusCode).toBe(400);
    expect(repo.createRule).not.toHaveBeenCalled();
  });

  it('PATCH /:id rejects unsafe param values with 400', async () => {
    const unsafeUpdate = { params: { watchedPaths: ['/etc\n rm -rf /'] } };
    const res = await request(buildApp()).patch('/api/falco-rules/r-1').send(unsafeUpdate);
    expect(res.statusCode).toBe(400);
    expect(repo.updateRule).not.toHaveBeenCalled();
  });
});
