import { databases, DB_ID, Query, ID } from '../lib/appwrite';
import { logger, errorContext } from '../services/logger';
import { GateBlocker, PipelineGateStatus } from '../types/gate.types';

export const gateRepository = {
  /** Ensures the pipeline_state collection exists, creating it on first use. */
  async ensurePipelineStateCollection(): Promise<void> {
    try {
      await databases.getCollection(DB_ID, 'pipeline_state');
    } catch (err) {
      const isMissing = err instanceof Error && (
        (err as { code?: number }).code === 404 || (err as { type?: string }).type === 'collection_not_found'
      );
      if (isMissing) {
        logger.info('[Pipeline State Setup] pipeline_state collection not found. Creating it...');
        try {
          await databases.createCollection(DB_ID, 'pipeline_state', 'Pipeline State');
          await databases.createStringAttribute(DB_ID, 'pipeline_state', 'nodeId', 50, true);
          await databases.createStringAttribute(DB_ID, 'pipeline_state', 'status', 50, true);
          logger.info('[Pipeline State Setup] pipeline_state collection created.');
          await new Promise(resolve => setTimeout(resolve, 3000));
        } catch (createErr) {
          logger.error('[Pipeline State Setup] Error creating pipeline_state collection:', {
            event: 'GATE_STATE_COLLECTION_CREATE_FAILED', ...errorContext(createErr),
          });
        }
      }
    }
  },

  async listOpenFindings(repoId: string): Promise<GateBlocker[]> {
    const findingsResponse = await databases.listDocuments(DB_ID, 'vulnerabilities', [
      Query.equal('repo_id', repoId),
      Query.equal('status', 'open'),
      Query.limit(100)
    ]);
    return findingsResponse.documents as unknown as GateBlocker[];
  },

  async getReleaseNodeState(): Promise<{ exists: boolean; id?: string; status?: PipelineGateStatus }> {
    const existingState = await databases.listDocuments(DB_ID, 'pipeline_state', [
      Query.equal('nodeId', 'release'),
      Query.limit(1)
    ]);
    if (existingState.total === 0) return { exists: false };
    const doc = existingState.documents[0];
    return { exists: true, id: doc.$id, status: doc.status };
  },

  async setReleaseNodeStatus(status: PipelineGateStatus): Promise<void> {
    const current = await this.getReleaseNodeState();
    if (current.exists && current.id) {
      await databases.updateDocument(DB_ID, 'pipeline_state', current.id, { status });
    } else {
      await databases.createDocument(DB_ID, 'pipeline_state', ID.unique(), { nodeId: 'release', status });
    }
  },

  async getRepository(repoId: string) {
    return databases.getDocument(DB_ID, 'repositories', repoId).catch(() => null);
  },

  async listUserRepos(userId: string) {
    return databases.listDocuments(DB_ID, 'repositories', [Query.equal('user_id', userId)]);
  }
};
