import { correlate, classifyFinding, isActiveFinding, CorrelatableFinding } from './correlationEngine';
import { StoredRequirement } from '../types/securityRequirements.types';

const baseReq: StoredRequirement = {
  code: 'REQ-X',
  title: 'requirement',
  description: 'desc',
  category: 'Secure Coding',
  frameworks: ['PCI DSS'],
  controlIds: ['PCI DSS 6.5.1'],
  severity: 'high',
  status: 'required',
  remediation: 'fix it',
  sourceRuleId: ['rule'],
  projectId: 'p1',
  lifecycleStatus: 'open',
  createdAt: '2026-01-01',
};

const req = (over: Partial<StoredRequirement> = {}): StoredRequirement => ({ ...baseReq, ...over });

const finding = (over: Partial<CorrelatableFinding> = {}): CorrelatableFinding => ({
  tool: 'semgrep',
  category: 'python.lang.security.sql-injection',
  ruleId: 'python.sql-injection',
  title: 'sql-injection',
  message: 'Possible SQL injection',
  severity: 'HIGH',
  status: 'open',
  ...over,
});

describe('classifyFinding', () => {
  it('classes a gitleaks / secret-exposure finding as secret', () => {
    expect(classifyFinding({ tool: 'gitleaks', category: 'secret-exposure' })).toBe('secret');
  });
  it('classes a trivy dependency vulnerability as dependency-vuln', () => {
    expect(classifyFinding({ tool: 'trivy', category: 'dependency-vulnerability' })).toBe('dependency-vuln');
  });
  it('classes checkov and hadolint findings as iac-misconfig', () => {
    expect(classifyFinding({ tool: 'checkov', category: 'iac-misconfig' })).toBe('iac-misconfig');
    expect(classifyFinding({ tool: 'hadolint', category: 'dockerfile-lint' })).toBe('iac-misconfig');
  });
  it('classes a semgrep injection finding as injection', () => {
    expect(classifyFinding(finding())).toBe('injection');
    expect(classifyFinding({ tool: 'bandit', category: 'B608', message: 'Possible SQL injection vector' })).toBe('injection');
  });
  it('classes an ingested SARIF injection finding (any tool) as injection', () => {
    expect(classifyFinding({ tool: 'codeql', category: 'js/sql-injection', ruleId: 'js/sql-injection', message: 'user input' })).toBe('injection');
  });
  it('keeps a CVE mentioning injection as dependency-vuln (categorised class wins over keyword)', () => {
    expect(classifyFinding({ tool: 'trivy', category: 'dependency-vulnerability', title: 'CVE-2020-1 SQL injection in libX' })).toBe('dependency-vuln');
  });
  it('does not classify non-security noise (license, maintainability lint)', () => {
    expect(classifyFinding({ tool: 'trivy', category: 'license-compliance' })).toBeNull();
    expect(classifyFinding({ tool: 'semgrep', category: 'style.unused-import', ruleId: 'unused-import', title: 'unused', message: 'unused import' })).toBeNull();
  });
});

describe('isActiveFinding', () => {
  it('counts open (and status-less) findings, ignores resolved/dismissed/false_positive/snoozed', () => {
    expect(isActiveFinding({ status: 'open' })).toBe(true);
    expect(isActiveFinding({})).toBe(true);
    for (const status of ['resolved', 'remediated', 'dismissed', 'false_positive', 'snoozed']) {
      expect(isActiveFinding({ status })).toBe(false);
    }
  });
});

describe('correlate', () => {
  it('flags a Secure Coding requirement as violated when an injection finding is present', () => {
    const [c] = correlate([req({ category: 'Secure Coding' })], [finding()]);
    expect(c.status).toBe('violated');
    expect(c.matchedFindings).toHaveLength(1);
    expect(c.contradictsAttestation).toBe(false);
  });

  it('flags a Vulnerability Management requirement from a dependency finding', () => {
    const [c] = correlate(
      [req({ category: 'Vulnerability Management' })],
      [finding({ tool: 'trivy', category: 'dependency-vulnerability', title: 'CVE-2021-44228', message: 'log4j' })],
    );
    expect(c.status).toBe('violated');
  });

  it('flags a Cryptography requirement from a leaked secret', () => {
    const [c] = correlate(
      [req({ category: 'Cryptography' })],
      [finding({ tool: 'gitleaks', category: 'secret-exposure', title: 'aws-access-token' })],
    );
    expect(c.status).toBe('violated');
  });

  it('leaves a requirement no scanner can assess as unverified, never satisfied — even with findings present', () => {
    const [c] = correlate([req({ category: 'Privacy' })], [finding()]);
    expect(c.status).toBe('unverified');
    expect(c.matchedFindings).toHaveLength(0);
  });

  it('reports a human-attested (satisfied) requirement as attested when nothing contradicts it', () => {
    const [c] = correlate([req({ category: 'Secure Coding', lifecycleStatus: 'satisfied' })], []);
    expect(c.status).toBe('attested');
    expect(c.contradictsAttestation).toBe(false);
  });

  it('treats a waived requirement as attested', () => {
    const [c] = correlate([req({ category: 'Cryptography', lifecycleStatus: 'waived' })], []);
    expect(c.status).toBe('attested');
  });

  it('overrides a human "satisfied" with violated when a live finding contradicts it', () => {
    const [c] = correlate([req({ category: 'Secure Coding', lifecycleStatus: 'satisfied' })], [finding()]);
    expect(c.status).toBe('violated');
    expect(c.contradictsAttestation).toBe(true);
  });

  it('does not count a resolved finding as a violation (scanner silence is not proof, but a fixed finding is not a live one)', () => {
    const [c] = correlate([req({ category: 'Secure Coding' })], [finding({ status: 'resolved' })]);
    expect(c.status).toBe('unverified');
  });

  it('excludes obsolete requirements from the correlation', () => {
    const out = correlate([req({ lifecycleStatus: 'obsolete' })], [finding()]);
    expect(out).toHaveLength(0);
  });

  it('sorts violated requirements ahead of unverified and attested', () => {
    const out = correlate(
      [
        req({ code: 'A-ATTESTED', category: 'Access Control', lifecycleStatus: 'satisfied' }),
        req({ code: 'B-UNVERIFIED', category: 'Privacy' }),
        req({ code: 'C-VIOLATED', category: 'Secure Coding' }),
      ],
      [finding()],
    );
    expect(out.map((c) => c.status)).toEqual(['violated', 'unverified', 'attested']);
  });
});
