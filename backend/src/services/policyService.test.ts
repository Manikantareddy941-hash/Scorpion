/**
 * policyService: dynamic-policy caching/parsing, Falco rule matching,
 * effective-policy fallback, scan evaluation verdicts, and the IAM
 * evaluator's deny-overrides/wildcard semantics.
 */

jest.mock('../lib/appwrite', () => ({
  databases: {
    listDocuments: jest.fn(),
    getDocument: jest.fn(),
    createDocument: jest.fn(),
  },
  DB_ID: 'test-db',
  COLLECTIONS: { PROJECT_POLICIES: 'project_policies', SCANS: 'scans', POLICY_EVALUATIONS: 'policy_evaluations' },
  ID: { unique: () => 'unique-id' },
  Query: {
    equal: (f: string, v: unknown) => ({ equal: [f, v] }),
    limit: (n: number) => ({ limit: n }),
  },
}));
jest.mock('./notificationService', () => ({ notifyPolicyFailure: jest.fn() }));
jest.mock('./logger', () => ({ logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn() } }));

import {
  getDynamicPolicy, isFalcoRuleBlocked, getEffectivePolicy, evaluateScan,
  evaluatePolicyResult, evaluateIAM, DEFAULT_POLICY, DEFAULT_IAM_POLICY, ADMIN_IAM_POLICY,
} from './policyService';
import { databases } from '../lib/appwrite';
import { notifyPolicyFailure } from './notificationService';

const db = databases as jest.Mocked<typeof databases>;

beforeEach(() => jest.clearAllMocks());

describe('getDynamicPolicy', () => {
  it('parses a stored policy row including JSON-encoded falco rules', async () => {
    db.listDocuments.mockResolvedValue({
      total: 1,
      documents: [{
        minSecurityScore: 65, blockOnCritical: false, allowedSnoozeDays: 7,
        blockedFalcoRules: JSON.stringify(['Custom rule']), regoCode: 'package gate',
      }],
    } as never);

    const policy = await getDynamicPolicy('repo-dyn-1');

    expect(policy).toMatchObject({
      minSecurityScore: 65, blockOnCritical: false, allowedSnoozeDays: 7,
      blockedFalcoRules: ['Custom rule'], regoCode: 'package gate',
    });
  });

  it('falls back to the default policy when the lookup fails, and caches it', async () => {
    db.listDocuments.mockRejectedValue(new Error('appwrite down'));

    const policy = await getDynamicPolicy('repo-dyn-2');
    expect(policy).toEqual(DEFAULT_POLICY);

    db.listDocuments.mockClear();
    await getDynamicPolicy('repo-dyn-2'); // 60s TTL cache
    expect(db.listDocuments).not.toHaveBeenCalled();
  });

  it('maps legacy min_risk_score rows onto minSecurityScore', async () => {
    db.listDocuments.mockResolvedValue({
      total: 1,
      documents: [{ min_risk_score: 42 }],
    } as never);

    expect((await getDynamicPolicy('repo-dyn-3')).minSecurityScore).toBe(42);
  });
});

describe('isFalcoRuleBlocked', () => {
  it('matches rules bidirectionally and case-insensitively', async () => {
    db.listDocuments.mockResolvedValue({ total: 0, documents: [] } as never);

    expect(await isFalcoRuleBlocked('repo-falco', 'TERMINAL SHELL OPENED IN CONTAINER (pod-1)')).toBe(true);
    expect(await isFalcoRuleBlocked('repo-falco', 'write below etc')).toBe(true);
    expect(await isFalcoRuleBlocked('repo-falco', 'Benign informational event')).toBe(false);
  });
});

describe('getEffectivePolicy', () => {
  it('returns the stored row when present', async () => {
    db.listDocuments.mockResolvedValue({ total: 1, documents: [{ policy_name: 'strict', max_critical: 0 }] } as never);
    expect((await getEffectivePolicy('r1'))).toMatchObject({ policy_name: 'strict' });
  });

  it('returns the balanced default when missing or on error', async () => {
    db.listDocuments.mockResolvedValue({ total: 0, documents: [] } as never);
    expect((await getEffectivePolicy('r1')).policy_name).toBe('balanced');

    db.listDocuments.mockRejectedValue(new Error('down'));
    expect((await getEffectivePolicy('r1'))).toMatchObject({ max_high: 5, min_risk_score: 50 });
  });
});

describe('evaluateScan', () => {
  const armScan = (details: Record<string, number>) => {
    db.getDocument.mockResolvedValue({
      $id: 'scan-1', status: 'completed', repo_id: 'repo-1',
      details: JSON.stringify(details),
    } as never);
    db.listDocuments.mockResolvedValue({ total: 0, documents: [] } as never); // balanced policy
    db.createDocument.mockResolvedValue({} as never);
  };

  it('throws when the scan is not completed', async () => {
    db.getDocument.mockResolvedValue({ status: 'running' } as never);
    await expect(evaluateScan('scan-x')).rejects.toThrow('not available');
  });

  it('FAILs on criticals over the limit and notifies', async () => {
    armScan({ critical_count: 2, high_count: 0, security_score: 90 });

    const evaluation = await evaluateScan('scan-1');

    expect(evaluation.result).toBe('FAIL');
    expect(evaluation.reason).toContain('Critical');
    expect(notifyPolicyFailure).toHaveBeenCalledWith('repo-1', 'scan-1', 'FAIL', expect.any(String));
    expect(db.createDocument).toHaveBeenCalledWith('test-db', 'policy_evaluations', 'unique-id', expect.objectContaining({ result: 'FAIL' }));
  });

  it('FAILs on highs over the limit', async () => {
    armScan({ critical_count: 0, high_count: 9, security_score: 90 });
    expect((await evaluateScan('scan-1')).reason).toContain('High');
  });

  it('WARNs on a low score without notifying', async () => {
    armScan({ critical_count: 0, high_count: 0, security_score: 10 });

    const evaluation = await evaluateScan('scan-1');

    expect(evaluation.result).toBe('WARN');
    expect(notifyPolicyFailure).not.toHaveBeenCalled();
  });

  it('PASSes when every threshold is met', async () => {
    armScan({ critical_count: 0, high_count: 1, security_score: 95 });
    expect((await evaluateScan('scan-1')).result).toBe('PASS');
  });
});

describe('evaluatePolicyResult', () => {
  // The path triggerScan actually uses. evaluateScan re-reads the scan document
  // and requires status 'completed'; at gate time the doc is still 'running'
  // with unwritten details, so that route threw on every scan. This one takes
  // the counts directly, so it must NOT read the scan document at all.
  beforeEach(() => {
    db.listDocuments.mockResolvedValue({ total: 0, documents: [] } as never); // balanced default policy
    db.createDocument.mockResolvedValue({} as never);
    db.getDocument.mockReset();
  });

  it('evaluates the passed counts without reading the scan document', async () => {
    const evaluation = await evaluatePolicyResult('scan-1', 'repo-1', { critical: 2, high: 0, securityScore: 90 });

    expect(evaluation.result).toBe('FAIL');
    expect(evaluation.reason).toContain('Critical');
    expect(db.getDocument).not.toHaveBeenCalled();
    expect(db.createDocument).toHaveBeenCalledWith('test-db', 'policy_evaluations', 'unique-id', expect.objectContaining({ result: 'FAIL' }));
  });

  it('PASSes clean counts', async () => {
    const evaluation = await evaluatePolicyResult('scan-1', 'repo-1', { critical: 0, high: 1, securityScore: 95 });
    expect(evaluation.result).toBe('PASS');
  });
});

describe('evaluateIAM', () => {
  it('default policy allows reads and denies privileged actions', () => {
    expect(evaluateIAM(DEFAULT_IAM_POLICY, 'repo:read', 'repo-1')).toBe(true);
    expect(evaluateIAM(DEFAULT_IAM_POLICY, 'gate:bypass', 'repo-1')).toBe(false);
    expect(evaluateIAM(DEFAULT_IAM_POLICY, 'repo:delete', 'repo-1')).toBe(false);
  });

  it('admin policy allows everything', () => {
    expect(evaluateIAM(ADMIN_IAM_POLICY, 'gate:bypass', 'any')).toBe(true);
  });

  it('explicit Deny overrides a matching Allow', () => {
    const statements = [
      { Effect: 'Allow' as const, Actions: ['repo:*'], Resources: ['*'] },
      { Effect: 'Deny' as const, Actions: ['repo:delete'], Resources: ['*'] },
    ];
    expect(evaluateIAM(statements, 'repo:scan', 'r1')).toBe(true);
    expect(evaluateIAM(statements, 'repo:delete', 'r1')).toBe(false);
  });

  it('supports trailing wildcards on actions and resources', () => {
    const statements = [{ Effect: 'Allow' as const, Actions: ['tasks:*'], Resources: ['team-*'] }];
    expect(evaluateIAM(statements, 'tasks:create', 'team-42')).toBe(true);
    expect(evaluateIAM(statements, 'tasks:create', 'repo-1')).toBe(false);
    expect(evaluateIAM(statements, 'repo:read', 'team-42')).toBe(false);
  });

  it('denies by default when nothing matches', () => {
    expect(evaluateIAM([], 'anything', 'anywhere')).toBe(false);
  });
});
