import { VulnerablePackage } from './reachabilityService';
import { redisConnection } from '../queues/redisConnection';
import { logger } from './logger';

/**
 * Image digest → findings store. Written by the CI ingest endpoint, read by the
 * K8s admission webhook so the gate decides on real scan data instead of a stub.
 *
 * Primary: Redis (shared across replicas, native PX TTL eviction). Fallback: a
 * bounded process-local LRU Map used only while Redis is unreachable, so a
 * transient DB drop degrades to stale-but-available instead of denying every
 * webhook. Writes mirror to the Map so an in-flight drop still serves the data
 * the same process just stored.
 *
 * ponytail: Redis use is gated on `status === 'ready'` (not a try/connect race),
 * so unit tests with no server deterministically hit the Map fallback. The Map is
 * per-process and lost on restart — that's the fallback's known ceiling, Redis is
 * the durable cross-replica path.
 */
const KEY_PREFIX = 'scan:';

/**
 * Tenant owning a cache entry. `null` means the legacy global namespace, used
 * by single-tenant deployments that still authenticate with the shared
 * CI_INGEST_API_KEY.
 */
export type Tenant = string | null;

/**
 * Namespaces every cache entry by tenant.
 *
 * Without this, entries were keyed by image digest alone and shared by all
 * tenants. Since the admission webhook gates deploys on these entries, any
 * party able to write one could declare an arbitrary digest clean and have
 * another tenant's pod admitted — a gate bypass rather than a disclosure.
 *
 * The tenant is URI-encoded so an id containing ':' cannot forge a different
 * tenant's namespace.
 */
function scopedKey(prefix: string, tenant: Tenant, digest: string): string {
  return tenant ? `${prefix}${encodeURIComponent(tenant)}:${digest}` : prefix + digest;
}
const MAX_ENTRIES = 1000;
const TTL_MS = 60 * 60 * 1000; // 1h — generous vs. CI build→admission gap.

interface Entry {
  packages: VulnerablePackage[];
  expiresAt: number;
  signature?: string;
}

const SIG_PREFIX = 'sig:';

const fallback = new Map<string, Entry>();

const redisReady = (): boolean => redisConnection.status === 'ready';
const toMessage = (err: unknown): string => (err instanceof Error ? err.message : String(err));

export async function putScan(
  tenant: Tenant,
  digest: string,
  packages: VulnerablePackage[],
  now: number = Date.now(),
  signature?: string
): Promise<void> {
  const key = scopedKey('', tenant, digest);
  // Always mirror locally so a mid-flight Redis drop still serves what we just stored.
  putLocal(key, packages, now, signature);
  if (!redisReady()) return;
  try {
    await redisConnection.set(KEY_PREFIX + key, JSON.stringify(packages), 'PX', TTL_MS);
    if (signature) {
      await redisConnection.set(SIG_PREFIX + key, signature, 'PX', TTL_MS);
    }
  } catch (err) {
    logger.warn('[imageStore] redis put failed — kept local fallback', { digest, error: toMessage(err) });
  }
}

/**
 * Cosign signature recorded for an image digest at CI-ingest time, if any.
 * Read by the K8s admission webhook when REQUIRE_IMAGE_SIGNATURE is enabled.
 * Absence (undefined) means "no signature on record" — the caller decides
 * whether that blocks (it does, fail-secure, in prod when enforcement is on).
 */
export async function getSignature(tenant: Tenant, digest: string, now: number = Date.now()): Promise<string | undefined> {
  const key = scopedKey('', tenant, digest);
  if (redisReady()) {
    try {
      const raw = await redisConnection.get(SIG_PREFIX + key);
      if (raw !== null) return raw;
    } catch (err) {
      logger.warn('[imageStore] redis sig get failed — serving local fallback', { digest, error: toMessage(err) });
    }
  }
  const entry = fallback.get(key);
  if (entry === undefined || entry.expiresAt <= now) return undefined;
  return entry.signature;
}

/**
 * Signed SLSA provenance (serialized SignedProvenance JSON) recorded per image
 * digest at build time by buildService. Written on a separate path from
 * putScan (build vs. CI-ingest), so it lives under its own key/fallback map
 * rather than inside Entry. Same Redis-primary + bounded local LRU semantics.
 */
const PROV_PREFIX = 'prov:';
const provFallback = new Map<string, { value: string; expiresAt: number }>();

export async function putProvenance(tenant: Tenant, digest: string, provenanceJson: string, now: number = Date.now()): Promise<void> {
  const key = scopedKey('', tenant, digest);
  provFallback.delete(key);
  while (provFallback.size >= MAX_ENTRIES) {
    const oldest = provFallback.keys().next().value;
    if (oldest === undefined) break;
    provFallback.delete(oldest);
  }
  provFallback.set(key, { value: provenanceJson, expiresAt: now + TTL_MS });
  if (!redisReady()) return;
  try {
    await redisConnection.set(PROV_PREFIX + key, provenanceJson, 'PX', TTL_MS);
  } catch (err) {
    logger.warn('[imageStore] redis provenance put failed — kept local fallback', { digest, error: toMessage(err) });
  }
}

export async function getProvenance(tenant: Tenant, digest: string, now: number = Date.now()): Promise<string | undefined> {
  const key = scopedKey('', tenant, digest);
  if (redisReady()) {
    try {
      const raw = await redisConnection.get(PROV_PREFIX + key);
      if (raw !== null) return raw;
    } catch (err) {
      logger.warn('[imageStore] redis provenance get failed — serving local fallback', { digest, error: toMessage(err) });
    }
  }
  const entry = provFallback.get(key);
  if (entry === undefined || entry.expiresAt <= now) return undefined;
  return entry.value;
}

export async function getScan(tenant: Tenant, digest: string, now: number = Date.now()): Promise<VulnerablePackage[] | undefined> {
  const key = scopedKey('', tenant, digest);
  if (redisReady()) {
    try {
      const raw = await redisConnection.get(KEY_PREFIX + key);
      if (raw !== null) return JSON.parse(raw) as VulnerablePackage[];
      // Redis up but key absent: fall through to local in case a Redis write failed.
    } catch (err) {
      logger.warn('[imageStore] redis get failed — serving local fallback', { digest, error: toMessage(err) });
    }
  }
  return getLocal(key, now);
}

// --- process-local bounded LRU + lazy-TTL fallback ---------------------------
// Map iteration order is insertion order, so the first key is the LRU victim;
// delete-then-set moves a key to the tail to mark it most-recently-used.

function putLocal(digest: string, packages: VulnerablePackage[], now: number, signature?: string): void {
  fallback.delete(digest);
  while (fallback.size >= MAX_ENTRIES) {
    const oldest = fallback.keys().next().value;
    if (oldest === undefined) break;
    fallback.delete(oldest);
  }
  fallback.set(digest, { packages, expiresAt: now + TTL_MS, signature });
}

function getLocal(digest: string, now: number): VulnerablePackage[] | undefined {
  const entry = fallback.get(digest);
  if (entry === undefined) return undefined;
  if (entry.expiresAt <= now) {
    fallback.delete(digest);
    return undefined;
  }
  fallback.delete(digest);
  fallback.set(digest, entry);
  return entry.packages;
}
