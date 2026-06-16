import { databases, DB_ID, COLLECTIONS, ID, Query } from '../lib/appwrite';
import { auditLog } from './auditService';

export interface ThreatModel {
  $id?: string;
  name: string;
  description: string;
  diagramData: any;
  threats: any[];
  createdBy: string;
  createdAt?: string;
  updatedAt?: string;
  status: 'draft' | 'review' | 'final';
}

export interface Threat {
  threatId: string;
  component: string;
  strideCategory: 'Spoofing' | 'Tampering' | 'Repudiation' | 'Information Disclosure' | 'Denial of Service' | 'Elevation of Privilege';
  title: string;
  description: string;
  severity: 'low' | 'medium' | 'high' | 'critical';
  mitigations: string[];
}

// Helper function to ensure threat_models collection exists
async function ensureThreatModelsCollection() {
  try {
    await databases.getCollection(DB_ID, COLLECTIONS.THREAT_MODELS);
  } catch (err: any) {
    if (err.code === 404 || err.type === 'collection_not_found') {
      console.log('[Threat Model Service] THREAT_MODELS collection not found. Creating it...');
      try {
        await databases.createCollection(DB_ID, COLLECTIONS.THREAT_MODELS, 'Threat Models');
        
        // Create attributes
        await databases.createStringAttribute(DB_ID, COLLECTIONS.THREAT_MODELS, 'name', 255, true);
        await databases.createStringAttribute(DB_ID, COLLECTIONS.THREAT_MODELS, 'description', 5000, true);
        await databases.createStringAttribute(DB_ID, COLLECTIONS.THREAT_MODELS, 'diagramData', 100000, true);
        await databases.createStringAttribute(DB_ID, COLLECTIONS.THREAT_MODELS, 'threats', 100000, true);
        await databases.createStringAttribute(DB_ID, COLLECTIONS.THREAT_MODELS, 'createdBy', 255, true);
        await databases.createStringAttribute(DB_ID, COLLECTIONS.THREAT_MODELS, 'status', 50, true);
        
        console.log('[Threat Model Service] THREAT_MODELS collection and attributes created successfully.');
        // Wait 3 seconds for attributes to propagate in Appwrite
        await new Promise(resolve => setTimeout(resolve, 3000));
      } catch (createErr: any) {
        console.error('[Threat Model Service] Error creating collection or attributes:', createErr);
      }
    } else {
      console.error('[Threat Model Service] Unexpected error checking threat_models collection:', err);
    }
  }
}

// Initialize collection on first use
ensureThreatModelsCollection();

export const createThreatModel = async (
  model: Omit<ThreatModel, '$id' | 'createdAt' | 'updatedAt'>,
  userId: string,
  userEmail: string
): Promise<ThreatModel> => {
  try {
    await ensureThreatModelsCollection();
    
    const now = new Date().toISOString();
    const document = await databases.createDocument(DB_ID, COLLECTIONS.THREAT_MODELS, ID.unique(), {
      name: model.name,
      description: model.description,
      diagramData: JSON.stringify(model.diagramData),
      threats: JSON.stringify(model.threats),
      createdBy: model.createdBy,
      status: model.status,
      createdAt: now,
      updatedAt: now
    });

    // Log to audit
    await auditLog({
      action: 'threat_model.created',
      actor: userId,
      actorEmail: userEmail,
      resource: 'threat_model',
      resourceId: document.$id,
      details: { name: model.name, status: model.status }
    });

    return {
      $id: document.$id,
      name: document.name,
      description: document.description,
      diagramData: typeof document.diagramData === 'string' ? JSON.parse(document.diagramData) : document.diagramData,
      threats: typeof document.threats === 'string' ? JSON.parse(document.threats) : document.threats,
      createdBy: document.createdBy,
      createdAt: document.createdAt,
      updatedAt: document.updatedAt,
      status: document.status
    };
  } catch (err: any) {
    console.error('[Threat Model Service] Failed to create threat model:', err);
    throw err;
  }
};

export const getThreatModel = async (id: string): Promise<ThreatModel | null> => {
  try {
    await ensureThreatModelsCollection();
    
    const document = await databases.getDocument(DB_ID, COLLECTIONS.THREAT_MODELS, id);
    return {
      $id: document.$id,
      name: document.name,
      description: document.description,
      diagramData: typeof document.diagramData === 'string' ? JSON.parse(document.diagramData) : document.diagramData,
      threats: typeof document.threats === 'string' ? JSON.parse(document.threats) : document.threats,
      createdBy: document.createdBy,
      createdAt: document.createdAt,
      updatedAt: document.updatedAt,
      status: document.status
    };
  } catch (err: any) {
    if (err.code === 404) return null;
    console.error('[Threat Model Service] Failed to get threat model:', err);
    throw err;
  }
};

export const listThreatModels = async (userId?: string): Promise<ThreatModel[]> => {
  try {
    await ensureThreatModelsCollection();
    
    const queries = [Query.orderDesc('$createdAt')];
    if (userId) {
      queries.push(Query.equal('createdBy', userId));
    }
    
    const response = await databases.listDocuments(DB_ID, COLLECTIONS.THREAT_MODELS, queries);
    
    return response.documents.map(doc => ({
      $id: doc.$id,
      name: doc.name,
      description: doc.description,
      diagramData: typeof doc.diagramData === 'string' ? JSON.parse(doc.diagramData) : doc.diagramData,
      threats: typeof doc.threats === 'string' ? JSON.parse(doc.threats) : doc.threats,
      createdBy: doc.createdBy,
      createdAt: doc.createdAt,
      updatedAt: doc.updatedAt,
      status: doc.status
    }));
  } catch (err: any) {
    console.error('[Threat Model Service] Failed to list threat models:', err);
    throw err;
  }
};

export const updateThreatModel = async (
  id: string,
  updates: Partial<Omit<ThreatModel, '$id' | 'createdAt'>>,
  userId: string,
  userEmail: string
): Promise<ThreatModel> => {
  try {
    await ensureThreatModelsCollection();
    
    const updateData: any = {
      updatedAt: new Date().toISOString()
    };
    
    if (updates.name !== undefined) updateData.name = updates.name;
    if (updates.description !== undefined) updateData.description = updates.description;
    if (updates.diagramData !== undefined) updateData.diagramData = JSON.stringify(updates.diagramData);
    if (updates.threats !== undefined) updateData.threats = JSON.stringify(updates.threats);
    if (updates.status !== undefined) updateData.status = updates.status;
    
    const document = await databases.updateDocument(DB_ID, COLLECTIONS.THREAT_MODELS, id, updateData);

    // Log to audit
    await auditLog({
      action: 'threat_model.updated',
      actor: userId,
      actorEmail: userEmail,
      resource: 'threat_model',
      resourceId: id,
      details: { updates: Object.keys(updates) }
    });

    return {
      $id: document.$id,
      name: document.name,
      description: document.description,
      diagramData: typeof document.diagramData === 'string' ? JSON.parse(document.diagramData) : document.diagramData,
      threats: typeof document.threats === 'string' ? JSON.parse(document.threats) : document.threats,
      createdBy: document.createdBy,
      createdAt: document.createdAt,
      updatedAt: document.updatedAt,
      status: document.status
    };
  } catch (err: any) {
    console.error('[Threat Model Service] Failed to update threat model:', err);
    throw err;
  }
};

export const deleteThreatModel = async (
  id: string,
  userId: string,
  userEmail: string
): Promise<void> => {
  try {
    await ensureThreatModelsCollection();
    
    const model = await getThreatModel(id);
    await databases.deleteDocument(DB_ID, COLLECTIONS.THREAT_MODELS, id);

    // Log to audit
    await auditLog({
      action: 'threat_model.deleted',
      actor: userId,
      actorEmail: userEmail,
      resource: 'threat_model',
      resourceId: id,
      details: { name: model?.name }
    });
  } catch (err: any) {
    console.error('[Threat Model Service] Failed to delete threat model:', err);
    throw err;
  }
};

export const updateThreats = async (
  id: string,
  threats: Threat[],
  userId: string,
  userEmail: string
): Promise<ThreatModel> => {
  try {
    await ensureThreatModelsCollection();
    
    const document = await databases.updateDocument(DB_ID, COLLECTIONS.THREAT_MODELS, id, {
      threats: JSON.stringify(threats),
      updatedAt: new Date().toISOString()
    });

    // Log to audit
    await auditLog({
      action: 'threat_model.analyzed',
      actor: userId,
      actorEmail: userEmail,
      resource: 'threat_model',
      resourceId: id,
      details: { threatCount: threats.length }
    });

    return {
      $id: document.$id,
      name: document.name,
      description: document.description,
      diagramData: typeof document.diagramData === 'string' ? JSON.parse(document.diagramData) : document.diagramData,
      threats: typeof document.threats === 'string' ? JSON.parse(document.threats) : document.threats,
      createdBy: document.createdBy,
      createdAt: document.createdAt,
      updatedAt: document.updatedAt,
      status: document.status
    };
  } catch (err: any) {
    console.error('[Threat Model Service] Failed to update threats:', err);
    throw err;
  }
};
