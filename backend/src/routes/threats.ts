import { Router, Request, Response } from 'express';
import { databases, DB_ID, COLLECTIONS, ID, Query } from '../lib/appwrite';
import { verifyUser } from '../middleware/auth';
import { logSecureAuditEvent } from '../utils/tamperAuditLogger';
import { sendSecurityAlert } from '../services/notificationService';
import { isFalcoRuleBlocked } from '../services/policyService';
import { logger } from '../services/logger';

const router = Router();

// Same shared-secret pattern as routes/falcoRoutes.ts's verifyFalcoSecret
const verifyFalcoSecret = (req: Request, res: Response, next: any) => {
  const expected = process.env.FALCO_SECRET;
  const secret = req.headers['x-falco-secret'];
  // Fails closed: an unconfigured secret must never leave this endpoint open.
  if (!expected || secret !== expected) {
    return res.status(401).json({ error: 'Unauthorized Falco source' });
  }
  next();
};

// Best-effort correlation of a Falco event's container image to one of our
// scanned repos, mirroring runtime/falcoHandler.ts's incident-ownership logic,
// so threats can be attributed to a tenant instead of being globally visible.
async function resolveOwnerForContainerImage(containerImage: string): Promise<string | null> {
  if (!containerImage || containerImage === 'unknown') return null;
  try {
    const latestScans = await databases.listDocuments(DB_ID, COLLECTIONS.SCANS, [
      Query.equal('repoUrl', containerImage),
      Query.orderDesc('$createdAt'),
      Query.limit(1)
    ]);
    if (latestScans.documents.length === 0) return null;
    const scanDoc = latestScans.documents[0];
    if (scanDoc.user_id) return scanDoc.user_id;
    if (scanDoc.repo_id) {
      const repoDoc = await databases.getDocument(DB_ID, COLLECTIONS.REPOSITORIES, scanDoc.repo_id).catch(() => null);
      if (repoDoc?.user_id) return repoDoc.user_id;
    }
  } catch {
    // Correlation is best-effort; an un-owned threat is just invisible via the
    // regular per-user API below rather than blocking ingestion.
  }
  return null;
}

// Helper function to ensure THREATS collection and attributes exist
async function ensureThreatsCollection() {
  try {
    // Try to get the collection. If it exists, return it.
    await databases.getCollection(DB_ID, 'threats');
    await ensureOwnerUserIdAttribute();
  } catch (err: any) {
    if (err.code === 404 || err.type === 'collection_not_found') {
      logger.info('[Threats Setup] THREATS collection not found. Creating it...');
      try {
        await databases.createCollection(DB_ID, 'threats', 'Threats');

        // Create attributes
        await databases.createStringAttribute(DB_ID, 'threats', 'rule', 255, true);
        await databases.createStringAttribute(DB_ID, 'threats', 'priority', 50, true);
        await databases.createStringAttribute(DB_ID, 'threats', 'containerId', 255, true);
        await databases.createStringAttribute(DB_ID, 'threats', 'output', 5000, true);
        await databases.createStringAttribute(DB_ID, 'threats', 'status', 50, true);
        await databases.createStringAttribute(DB_ID, 'threats', 'timestamp', 255, true);
        await databases.createStringAttribute(DB_ID, 'threats', 'ownerUserId', 255, false);
        
        logger.info('[Threats Setup] THREATS collection and attributes created successfully.');
        // Wait 3 seconds for attributes to propagate in Appwrite
        await new Promise(resolve => setTimeout(resolve, 3000));
      } catch (createErr: any) {
        logger.error('[Threats Setup] Error creating collection or attributes:', createErr);
      }
    } else {
      logger.error('[Threats Setup] Unexpected error checking threats collection:', err);
    }
  }
}

// Adds the ownerUserId attribute to a pre-existing threats collection that
// predates tenant-scoping, so ingestion doesn't fail against older deployments.
async function ensureOwnerUserIdAttribute() {
  try {
    const attrs: any = await databases.listAttributes(DB_ID, 'threats');
    const hasOwnerUserId = (attrs.attributes || []).some((a: any) => a.key === 'ownerUserId');
    if (!hasOwnerUserId) {
      logger.info('[Threats Setup] Adding missing ownerUserId attribute to threats collection...');
      await databases.createStringAttribute(DB_ID, 'threats', 'ownerUserId', 255, false);
      await new Promise(resolve => setTimeout(resolve, 3000));
    }
  } catch (err: any) {
    logger.error('[Threats Setup] Failed to ensure ownerUserId attribute:', err);
  }
}

// Helper function to ensure pipeline_state collection exists
async function ensurePipelineStateCollection() {
  try {
    await databases.getCollection(DB_ID, 'pipeline_state');
  } catch (err: any) {
    if (err.code === 404 || err.type === 'collection_not_found') {
      logger.info('[Pipeline State Setup] pipeline_state collection not found. Creating it...');
      try {
        await databases.createCollection(DB_ID, 'pipeline_state', 'Pipeline State');
        await databases.createStringAttribute(DB_ID, 'pipeline_state', 'nodeId', 50, true);
        await databases.createStringAttribute(DB_ID, 'pipeline_state', 'status', 50, true);
        logger.info('[Pipeline State Setup] pipeline_state collection created.');
        await new Promise(resolve => setTimeout(resolve, 3000));
      } catch (createErr) {
        logger.error('[Pipeline State Setup] Error creating pipeline_state collection:', createErr);
      }
    }
  }
}

// Initialize collections asynchronously on startup/first-hit
ensureThreatsCollection();
ensurePipelineStateCollection();

// POST /api/threats/falco
router.post('/falco', verifyFalcoSecret, async (req: Request, res: Response) => {
  const event = req.body;
  logger.info(`[Falco Webhook] Received event: ${event.rule} (${event.priority})`);

  try {
    await ensureThreatsCollection();
    await ensurePipelineStateCollection();

    const rule = event.rule || 'Unknown Falco Rule';
    const priority = event.priority || 'Notice';
    const containerId = event.output_fields?.['container.id'] || 'unknown';
    const containerImage = event.output_fields?.['container.image.repository'] || 'unknown';
    const output = event.output || 'No output details available.';

    // Evaluate if the rule is blocked by dynamic policy configurations
    const isRuleBlocked = await isFalcoRuleBlocked('system', rule);
    const status = (priority === 'Critical' || priority === 'Error' || isRuleBlocked) ? 'compromised' : 'passing';

    // Correlate to a tenant so this threat isn't visible to every authenticated
    // user via GET / below. An un-owned threat stays invisible via that route.
    const ownerUserId = await resolveOwnerForContainerImage(containerImage);

    // 1. Normalize and persist to THREATS collection
    const threatDoc = await databases.createDocument(DB_ID, 'threats', ID.unique(), {
      rule,
      priority,
      containerId,
      output,
      status,
      timestamp: event.time || new Date().toISOString(),
      ...(ownerUserId ? { ownerUserId } : {})
    });

    logger.info(`[Falco Webhook] Threat successfully persisted to DB: ${threatDoc.$id}`);

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
        const existingState = await databases.listDocuments(DB_ID, 'pipeline_state', [
          Query.equal('nodeId', 'monitor'),
          Query.limit(1)
        ]);

        if (existingState.total > 0) {
          await databases.updateDocument(DB_ID, 'pipeline_state', existingState.documents[0].$id, {
            status: 'compromised'
          });
          logger.info('[Falco Webhook] Updated existing monitor node state to compromised.');
        } else {
          await databases.createDocument(DB_ID, 'pipeline_state', ID.unique(), {
            nodeId: 'monitor',
            status: 'compromised'
          });
          logger.info('[Falco Webhook] Created monitor node state as compromised.');
        }
      } catch (stateErr: any) {
        logger.error('[Falco Webhook] Failed to update pipeline_state collection:', stateErr.message);
      }
    }

    res.status(202).json({
      status: 'success',
      message: 'Threat normalized and ingested successfully',
      threatId: threatDoc.$id,
      nodeStatus: status
    });
  } catch (err: any) {
    logger.error('[Falco Webhook] Failed to process webhook event:', err);
    res.status(500).json({ error: 'Webhook processing failed', details: err.message });
  }
});

// GET /api/threats
router.get('/', verifyUser, async (req: Request, res: Response) => {
  try {
    const userId = (req as any).user?.$id;
    await ensureThreatsCollection();
    const threatsRes = await databases.listDocuments(DB_ID, 'threats', [
      Query.equal('ownerUserId', userId),
      Query.orderDesc('$createdAt'),
      Query.limit(100)
    ]);
    res.json(threatsRes.documents);
  } catch (err: any) {
    logger.error('[GET Threats API] Failed to retrieve threats:', err);
    res.status(500).json({ error: 'Failed to retrieve threats', details: err.message });
  }
});

// POST /api/threats/clear - Diagnostic endpoint to reset/clear threat state back to passing
router.post('/clear', verifyUser, async (req: Request, res: Response) => {
  try {
    const userId = (req as any).user?.$id;
    await ensureThreatsCollection();
    await ensurePipelineStateCollection();

    // Fetch the caller's own active compromised threats and set to 'passing'
    const activeThreats = await databases.listDocuments(DB_ID, 'threats', [
      Query.equal('status', 'compromised'),
      Query.equal('ownerUserId', userId),
      Query.limit(100)
    ]);

    await Promise.all(
      activeThreats.documents.map(t =>
        databases.updateDocument(DB_ID, 'threats', t.$id, {
          status: 'passing'
        })
      )
    );

    // Reset monitor node in pipeline_state
    const monitorState = await databases.listDocuments(DB_ID, 'pipeline_state', [
      Query.equal('nodeId', 'monitor'),
      Query.limit(1)
    ]);

    if (monitorState.total > 0) {
      await databases.updateDocument(DB_ID, 'pipeline_state', monitorState.documents[0].$id, {
        status: 'passing'
      });
    }

    // Write secure audit log for ALARM_CLEAR
    await logSecureAuditEvent(userId, 'ALARM_CLEAR', 'system', 'Runtime threats manually cleared and monitor node reset to passing.');

    res.json({ status: 'success', message: 'All pipeline threats cleared and reset.' });
  } catch (err: any) {
    logger.error('[Clear Threats API] Failed to reset states:', err);
    res.status(500).json({ error: 'Clear operation failed', details: err.message });
  }
});

export default router;
