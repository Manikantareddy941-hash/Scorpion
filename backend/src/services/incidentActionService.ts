import { databases, DB_ID, ID, Query } from '../lib/appwrite';
import { logger, errorContext } from './logger';
import { isAppwriteError } from '../utils/errorGuards';

const CRITICAL_SEVERITIES = new Set(['critical']);

export const isCriticalSeverity = (severity: string): boolean => CRITICAL_SEVERITIES.has((severity || '').toLowerCase());

async function ensurePipelineStateCollection() {
  try {
    await databases.getCollection(DB_ID, 'pipeline_state');
  } catch (err) {
    if (isAppwriteError(err) && (err.code === 404 || err.type === 'collection_not_found')) {
      try {
        await databases.createCollection(DB_ID, 'pipeline_state', 'Pipeline State');
        await databases.createStringAttribute(DB_ID, 'pipeline_state', 'nodeId', 50, true);
        await databases.createStringAttribute(DB_ID, 'pipeline_state', 'status', 50, true);
        await new Promise(resolve => setTimeout(resolve, 3000));
      } catch (createErr) {
        logger.error('[Incident Response] Error creating pipeline_state collection:', {
            event: 'GATE_STATE_COLLECTION_CREATE_FAILED', ...errorContext(createErr),
        });
      }
    }
  }
}

/**
 * Automated containment: a critical security incident (runtime intrusion,
 * GitOps drift, etc.) automatically freezes the release gate platform-wide,
 * the same gate gateRoutes.ts's checkReleaseGate already enforces. This is
 * deliberately broad (the gate is a single global pipeline_state, not
 * per-repo - see gateRoutes.ts) rather than scoped, on the principle that
 * an active critical incident should pause all releases until a human with
 * gate:bypass permission triages it via POST /api/gates/override.
 *
 * Reversible by design: the existing break-glass override already requires
 * the IAM-gated 'gate:bypass' permission (see iamMiddleware.ts), so this
 * never permanently locks anyone out, it just requires deliberate human
 * action to clear.
 */
export async function freezeReleaseGateForIncident(reason: string): Promise<void> {
  try {
    await ensurePipelineStateCollection();

    const existing = await databases.listDocuments(DB_ID, 'pipeline_state', [
      Query.equal('nodeId', 'release'),
      Query.limit(1)
    ]);

    if (existing.total > 0) {
      await databases.updateDocument(DB_ID, 'pipeline_state', existing.documents[0].$id, { status: 'BLOCKED' });
    } else {
      await databases.createDocument(DB_ID, 'pipeline_state', ID.unique(), { nodeId: 'release', status: 'BLOCKED' });
    }

    logger.warn(`[Incident Response] Release gate automatically frozen: ${reason}`);
  } catch (err) {
    // Containment is best-effort - a failure here must never prevent the
    // incident itself from being recorded/alerted on.
    // A release gate that fails to freeze during an incident keeps shipping.
    // `reason` is the only identifier this function receives — incidentService
    // composes it as `<source> incident "<title>" (<id>)`. Without it the alert
    // says a freeze failed but not which incident is still shipping, which is
    // the one thing responding to it requires. The success path above already
    // logs it; only the failure path was missing it.
    logger.error('[Incident Response] Failed to freeze release gate:', {
      event: 'INCIDENT_GATE_FREEZE_FAILED', reason, ...errorContext(err),
    });
  }
}
