import { Router, Response, Request, NextFunction } from 'express';
import { Models, ID } from 'node-appwrite';
import { databases, DB_ID, COLLECTIONS, Query } from '../lib/appwrite';
import { getSecurityPostureStats, getTrendData, generatePDFReportBuffer } from '../services/reportingService';

interface AuthenticatedRequest extends Request {
    user?: Models.User<Models.Preferences>;
}

const router = Router();

router.get('/stats', async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
        const { scope, id } = req.query;
        const stats = await getSecurityPostureStats(req.user!.$id, (scope as any) || 'global', id as string);

        if (!stats) return res.status(404).json({ error: 'No data found for the given scope' });

        const reposDocs = await databases.listDocuments(DB_ID, COLLECTIONS.REPOSITORIES, [
            Query.equal('user_id', req.user!.$id)
        ]);

        const trend = await getTrendData(req.user!.$id, reposDocs.documents.map(r => r.$id));

        res.json({ stats, trend });
    } catch (err) {
        next(err);
    }
});

router.post('/generate', async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
        const { scope, id, title } = req.body;
        const stats = await getSecurityPostureStats(req.user!.$id, (scope as any) || 'global', id as string);

        if (!stats) return res.status(404).json({ error: 'No data found for report generation' });

        const reposDocs = await databases.listDocuments(DB_ID, COLLECTIONS.REPOSITORIES, [
            Query.equal('user_id', req.user!.$id)
        ]);

        const trend = await getTrendData(req.user!.$id, reposDocs.documents.map(r => r.$id));

        const buffer = await generatePDFReportBuffer({
            title: title || `Security Report - ${scope}`,
            stats,
            trend
        });

        await databases.createDocument(DB_ID, COLLECTIONS.SECURITY_REPORTS, ID.unique(), {
            user_id: req.user!.$id,
            scope,
            name: title || `Report ${new Date().toLocaleDateString()}`,
            stats_snapshot: JSON.stringify(stats),
            repo_id: scope === 'project' ? id : null,
            team_id: scope === 'team' ? id : null
        });

        res.setHeader('Content-Type', 'application/pdf');
        res.setHeader('Content-Disposition', `attachment; filename=StackPilot_Report_${scope}.pdf`);
        res.send(buffer);
    } catch (err) {
        next(err);
    }
});

export default router;
