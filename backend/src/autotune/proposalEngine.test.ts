import { FindingRecord } from '../monitor/feedbackMetrics';
import { GateConfig } from '../repositories/gateRulesRepository';
import { MIN_PHASE_SHARE, MIN_SAMPLE, WINDOW_DAYS, proposeFromEscapes } from './proposalEngine';

const NOW = Date.parse('2026-08-01T00:00:00.000Z');
const DAY = 86_400_000;

/** checkov -> deploy phase, semgrep -> build phase (see feedbackMetrics PHASE). */
const finding = (
  scanner: string, severity = 'high', ageDays = 1,
): FindingRecord => ({ scanner, severity, status: 'open', createdAt: NOW - ageDays * DAY });

const many = (n: number, scanner: string, severity = 'high', ageDays = 1): FindingRecord[] =>
  Array.from({ length: n }, () => finding(scanner, severity, ageDays));

const config = (over: Partial<GateConfig['rules'][number]>[] = []): GateConfig => ({
  env: 'prod',
  rules: over.length > 0
    ? over.map((o, i) => ({ id: `r${i}`, severity: 'high', threshold: 5, action: 'warn', enabled: true, ...o }))
    : [{ id: 'seed-high', severity: 'high', threshold: 5, action: 'warn', enabled: true }],
});

const run = (findings: FindingRecord[], cfg = config(), existingOpen?: { targetId: string; field: string }[]) =>
  proposeFromEscapes(findings, cfg, { now: NOW, existingOpen });

describe('sample size', () => {
  test('proposes nothing below the minimum, and says so', () => {
    // 9 findings all in one phase is 100% — a percentage that means nothing.
    const result = run(many(MIN_SAMPLE - 1, 'checkov'));

    expect(result.proposals).toEqual([]);
    expect(result.skipped[0]).toMatchObject({ reason: 'below_sample' });
  });

  test('proposes once the sample is large enough', () => {
    expect(run(many(MIN_SAMPLE, 'checkov')).proposals).toHaveLength(1);
  });

  test('findings outside the window do not count toward the sample', () => {
    const stale = many(MIN_SAMPLE, 'checkov', 'high', WINDOW_DAYS + 5);

    expect(run(stale).proposals).toEqual([]);
    expect(run(stale).skipped[0]).toMatchObject({ reason: 'below_sample' });
  });
});

describe('phase share', () => {
  test('a phase below the share threshold is skipped with its actual share', () => {
    // 6 deploy / 6 build = 50/50... push it under 40% with three phases.
    const findings = [...many(5, 'checkov'), ...many(5, 'semgrep'), ...many(5, 'zap')];
    const result = run(findings);

    expect(result.proposals).toEqual([]);
    expect(result.skipped.every((s) => s.reason === 'below_share')).toBe(true);
    expect(result.skipped[0].detail).toMatch(/%/);
  });

  test('a dominant phase crosses and produces a proposal', () => {
    const findings = [...many(12, 'checkov'), ...many(3, 'semgrep')];
    const result = run(findings);

    expect(result.proposals).toHaveLength(1);
    expect(result.proposals[0].metricKey).toBe('escape_share:deploy');
    expect(result.proposals[0].metricValue).toBeGreaterThanOrEqual(MIN_PHASE_SHARE);
    expect(result.proposals[0].metricThreshold).toBe(MIN_PHASE_SHARE);
  });
});

describe('the phase-to-severity bridge', () => {
  test('targets the rule for the severity that dominates the leaking phase', () => {
    // Escapes are counted by phase; gate rules are keyed by severity. The rule
    // proposed against must be the one governing what actually leaked.
    const findings = [...many(12, 'checkov', 'critical'), ...many(2, 'semgrep', 'low')];
    const cfg = config([
      { id: 'rule-critical', severity: 'critical', threshold: 3 },
      { id: 'rule-high', severity: 'high', threshold: 5 },
    ]);

    expect(run(findings, cfg).proposals[0]).toMatchObject({ targetId: 'rule-critical', currentValue: 3, proposedValue: 2 });
  });

  test('skips when no rule covers the leaking severity', () => {
    const findings = many(12, 'checkov', 'low');
    const cfg = config([{ id: 'rule-critical', severity: 'critical', threshold: 3 }]);

    const result = run(findings, cfg);
    expect(result.proposals).toEqual([]);
    expect(result.skipped.some((s) => s.reason === 'no_rule_for_severity')).toBe(true);
  });
});

describe('the floor', () => {
  test('a rule already at threshold 0 produces no proposal', () => {
    // DEFAULT_CONFIG seeds critical at 0, so a fresh install legitimately has
    // nothing to propose. Zero proposals is correct, not broken.
    const findings = many(12, 'checkov', 'critical');
    const cfg = config([{ id: 'seed-critical', severity: 'critical', threshold: 0 }]);

    const result = run(findings, cfg);
    expect(result.proposals).toEqual([]);
    expect(result.skipped.some((s) => s.reason === 'at_floor')).toBe(true);
  });

  test('never proposes a negative threshold', () => {
    const cfg = config([{ id: 'r', severity: 'high', threshold: 0 }]);

    for (const p of run(many(12, 'checkov'), cfg).proposals) {
      expect(Number(p.proposedValue)).toBeGreaterThanOrEqual(0);
    }
  });
});

describe('disabled rules', () => {
  test('proposes enabling rather than lowering an inert threshold', () => {
    // The threshold means nothing while the rule is off, so switching it on is
    // the change that actually restores the control.
    const cfg = config([{ id: 'r-off', severity: 'high', threshold: 5, enabled: false }]);

    expect(run(many(12, 'checkov'), cfg).proposals[0]).toMatchObject({
      targetId: 'r-off', field: 'enabled', currentValue: false, proposedValue: true,
    });
  });
});

describe('deduplication', () => {
  test('does not queue a second proposal for a rule and field already open', () => {
    const result = run(many(12, 'checkov'), config(), [{ targetId: 'seed-high', field: 'threshold' }]);

    expect(result.proposals).toEqual([]);
    expect(result.skipped.some((s) => s.reason === 'already_proposed')).toBe(true);
  });

  test('an open proposal on a different field does not block this one', () => {
    const result = run(many(12, 'checkov'), config(), [{ targetId: 'seed-high', field: 'action' }]);

    expect(result.proposals).toHaveLength(1);
  });
});

describe('the rationale is the product', () => {
  test('states the share, the counts, the severity and the exact diff', () => {
    // An operator has to be able to judge the proposal from this one string.
    const { rationale } = run([...many(12, 'checkov'), ...many(3, 'semgrep')]).proposals[0];

    expect(rationale).toMatch(/80% of escaped findings/);
    expect(rationale).toMatch(/deploy phase \(12 of 15\)/);
    expect(rationale).toMatch(/mostly high severity/);
    expect(rationale).toMatch(/threshold 5 -> 4/);
  });

  test('carries a re-runnable evidence descriptor, not a hash', () => {
    const { evidenceQuery } = run(many(12, 'checkov')).proposals[0];

    expect(JSON.parse(evidenceQuery)).toEqual({
      kind: 'escape_share', phase: 'deploy', windowDays: WINDOW_DAYS, minSample: MIN_SAMPLE,
    });
  });
});

test('every proposal is a tightening one', () => {
  // The engine must never emit a diff the kernel would refuse.
  const findings = [...many(12, 'checkov', 'critical'), ...many(11, 'semgrep', 'high')];
  const cfg = config([
    { id: 'rc', severity: 'critical', threshold: 4 },
    { id: 'rh', severity: 'high', threshold: 2 },
  ]);

  for (const p of proposeFromEscapes(findings, cfg, { now: NOW }).proposals) {
    if (p.field === 'threshold') expect(Number(p.proposedValue)).toBeLessThan(Number(p.currentValue));
    if (p.field === 'enabled') expect(p.proposedValue).toBe(true);
  }
});

test('a healthy pipeline yields no proposals and an explanation for each phase', () => {
  const even = [...many(5, 'checkov'), ...many(5, 'semgrep'), ...many(5, 'zap'), ...many(5, 'falco')];
  const result = run(even);

  expect(result.proposals).toEqual([]);
  expect(result.skipped.length).toBeGreaterThan(0);
});

test('findings that map to no known phase produce a skip, not silence', () => {
  // Zero proposals AND zero skips is indistinguishable from a broken engine.
  // Every finding in the live database looked like this until the scanner was
  // read from `tool` rather than the absent `scanner` field.
  const unmapped = Array.from({ length: 20 }, () => ({
    scanner: 'some-tool-nobody-mapped', severity: 'high', status: 'open', createdAt: NOW - DAY,
  }));

  const result = run(unmapped);

  expect(result.proposals).toEqual([]);
  expect(result.skipped).toEqual([
    { reason: 'no_actionable_phase', detail: expect.stringContaining('none map to a known pipeline phase') },
  ]);
});
