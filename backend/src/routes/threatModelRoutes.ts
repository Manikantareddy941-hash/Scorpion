import { Router, Request, Response } from 'express';
import { verifyUser } from '../middleware/auth';
import {
  createThreatModel,
  getThreatModel,
  listThreatModels,
  updateThreatModel,
  deleteThreatModel,
  updateThreats
} from '../services/threatModelService';
import { generateStrideThreats } from '../services/threatAiService';
import { logger } from '../services/logger';

const router = Router();

// All routes require authentication
router.use(verifyUser);

// POST /api/threat-models - Create new threat model
router.post('/', async (req: Request, res: Response) => {
  try {
    const { name, description, diagramData, threats, createdBy, status } = req.body;
    const userId = (req as any).user?.$id || 'unknown';
    const userEmail = (req as any).user?.email || 'unknown';

    if (!name || !createdBy) {
      return res.status(400).json({ error: 'Name and createdBy are required' });
    }

    const model = await createThreatModel(
      {
        name,
        description: description || '',
        diagramData: diagramData || { nodes: [], edges: [] },
        threats: threats || [],
        createdBy,
        status: status || 'draft'
      },
      userId,
      userEmail
    );

    res.status(201).json(model);
  } catch (err: any) {
    logger.error('[Threat Model Routes] Failed to create threat model:', err);
    res.status(500).json({ error: 'Failed to create threat model', details: err.message });
  }
});

// GET /api/threat-models - List all threat models
router.get('/', async (req: Request, res: Response) => {
  try {
    const userId = (req as any).user?.$id;
    const models = await listThreatModels(userId);
    res.json(models);
  } catch (err: any) {
    logger.error('[Threat Model Routes] Failed to list threat models:', err);
    res.status(500).json({ error: 'Failed to list threat models', details: err.message });
  }
});

// GET /api/threat-models/:id - Fetch single threat model
router.get('/:id', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const userId = (req as any).user?.$id;
    const model = await getThreatModel(id);

    if (!model) {
      return res.status(404).json({ error: 'Threat model not found' });
    }
    if (model.createdBy !== userId) {
      return res.status(403).json({ error: 'You do not have access to this threat model' });
    }

    res.json(model);
  } catch (err: any) {
    logger.error('[Threat Model Routes] Failed to get threat model:', err);
    res.status(500).json({ error: 'Failed to get threat model', details: err.message });
  }
});

// PUT /api/threat-models/:id - Update threat model
router.put('/:id', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const { name, description, diagramData, threats, status } = req.body;
    const userId = (req as any).user?.$id || 'unknown';
    const userEmail = (req as any).user?.email || 'unknown';

    const existing = await getThreatModel(id);
    if (!existing) return res.status(404).json({ error: 'Threat model not found' });
    if (existing.createdBy !== userId) {
      return res.status(403).json({ error: 'You do not have access to this threat model' });
    }

    const updates: any = {};
    if (name !== undefined) updates.name = name;
    if (description !== undefined) updates.description = description;
    if (diagramData !== undefined) updates.diagramData = diagramData;
    if (threats !== undefined) updates.threats = threats;
    if (status !== undefined) updates.status = status;

    const model = await updateThreatModel(id, updates, userId, userEmail);
    res.json(model);
  } catch (err: any) {
    logger.error('[Threat Model Routes] Failed to update threat model:', err);
    res.status(500).json({ error: 'Failed to update threat model', details: err.message });
  }
});

// DELETE /api/threat-models/:id - Delete threat model
router.delete('/:id', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const userId = (req as any).user?.$id || 'unknown';
    const userEmail = (req as any).user?.email || 'unknown';

    const existing = await getThreatModel(id);
    if (!existing) return res.status(404).json({ error: 'Threat model not found' });
    if (existing.createdBy !== userId) {
      return res.status(403).json({ error: 'You do not have access to this threat model' });
    }

    await deleteThreatModel(id, userId, userEmail);
    res.json({ success: true, message: 'Threat model deleted successfully' });
  } catch (err: any) {
    logger.error('[Threat Model Routes] Failed to delete threat model:', err);
    res.status(500).json({ error: 'Failed to delete threat model', details: err.message });
  }
});

// POST /api/threat-models/:id/analyze - Trigger AI STRIDE analysis
router.post('/:id/analyze', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const userId = (req as any).user?.$id || 'unknown';
    const userEmail = (req as any).user?.email || 'unknown';

    // Get the current model
    const model = await getThreatModel(id);
    if (!model) {
      return res.status(404).json({ error: 'Threat model not found' });
    }
    if (model.createdBy !== userId) {
      return res.status(403).json({ error: 'You do not have access to this threat model' });
    }

    // Generate STRIDE threats using AI
    const threats = await generateStrideThreats(model.diagramData);

    // Update the model with new threats
    const updatedModel = await updateThreats(id, threats, userId, userEmail);

    res.json(updatedModel);
  } catch (err: any) {
    logger.error('[Threat Model Routes] Failed to analyze threat model:', err);
    res.status(500).json({ error: 'Failed to analyze threat model', details: err.message });
  }
});

export default router;
