import { CORRELATION_CATALOG, catalogById } from './correlationCatalog';

test('catalog has the 5 fixed rules with unique ids', () => {
  const ids = CORRELATION_CATALOG.map(r => r.id);
  expect(ids).toEqual([
    'account-takeover', 'ssrf-metadata-exfil', 'recon-to-exploit',
    'runtime-breakout', 'gate-bypass-deploy',
  ]);
  expect(new Set(ids).size).toBe(5);
});

test('account-takeover requires new-IP success between failures and export', () => {
  const r = catalogById('account-takeover')!;
  expect(r.key).toBe('actor');
  expect(r.sequence[0].minCount).toBe(5);
  expect(r.sequence[1].newValueFor).toBe('srcIp');
});

test('ssrf rule pins the cloud metadata IP', () => {
  const r = catalogById('ssrf-metadata-exfil')!;
  expect(r.sequence[0].targetEquals).toBe('169.254.169.254');
});
