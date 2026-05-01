import { Router, Request, Response } from 'express';
import { generateSBOM } from '../services/sbomService';

const router = Router();

router.get('/:repoId', async (req: Request, res: Response) => {
    const { repoId } = req.params;
    const format = (req.query.format as 'json' | 'csv') || 'json';

    try {
        console.log(`[SBOM Route] Request for repo: ${repoId}, format: ${format}`);
        const result = await generateSBOM(repoId, format);

        if (format === 'json') {
            res.setHeader('Content-Type', 'application/json');
            res.setHeader('Content-Disposition', `attachment; filename="sbom_${repoId}.json"`);
            return res.json(result);
        } else {
            res.setHeader('Content-Type', 'text/csv');
            res.setHeader('Content-Disposition', `attachment; filename="sbom_${repoId}.csv"`);
            return res.send(result);
        }

    } catch (err: any) {
        console.error('[SBOM Route] Error:', err);
        res.status(500).json({ error: err.message || 'Failed to generate SBOM' });
    }
});

export default router;
