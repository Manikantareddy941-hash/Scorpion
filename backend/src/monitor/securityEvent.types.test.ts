import type { SecurityEvent, CorrelationRule, Correlation } from './securityEvent.types';

test('SecurityEvent shape accepts a normalized event', () => {
  const e: SecurityEvent = {
    id: 'e1', type: 'auth_failure', ownerUserId: 'u1',
    severity: 'high', timestamp: 1000, srcIp: '1.2.3.4',
  };
  expect(e.type).toBe('auth_failure');
});

test('CorrelationRule requires an ordered condition sequence', () => {
  const r: CorrelationRule = {
    id: 'account-takeover', title: 'Account Takeover', severity: 'critical',
    key: 'actor', windowMs: 600000,
    sequence: [{ type: 'auth_failure', minCount: 5 }, { type: 'auth_success' }, { type: 'data_export' }],
  };
  expect(r.sequence).toHaveLength(3);
});
