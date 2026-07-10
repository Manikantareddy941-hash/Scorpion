import { isSuppressed, SuppressionRule } from './suppressionMatcher';

const now = 1000;
const cand = { ruleId: 'recon-to-exploit', severity: 'high', repoId: 'r1', actor: 'a1' };

test('suppresses on exact ruleId match', () => {
  const rules: SuppressionRule[] = [{ id: 's1', matchType: 'ruleId', matchValue: 'recon-to-exploit' }];
  expect(isSuppressed(cand, rules, now).suppressed).toBe(true);
});

test('expired rule does not suppress', () => {
  const rules: SuppressionRule[] = [{ id: 's1', matchType: 'severity', matchValue: 'high', expiresAt: 500 }];
  expect(isSuppressed(cand, rules, now).suppressed).toBe(false);
});

test('no match → not suppressed', () => {
  const rules: SuppressionRule[] = [{ id: 's1', matchType: 'actor', matchValue: 'someone-else' }];
  expect(isSuppressed(cand, rules, now).suppressed).toBe(false);
});
