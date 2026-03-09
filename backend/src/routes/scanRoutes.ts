import { Router } from 'express';
import { triggerScan } from '../services/scanService';

const router = Router();

// Trigger scan for repo
router.post('/:repoId', async (req, res) => {
  const { repoId } = req.params;

  try {
    const result = await triggerScan(repoId);

    if (result.error) {
      return res.status(400).json({ error: result.error });
    }

    return res.json({
      message: 'Scan started',
      scanId: result.scanId
    });

  } catch (err) {
    console.error('Scan route error:', err);
    res.status(500).json({ error: 'Failed to start scan' });
  }
});

export default router;
