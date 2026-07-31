jest.mock('./authorizationService', () => ({
  evaluate: jest.fn(),
  createMemo: () => new Map(),
}));
jest.mock('../repositories/planRepository', () => ({
  planRepository: { getIssueProjectId: jest.fn(), getSprintProjectId: jest.fn() },
}));
jest.mock('../services/planService', () => ({ assertLegacyProjectAccess: jest.fn() }));
jest.mock('../services/logger', () => ({ logger: { warn: jest.fn(), error: jest.fn(), info: jest.fn() } }));

import { Response } from 'express';
import { evaluate } from './authorizationService';
import { planRepository } from '../repositories/planRepository';
import { assertLegacyProjectAccess } from '../services/planService';
import { logger } from '../services/logger';
import { requirePermission } from './requirePermission';
import { AuthenticatedRequest } from '../types/plan.types';

const evaluateMock = evaluate as jest.Mock;
const legacy = assertLegacyProjectAccess as jest.Mock;
const getIssueProjectId = planRepository.getIssueProjectId as jest.Mock;
const warn = logger.warn as jest.Mock;

const makeReq = (params: Record<string, string>): AuthenticatedRequest =>
  ({ params, user: { $id: 'u1' } } as unknown as AuthenticatedRequest);

function makeRes(): Response & { statusCode?: number; payload?: unknown } {
  const res = {
    statusCode: undefined as number | undefined,
    payload: undefined as unknown,
    status(code: number) { res.statusCode = code; return res; },
    json(body: unknown) { res.payload = body; return res; },
  };
  return res as unknown as Response & { statusCode?: number; payload?: unknown };
}

const ENFORCE = process.env.RBAC_ENFORCE;
beforeEach(() => {
  jest.clearAllMocks();
  evaluateMock.mockReset();
  legacy.mockReset();
  getIssueProjectId.mockReset();
  delete process.env.RBAC_ENFORCE;
});
afterAll(() => { if (ENFORCE === undefined) delete process.env.RBAC_ENFORCE; else process.env.RBAC_ENFORCE = ENFORCE; });

describe('shadow mode (default)', () => {
  test('an RBAC denial does NOT block while the legacy check still allows', async () => {
    // The entire point of the rollout: a missing grant must not take the
    // workspace away from someone before the backfill has been validated.
    evaluateMock.mockResolvedValue({ allowed: false, reason: 'not_found' });
    legacy.mockResolvedValue(true);
    const next = jest.fn();
    const res = makeRes();

    await requirePermission('issue:write')(makeReq({ projectId: 'p1' }), res, next);

    expect(next).toHaveBeenCalled();
    expect(res.statusCode).toBeUndefined();
  });

  test('the divergence is logged so the gap is visible before enforcement', async () => {
    evaluateMock.mockResolvedValue({ allowed: false, reason: 'not_found' });
    legacy.mockResolvedValue(true);

    await requirePermission('issue:write')(makeReq({ projectId: 'p1' }), makeRes(), jest.fn());

    expect(warn).toHaveBeenCalledWith(expect.any(String), expect.objectContaining({
      event: 'rbac_divergence', projectId: 'p1', permission: 'issue:write',
      rbac: 'not_found', legacyAllowed: true,
    }));
  });

  test('agreement logs nothing', async () => {
    evaluateMock.mockResolvedValue({ allowed: true, reason: 'granted' });
    legacy.mockResolvedValue(true);

    await requirePermission('issue:read')(makeReq({ projectId: 'p1' }), makeRes(), jest.fn());

    expect(warn).not.toHaveBeenCalled();
  });

  test('the legacy check still blocks an outsider', async () => {
    evaluateMock.mockResolvedValue({ allowed: false, reason: 'not_found' });
    legacy.mockResolvedValue(false);
    const next = jest.fn();
    const res = makeRes();

    await requirePermission('issue:read')(makeReq({ projectId: 'p1' }), res, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.statusCode).toBe(403);
  });
});

describe('enforcing', () => {
  beforeEach(() => { process.env.RBAC_ENFORCE = 'true'; });

  test('granted passes through and the legacy check is not consulted', async () => {
    evaluateMock.mockResolvedValue({ allowed: true, reason: 'granted' });
    const next = jest.fn();

    await requirePermission('issue:write')(makeReq({ projectId: 'p1' }), makeRes(), next);

    expect(next).toHaveBeenCalled();
    expect(legacy).not.toHaveBeenCalled();
  });

  test('a member lacking the permission gets 403', async () => {
    evaluateMock.mockResolvedValue({ allowed: false, reason: 'denied' });
    const res = makeRes();

    await requirePermission('issue:delete')(makeReq({ projectId: 'p1' }), res, jest.fn());

    expect(res.statusCode).toBe(403);
  });

  test('a non-member gets 404, so project existence is not disclosed', async () => {
    evaluateMock.mockResolvedValue({ allowed: false, reason: 'not_found' });
    const res = makeRes();

    await requirePermission('issue:read')(makeReq({ projectId: 'p1' }), res, jest.fn());

    expect(res.statusCode).toBe(404);
  });

  test('an unverifiable check gets 503, never a silent allow', async () => {
    evaluateMock.mockResolvedValue({ allowed: false, reason: 'unavailable' });
    const next = jest.fn();
    const res = makeRes();

    await requirePermission('issue:read')(makeReq({ projectId: 'p1' }), res, next);

    expect(res.statusCode).toBe(503);
    expect(next).not.toHaveBeenCalled();
  });
});

describe('child-keyed routes', () => {
  test('resolves the owning project from an issue id', async () => {
    getIssueProjectId.mockResolvedValue('p9');
    evaluateMock.mockResolvedValue({ allowed: true, reason: 'granted' });
    legacy.mockResolvedValue(true);

    await requirePermission('issue:delete', 'issueId')(makeReq({ issueId: 'i1' }), makeRes(), jest.fn());

    expect(evaluateMock).toHaveBeenCalledWith('p9', 'u1', 'issue:delete', expect.anything());
  });

  test('an unknown child id is 404 and never reaches the authorization check', async () => {
    getIssueProjectId.mockResolvedValue(null);
    const res = makeRes();

    await requirePermission('issue:delete', 'issueId')(makeReq({ issueId: 'ghost' }), res, jest.fn());

    expect(res.statusCode).toBe(404);
    expect(evaluateMock).not.toHaveBeenCalled();
  });

  test('a failed resolution is 503, not a pass-through', async () => {
    // Cannot tell which project the issue belongs to, so cannot authorize it.
    getIssueProjectId.mockRejectedValue(new Error('appwrite down'));
    const next = jest.fn();
    const res = makeRes();

    await requirePermission('issue:write', 'issueId')(makeReq({ issueId: 'i1' }), res, next);

    expect(res.statusCode).toBe(503);
    expect(next).not.toHaveBeenCalled();
  });
});
