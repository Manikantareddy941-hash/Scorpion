import { databases, DB_ID, Query } from '../lib/appwrite';
import { sendSlackNotification } from '../services/slackService';
import { auditLog } from '../services/auditService';
import { logger } from '../services/logger';
import type { SoarActionRecord } from '../repositories/soarRepository';

export const QUARANTINE_LABEL = 'scorpion-quarantine';
export const QUARANTINE_POLICY_NAME = 'scorpion-quarantine-deny-all';

/** DIP seam: the executor is pure orchestration; cluster writes live here. */
export interface K8sPodActions {
  getPodJson(namespace: string, pod: string): Promise<string>;
  labelPod(namespace: string, pod: string, key: string, value: string): Promise<void>;
  deletePod(namespace: string, pod: string): Promise<void>;
  ensureQuarantinePolicy(namespace: string): Promise<void>;
}

function createK8sPodActionsImpl(k8sClient: typeof import('@kubernetes/client-node')): K8sPodActions {
  const kc = new k8sClient.KubeConfig();
  kc.loadFromDefault();
  const core = kc.makeApiClient(k8sClient.CoreV1Api);
  const net = kc.makeApiClient(k8sClient.NetworkingV1Api);
  return {
    async getPodJson(namespace, pod) {
      const res = await core.readNamespacedPod({ name: pod, namespace });
      return JSON.stringify(res);
    },
    async labelPod(namespace, pod, key, value) {
      await core.patchNamespacedPod({
        name: pod,
        namespace,
        body: { metadata: { labels: { [key]: value } } },
      });
    },
    async deletePod(namespace, pod) {
      await core.deleteNamespacedPod({ name: pod, namespace });
    },
    async ensureQuarantinePolicy(namespace) {
      try {
        await net.createNamespacedNetworkPolicy({
          namespace,
          body: {
            metadata: { name: QUARANTINE_POLICY_NAME, namespace },
            spec: {
              podSelector: { matchLabels: { [QUARANTINE_LABEL]: 'true' } },
              policyTypes: ['Ingress', 'Egress'],
            },
          },
        });
      } catch (err) {
        // 409 already-exists is success (idempotent); anything else propagates.
        const status = (err as { code?: number; statusCode?: number }).code
          ?? (err as { statusCode?: number }).statusCode;
        if (status !== 409) throw err;
      }
    },
  };
}

export function createK8sPodActions(): K8sPodActions {
  // Lazy-load k8s client to allow jest mocking in tests
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const k8sClient = require('@kubernetes/client-node') as typeof import('@kubernetes/client-node');
  return createK8sPodActionsImpl(k8sClient);
}

export interface SoarExecutionDeps {
  k8s: K8sPodActions;
  /** Raw Falco event JSON, attached to evidence captures when available. */
  falcoEventJson?: string;
}

type ExecutionResult = { ok: true; result: string } | { ok: false; error: string };

function toMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

async function slackEscalate(action: SoarActionRecord): Promise<string> {
  // Reuses the integration lookup convention from falcoHandler.
  const integrations = await databases.listDocuments(DB_ID, 'integrations', [Query.limit(25)]);
  let sent = 0;
  for (const doc of integrations.documents) {
    const integ = doc as unknown as { isEnabled?: boolean; slack_webhook?: string };
    if (integ.isEnabled && integ.slack_webhook) {
      await sendSlackNotification(integ.slack_webhook, {
        title: `SOAR escalation: ${action.falcoRule}`,
        repository: action.containerImage,
        severity: 'Critical',
        rule: action.falcoRule,
        incidentId: action.incidentId,
      });
      sent++;
    }
  }
  return `slack escalation sent to ${sent} integration(s)`;
}

/** Executes one approved action. Never throws — every failure is a returned
 *  error so the worker can mark the record 'failed' and escalate (fail-loud). */
export async function executeSoarAction(
  action: SoarActionRecord,
  deps: SoarExecutionDeps,
): Promise<ExecutionResult> {
  try {
    switch (action.actionType) {
      case 'capture_evidence': {
        let podSpec: unknown = 'unavailable';
        if (action.namespace && action.podName) {
          try {
            const podJson = await deps.k8s.getPodJson(action.namespace, action.podName);
            podSpec = JSON.parse(podJson);
          } catch (e) {
            podSpec = toMessage(e);
          }
        }
        let event: unknown = null;
        if (deps.falcoEventJson) {
          try {
            event = JSON.parse(deps.falcoEventJson);
          } catch {
            event = deps.falcoEventJson;
          }
        }
        const evidence = JSON.stringify({ event, podSpec });
        return { ok: true, result: evidence };
      }
      case 'slack_escalate':
        return { ok: true, result: await slackEscalate(action) };
      case 'isolate_pod': {
        if (!action.namespace || !action.podName) {
          return { ok: false, error: 'missing namespace/pod on event; cannot isolate' };
        }
        await deps.k8s.ensureQuarantinePolicy(action.namespace);
        await deps.k8s.labelPod(action.namespace, action.podName, QUARANTINE_LABEL, 'true');
        return { ok: true, result: `pod ${action.namespace}/${action.podName} quarantined` };
      }
      case 'kill_pod': {
        if (!action.namespace || !action.podName) {
          return { ok: false, error: 'missing namespace/pod on event; cannot kill' };
        }
        await deps.k8s.deletePod(action.namespace, action.podName);
        return { ok: true, result: `pod ${action.namespace}/${action.podName} deleted` };
      }
      default: {
        const _: never = action.actionType;
        return _; // exhaustive
      }
    }
  } catch (err) {
    logger.error(`[SOAR] action ${action.actionType} failed:`, toMessage(err));
    return { ok: false, error: toMessage(err) };
  } finally {
    await auditLog({
      action: `soar.${action.actionType}` as const,
      actor: 'system',
      actorEmail: 'system@scorpion',
      resource: 'soar_action',
      details: { actionId: action.id, incidentId: action.incidentId, pod: action.podName ?? '' },
    }).catch(() => undefined);
  }
}
