import { Router, Response, Request } from 'express';
import { databases, DB_ID, Query, ID } from '../lib/appwrite';
import { verifyUser } from '../middleware/auth';
import { spawnSync } from 'child_process';
import { sendFindingAlert } from '../utils/alertDispatcher';

const router = Router();

router.post('/docker', verifyUser, async (req: Request, res: Response) => {
    const { image_name } = req.body;
    if (!image_name) return res.status(400).json({ error: 'image_name is required' });

    // Check if trivy is available
    const trivyCheck = spawnSync('trivy', ['--version']);
    if (trivyCheck.status !== 0) {
        return res.status(503).json({ error: "Trivy not available" });
    }

    try {
        console.log(`[DockerScan] Scanning image: ${image_name}...`);
        const result = spawnSync('trivy', [
            'image',
            '--format', 'json',
            image_name
        ], { encoding: 'utf8', maxBuffer: 20 * 1024 * 1024 });

        if (result.status !== 0) {
            return res.status(500).json({ error: "Trivy scan failed", details: result.stderr });
        }

        const output = JSON.parse(result.stdout || '{"Results": []}');
        const vulnerabilities = (output.Results || []).flatMap((r: any) => r.Vulnerabilities || []);

        const stats = {
            total: vulnerabilities.length,
            by_severity: { critical: 0, high: 0, medium: 0, low: 0 } as Record<string, number>,
            image_name
        };

        for (const vuln of vulnerabilities) {
            const severity = vuln.Severity?.toLowerCase() || 'low';
            if (stats.by_severity.hasOwnProperty(severity)) {
                stats.by_severity[severity]++;
            }

            const finding = {
                repo_id: 'docker',
                repo_name: image_name,
                type: 'docker',
                severity: severity,
                title: `${vuln.PkgName} (${vuln.InstalledVersion})`,
                description: `Fixed Version: ${vuln.FixedVersion || 'N/A'}`,
                cve_id: vuln.VulnerabilityID,
                file_path: image_name,
                status: 'open',
                created_at: new Date().toISOString(),
                scanId: ID.unique()
            };

            // Write to Appwrite
            const createdFinding = await databases.createDocument(
                DB_ID,
                'findings',
                ID.unique(),
                finding
            );

            // Alert Dispatcher
            const userId = (req as any).user?.$id;
            if (userId) {
                await sendFindingAlert(createdFinding as any, userId);
            }
        }

        res.json(stats);

    } catch (err: any) {
        console.error('[Docker API Error]', err.message);
        res.status(500).json({ error: 'Internal server error' });
    }
});

export default router;
