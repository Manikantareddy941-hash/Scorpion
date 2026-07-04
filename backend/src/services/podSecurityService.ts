/**
 * Kyverno-style pod-security rule evaluator. Pure: no I/O, no imports — the
 * admission webhook (k8sAdmission.ts) supplies the pod spec it already receives
 * in the AdmissionReview and a PodSecurityConfig loaded from the repository.
 *
 * Rule philosophy: settings that are dangerous when PRESENT (privileged,
 * hostNetwork, added caps) are safe when absent; settings that are safe only
 * when ASSERTED (runAsNonRoot, readOnlyRootFilesystem) violate when absent.
 */

export type PodSecurityMode = 'enforce' | 'audit' | 'off';

export type PodSecurityRuleId =
  | 'registry-allowlist'
  | 'no-privileged'
  | 'run-as-non-root'
  | 'drop-dangerous-capabilities'
  | 'read-only-root-fs'
  | 'no-host-namespaces'
  | 'required-labels';

export interface PodSecurityConfig {
  modes: Record<PodSecurityRuleId, PodSecurityMode>;
  /** Image prefix allowlist, e.g. "registry.company.com/". Empty = rule inert. */
  allowedRegistries: string[];
  /** Label keys every pod must carry. Empty = rule inert. */
  requiredLabels: string[];
}

export interface PodSecurityViolation {
  rule: PodSecurityRuleId;
  message: string;
  mode: 'enforce' | 'audit';
}

export interface PodSecurityContainer {
  name?: string;
  image?: string;
  securityContext?: {
    privileged?: boolean;
    runAsNonRoot?: boolean;
    readOnlyRootFilesystem?: boolean;
    capabilities?: { add?: string[] };
  };
}

export interface PodLikeSpec {
  metadata?: { labels?: Record<string, string> };
  spec?: {
    hostNetwork?: boolean;
    hostPID?: boolean;
    hostIPC?: boolean;
    volumes?: { name?: string; hostPath?: unknown }[];
    securityContext?: { runAsNonRoot?: boolean };
    containers?: PodSecurityContainer[];
    initContainers?: PodSecurityContainer[];
  };
}

export const DEFAULT_POD_SECURITY_CONFIG: PodSecurityConfig = {
  // Audit-first default so a fresh install never bricks a cluster; privileged
  // containers are the one thing dangerous enough to enforce out of the box.
  modes: {
    'registry-allowlist': 'audit',
    'no-privileged': 'enforce',
    'run-as-non-root': 'audit',
    'drop-dangerous-capabilities': 'audit',
    'read-only-root-fs': 'audit',
    'no-host-namespaces': 'audit',
    'required-labels': 'audit',
  },
  allowedRegistries: [],
  requiredLabels: [],
};

const DANGEROUS_CAPABILITIES = new Set(['SYS_ADMIN', 'NET_ADMIN', 'SYS_PTRACE', 'ALL']);

const containerName = (c: PodSecurityContainer, i: number) => c.name || `#${i}`;

export function evaluatePodSecurity(pod: PodLikeSpec, config: PodSecurityConfig): PodSecurityViolation[] {
  const violations: PodSecurityViolation[] = [];
  const spec = pod.spec ?? {};
  const containers = [...(spec.containers ?? []), ...(spec.initContainers ?? [])];

  const add = (rule: PodSecurityRuleId, message: string) => {
    const mode = config.modes[rule];
    if (mode === 'enforce' || mode === 'audit') violations.push({ rule, message, mode });
  };
  const active = (rule: PodSecurityRuleId) => config.modes[rule] !== 'off';

  if (active('registry-allowlist') && config.allowedRegistries.length > 0) {
    containers.forEach((c, i) => {
      const image = c.image ?? '';
      if (!config.allowedRegistries.some(prefix => image.startsWith(prefix))) {
        add('registry-allowlist', `image "${image}" of container "${containerName(c, i)}" not from an approved registry`);
      }
    });
  }

  if (active('no-privileged')) {
    containers.forEach((c, i) => {
      if (c.securityContext?.privileged === true) {
        add('no-privileged', `container "${containerName(c, i)}" runs privileged`);
      }
    });
  }

  if (active('run-as-non-root')) {
    const podAsserts = spec.securityContext?.runAsNonRoot === true;
    containers.forEach((c, i) => {
      if (!podAsserts && c.securityContext?.runAsNonRoot !== true) {
        add('run-as-non-root', `container "${containerName(c, i)}" does not enforce runAsNonRoot`);
      }
    });
  }

  if (active('drop-dangerous-capabilities')) {
    containers.forEach((c, i) => {
      const added = c.securityContext?.capabilities?.add ?? [];
      const hits = added.filter(cap => DANGEROUS_CAPABILITIES.has(cap.toUpperCase()));
      if (hits.length > 0) {
        add('drop-dangerous-capabilities', `container "${containerName(c, i)}" adds dangerous capabilities: ${hits.join(', ')}`);
      }
    });
  }

  if (active('read-only-root-fs')) {
    containers.forEach((c, i) => {
      if (c.securityContext?.readOnlyRootFilesystem !== true) {
        add('read-only-root-fs', `container "${containerName(c, i)}" lacks a read-only root filesystem`);
      }
    });
  }

  if (active('no-host-namespaces')) {
    const flags = (['hostNetwork', 'hostPID', 'hostIPC'] as const).filter(k => spec[k] === true);
    for (const flag of flags) add('no-host-namespaces', `pod requests host namespace "${flag}"`);
    for (const vol of spec.volumes ?? []) {
      if (vol && typeof vol === 'object' && 'hostPath' in vol && vol.hostPath !== undefined) {
        add('no-host-namespaces', `volume "${vol.name || 'unnamed'}" mounts a hostPath`);
      }
    }
  }

  if (active('required-labels') && config.requiredLabels.length > 0) {
    const labels = pod.metadata?.labels ?? {};
    const missing = config.requiredLabels.filter(key => !(key in labels));
    if (missing.length > 0) {
      add('required-labels', `pod is missing required label(s): ${missing.join(', ')}`);
    }
  }

  return violations;
}
