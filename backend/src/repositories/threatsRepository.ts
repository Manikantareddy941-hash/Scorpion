import { databases, DB_ID, COLLECTIONS, ID, Query } from '../lib/appwrite';
import { logger } from '../services/logger';
import { gateRepository } from './gateRepository';
import { ThreatStatus } from '../types/threats.types';

// Adds the ownerUserId attribute to a pre-existing threats collection that
// predates tenant-scoping, so ingestion doesn't fail against older deployments.
async function ensureOwnerUserIdAttribute(): Promise<void> {
  try {
    const attrs = await databases.listAttributes(DB_ID, 'threats');
    const hasOwnerUserId = (attrs.attributes || []).some(a => (a as { key?: string }).key === 'ownerUserId');
    if (!hasOwnerUserId) {
      logger.info('[Threats Setup] Adding missing ownerUserId attribute to threats collection...');
      await databases.createStringAttribute(DB_ID, 'threats', 'ownerUserId', 255, false);
      await new Promise(resolve => setTimeout(resolve, 3000));
    }
  } catch (err) {
    logger.error('[Threats Setup] Failed to ensure ownerUserId attribute:', err);
  }
}

export const threatsRepository = {
  async ensureThreatsCollection(): Promise<void> {
    try {
      // Try to get the collection. If it exists, return it.
      await databases.getCollection(DB_ID, 'threats');
      await ensureOwnerUserIdAttribute();
    } catch (err) {
      const isMissing = err instanceof Error && (
        (err as { code?: number }).code === 404 || (err as { type?: string }).type === 'collection_not_found'
      );
      if (isMissing) {
        logger.info('[Threats Setup] THREATS collection not found. Creating it...');
        try {
          await databases.createCollection(DB_ID, 'threats', 'Threats');

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
        } catch (createErr) {
          logger.error('[Threats Setup] Error creating collection or attributes:', createErr);
        }
      } else {
        logger.error('[Threats Setup] Unexpected error checking threats collection:', err);
      }
    }
  },

  ensurePipelineStateCollection: () => gateRepository.ensurePipelineStateCollection(),
  getRepository: (repoId: string) => gateRepository.getRepository(repoId),

  async findLatestScanByRepoUrl(repoUrl: string) {
    return databases.listDocuments(DB_ID, COLLECTIONS.SCANS, [
      Query.equal('repoUrl', repoUrl),
      Query.orderDesc('$createdAt'),
      Query.limit(1)
    ]);
  },

  async createThreat(data: Record<string, unknown>) {
    return databases.createDocument(DB_ID, 'threats', ID.unique(), data);
  },

  async listThreatsForOwner(userId: string) {
    return databases.listDocuments(DB_ID, 'threats', [
      Query.equal('ownerUserId', userId),
      Query.orderDesc('$createdAt'),
      Query.limit(100)
    ]);
  },

  async listCompromisedThreatsForOwner(userId: string) {
    return databases.listDocuments(DB_ID, 'threats', [
      Query.equal('status', 'compromised'),
      Query.equal('ownerUserId', userId),
      Query.limit(100)
    ]);
  },

  async updateThreatStatus(id: string, status: ThreatStatus) {
    return databases.updateDocument(DB_ID, 'threats', id, { status });
  },

  async getMonitorNodeState(): Promise<{ exists: boolean; id?: string }> {
    const existingState = await databases.listDocuments(DB_ID, 'pipeline_state', [
      Query.equal('nodeId', 'monitor'),
      Query.limit(1)
    ]);
    if (existingState.total === 0) return { exists: false };
    return { exists: true, id: existingState.documents[0].$id };
  },

  /** Creates the monitor node if missing, or updates it - used when a threat is ingested. */
  async setMonitorNodeStatus(status: 'compromised' | 'passing'): Promise<void> {
    const state = await this.getMonitorNodeState();
    if (state.exists && state.id) {
      await databases.updateDocument(DB_ID, 'pipeline_state', state.id, { status });
    } else {
      await databases.createDocument(DB_ID, 'pipeline_state', ID.unique(), { nodeId: 'monitor', status });
    }
  },

  /** Only updates an existing monitor node - used by /clear, which never creates one. */
  async resetMonitorNodeIfExists(): Promise<void> {
    const state = await this.getMonitorNodeState();
    if (state.exists && state.id) {
      await databases.updateDocument(DB_ID, 'pipeline_state', state.id, { status: 'passing' });
    }
  }
};
