import { putScan, getSignature } from './imageStore';

// Redis is not 'ready' in unit tests, so these deterministically exercise the
// process-local fallback path (see imageStore.ts module comment).
describe('imageStore signature persistence', () => {
  it('round-trips a signature stored alongside a scan', async () => {
    await putScan(null, 'sha256:sig-a', [], Date.now(), 'cosign-blob-sig');
    expect(await getSignature(null, 'sha256:sig-a')).toBe('cosign-blob-sig');
  });

  it('returns undefined when a scan was stored without a signature', async () => {
    await putScan(null, 'sha256:sig-b', []);
    expect(await getSignature(null, 'sha256:sig-b')).toBeUndefined();
  });

  it('returns undefined for a digest that was never stored', async () => {
    expect(await getSignature(null, 'sha256:never')).toBeUndefined();
  });

  it('treats an expired entry as having no signature', async () => {
    const past = Date.now() - 10_000;
    await putScan(null, 'sha256:sig-c', [], past, 'stale-sig');
    // Read "now" well past the 1h TTL relative to the past insert.
    expect(await getSignature(null, 'sha256:sig-c', past + 60 * 60 * 1000 + 1)).toBeUndefined();
  });
});
