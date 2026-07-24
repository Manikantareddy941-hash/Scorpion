import { generate, reconcile } from './securityRequirementsEngine';
import { securityRequirementRules } from './securityRequirementRules';
import { ProjectProfile, StoredRequirement, Framework } from '../types/securityRequirements.types';

// A base profile; individual tests override the dimensions they exercise.
const baseProfile = (over: Partial<ProjectProfile> = {}): ProjectProfile => ({
  projectId: 'proj-1',
  appType: 'api',
  stack: ['node'],
  dataTypes: ['none'],
  deployment: 'cloud',
  authModel: 'session',
  frameworks: [],
  ...over,
});

describe('securityRequirementsEngine.generate', () => {
  it('emits PCI card-data requirements for a card+PCI profile', () => {
    const reqs = generate(baseProfile({ dataTypes: ['card'], frameworks: ['PCI DSS'] }));
    const codes = reqs.map((r) => r.code);

    expect(codes).toContain('REQ-PCI-6.5.1-SQLI');
    expect(codes).toContain('REQ-PCI-3.4-ENCRYPT-AT-REST');
  });

  it('excludes requirements whose framework was not selected', () => {
    const reqs = generate(baseProfile({ dataTypes: ['card'], frameworks: ['PCI DSS'] }));
    const codes = reqs.map((r) => r.code);

    // HIPAA PHI requirement must not appear without health data + HIPAA selected.
    expect(codes).not.toContain('REQ-HIPAA-164.312-PHI-ENCRYPT');
  });

  it('emits HIPAA requirements for a health+HIPAA profile', () => {
    const reqs = generate(baseProfile({ dataTypes: ['health'], frameworks: ['HIPAA'] }));
    expect(reqs.map((r) => r.code)).toContain('REQ-HIPAA-164.312-PHI-ENCRYPT');
  });

  it('merges the same code across frameworks instead of overwriting', () => {
    // Both PCI and SOC 2 require MFA and emit REQ-AUTH-MFA.
    const reqs = generate(baseProfile({ frameworks: ['PCI DSS', 'SOC 2'], authModel: 'session' }));
    const mfa = reqs.filter((r) => r.code === 'REQ-AUTH-MFA');

    expect(mfa).toHaveLength(1);
    expect(mfa[0].frameworks).toEqual(expect.arrayContaining<Framework>(['PCI DSS', 'SOC 2']));
    expect(mfa[0].frameworks).toHaveLength(2);
    expect(mfa[0].controlIds.length).toBeGreaterThanOrEqual(2);
    expect(mfa[0].sourceRuleId.length).toBeGreaterThanOrEqual(2);
  });

  it('takes the highest severity and strongest status on merge', () => {
    const reqs = generate(baseProfile({ frameworks: ['PCI DSS', 'SOC 2'], authModel: 'session' }));
    const mfa = reqs.find((r) => r.code === 'REQ-AUTH-MFA');

    // PCI emits high/required, SOC2 emits medium/recommended -> high/required wins.
    expect(mfa?.severity).toBe('high');
    expect(mfa?.status).toBe('required');
  });

  it('is deterministic: same profile yields identical output', () => {
    const p = baseProfile({ dataTypes: ['card', 'pii'], frameworks: ['PCI DSS', 'GDPR'] });
    expect(generate(p)).toEqual(generate(p));
  });

  it('returns codes in stable sorted order', () => {
    const reqs = generate(baseProfile({ dataTypes: ['card'], frameworks: ['PCI DSS', 'SOC 2'] }));
    const codes = reqs.map((r) => r.code);
    expect(codes).toEqual([...codes].sort());
  });
});

describe('securityRequirementRules integrity', () => {
  const KNOWN_FRAMEWORKS: Framework[] = ['PCI DSS', 'NIST 800-53', 'SOC 2', 'ISO 27001', 'HIPAA', 'GDPR'];

  it('every emitted requirement is well-formed', () => {
    for (const rule of securityRequirementRules) {
      expect(rule.id).toBeTruthy();
      expect(typeof rule.when).toBe('function');
      for (const e of rule.emit) {
        expect(e.code).toMatch(/^REQ-/);
        expect(e.title.length).toBeGreaterThan(0);
        expect(e.description.length).toBeGreaterThan(0);
        expect(e.remediation.length).toBeGreaterThan(0);
        expect(e.controlId.length).toBeGreaterThan(0);
        expect(KNOWN_FRAMEWORKS).toContain(e.framework);
        expect(['low', 'medium', 'high', 'critical']).toContain(e.severity);
        expect(['required', 'recommended']).toContain(e.status);
      }
    }
  });

  it('no two rules disagree on a code category or title', () => {
    const seen = new Map<string, { category: string; title: string }>();
    for (const rule of securityRequirementRules) {
      for (const e of rule.emit) {
        const prior = seen.get(e.code);
        if (prior) {
          expect(e.category).toBe(prior.category);
          expect(e.title).toBe(prior.title);
        } else {
          seen.set(e.code, { category: e.category, title: e.title });
        }
      }
    }
  });
});

describe('securityRequirementsEngine.reconcile', () => {
  const gen = (code: string) => ({
    code, title: code, description: 'd', category: 'c',
    frameworks: ['PCI DSS'] as Framework[], controlIds: ['x'], severity: 'high' as const,
    status: 'required' as const, remediation: 'r', sourceRuleId: ['rule-x'],
  });

  const stored = (code: string, over: Partial<StoredRequirement> = {}): StoredRequirement => ({
    ...gen(code), $id: `id-${code}`, projectId: 'proj-1',
    lifecycleStatus: 'open', createdAt: '2026-01-01', ...over,
  });

  it('creates requirements that are new', () => {
    const plan = reconcile([gen('REQ-A')], []);
    expect(plan.toCreate.map((r) => r.code)).toEqual(['REQ-A']);
    expect(plan.toUpdate).toHaveLength(0);
    expect(plan.toObsolete).toHaveLength(0);
  });

  it('preserves satisfied status and updatedBy when a requirement still applies', () => {
    const prior = stored('REQ-A', { lifecycleStatus: 'satisfied', updatedBy: 'alice@x', justification: 'done' });
    const plan = reconcile([gen('REQ-A')], [prior]);

    expect(plan.toUpdate).toHaveLength(1);
    expect(plan.toUpdate[0].stored.lifecycleStatus).toBe('satisfied');
    expect(plan.toUpdate[0].stored.updatedBy).toBe('alice@x');
    expect(plan.toCreate).toHaveLength(0);
  });

  it('marks a stored requirement obsolete when it no longer applies', () => {
    const plan = reconcile([gen('REQ-A')], [stored('REQ-A'), stored('REQ-GONE')]);
    expect(plan.toObsolete.map((r) => r.code)).toEqual(['REQ-GONE']);
  });

  it('does not re-obsolete an already-obsolete requirement', () => {
    const plan = reconcile([], [stored('REQ-OLD', { lifecycleStatus: 'obsolete' })]);
    expect(plan.toObsolete).toHaveLength(0);
  });
});
