import { logger } from '../logger';
import { verifyImageSignature } from '../cosignService';

/**
 * Resolves a baked scanner image to a verified, timestamped digest.
 *
 * The runner namespace denies egress, so scanners carry their vulnerability
 * database inside the image (see docker/scanners/). That makes two facts
 * security-relevant that normally are not:
 *
 *   WHICH image ran — a substituted image is a substituted scanner, and the
 *   registry is the one party positioned to substitute it. So the tag is
 *   resolved to a digest, the digest's signature is verified, and the DIGEST is
 *   dispatched. Verifying a tag and then dispatching that tag leaves a window
 *   for it to move in between.
 *
 *   HOW OLD its database is — a stale database reports "no vulnerabilities" for
 *   CVEs it has never heard of. That is the same silent-clean failure the
 *   canary and the unavailable-flag guard exist to prevent, arriving through
 *   the supply side instead.
 *
 * The build timestamp is read from an image LABEL via the registry, not from a
 * file inside the container. Both are covered by the digest, but reading a file
 * means executing the image and believing what it prints — asking the thing
 * under suspicion. The label comes from the manifest, which the signature
 * covers.
 */

export type Freshness = 'fresh' | 'degraded' | 'stale';

/** Trivy publishes database updates every six hours; a daily bake has slack. */
export const FRESH_HOURS = 24;
/**
 * Beyond this the image is refused. Deliberately not the 24h boundary: a broken
 * bake would otherwise freeze every pipeline a day later, and signature
 * databases are additive — a three-day gap misses three days of CVEs, which is
 * worth a warning rather than an outage.
 */
export const STALE_HOURS = Number(process.env.SCANNER_DB_STALE_HOURS) || 72;

/** The label the bake workflow stamps. */
export const BUILT_AT_LABEL = 'org.scorpion.db.built-at';

const REGISTRY_TIMEOUT_MS = 10_000;
const REGISTRY_ATTEMPTS = 3;

const MANIFEST_ACCEPT = [
  'application/vnd.oci.image.index.v1+json',
  'application/vnd.oci.image.manifest.v1+json',
  'application/vnd.docker.distribution.manifest.list.v2+json',
  'application/vnd.docker.distribution.manifest.v2+json',
].join(', ');

/** Raised for every refusal. Callers treat it as "no scanner", never as a clean scan. */
export class ScannerImageError extends Error {
  constructor(message: string, readonly reason: string) {
    super(message);
    this.name = 'ScannerImageError';
  }
}

export interface ResolvedScannerImage {
  /** Immutable reference to dispatch: registry/path@sha256:... */
  pinned: string;
  digest: string;
  builtAt: Date;
  freshness: Freshness;
  ageHours: number;
}

/**
 * Pure, so the thresholds are decided in tests rather than by accident.
 *
 * A build timestamp in the future is treated as stale, not fresh: it means a
 * clock is wrong somewhere, and trusting an unexplained timestamp is how a
 * never-refreshed database passes as current forever.
 */
export function classifyFreshness(builtAt: Date, now: Date = new Date()): Freshness {
  const ageHours = (now.getTime() - builtAt.getTime()) / 3_600_000;
  if (ageHours < -1) return 'stale';
  if (ageHours <= FRESH_HOURS) return 'fresh';
  if (ageHours <= STALE_HOURS) return 'degraded';
  return 'stale';
}

/** Splits `ghcr.io/owner/name` into the host and repository path. */
function splitRef(ref: string): { host: string; path: string } {
  const slash = ref.indexOf('/');
  if (slash === -1) throw new ScannerImageError(`malformed image reference: ${ref}`, 'malformed_ref');
  return { host: ref.slice(0, slash), path: ref.slice(slash + 1) };
}

async function withRetry<T>(what: string, fn: () => Promise<T>): Promise<T> {
  let last: unknown;
  for (let attempt = 1; attempt <= REGISTRY_ATTEMPTS; attempt += 1) {
    try {
      return await fn();
    } catch (err) {
      last = err;
      // A registry blip must not read as "no such image", which would block
      // every scan. Retried with backoff, then surfaced as its own reason.
      if (attempt < REGISTRY_ATTEMPTS) await new Promise(r => setTimeout(r, 250 * attempt));
    }
  }
  throw new ScannerImageError(
    `${what} failed after ${REGISTRY_ATTEMPTS} attempts: ${last instanceof Error ? last.message : String(last)}`,
    'registry_unreachable',
  );
}

/** Anonymous pull token. The scanner packages are public — see the Phase 1 decision. */
async function pullToken(host: string, path: string): Promise<string> {
  return withRetry('registry token', async () => {
    const res = await fetch(`https://${host}/token?scope=repository:${path}:pull&service=${host}`, {
      signal: AbortSignal.timeout(REGISTRY_TIMEOUT_MS),
    });
    if (!res.ok) throw new Error(`token endpoint returned ${res.status}`);
    const body = (await res.json()) as { token?: string };
    if (!body.token) throw new Error('token endpoint returned no token');
    return body.token;
  });
}

async function registryJson<T>(url: string, token: string): Promise<{ body: T; digest: string | null }> {
  return withRetry(`registry GET ${url}`, async () => {
    const res = await fetch(url, {
      headers: { authorization: `Bearer ${token}`, accept: MANIFEST_ACCEPT },
      signal: AbortSignal.timeout(REGISTRY_TIMEOUT_MS),
    });
    if (!res.ok) throw new Error(`${url} returned ${res.status}`);
    return { body: (await res.json()) as T, digest: res.headers.get('docker-content-digest') };
  });
}

interface Descriptor { digest: string; mediaType?: string; platform?: { os?: string; architecture?: string } }
interface Manifest { mediaType?: string; manifests?: Descriptor[]; config?: Descriptor }
interface ConfigBlob { config?: { Labels?: Record<string, string> } }

/**
 * Reads the build timestamp label, descending through a multi-arch index when
 * the registry serves one.
 */
async function readBuiltAt(host: string, path: string, digest: string, token: string): Promise<Date> {
  const base = `https://${host}/v2/${path}`;
  const { body: manifest } = await registryJson<Manifest>(`${base}/manifests/${digest}`, token);

  let config = manifest.config;
  if (!config && manifest.manifests?.length) {
    const linux = manifest.manifests.find(
      m => m.platform?.os === 'linux' && m.platform?.architecture === 'amd64',
    ) ?? manifest.manifests[0];
    const { body: inner } = await registryJson<Manifest>(`${base}/manifests/${linux.digest}`, token);
    config = inner.config;
  }
  if (!config?.digest) {
    throw new ScannerImageError('image manifest carries no config descriptor', 'no_config');
  }

  const { body: blob } = await registryJson<ConfigBlob>(`${base}/blobs/${config.digest}`, token);
  const raw = blob.config?.Labels?.[BUILT_AT_LABEL];
  if (!raw) {
    // Not a formatting problem. An image with no stamp cannot be shown to be
    // fresh, and unknown age is not fresh.
    throw new ScannerImageError(`image has no ${BUILT_AT_LABEL} label`, 'no_timestamp');
  }

  const builtAt = new Date(raw);
  if (Number.isNaN(builtAt.getTime())) {
    throw new ScannerImageError(`${BUILT_AT_LABEL} is not a date: "${raw}"`, 'bad_timestamp');
  }
  return builtAt;
}

/**
 * Resolves, verifies and dates a scanner image.
 *
 * Every failure raises rather than returning a degraded result, mirroring the
 * ladder k8sAdmission already applies to deploys: unresolvable, unsigned,
 * tampered, and unverifiable all block. An operator who turned this on gets an
 * image they can prove, or none.
 *
 * Staleness is REPORTED, not enforced here — the caller decides, because
 * `degraded` is a warning and `stale` is a refusal, and that policy belongs
 * with the thing that can emit telemetry and honour a break-glass.
 */
export async function resolveScannerImage(ref: string, now: Date = new Date()): Promise<ResolvedScannerImage> {
  const { host, path } = splitRef(ref);
  const token = await pullToken(host, path);

  const { digest } = await registryJson<unknown>(`https://${host}/v2/${path}/manifests/current`, token);
  if (!digest) {
    throw new ScannerImageError(`registry did not report a digest for ${ref}:current`, 'no_digest');
  }

  const builtAt = await readBuiltAt(host, path, digest, token);
  const pinned = `${ref}@${digest}`;

  // Verified against the digest, and the digest is what gets dispatched. A tag
  // verified and then dispatched could move in between.
  let verified: boolean;
  try {
    verified = await verifyImageSignature(pinned);
  } catch (err) {
    // Cosign missing, or no public key configured. The operator enabled this,
    // so an image we cannot prove must not run — same rung as k8sAdmission.
    throw new ScannerImageError(
      `cannot verify ${pinned}: ${err instanceof Error ? err.message : String(err)}`,
      'unverifiable',
    );
  }
  if (!verified) {
    throw new ScannerImageError(`signature verification failed for ${pinned}`, 'bad_signature');
  }

  const ageHours = (now.getTime() - builtAt.getTime()) / 3_600_000;
  const freshness = classifyFreshness(builtAt, now);

  logger.info('[ScannerImage] resolved', {
    event: 'scanner_image_resolved', ref, digest, freshness, ageHours: Math.round(ageHours),
  });

  return { pinned, digest, builtAt, freshness, ageHours };
}
