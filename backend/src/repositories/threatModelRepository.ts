import { Models } from 'node-appwrite';
import { databases, DB_ID, COLLECTIONS, ID, Query } from '../lib/appwrite';
import { logger, errorContext } from '../services/logger';
import { isPostgresEnabled } from '../db/pool';
import { threatModelPgRepository } from './pg/threatModelPgRepository';

export type ThreatModelDocument = Models.Document & {
  name: string;
  description: string;
  diagramData: string;
  threats: string;
  createdBy: string;
  status: 'draft' | 'review' | 'final';
  createdAt: string;
  updatedAt: string;
};

const legacyThreatModelRepository = {
  async ensureCollection(): Promise<void> {
    try {
      await databases.getCollection(DB_ID, COLLECTIONS.THREAT_MODELS);
    } catch (err) {
      const isMissing = err instanceof Error && (
        (err as { code?: number }).code === 404 || (err as { type?: string }).type === 'collection_not_found'
      );
      if (isMissing) {
        logger.info('[Threat Model Repository] THREAT_MODELS collection not found. Creating it...');
        try {
          await databases.createCollection(DB_ID, COLLECTIONS.THREAT_MODELS, 'Threat Models');

          await databases.createStringAttribute(DB_ID, COLLECTIONS.THREAT_MODELS, 'name', 255, true);
          await databases.createStringAttribute(DB_ID, COLLECTIONS.THREAT_MODELS, 'description', 5000, true);
          await databases.createStringAttribute(DB_ID, COLLECTIONS.THREAT_MODELS, 'diagramData', 100000, true);
          await databases.createStringAttribute(DB_ID, COLLECTIONS.THREAT_MODELS, 'threats', 100000, true);
          await databases.createStringAttribute(DB_ID, COLLECTIONS.THREAT_MODELS, 'createdBy', 255, true);
          await databases.createStringAttribute(DB_ID, COLLECTIONS.THREAT_MODELS, 'status', 50, true);

          logger.info('[Threat Model Repository] THREAT_MODELS collection and attributes created successfully.');
          // Wait 3 seconds for attributes to propagate in Appwrite
          await new Promise(resolve => setTimeout(resolve, 3000));
        } catch (createErr) {
          logger.error('[Threat Model Repository] Error creating collection or attributes:', {
            event: 'THREAT_MODEL_COLLECTION_CREATE_FAILED', ...errorContext(createErr),
          });
        }
      } else {
        logger.error('[Threat Model Repository] Unexpected error checking threat_models collection:', {
          event: 'THREAT_MODEL_COLLECTION_CHECK_FAILED', ...errorContext(err),
        });
      }
    }
  },

  async create(data: Record<string, unknown>): Promise<ThreatModelDocument> {
    return databases.createDocument(DB_ID, COLLECTIONS.THREAT_MODELS, ID.unique(), data) as unknown as Promise<ThreatModelDocument>;
  },

  async get(id: string): Promise<ThreatModelDocument> {
    return databases.getDocument(DB_ID, COLLECTIONS.THREAT_MODELS, id);
  },

  async list(userId?: string): Promise<ThreatModelDocument[]> {
    const queries = [Query.orderDesc('$createdAt')];
    if (userId) {
      queries.push(Query.equal('createdBy', userId));
    }
    const response = await databases.listDocuments<ThreatModelDocument>(DB_ID, COLLECTIONS.THREAT_MODELS, queries);
    return response.documents;
  },

  async update(id: string, data: Record<string, unknown>): Promise<ThreatModelDocument> {
    return databases.updateDocument(DB_ID, COLLECTIONS.THREAT_MODELS, id, data);
  },

  async remove(id: string): Promise<void> {
    await databases.deleteDocument(DB_ID, COLLECTIONS.THREAT_MODELS, id);
  }
};

/** Storage facade: Postgres when DATABASE_URL is configured, legacy Appwrite otherwise. */
export const threatModelRepository: typeof legacyThreatModelRepository =
  isPostgresEnabled() ? threatModelPgRepository : legacyThreatModelRepository;
