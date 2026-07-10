import { evaluate } from './correlationEngine';
import { catalogById } from './correlationCatalog';
import type { SecurityEvent } from './securityEvent.types';

const ev = (p: Partial<SecurityEvent> & Pick<SecurityEvent, 'type' | 'timestamp'>): SecurityEvent => ({
  id: `${p.type}-${p.timestamp}`, ownerUserId: 'u1', severity: 'high', ...p,
});

test('fires account-takeover on failures → new-IP success → export for same actor', () => {
  const rule = catalogById('account-takeover')!;
  const t = 1_000_000;
  const events: SecurityEvent[] = [
    ...[0,1,2,3,4].map(i => ev({ type: 'auth_failure', actor: 'a', srcIp: '1.1.1.1', timestamp: t + i })),
    ev({ type: 'auth_success', actor: 'a', srcIp: '9.9.9.9', timestamp: t + 10 }),
    ev({ type: 'data_export', actor: 'a', srcIp: '9.9.9.9', timestamp: t + 20 }),
  ];
  const out = evaluate(events, [rule], t + 30);
  expect(out).toHaveLength(1);
  expect(out[0].ruleId).toBe('account-takeover');
  expect(out[0].correlationKey).toBe('a');
});

test('does not fire when success IP equals failure IP (no new-IP)', () => {
  const rule = catalogById('account-takeover')!;
  const t = 1_000_000;
  const events: SecurityEvent[] = [
    ...[0,1,2,3,4].map(i => ev({ type: 'auth_failure', actor: 'a', srcIp: '1.1.1.1', timestamp: t + i })),
    ev({ type: 'auth_success', actor: 'a', srcIp: '1.1.1.1', timestamp: t + 10 }),
    ev({ type: 'data_export', actor: 'a', srcIp: '1.1.1.1', timestamp: t + 20 }),
  ];
  expect(evaluate(events, [rule], t + 30)).toHaveLength(0);
});

test('does not fire when the sequence exceeds the window', () => {
  const rule = catalogById('ssrf-metadata-exfil')!; // window 5m
  const t = 1_000_000;
  const events: SecurityEvent[] = [
    ev({ type: 'metadata_access', srcIp: '2.2.2.2', target: '169.254.169.254', timestamp: t }),
    ev({ type: 'cloud_api', srcIp: '2.2.2.2', timestamp: t + 6 * 60_000 }),
  ];
  expect(evaluate(events, [rule], t + 6 * 60_000)).toHaveLength(0);
});

test('separates groups by key — cross-actor events never correlate', () => {
  const rule = catalogById('recon-to-exploit')!;
  const t = 1_000_000;
  const events: SecurityEvent[] = [
    ev({ type: 'recon', srcIp: 'A', timestamp: t }),
    ev({ type: 'exploit', srcIp: 'B', timestamp: t + 1 }),
  ];
  expect(evaluate(events, [rule], t + 2)).toHaveLength(0);
});
