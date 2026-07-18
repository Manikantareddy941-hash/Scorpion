import { putScan, getScan, putProvenance, getProvenance } from './imageStore';

const pkg = (id: string): { pkgName: string } => ({ pkgName: id });

// No Redis server in unit env → redisConnection.status !== 'ready' → these
// exercise the process-local LRU + TTL fallback (the deterministic path).
describe('imageStore LRU + TTL fallback', () => {
  it('returns stored findings before expiry', async () => {
    const t = 1_000_000;
    await putScan(null, 'sha-a', [pkg('a')], t);
    expect(await getScan(null, 'sha-a', t)).toEqual([pkg('a')]);
  });

  it('expires entries past their TTL on read', async () => {
    const t = 1_000_000;
    await putScan(null, 'sha-ttl', [pkg('x')], t);
    expect(await getScan(null, 'sha-ttl', t + 60 * 60 * 1000 + 1)).toBeUndefined();
  });

  it('evicts the least-recently-used digest when capacity is exceeded', async () => {
    const base = 2_000_000;
    // Fill to the 1000-entry cap.
    for (let i = 0; i < 1000; i++) await putScan(null, `d-${i}`, [pkg(`${i}`)], base);
    // Touch d-0 so it is no longer the LRU victim.
    expect(await getScan(null, 'd-0', base)).toEqual([pkg('0')]);
    // One more insert must evict d-1 (now oldest), not the freshly touched d-0.
    await putScan(null, 'd-new', [pkg('new')], base);
    expect(await getScan(null, 'd-1', base)).toBeUndefined();
    expect(await getScan(null, 'd-0', base)).toEqual([pkg('0')]);
    expect(await getScan(null, 'd-new', base)).toEqual([pkg('new')]);
  });
});

describe('provenance store fallback', () => {
  it('returns stored provenance before expiry', async () => {
    const t = 1_000_000;
    await putProvenance(null, 'sha-p', '{"statement":{}}', t);
    expect(await getProvenance(null, 'sha-p', t)).toBe('{"statement":{}}');
  });

  it('expires provenance past its TTL on read', async () => {
    const t = 1_000_000;
    await putProvenance(null, 'sha-p-ttl', '{}', t);
    expect(await getProvenance(null, 'sha-p-ttl', t + 60 * 60 * 1000 + 1)).toBeUndefined();
  });

  it('returns undefined for unknown digests', async () => {
    expect(await getProvenance(null, 'sha-p-missing')).toBeUndefined();
  });
});
