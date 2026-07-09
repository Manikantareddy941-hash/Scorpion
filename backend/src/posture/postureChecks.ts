/**
 * CSPM posture core: fixed CIS-flavored checks evaluated against an immutable
 * cluster snapshot. Pure — the k8s client lives in the scanner worker.
 */

export type PostureSeverity = 'critical' | 'high' | 'medium' | 'low';

export interface PostureContainer {
  name: string;
  image: string;
  privileged: boolean;
  runAsNonRoot?: boolean;
  hasCpuLimit: boolean;
  hasMemoryLimit: boolean;
  envVars: { name: string; hasLiteralValue: boolean }[];
}

export interface PodPosture {
  namespace: string;
  podName: string;
  serviceAccountName: string;
  automountServiceAccountToken?: boolean;
  hostPathVolumes: string[];
  containers: PostureContainer[];
}

export interface NamespacePosture { name: string; podCount: number; networkPolicyCount: number }
export interface ClusterSnapshot { pods: PodPosture[]; namespaces: NamespacePosture[] }

export interface PostureFinding {
  checkId: string;
  severity: PostureSeverity;
  namespace: string;
  resource: string;
  reason: string;
}

const SECRET_ENV_PATTERN = /(SECRET|TOKEN|PASSWORD|PASSWD|API_?KEY|PRIVATE_?KEY|CREDENTIAL)/i;

type PodCheck = (pod: PodPosture) => PostureFinding[];

const finding = (
  checkId: string, severity: PostureSeverity, namespace: string, resource: string, reason: string,
): PostureFinding => ({ checkId, severity, namespace, resource, reason });

const podResource = (pod: PodPosture, container?: string) =>
  container ? `${pod.namespace}/${pod.podName}/${container}` : `${pod.namespace}/${pod.podName}`;

const checkPrivileged: PodCheck = (pod) =>
  pod.containers
    .filter((c) => c.privileged)
    .map((c) => finding('privileged-pod-running', 'critical', pod.namespace, podResource(pod, c.name),
      `container '${c.name}' runs privileged`));

const checkHostPath: PodCheck = (pod) =>
  pod.hostPathVolumes.map((v) => finding('hostpath-mounted', 'high', pod.namespace, podResource(pod),
    `hostPath volume '${v}' mounted`));

const checkDefaultSaToken: PodCheck = (pod) =>
  pod.serviceAccountName === 'default' && pod.automountServiceAccountToken !== false
    ? [finding('default-sa-token-automounted', 'medium', pod.namespace, podResource(pod),
        'default service account token is automounted')]
    : [];

const checkResourceLimits: PodCheck = (pod) =>
  pod.containers
    .filter((c) => !c.hasCpuLimit || !c.hasMemoryLimit)
    .map((c) => finding('no-resource-limits', 'low', pod.namespace, podResource(pod, c.name),
      `container '${c.name}' lacks cpu/memory limits`));

const checkLatestTag: PodCheck = (pod) =>
  pod.containers
    .filter((c) => !c.image.includes('@sha256:') && (c.image.endsWith(':latest') || !c.image.includes(':')))
    .map((c) => finding('latest-image-tag', 'medium', pod.namespace, podResource(pod, c.name),
      `image '${c.image}' is not pinned`));

const checkRunAsRoot: PodCheck = (pod) =>
  pod.containers
    .filter((c) => c.runAsNonRoot !== true)
    .map((c) => finding('runs-as-root', 'high', pod.namespace, podResource(pod, c.name),
      `container '${c.name}' does not enforce runAsNonRoot`));

const checkSecretInEnv: PodCheck = (pod) =>
  pod.containers.flatMap((c) =>
    c.envVars
      .filter((e) => e.hasLiteralValue && SECRET_ENV_PATTERN.test(e.name))
      .map((e) => finding('secret-in-env', 'high', pod.namespace, podResource(pod, c.name),
        `env var '${e.name}' carries a literal secret-like value`)));

const POD_CHECKS: PodCheck[] = [
  checkPrivileged, checkHostPath, checkDefaultSaToken, checkResourceLimits,
  checkLatestTag, checkRunAsRoot, checkSecretInEnv,
];

export function runPostureChecks(snapshot: ClusterSnapshot): PostureFinding[] {
  const podFindings = snapshot.pods.flatMap((pod) => POD_CHECKS.flatMap((check) => check(pod)));
  const nsFindings = snapshot.namespaces
    .filter((ns) => ns.podCount > 0 && ns.networkPolicyCount === 0)
    .map((ns) => finding('namespace-without-networkpolicy', 'high', ns.name, ns.name,
      'namespace runs pods with no NetworkPolicy (flat network)'));
  return [...podFindings, ...nsFindings];
}

const SEVERITY_WEIGHT: Record<PostureSeverity, number> = { critical: 25, high: 15, medium: 8, low: 3 };

export function scoreNamespace(findings: PostureFinding[]): number {
  const penalty = findings.reduce((sum, f) => sum + SEVERITY_WEIGHT[f.severity], 0);
  return Math.max(0, 100 - penalty);
}
