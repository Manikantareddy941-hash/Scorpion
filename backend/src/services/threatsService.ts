import { threatsRepository } from '../repositories/threatsRepository';
import { sendSecurityAlert } from './notificationService';
import { isFalcoRuleBlocked } from './policyService';
import { logSecureAuditEvent } from '../utils/tamperAuditLogger';
import { logger, errorContext } from './logger';
import { FalcoEvent, ThreatStatus } from '../types/threats.types';

// Best-effort correlation of a Falco event's container image to one of our
// scanned repos, mirroring runtime/falcoHandler.ts's incident-ownership logic,
// so threats can be attributed to a tenant instead of being globally visible.
async function resolveOwnerForContainerImage(containerImage: string): Promise<string | null> {
  if (!containerImage || containerImage === 'unknown') return null;
  try {
    const latestScans = await threatsRepository.findLatestScanByRepoUrl(containerImage);
    if (latestScans.documents.length === 0) return null;
    const scanDoc = latestScans.documents[0];
    if (scanDoc.user_id) return scanDoc.user_id;
    if (scanDoc.repo_id) {
      const repoDoc = await threatsRepository.getRepository(scanDoc.repo_id);
      if (repoDoc?.user_id) return repoDoc.user_id;
    }
  } catch {
    // Correlation is best-effort; an un-owned threat is just invisible via the
    // regular per-user API below rather than blocking ingestion.
  }
  return null;
}

export const threatsService = {
  async bootstrap(): Promise<void> {
    await threatsRepository.ensureThreatsCollection();
    await threatsRepository.ensurePipelineStateCollection();
  },

  async ingestFalcoEvent(event: FalcoEvent): Promise<{ threatId: string; status: ThreatStatus }> {
    await threatsRepository.ensureThreatsCollection();
    await threatsRepository.ensurePipelineStateCollection();

    const rule = event.rule || 'Unknown Falco Rule';
    const priority = event.priority || 'Notice';
    const containerId = (event.output_fields?.['container.id'] as string) || 'unknown';
    const containerImage = (event.output_fields?.['container.image.repository'] as string) || 'unknown';
    const output = event.output || 'No output details available.';

    // Evaluate if the rule is blocked by dynamic policy configurations
    const isRuleBlocked = await isFalcoRuleBlocked('system', rule);
    const status: ThreatStatus = (priority === 'Critical' || priority === 'Error' || isRuleBlocked) ? 'compromised' : 'passing';

    // Correlate to a tenant so this threat isn't visible to every authenticated
    // user via GET / below. An un-owned threat stays invisible via that route.
    const ownerUserId = await resolveOwnerForContainerImage(containerImage);

    // 1. Normalize and persist to THREATS collection
    const threatDoc = await threatsRepository.createThreat({
      rule,
      priority,
      containerId,
      output,
      status,
      timestamp: event.time || new Date().toISOString(),
      ...(ownerUserId ? { ownerUserId } : {})
    });

    logger.info(`[Threats] Threat successfully persisted to DB: ${threatDoc.$id}`);

    // 2. Real-time Pipeline Broadcast (pipeline_state collection update)
    if (status === 'compromised') {
      // Dispatch live security notifications
      sendSecurityAlert({
        type: 'threat',
        title: `Falco Container Intrusion: ${rule}`,
        severity: (priority.toUpperCase() === 'CRITICAL' || priority.toUpperCase() === 'ERROR') ? 'CRITICAL' : 'HIGH',
        details: `Container ID: ${containerId}\nIntrusion details:\n${output}`,
        repo_id: 'system'
      });

      try {
        await threatsRepository.setMonitorNodeStatus('compromised');
        logger.info('[Threats] Updated monitor node state to compromised.');
      } catch (stateErr) {
        logger.error('[Threats] Failed to update pipeline_state collection', {
          event: 'THREAT_PIPELINE_STATE_UPDATE_FAILED', targetStatus: 'compromised', ...errorContext(stateErr),
        });
      }
    }

    return { threatId: threatDoc.$id, status };
  },

  async listThreats(userId: string) {
    await threatsRepository.ensureThreatsCollection();
    const threatsRes = await threatsRepository.listThreatsForOwner(userId);
    return threatsRes.documents;
  },

  /** Resets the caller's own active compromised threats and the monitor node back to passing. */
  async clearThreats(userId: string): Promise<void> {
    await threatsRepository.ensureThreatsCollection();
    await threatsRepository.ensurePipelineStateCollection();

    const activeThreats = await threatsRepository.listCompromisedThreatsForOwner(userId);
    await Promise.all(activeThreats.documents.map(t => threatsRepository.updateThreatStatus(t.$id, 'passing')));

    await threatsRepository.resetMonitorNodeIfExists();

    await logSecureAuditEvent(userId, 'ALARM_CLEAR', 'system', 'Runtime threats manually cleared and monitor node reset to passing.');
  }
};
