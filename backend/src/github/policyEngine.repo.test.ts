import { evaluatePolicyForRepo } from './policyEngine';
import { getDynamicPolicy } from '../services/policyService';
import { evaluatePolicy as evaluateOpaPolicy } from '../services/opaService';

jest.mock('../services/policyService');
jest.mock('../services/opaService');
jest.mock('../services/logger', () => ({ logger: { warn: jest.fn(), info: jest.fn(), error: jest.fn() } }));

const mockGetPolicy = getDynamicPolicy as jest.MockedFunction<typeof getDynamicPolicy>;
const mockOpa = evaluateOpaPolicy as jest.MockedFunction<typeof evaluateOpaPolicy>;

const CLEAN_SCAN = { trivy: { Results: [] }, gitleaks: [], semgrep: { results: [] } };
const CRITICAL_SCAN = {
  trivy: { Results: [{ Vulnerabilities: [{ Severity: 'CRITICAL' }] }] },
  gitleaks: [],
  semgrep: { results: [] },
};

const basePolicy = {
  minSecurityScore: 80,
  blockOnCritical: true,
  allowedSnoozeDays: 14,
  blockedFalcoRules: [] as string[],
};

beforeEach(() => {
  jest.clearAllMocks();
});

describe('evaluatePolicyForRepo', () => {
  it('passes a clean scan when the repo has no custom policy', async () => {
    mockGetPolicy.mockResolvedValue({ ...basePolicy });
    const r = await evaluatePolicyForRepo(CLEAN_SCAN, 'repo-1');
    expect(r.passed).toBe(true);
    expect(r.denyReasons).toEqual([]);
    expect(mockOpa).not.toHaveBeenCalled();
  });

  it('blocks when a critical finding is present (baseline + blockOnCritical)', async () => {
    mockGetPolicy.mockResolvedValue({ ...basePolicy });
    const r = await evaluatePolicyForRepo(CRITICAL_SCAN, 'repo-1');
    expect(r.passed).toBe(false);
    expect(r.criticalCount).toBe(1);
  });

  it('blocks a clean scan when the custom Rego policy denies it', async () => {
    mockGetPolicy.mockResolvedValue({ ...basePolicy, regoCode: 'package scorpion' });
    mockOpa.mockResolvedValue({ allow: false, denyReasons: ['prod requires score >= 90'] });
    const r = await evaluatePolicyForRepo(CLEAN_SCAN, 'repo-1');
    expect(r.passed).toBe(false);
    expect(r.denyReasons).toContain('prod requires score >= 90');
    expect(r.summary).toContain('Policy violated');
  });

  it('does not crash the gate when OPA throws — falls back to the threshold decision', async () => {
    mockGetPolicy.mockResolvedValue({ ...basePolicy, regoCode: 'package scorpion' });
    mockOpa.mockRejectedValue(new Error('opa not installed'));
    const r = await evaluatePolicyForRepo(CLEAN_SCAN, 'repo-1');
    expect(r.passed).toBe(true); // clean scan, OPA error ignored
    expect(r.denyReasons).toEqual([]);
  });

  it('does not crash when the per-repo policy load fails', async () => {
    mockGetPolicy.mockRejectedValue(new Error('appwrite down'));
    const r = await evaluatePolicyForRepo(CLEAN_SCAN, 'repo-1');
    expect(r.passed).toBe(true);
    expect(r.denyReasons).toEqual([]);
  });

  it('passes OPA the derived score and environment', async () => {
    mockGetPolicy.mockResolvedValue({ ...basePolicy, regoCode: 'package scorpion' });
    mockOpa.mockResolvedValue({ allow: true, denyReasons: [] });
    await evaluatePolicyForRepo(CRITICAL_SCAN, 'repo-1', 'staging');
    // one critical => score 100 - 15 = 85
    expect(mockOpa).toHaveBeenCalledWith(
      expect.objectContaining({ critical_count: 1, security_score: 85, environment: 'staging' }),
      expect.objectContaining({ regoCode: 'package scorpion' })
    );
  });
});
