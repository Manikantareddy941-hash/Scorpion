import { Router, Response, Request } from 'express';
import { databases, DB_ID, ID } from '../lib/appwrite';
import { verifyUser } from '../middleware/auth';
import { spawnSync } from 'child_process';
import { sendFindingAlert } from '../utils/alertDispatcher';
import fs from 'fs';
import path from 'path';
import os from 'os';

const router = Router();

router.post('/dast', verifyUser, async (req: Request, res: Response) => {
    const { target_url } = req.body;
    if (!target_url) return res.status(400).json({ error: 'target_url is required' });

    const reportPath = path.join(os.tmpdir(), `zap-report-${ID.unique()}.json`);

    try {
        console.log(`[DAST] Initializing ZAP Baseline scan for ${target_url}...`);
        
        // Use zap-baseline.py (standard ZAP docker/binary entrypoint)
        const result = spawnSync('zap-baseline.py', [
            '-t', target_url,
            '-J', reportPath,
            '-m', '5' // Max 5 minutes for baseline
        ], { encoding: 'utf8', maxBuffer: 10 * 1024 * 1024 });

        if (!fs.existsSync(reportPath)) {
            return res.status(500).json({ error: "DAST scan failed to generate report", details: result.stderr });
        }

        const reportContent = JSON.parse(fs.readFileSync(reportPath, 'utf8'));
        const site = reportContent.site?.[0] || {};
        const alerts = site.alerts || [];

        const stats = {
            total: alerts.length,
            target: target_url,
            findings: [] as any[]
        };

        for (const alert of alerts) {
            const severityMap: Record<string, string> = {
                '3': 'high',
                '2': 'medium',
                '1': 'low',
                '0': 'info'
            };

            const finding = {
                repo_id: 'dast',
                repo_name: target_url,
                type: 'dast',
                severity: severityMap[alert.riskcode] || 'medium',
                title: alert.alert,
                description: alert.desc,
                file_path: alert.instances?.[0]?.uri || target_url,
                status: 'open',
                created_at: new Date().toISOString(),
                scanId: ID.unique()
            };

            const createdFinding = await databases.createDocument(
                DB_ID,
                'findings',
                ID.unique(),
                finding
            );

            const userId = (req as any).user?.$id;
            if (userId) {
                await sendFindingAlert(createdFinding as any, userId);
            }
            
            stats.findings.push(createdFinding);
        }

        fs.unlinkSync(reportPath);
        res.json(stats);

    } catch (err: any) {
        console.error('[DAST API Error]', err.message);
        res.status(500).json({ error: 'Internal server error' });
    }
});

export default router;
