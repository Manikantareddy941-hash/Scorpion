import * as k8s from '@kubernetes/client-node';
import { logger } from '../services/logger';
import {
  ClusterSnapshot, PodPosture, runPostureChecks, scoreNamespace,
} from '../posture/postureChecks';
import { postureRepository } from '../repositories/postureRepository';

/** DIP seam: check logic is pure; only this reader touches the cluster. */
export interface ClusterReader {
  readSnapshot(): Promise<ClusterSnapshot>;
}

const DEFAULT_INTERVAL_MS = Number(process.env.POSTURE_SCAN_INTERVAL_MS) || 300_000;

function toMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/** Maps a raw V1Pod to the pure check input. Exported for unit testing. */
export function podToPosture(pod: k8s.V1Pod): PodPosture {
  const spec = pod.spec;
  return {
    namespace: pod.metadata?.namespace ?? 'unknown',
    podName: pod.metadata?.name ?? 'unknown',
    serviceAccountName: spec?.serviceAccountName ?? 'default',
    automountServiceAccountToken: spec?.automountServiceAccountToken,
    hostPathVolumes: (spec?.volumes ?? [])
      .filter((v) => v.hostPath)
      .map((v) => v.hostPath?.path ?? v.name),
    containers: (spec?.containers ?? []).map((c) => ({
      name: c.name,
      image: c.image ?? '',
      privileged: c.securityContext?.privileged === true,
      runAsNonRoot: c.securityContext?.runAsNonRoot ?? spec?.securityContext?.runAsNonRoot,
      hasCpuLimit: Boolean(c.resources?.limits?.cpu),
      hasMemoryLimit: Boolean(c.resources?.limits?.memory),
      envVars: (c.env ?? []).map((e) => ({ name: e.name, hasLiteralValue: e.value !== undefined })),
    })),
  };
}

export function createClusterReader(): ClusterReader {
  const kc = new k8s.KubeConfig();
  kc.loadFromDefault();
  const core = kc.makeApiClient(k8s.CoreV1Api);
  const net = kc.makeApiClient(k8s.NetworkingV1Api);
  return {
    async readSnapshot() {
      const [pods, namespaces, policies] = await Promise.all([
        core.listPodForAllNamespaces(),
        core.listNamespace(),
        net.listNetworkPolicyForAllNamespaces(),
      ]);
      const policyCount = new Map<string, number>();
      for (const p of policies.items) {
        const ns = p.metadata?.namespace ?? '';
        policyCount.set(ns, (policyCount.get(ns) ?? 0) + 1);
      }
      const podCount = new Map<string, number>();
      for (const p of pods.items) {
        const ns = p.metadata?.namespace ?? '';
        podCount.set(ns, (podCount.get(ns) ?? 0) + 1);
      }
      return {
        pods: pods.items.map(podToPosture),
        namespaces: namespaces.items.map((n) => ({
          name: n.metadata?.name ?? 'unknown',
          podCount: podCount.get(n.metadata?.name ?? '') ?? 0,
          networkPolicyCount: policyCount.get(n.metadata?.name ?? '') ?? 0,
        })),
      };
    },
  };
}

/** One scan tick: snapshot → checks → per-namespace score → persist. */
export async function runPostureScan(reader: ClusterReader): Promise<void> {
  let snapshot: ClusterSnapshot;
  try {
    snapshot = await reader.readSnapshot();
  } catch (err) {
    logger.warn('[PostureScanner] cluster read failed, skipping tick:',
      toMessage(err));
    return;
  }
  const findings = runPostureChecks(snapshot);
  const grouped = snapshot.namespaces.map((ns) => {
    const nsFindings = findings.filter((f) => f.namespace === ns.name);
    return { namespace: ns.name, score: scoreNamespace(nsFindings), findings: nsFindings };
  });
  await postureRepository.saveSnapshot(grouped);
  logger.info(`[PostureScanner] scanned ${snapshot.namespaces.length} namespace(s), ${findings.length} finding(s)`);
}

export function startPostureScanner(reader: ClusterReader = createClusterReader()): NodeJS.Timeout {
  logger.info(`[PostureScanner] starting, interval ${DEFAULT_INTERVAL_MS}ms`);
  return setInterval(() => {
    runPostureScan(reader).catch((err) => logger.error('[PostureScanner] tick failed:', err));
  }, DEFAULT_INTERVAL_MS);
}
