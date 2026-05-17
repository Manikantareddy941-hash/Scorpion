import { Router, Request, Response } from 'express';
import { databases, DB_ID, COLLECTIONS, ID, Query } from '../lib/appwrite';
import { verifyUser } from '../middleware/auth';
import { logSecureAuditEvent } from '../utils/tamperAuditLogger';
import { sendSecurityAlert } from '../services/notificationService';
import { isFalcoRuleBlocked } from '../services/policyService';

const router = Router();

// Helper function to ensure THREATS collection and attributes exist
async function ensureThreatsCollection() {
  try {
    // Try to get the collection. If it exists, return it.
    await databases.getCollection(DB_ID, 'threats');
  } catch (err: any) {
    if (err.code === 404 || err.type === 'collection_not_found') {
      console.log('[Threats Setup] THREATS collection not found. Creating it...');
      try {
        await databases.createCollection(DB_ID, 'threats', 'Threats');
        
        // Create attributes
        await databases.createStringAttribute(DB_ID, 'threats', 'rule', 255, true);
        await databases.createStringAttribute(DB_ID, 'threats', 'priority', 50, true);
        await databases.createStringAttribute(DB_ID, 'threats', 'containerId', 255, true);
        await databases.createStringAttribute(DB_ID, 'threats', 'output', 5000, true);
        await databases.createStringAttribute(DB_ID, 'threats', 'status', 50, true);
        await databases.createStringAttribute(DB_ID, 'threats', 'timestamp', 255, true);
        
        console.log('[Threats Setup] THREATS collection and attributes created successfully.');
        // Wait 3 seconds for attributes to propagate in Appwrite
        await new Promise(resolve => setTimeout(resolve, 3000));
      } catch (createErr: any) {
        console.error('[Threats Setup] Error creating collection or attributes:', createErr);
      }
    } else {
      console.error('[Threats Setup] Unexpected error checking threats collection:', err);
    }
  }
}

// Helper function to ensure pipeline_state collection exists
async function ensurePipelineStateCollection() {
  try {
    await databases.getCollection(DB_ID, 'pipeline_state');
  } catch (err: any) {
    if (err.code === 404 || err.type === 'collection_not_found') {
      console.log('[Pipeline State Setup] pipeline_state collection not found. Creating it...');
      try {
        await databases.createCollection(DB_ID, 'pipeline_state', 'Pipeline State');
        await databases.createStringAttribute(DB_ID, 'pipeline_state', 'nodeId', 50, true);
        await databases.createStringAttribute(DB_ID, 'pipeline_state', 'status', 50, true);
        console.log('[Pipeline State Setup] pipeline_state collection created.');
        await new Promise(resolve => setTimeout(resolve, 3000));
      } catch (createErr) {
        console.error('[Pipeline State Setup] Error creating pipeline_state collection:', createErr);
      }
    }
  }
}

// Initialize collections asynchronously on startup/first-hit
ensureThreatsCollection();
ensurePipelineStateCollection();

// POST /api/threats/falco
router.post('/falco', async (req: Request, res: Response) => {
  const event = req.body;
  console.log(`[Falco Webhook] Received event: ${event.rule} (${event.priority})`);

  try {
    await ensureThreatsCollection();
    await ensurePipelineStateCollection();

    const rule = event.rule || 'Unknown Falco Rule';
    const priority = event.priority || 'Notice';
    const containerId = event.output_fields?.['container.id'] || 'unknown';
    const output = event.output || 'No output details available.';
    
    // Evaluate if the rule is blocked by dynamic policy configurations
    const isRuleBlocked = await isFalcoRuleBlocked('system', rule);
    const status = (priority === 'Critical' || priority === 'Error' || isRuleBlocked) ? 'compromised' : 'passing';

    // 1. Normalize and persist to THREATS collection
    const threatDoc = await databases.createDocument(DB_ID, 'threats', ID.unique(), {
      rule,
      priority,
      containerId,
      output,
      status,
      timestamp: event.time || new Date().toISOString()
    });

    console.log(`[Falco Webhook] Threat successfully persisted to DB: ${threatDoc.$id}`);

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
          console.log('[Falco Webhook] Updated existing monitor node state to compromised.');
        } else {
          await databases.createDocument(DB_ID, 'pipeline_state', ID.unique(), {
            nodeId: 'monitor',
            status: 'compromised'
          });
          console.log('[Falco Webhook] Created monitor node state as compromised.');
        }
      } catch (stateErr: any) {
        console.error('[Falco Webhook] Failed to update pipeline_state collection:', stateErr.message);
      }
    }

    res.status(202).json({
      status: 'success',
      message: 'Threat normalized and ingested successfully',
      threatId: threatDoc.$id,
      nodeStatus: status
    });
  } catch (err: any) {
    console.error('[Falco Webhook] Failed to process webhook event:', err);
    res.status(500).json({ error: 'Webhook processing failed', details: err.message });
  }
});

// GET /api/threats
router.get('/', async (req: Request, res: Response) => {
  try {
    await ensureThreatsCollection();
    const threatsRes = await databases.listDocuments(DB_ID, 'threats', [
      Query.orderDesc('$createdAt'),
      Query.limit(100)
    ]);
    res.json(threatsRes.documents);
  } catch (err: any) {
    console.error('[GET Threats API] Failed to retrieve threats:', err);
    res.status(500).json({ error: 'Failed to retrieve threats', details: err.message });
  }
});

// POST /api/threats/clear - Diagnostic endpoint to reset/clear threat state back to passing
router.post('/clear', async (req: Request, res: Response) => {
  try {
    await ensureThreatsCollection();
    await ensurePipelineStateCollection();

    // Fetch active compromised threats and set to 'passing' or clear
    const activeThreats = await databases.listDocuments(DB_ID, 'threats', [
      Query.equal('status', 'compromised'),
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
    await logSecureAuditEvent('system', 'ALARM_CLEAR', 'system', 'Runtime threats manually cleared and monitor node reset to passing.');

    res.json({ status: 'success', message: 'All pipeline threats cleared and reset.' });
  } catch (err: any) {
    console.error('[Clear Threats API] Failed to reset states:', err);
    res.status(500).json({ error: 'Clear operation failed', details: err.message });
  }
});

export default router;
