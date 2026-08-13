import { threatModelRepository, ThreatModelDocument } from '../repositories/threatModelRepository';
import { auditLog } from './auditService';
import { logger, errorContext } from './logger';
import { ThreatModel, Threat } from '../types/threatModel.types';

export type { ThreatModel, Threat };

function toThreatModel(doc: ThreatModelDocument): ThreatModel {
  return {
    $id: doc.$id,
    name: doc.name,
    description: doc.description,
    diagramData: typeof doc.diagramData === 'string' ? JSON.parse(doc.diagramData) : doc.diagramData,
    threats: typeof doc.threats === 'string' ? JSON.parse(doc.threats) : doc.threats,
    createdBy: doc.createdBy,
    createdAt: doc.createdAt,
    updatedAt: doc.updatedAt,
    status: doc.status
  };
}

export const createThreatModel = async (
  model: Omit<ThreatModel, '$id' | 'createdAt' | 'updatedAt'>,
  userId: string,
  userEmail: string
): Promise<ThreatModel> => {
  try {
    await threatModelRepository.ensureCollection();

    const now = new Date().toISOString();
    const document = await threatModelRepository.create({
      name: model.name,
      description: model.description,
      diagramData: JSON.stringify(model.diagramData),
      threats: JSON.stringify(model.threats),
      createdBy: model.createdBy,
      status: model.status,
      createdAt: now,
      updatedAt: now
    });

    await auditLog({
      action: 'threat_model.created',
      actor: userId,
      actorEmail: userEmail,
      resource: 'threat_model',
      resourceId: document.$id,
      details: { name: model.name, status: model.status }
    });

    return toThreatModel(document);
  } catch (err) {
    logger.error('[Threat Model Service] Failed to create threat model:', { event: 'THREAT_MODEL_CREATE_FAILED', ...errorContext(err) });
    throw err;
  }
};

export const getThreatModel = async (id: string): Promise<ThreatModel | null> => {
  try {
    await threatModelRepository.ensureCollection();

    const document = await threatModelRepository.get(id);
    return toThreatModel(document);
  } catch (err) {
    if (err instanceof Error && (err as { code?: number }).code === 404) return null;
    logger.error('[Threat Model Service] Failed to get threat model:', { event: 'THREAT_MODEL_READ_FAILED', ...errorContext(err) });
    throw err;
  }
};

export const listThreatModels = async (userId?: string): Promise<ThreatModel[]> => {
  try {
    await threatModelRepository.ensureCollection();

    const documents = await threatModelRepository.list(userId);
    return documents.map(toThreatModel);
  } catch (err) {
    logger.error('[Threat Model Service] Failed to list threat models:', { event: 'THREAT_MODEL_LIST_FAILED', ...errorContext(err) });
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
    await threatModelRepository.ensureCollection();

    const updateData: Record<string, unknown> = {
      updatedAt: new Date().toISOString()
    };

    if (updates.name !== undefined) updateData.name = updates.name;
    if (updates.description !== undefined) updateData.description = updates.description;
    if (updates.diagramData !== undefined) updateData.diagramData = JSON.stringify(updates.diagramData);
    if (updates.threats !== undefined) updateData.threats = JSON.stringify(updates.threats);
    if (updates.status !== undefined) updateData.status = updates.status;

    const document = await threatModelRepository.update(id, updateData);

    await auditLog({
      action: 'threat_model.updated',
      actor: userId,
      actorEmail: userEmail,
      resource: 'threat_model',
      resourceId: id,
      details: { updates: Object.keys(updates) }
    });

    return toThreatModel(document);
  } catch (err) {
    logger.error('[Threat Model Service] Failed to update threat model:', { event: 'THREAT_MODEL_UPDATE_FAILED', ...errorContext(err) });
    throw err;
  }
};

export const deleteThreatModel = async (
  id: string,
  userId: string,
  userEmail: string
): Promise<void> => {
  try {
    await threatModelRepository.ensureCollection();

    const model = await getThreatModel(id);
    await threatModelRepository.remove(id);

    await auditLog({
      action: 'threat_model.deleted',
      actor: userId,
      actorEmail: userEmail,
      resource: 'threat_model',
      resourceId: id,
      details: { name: model?.name }
    });
  } catch (err) {
    logger.error('[Threat Model Service] Failed to delete threat model:', { event: 'THREAT_MODEL_DELETE_FAILED', ...errorContext(err) });
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
    await threatModelRepository.ensureCollection();

    const document = await threatModelRepository.update(id, {
      threats: JSON.stringify(threats),
      updatedAt: new Date().toISOString()
    });

    await auditLog({
      action: 'threat_model.analyzed',
      actor: userId,
      actorEmail: userEmail,
      resource: 'threat_model',
      resourceId: id,
      details: { threatCount: threats.length }
    });

    return toThreatModel(document);
  } catch (err) {
    logger.error('[Threat Model Service] Failed to update threats:', { event: 'THREAT_MODEL_THREATS_UPDATE_FAILED', ...errorContext(err) });
    throw err;
  }
};

// Initialize collection on first use
threatModelRepository.ensureCollection();
