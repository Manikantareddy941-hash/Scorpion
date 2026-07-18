import { putScan, getScan, putProvenance, getProvenance } from './imageStore';

/**
 * Cross-tenant isolation of the scan cache.
 *
 * The admission webhook gates deploys on these entries. When they were keyed by
 * image digest alone, every tenant shared them — so any party able to write one
 * could declare an arbitrary digest clean and have another tenant's pod
 * admitted. That is a gate bypass, not a disclosure, which is why these run
 * against the in-process fallback with no Redis required.
 */

const CLEAN: never[] = [];
const VULNERABLE = [{ pkgName: 'openssl', severity: 'critical' }] as never;

describe('imageStore tenant isolation', () => {
  it('does not serve one tenant a scan written by another', async () => {
    await putScan('tenant-a', 'sha256:shared', VULNERABLE);
    expect(await getScan('tenant-b', 'sha256:shared')).toBeUndefined();
  });

  it("a tenant's own scan is still readable by that tenant", async () => {
    await putScan('tenant-a', 'sha256:mine', VULNERABLE);
    expect(await getScan('tenant-a', 'sha256:mine')).toEqual(VULNERABLE);
  });

  it('one tenant cannot overwrite another tenant verdict for the same digest', async () => {
    // The attack: B declares a digest clean so A's admission gate lets it pass.
    await putScan('tenant-a', 'sha256:contested', VULNERABLE);
    await putScan('tenant-b', 'sha256:contested', CLEAN);

    expect(await getScan('tenant-a', 'sha256:contested')).toEqual(VULNERABLE);
    expect(await getScan('tenant-b', 'sha256:contested')).toEqual(CLEAN);
  });

  it('the legacy shared namespace is separate from any tenant namespace', async () => {
    await putScan(null, 'sha256:legacy', VULNERABLE);
    expect(await getScan('tenant-a', 'sha256:legacy')).toBeUndefined();
    expect(await getScan(null, 'sha256:legacy')).toEqual(VULNERABLE);
  });

  it('a tenant id containing a colon cannot forge another namespace', async () => {
    // Without encoding, tenant "a:sha256:x" would collide with tenant "a".
    await putScan('tenant-a', 'sha256:target', VULNERABLE);
    await putScan('tenant-a:sha256:target', 'sha256:decoy', CLEAN);
    expect(await getScan('tenant-a', 'sha256:target')).toEqual(VULNERABLE);
  });

  it('provenance is namespaced per tenant too', async () => {
    await putProvenance('tenant-a', 'sha256:prov', '{"builder":"a"}');
    expect(await getProvenance('tenant-b', 'sha256:prov')).toBeUndefined();
    expect(await getProvenance('tenant-a', 'sha256:prov')).toBe('{"builder":"a"}');
  });
});
