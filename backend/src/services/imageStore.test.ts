import { putScan, getScan, putProvenance, getProvenance } from './imageStore';

const pkg = (id: string): { pkgName: string } => ({ pkgName: id });

// No Redis server in unit env → redisConnection.status !== 'ready' → these
// exercise the process-local LRU + TTL fallback (the deterministic path).
describe('imageStore LRU + TTL fallback', () => {
  it('returns stored findings before expiry', async () => {
    const t = 1_000_000;
    await putScan('sha-a', [pkg('a')], t);
    expect(await getScan('sha-a', t)).toEqual([pkg('a')]);
  });

  it('expires entries past their TTL on read', async () => {
    const t = 1_000_000;
    await putScan('sha-ttl', [pkg('x')], t);
    expect(await getScan('sha-ttl', t + 60 * 60 * 1000 + 1)).toBeUndefined();
  });

  it('evicts the least-recently-used digest when capacity is exceeded', async () => {
    const base = 2_000_000;
    // Fill to the 1000-entry cap.
    for (let i = 0; i < 1000; i++) await putScan(`d-${i}`, [pkg(`${i}`)], base);
    // Touch d-0 so it is no longer the LRU victim.
    expect(await getScan('d-0', base)).toEqual([pkg('0')]);
    // One more insert must evict d-1 (now oldest), not the freshly touched d-0.
    await putScan('d-new', [pkg('new')], base);
    expect(await getScan('d-1', base)).toBeUndefined();
    expect(await getScan('d-0', base)).toEqual([pkg('0')]);
    expect(await getScan('d-new', base)).toEqual([pkg('new')]);
  });
});

describe('provenance store fallback', () => {
  it('returns stored provenance before expiry', async () => {
    const t = 1_000_000;
    await putProvenance('sha-p', '{"statement":{}}', t);
    expect(await getProvenance('sha-p', t)).toBe('{"statement":{}}');
  });

  it('expires provenance past its TTL on read', async () => {
    const t = 1_000_000;
    await putProvenance('sha-p-ttl', '{}', t);
    expect(await getProvenance('sha-p-ttl', t + 60 * 60 * 1000 + 1)).toBeUndefined();
  });

  it('returns undefined for unknown digests', async () => {
    expect(await getProvenance('sha-p-missing')).toBeUndefined();
  });
});
