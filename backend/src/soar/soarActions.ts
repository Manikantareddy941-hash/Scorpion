import { databases, DB_ID, COLLECTIONS, Query } from '../lib/appwrite';
import { sendSlackNotification } from '../services/slackService';
import { auditLog } from '../services/auditService';
import { logger, errorContext, errorMessage } from '../services/logger';
import type { SoarActionRecord } from '../repositories/soarRepository';

export const QUARANTINE_LABEL = 'scorpion-quarantine';
export const QUARANTINE_POLICY_NAME = 'scorpion-quarantine-deny-all';

/** RFC 6902 JSON Patch operation. @kubernetes/client-node v1.4.0 always
 *  negotiates Content-Type: application/json-patch+json for patch calls
 *  (ObjectSerializer.getPreferredMediaType picks the first of a fixed
 *  candidate list; there is no per-call override), so the body must be a
 *  patch array, never a plain merge object. */
type JsonPatchOp = { op: 'add' | 'remove' | 'replace' | 'test'; path: string; value?: unknown };

/** DIP seam: the executor is pure orchestration; cluster writes live here. */
export interface K8sPodActions {
  getPodJson(namespace: string, pod: string): Promise<string>;
  labelPod(namespace: string, pod: string, key: string, value: string): Promise<void>;
  deletePod(namespace: string, pod: string): Promise<void>;
  ensureQuarantinePolicy(namespace: string): Promise<void>;
}

export function createK8sPodActionsImpl(k8sClient: typeof import('@kubernetes/client-node')): K8sPodActions {
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
      // "add" on a nested path like /metadata/labels/foo 400s when the pod
      // has no labels map yet; replacing the whole map (merged from a fresh
      // read) via "add" on /metadata/labels works whether or not it existed.
      const current = await core.readNamespacedPod({ name: pod, namespace });
      const existingLabels = (current.metadata?.labels ?? {}) as Record<string, string>;
      const patch: JsonPatchOp[] = [
        { op: 'add', path: '/metadata/labels', value: { ...existingLabels, [key]: value } },
      ];
      await core.patchNamespacedPod({ name: pod, namespace, body: patch });
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
  /** Owner of the incident that triggered this action. Required for
   *  slack_escalate — without it, the integration lookup would broadcast
   *  to every tenant's webhook, so the action fails instead (fail-secure). */
  ownerUserId?: string;
}

type ExecutionResult = { ok: true; result: string } | { ok: false; error: string };

async function slackEscalate(action: SoarActionRecord, ownerUserId: string): Promise<string> {
  // Scoped to the incident owner, same convention as falcoHandler — an
  // unscoped list here would broadcast the incident to every tenant's webhook.
  const integrations = await databases.listDocuments(DB_ID, COLLECTIONS.INTEGRATIONS, [
    Query.equal('userId', ownerUserId),
  ]);
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
            podSpec = errorMessage(e);
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
      case 'slack_escalate': {
        if (!deps.ownerUserId) {
          return { ok: false, error: 'no owner user id for Slack escalation' };
        }
        return { ok: true, result: await slackEscalate(action, deps.ownerUserId) };
      }
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
    logger.error(`[SOAR] action ${action.actionType} failed`, errorContext(err));
    return { ok: false, error: errorMessage(err) };
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
