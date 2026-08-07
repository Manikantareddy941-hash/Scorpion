import * as k8s from '@kubernetes/client-node';
import * as assert from 'assert';
import { logger, errorMessage } from '../services/logger';
import { gateRulesRepository, GateRule } from '../repositories/gateRulesRepository';
import { driftRepository } from '../repositories/driftRepository';
import { getScan } from '../services/imageStore';
import { redisConnection } from '../queues/redisConnection';
// ponytail: the pure gate classifier lives in the admission route (source of
// truth). Imported here to avoid drift between admit-time and runtime gating;
// extract both to a shared service package if this coupling ever bites.
import {
  evaluatePreflight,
  resolveSignal,
  namespaceToEnv,
  imageDigest,
  Signal,
} from '../routes/k8sAdmission';

/**
 * Continuous runtime drift monitor.
 *
 * The admission webhook (k8sAdmission.ts) gates images at pod-create time, but
 * a cluster drifts AFTER admission: an SLA threshold tightens, a fresh CVE lands
 * on an already-running digest, or someone hot-swaps an image out of band. This
 * worker polls running pods and re-validates each running container against the
 * SAME centralized gate rules, emitting a structured anomaly per divergence.
 *
 * SOLID: the Kubernetes client and rule source are injected behind interfaces
 * (DIP), so the detection core is pure and unit-testable without a cluster.
 */

type GateEnv = ReturnType<typeof namespaceToEnv>;
type GateStatus = ReturnType<typeof evaluatePreflight>['status'];

export type DriftType = 'gate-violation' | 'unscanned-image' | 'out-of-band-update';

/** One running container, reduced to the only fields drift detection needs. */
export interface RunningContainer {
  namespace: string;
  podName: string;
  containerName: string;
  /** Spec image ref, e.g. `nginx:1.25`. */
  image: string;
  /** Runtime image id from container status, e.g. `nginx@sha256:...`. */
  imageID: string;
}

/** Data source for running containers (DIP seam — real impl wraps CoreV1Api). */
export interface PodLister {
  listRunningContainers(): Promise<RunningContainer[]>;
}

export interface DriftAnomaly {
  driftType: DriftType;
  namespace: string;
  podName: string;
  containerName: string;
  image: string;
  imageDigest: string;
  /** Set only for out-of-band-update: the digest seen on the previous poll. */
  previousDigest?: string;
  env: GateEnv;
  gateStatus: GateStatus;
  reason: string;
  severityCounts: Signal['counts'];
}

export interface DriftMonitorOptions {
  lister: PodLister;
  /** Defaults to the cluster-scoped gate config in gateRulesRepository. */
  loadRules?: () => Promise<GateRule[]>;
  /** Poll cadence; defaults to DRIFT_POLL_INTERVAL_MS env or 60s. */
  intervalMs?: number;
  /** Sink for anomalies; defaults to a structured JSON log line. */
  onAnomaly?: (anomaly: DriftAnomaly) => void;
}

const DEFAULT_INTERVAL_MS = Number(process.env.DRIFT_POLL_INTERVAL_MS) || 60_000;

// Per-container last-seen digest in Redis: shared across replicas, native PX TTL
// eviction. 24h TTL bounds storage — a container silent longer than that simply
// re-baselines (no false out-of-band alert on a normal redeploy gap).
const LAST_DIGEST_PREFIX = 'drift:lastdigest:';
const LAST_DIGEST_TTL_MS = 24 * 60 * 60 * 1000; // 24h

const redisReady = (): boolean => redisConnection.status === 'ready';

// Gate config is cluster-scoped, stored under one well-known system account —
// same convention as the admission webhook so both gate on identical rules.
const SYSTEM_USER_ID = process.env.K8S_GATE_RULES_USER_ID || 'system';

/**
 * Normalize a container-status imageID into a `repo@sha256:...` ref that
 * imageDigest()/resolveSignal() understand. K8s emits several shapes:
 *   `docker-pullable://repo@sha256:..`  (docker)
 *   `repo@sha256:..`                    (containerd)
 *   `sha256:..`                         (digest only)
 * A tag-only spec image with no digest falls through to the spec ref, which
 * resolveSignal treats as unscanned (reachability unknown) — fail-secure.
 */
export function normalizeImageRef(imageID: string, image: string): string {
  const id = imageID.replace(/^docker-pullable:\/\//, '');
  if (id.includes('@')) return id;
  if (id.startsWith('sha256:')) return `${image}@${id}`;
  return image;
}

/** Single structured JSON line per anomaly — every field queryable in Loki. */
function logAnomaly(anomaly: DriftAnomaly): void {
  logger.warn('runtime-drift', { event: 'runtime-drift', ...anomaly });
}

/** Default sink: log AND persist. driftRepository.save degrades to a local JSON
 *  store internally, so persistence never throws into the poll loop; the .catch
 *  only guards a truly unexpected failure. */
function persistAnomaly(anomaly: DriftAnomaly): void {
  logAnomaly(anomaly);
  void driftRepository.save(anomaly).catch((err: unknown) => {
    logger.error('[DriftMonitor] failed to persist drift anomaly', { event: 'runtime-drift-error', error: errorMessage(err) });
  });
}

/** Live cluster source: wraps CoreV1Api, in-cluster config with local fallback. */
export class KubePodLister implements PodLister {
  private readonly api: k8s.CoreV1Api;

  constructor(api?: k8s.CoreV1Api) {
    if (api) {
      this.api = api;
      return;
    }
    const kc = new k8s.KubeConfig();
    try {
      kc.loadFromCluster();
    } catch {
      kc.loadFromDefault(); // local dev: ~/.kube/config
    }
    this.api = kc.makeApiClient(k8s.CoreV1Api);
  }

  async listRunningContainers(): Promise<RunningContainer[]> {
    const list = await this.api.listPodForAllNamespaces();
    const out: RunningContainer[] = [];
    for (const pod of list.items ?? []) {
      const namespace = pod.metadata?.namespace ?? 'default';
      const podName = pod.metadata?.name ?? '<unknown>';
      if (pod.status?.phase !== 'Running') continue;
      for (const cs of pod.status?.containerStatuses ?? []) {
        if (!cs.state?.running) continue;
        out.push({
          namespace,
          podName,
          containerName: cs.name,
          image: cs.image ?? '',
          imageID: cs.imageID ?? '',
        });
      }
    }
    return out;
  }
}

export class DriftMonitor {
  private readonly lister: PodLister;
  private readonly loadRules: () => Promise<GateRule[]>;
  private readonly intervalMs: number;
  private readonly emit: (anomaly: DriftAnomaly) => void;
  // Per-container last-seen digest → detects out-of-band image swaps. Primary
  // store is Redis (shared across replicas, 24h PX TTL); this Map mirrors writes
  // so a mid-flight Redis drop and the no-server self-check still detect swaps.
  private readonly lastDigest = new Map<string, string>();
  private timer?: NodeJS.Timeout;
  private polling = false;

  constructor(opts: DriftMonitorOptions) {
    this.lister = opts.lister;
    this.loadRules =
      opts.loadRules ?? (async () => (await gateRulesRepository.get(SYSTEM_USER_ID)).rules);
    this.intervalMs = opts.intervalMs ?? DEFAULT_INTERVAL_MS;
    this.emit = opts.onAnomaly ?? persistAnomaly;
  }

  start(): void {
    if (this.timer) return;
    this.timer = setInterval(() => {
      void this.poll();
    }, this.intervalMs);
    logger.info('[DriftMonitor] started', { event: 'drift-monitor-start', intervalMs: this.intervalMs });
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = undefined;
    }
  }

  /** One detection pass. Re-entrancy guarded so a slow API call can't overlap. */
  async poll(): Promise<void> {
    if (this.polling) return;
    this.polling = true;
    try {
      const containers = await this.lister.listRunningContainers();
      const rules = await this.loadRules();
      for (const container of containers) await this.inspect(container, rules);
    } catch (err) {
      logger.error('[DriftMonitor] poll failed', { event: 'runtime-drift-error', error: errorMessage(err) });
    } finally {
      this.polling = false;
    }
  }

  private async inspect(c: RunningContainer, rules: GateRule[]): Promise<void> {
    const ref = normalizeImageRef(c.imageID, c.image);
    const digest = imageDigest(ref) ?? '';
    const env = namespaceToEnv(c.namespace);
    const signal = await resolveSignal(ref);
    const verdict = evaluatePreflight(rules, signal.counts, env, signal.reachability);

    const base = {
      namespace: c.namespace,
      podName: c.podName,
      containerName: c.containerName,
      image: c.image,
      imageDigest: digest,
      env,
      gateStatus: verdict.status,
      severityCounts: signal.counts,
    } as const;

    // Out-of-band update: digest changed between polls without a redeploy we saw.
    const key = `${c.namespace}/${c.podName}/${c.containerName}`;
    const previousDigest = await this.getLastDigest(key);
    if (digest) await this.setLastDigest(key, digest);
    if (previousDigest && digest && previousDigest !== digest) {
      this.emit({ ...base, driftType: 'out-of-band-update', previousDigest, reason: 'running image digest changed out of band' });
    }

    // Provenance gap: a running image we have no scan record for. More specific
    // than the gate verdict (which fail-secure blocks unknowns in prod anyway).
    // Tenant-less like buildService: the drift poller watches the cluster, not a
    // tenant session. Reads the shared namespace.
    const scanned = digest ? (await getScan(null, digest)) !== undefined : false;
    if (!scanned) {
      this.emit({ ...base, driftType: 'unscanned-image', reason: 'running image has no scan provenance' });
      return;
    }

    // Post-deployment SLA / new-vuln drift: scanned image that now fails the gate.
    if (verdict.status !== 'ready') {
      this.emit({ ...base, driftType: 'gate-violation', reason: verdict.reason });
    }
  }

  /** Last-seen digest for a container key. Redis is authoritative across
   *  replicas; falls back to the local mirror when Redis is unreachable. */
  private async getLastDigest(key: string): Promise<string | undefined> {
    if (redisReady()) {
      try {
        const v = await redisConnection.get(LAST_DIGEST_PREFIX + key);
        if (v !== null) return v;
      } catch (err) {
        logger.warn('[DriftMonitor] redis get lastDigest failed — using local mirror', { key, error: errorMessage(err) });
      }
    }
    return this.lastDigest.get(key);
  }

  /** Persist last-seen digest with a 24h TTL. Always mirrors locally so an
   *  in-flight Redis drop still detects a swap within the same process. */
  private async setLastDigest(key: string, digest: string): Promise<void> {
    this.lastDigest.set(key, digest);
    if (!redisReady()) return;
    try {
      await redisConnection.set(LAST_DIGEST_PREFIX + key, digest, 'PX', LAST_DIGEST_TTL_MS);
    } catch (err) {
      logger.warn('[DriftMonitor] redis set lastDigest failed — kept local mirror', { key, error: errorMessage(err) });
    }
  }
}

/**
 * Wire-up entrypoint. Returns undefined (monitor disabled) when no kube config
 * is reachable, so a non-cluster host degrades quietly instead of crashing boot.
 */
export function startDriftMonitor(): DriftMonitor | undefined {
  let lister: PodLister;
  try {
    lister = new KubePodLister();
  } catch (err) {
    logger.warn('[DriftMonitor] no kube config — runtime drift monitoring disabled', { error: errorMessage(err) });
    return undefined;
  }
  const monitor = new DriftMonitor({ lister });
  monitor.start();
  return monitor;
}

// ponytail: one runnable self-check of the detection core with a fake lister and
// seeded scan store — no cluster, no timers. Run: ts-node src/workers/driftMonitor.ts
if (require.main === module) {
  void (async () => {
    const { putScan } = await import('../services/imageStore');
    await putScan(null, 'sha256:crit', [{ pkgName: 'openssl', severity: 'critical' }]);
    await putScan(null, 'sha256:clean', []);

    const rules: GateRule[] = [{ id: 't', severity: 'critical', threshold: 0, action: 'block', enabled: true }];

    let containers: RunningContainer[] = [
      { namespace: 'dev', podName: 'p1', containerName: 'app', image: 'repo:1', imageID: 'docker-pullable://repo@sha256:crit' },
      { namespace: 'dev', podName: 'p2', containerName: 'app', image: 'repo:2', imageID: 'repo@sha256:never' },
      { namespace: 'dev', podName: 'p3', containerName: 'app', image: 'repo:3', imageID: 'repo@sha256:clean' },
    ];
    const lister: PodLister = { listRunningContainers: async () => containers };

    const seen: DriftAnomaly[] = [];
    const monitor = new DriftMonitor({ lister, loadRules: async () => rules, onAnomaly: (a) => seen.push(a) });

    await monitor.poll();
    const types = (pod: string) => seen.filter((a) => a.podName === pod).map((a) => a.driftType);
    assert.deepStrictEqual(types('p1'), ['gate-violation'], 'scanned critical image must drift as gate-violation');
    assert.deepStrictEqual(types('p2'), ['unscanned-image'], 'unknown digest must drift as unscanned-image');
    assert.deepStrictEqual(types('p3'), [], 'clean scanned image must not drift');

    // Out-of-band update: p3 swaps to a new digest on the next poll.
    seen.length = 0;
    containers = [{ namespace: 'dev', podName: 'p3', containerName: 'app', image: 'repo:3', imageID: 'repo@sha256:crit' }];
    await monitor.poll();
    const p3 = seen.filter((a) => a.podName === 'p3').map((a) => a.driftType).sort();
    assert.deepStrictEqual(p3, ['gate-violation', 'out-of-band-update'], 'digest swap must report OOB + re-gate');
    assert.strictEqual(seen.find((a) => a.driftType === 'out-of-band-update')?.previousDigest, 'sha256:clean');

    console.log('driftMonitor self-check passed');
    redisConnection.disconnect(); // release the socket so the self-check exits
  })();
}
